import React, { useState, useRef, useMemo } from "react";
import { fmt } from "@/lib/api";
import { useCompany } from "@/lib/company";
import { useBranding } from "@/lib/branding";
import { useAuth } from "@/lib/auth";
import { useLang, useT } from "@/lib/i18n";
import CompanyLogo from "@/components/CompanyLogo";
import { X, Printer, Send } from "lucide-react";
import { buildEmailHtml, buildEmailSubject, defaultEmailGreeting } from "@/lib/emailQuote";
import { tSection, tItem, tUnit } from "@/lib/catalogTranslations";

export default function QuoteModal({ estimate, totals, onClose, emailConfigured, onEmail }) {
  const { company } = useCompany();
  const branding = useBranding();
  const { user } = useAuth();
  const { lang: uiLang } = useLang();
  const t = useT();
  const [email, setEmail] = useState("");
  // Per-estimate send language — defaults to the contractor's current UI lang,
  // but the contractor can flip it before sending. Note for the contractor only:
  // the message body resets when they change languages so they don't accidentally
  // send a Spanish quote with an English greeting.
  const [sendLang, setSendLang] = useState(uiLang);
  const [message, setMessage] = useState(() =>
    defaultEmailGreeting({ estimate, company, lang: uiLang })
  );
  const [sending, setSending] = useState(false);
  const printRef = useRef();
  const showSupplierFooter = company?.quote_footer_enabled !== false;

  // When the contractor flips EN/ES, refresh the greeting to match. We DON'T
  // overwrite the message if they've already customized it (i.e. it differs
  // from the last default we generated). Capture the old default BEFORE
  // mutating the ref so the setMessage callback compares against the right value.
  const lastDefaultRef = useRef(defaultEmailGreeting({ estimate, company, lang: uiLang }));
  React.useEffect(() => {
    const oldDefault = lastDefaultRef.current;
    const nextDefault = defaultEmailGreeting({ estimate, company, lang: sendLang });
    lastDefaultRef.current = nextDefault;
    setMessage((prev) => (prev === oldDefault ? nextDefault : prev));
  }, [sendLang, estimate, company]);

  const subject = useMemo(
    () => buildEmailSubject({ estimate, company, lang: sendLang }),
    [estimate, company, sendLang]
  );

  // Stable accept token for this customer-facing quote. Reuse any existing one
  // saved on the estimate (so the link stays valid across re-sends) or mint a
  // fresh UUID4 client-side.
  const acceptToken = useMemo(
    () => estimate.accept_token || (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    [estimate.accept_token]
  );
  // Tack the language onto the accept link so the customer's hosted page
  // matches the language of their email/PDF.
  const acceptUrl = `${window.location.origin}/accept/${acceptToken}?lang=${sendLang}`;

  const linesWithQty = (estimate.lines || []).filter((l) => (l.qty || 0) > 0);
  // Group by TAB first, then by section within each tab. Some section names
  // (e.g. "Siding Accessories", "Vinyl Soffit with Siding", "Misc.") are
  // used on both the Vinyl and Ascend tabs — without the tab-level grouping
  // their items would land in one mixed bucket, which is what Howard hit
  // when he ran a hybrid Vinyl + Ascend estimate.
  const TAB_LABEL = {
    vinyl: "Vinyl Siding",
    ascend: "Ascend Composite Siding",
    windows: "Windows",
    iss: "ISS Siding",
  };
  const TAB_ORDER = ["vinyl", "ascend", "windows", "iss"];
  const linesByTab = linesWithQty.reduce((acc, l) => {
    const tab = l.tab || "vinyl";
    (acc[tab] = acc[tab] || {});
    (acc[tab][l.section] = acc[tab][l.section] || []).push(l);
    return acc;
  }, {});
  const tabOrder = TAB_ORDER.filter((t) => linesByTab[t]);

  const handleEmail = async () => {
    if (!email) return;
    setSending(true);
    // Build an email-safe HTML (inline styles, table layout) instead of dumping the on-screen DOM.
    const html = buildEmailHtml({
      estimate,
      totals,
      company,
      branding,
      message,
      acceptUrl,
      acceptEmail: user?.email,
      lang: sendLang,
    });
    const ok = await onEmail({ recipient_email: email, html, subject, accept_token: acceptToken });
    setSending(false);
    if (ok) onClose();
  };

  const handleDownloadPdf = async () => {
    setSending(true);
    try {
      const html = buildEmailHtml({
        estimate, totals, company, branding, message,
        acceptUrl,
        acceptEmail: user?.email,
        lang: sendLang,
      });
      const res = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/estimates/${estimate.id}/pdf`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_email: "noreply@noreply.com", html_quote: html }),
        }
      );
      if (!res.ok) throw new Error(`PDF request failed: ${res.status}`);
      const blob = await res.blob();
      // Pull filename from Content-Disposition if present
      const dispo = res.headers.get("content-disposition") || "";
      const match = dispo.match(/filename="?([^";]+)"?/);
      const filename = match ? match[1] : `estimate-${estimate.estimate_number || estimate.id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`Could not generate PDF: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#09090B]/70 backdrop-blur-sm overflow-y-auto" data-testid="quote-modal">
      <div className="min-h-screen flex flex-col items-center py-6 sm:py-10 px-4">
        {/* Floating action bar */}
        <div className="no-print w-full max-w-3xl flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:flex-1">
            <input
              type="email"
              className="input bg-white h-12 md:h-9 text-base md:text-sm"
              placeholder={t("quote.recipientPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="email-recipient"
              style={{ minWidth: 240 }}
            />
            <button
              className="btn-primary h-12 md:h-9 justify-center md:justify-start"
              onClick={handleEmail}
              disabled={!email || sending || !emailConfigured}
              data-testid="send-email-btn"
              title={!emailConfigured ? "Add RESEND_API_KEY in backend/.env to enable" : ""}
            >
              <Send className="w-4 h-4" /> {sending ? t("quote.sending") : t("quote.emailBtn")}
            </button>
          </div>
          <div className="flex items-center gap-2 justify-between md:justify-end">
            <button
              className="btn-secondary h-12 md:h-9 flex-1 md:flex-none justify-center md:justify-start"
              onClick={handleDownloadPdf}
              disabled={sending}
              data-testid="download-pdf-btn"
              title={t("quote.downloadPdf")}
            >
              <Printer className="w-4 h-4" /> {sending ? "…" : t("quote.downloadPdf")}
            </button>
            <button
              className="btn-ghost text-white hover:text-white p-3 md:p-1"
              onClick={onClose}
              data-testid="quote-close-btn"
              aria-label={t("common.close")}
            >
              <X className="w-6 h-6 md:w-5 md:h-5" />
            </button>
          </div>
        </div>

        {/* Editable email preamble + send-language picker */}
        <div className="no-print w-full max-w-3xl mb-4 bg-white border border-[#E4E4E7] p-4" data-testid="email-preamble">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">
              {t("quote.subject")}
            </div>
            <div className="flex items-center gap-2" data-testid="send-lang-picker">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">
                {t("quote.langPicker")}
              </span>
              <div className="inline-flex border border-[#E4E4E7] rounded-sm overflow-hidden text-[11px] font-bold uppercase tracking-wider">
                <button
                  type="button"
                  onClick={() => setSendLang("en")}
                  className={`px-2.5 py-1 ${sendLang === "en" ? "bg-[#09090B] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"}`}
                  data-testid="send-lang-en"
                >EN</button>
                <button
                  type="button"
                  onClick={() => setSendLang("es")}
                  className={`px-2.5 py-1 border-l border-[#E4E4E7] ${sendLang === "es" ? "bg-[#09090B] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"}`}
                  data-testid="send-lang-es"
                >ES</button>
              </div>
            </div>
          </div>
          <div className="text-sm font-mono-num text-[#09090B] mb-3 break-words">{subject}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-1">
            {t("quote.personalNote")}
          </div>
          <textarea
            className="input w-full"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("quote.personalNote")}
            data-testid="email-message"
            style={{ resize: "vertical", minHeight: 96 }}
          />
          <div className="text-[11px] text-[#71717A] mt-1">
            {t("quote.personalNoteHelp")}
          </div>
        </div>
        {!emailConfigured && (
          <div className="no-print w-full max-w-3xl mb-3 text-xs text-amber-200 bg-amber-900/40 border border-amber-200/40 px-3 py-2">
            {t("quote.emailNotConfigured")}
          </div>
        )}

        {/* The printable quote */}
        <div
          ref={printRef}
          className="quote-page w-full max-w-3xl bg-white shadow-xl border border-[#09090B]"
          data-testid="quote-page"
        >
          <div className="border-b-4 border-[#F97316] px-8 sm:px-12 py-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <CompanyLogo company={company} size={56} />
              <div>
                <div className="font-heading text-2xl text-[#09090B]" style={{ minHeight: "1em" }}>
                  {company?.name || "\u00A0"}
                </div>
                <div className="text-xs uppercase tracking-[0.25em] text-[#52525B]">
                  Estimate · Quote
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[#A1A1AA]">Estimate</div>
              <div className="font-mono-num text-lg text-[#09090B]">{estimate.estimate_number}</div>
              <div className="text-xs text-[#52525B]">{estimate.estimate_date}</div>
            </div>
          </div>

          <div className="px-8 sm:px-12 py-6 grid grid-cols-2 gap-6 border-b border-[#E4E4E7]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mb-1 font-bold">
                Prepared For
              </div>
              <div className="font-semibold text-[#09090B]">{estimate.customer_name || "—"}</div>
              <div className="text-sm text-[#52525B]">{estimate.address || ""}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mb-1 font-bold">
                Estimator
              </div>
              <div className="font-semibold text-[#09090B]">{estimate.estimator || "—"}</div>
            </div>
          </div>

          {estimate.notes && (
            <div className="px-8 sm:px-12 py-5 border-b border-[#E4E4E7]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mb-2 font-bold">
                Scope of Work
              </div>
              <div className="text-sm whitespace-pre-line text-[#09090B]">{estimate.notes}</div>
            </div>
          )}

          {/* Iter 71 — Per-Elevation Siding Breakdown card. Renders when
              HOVER import populated `hover_measurements.per_elevation_siding`.
              Mirrors the same block in `buildEmailHtml` so the on-screen
              preview matches the customer-facing email/PDF. */}
          {(() => {
            const elev = estimate.hover_measurements?.per_elevation_siding;
            if (!elev) return null;
            const entries = Object.entries(elev).filter(([, v]) => Number(v) > 0);
            if (entries.length === 0) return null;
            const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0);
            const labels = { front: "Front", back: "Back", left: "Left", right: "Right" };
            return (
              <div className="px-8 sm:px-12 py-5 border-b border-[#E4E4E7]" data-testid="per-elevation-card">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mb-3 font-bold">
                  Per-Elevation Siding Breakdown
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {entries.map(([key, sqft]) => {
                      const pct = total > 0 ? Math.round((Number(sqft) / total) * 100) : 0;
                      return (
                        <tr key={key} className="border-b border-[#E4E4E7]">
                          <td className="py-2 text-[#09090B] w-[28%]">{labels[key] || key}</td>
                          <td className="py-2 px-2 w-[52%]">
                            <div className="h-1.5 bg-[#E4E4E7] w-full">
                              <div className="h-1.5 bg-[#F97316]" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="py-2 text-right text-[#09090B] font-semibold font-mono-num whitespace-nowrap w-[20%]">
                            {Math.round(Number(sqft)).toLocaleString()} ft²
                            <span className="text-[#A1A1AA] font-normal"> · {pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="pt-3 text-[#52525B] font-semibold">Total Siding Area</td>
                      <td></td>
                      <td className="pt-3 text-right text-[#09090B] font-bold font-mono-num whitespace-nowrap">
                        {Math.round(total).toLocaleString()} ft²
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div className="px-8 sm:px-12 py-6">
            {tabOrder.map((tabId) => (
              <div key={tabId} className="mb-6">
                <div className="text-[10px] uppercase tracking-[0.25em] font-bold text-[#A1A1AA] mb-2">
                  {TAB_LABEL[tabId]}
                </div>
                {Object.entries(linesByTab[tabId]).map(([section, items]) => (
                  <div key={section} className="mb-4">
                    <div className="text-xs uppercase tracking-[0.18em] font-bold text-[#F97316] border-b border-[#09090B] pb-1 mb-2">
                      {tSection(section, sendLang)}
                    </div>
                    {items.map((l) => (
                      <div key={l.name} className="flex justify-between py-1 text-sm">
                        <span className="text-[#09090B]">{tItem(l.name, sendLang)}</span>
                        <span className="text-[#52525B] font-mono-num">
                          {l.qty} {tUnit(l.unit, sendLang)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {(estimate.photos || []).length > 0 && (
            <div className="px-8 sm:px-12 py-4 border-t border-[#E4E4E7]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mb-3 font-bold">
                Job Photos
              </div>
              <div className="grid grid-cols-3 gap-3">
                {estimate.photos.map((p, i) => (
                  <img
                    key={`${p}-${i}`}
                    src={`${process.env.REACT_APP_BACKEND_URL}${p}`}
                    alt=""
                    className="aspect-square object-cover border border-[#E4E4E7]"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="px-8 sm:px-12 py-6 border-t-4 border-[#09090B] bg-[#FAFAFA]">
            <div className="flex justify-between items-baseline">
              <div className="font-heading text-2xl text-[#09090B]">Total Price</div>
              <div className="font-mono-num text-4xl font-black text-[#09090B]">
                {fmt(totals.sell)}
              </div>
            </div>
            <div className="text-xs text-[#52525B] mt-2">
              Valid for 30 days from the date above. Final price may vary based on site conditions discovered after work begins.
            </div>
          </div>

          <div className="px-8 sm:px-12 py-8 grid grid-cols-2 gap-8">
            <div>
              <div className="border-b border-[#09090B] h-8" />
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mt-1 font-bold">
                Customer Signature
              </div>
            </div>
            <div>
              <div className="border-b border-[#09090B] h-8" />
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] mt-1 font-bold">
                Date
              </div>
            </div>
          </div>

          {showSupplierFooter && (
            <div
              className="border-t border-[#E4E4E7] px-8 sm:px-12 py-3 text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] text-center"
              data-testid="supplier-footer"
            >
              Materials supplied by {branding.supplier_name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

