import React, { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import api, { API, formatApiError } from "@/lib/api";
import { useT, useLang } from "@/lib/i18n";
import { useCompany } from "@/lib/company";
import { useBranding } from "@/lib/branding";
import useEstimate from "@/lib/useEstimate";
import { calcTotals } from "@/lib/calc";
import { buildMaterialListHtml, materialListFilename } from "@/lib/materialList";
import StickyBar from "@/components/estimate/StickyBar";
import JobInfoPanel from "@/components/estimate/JobInfoPanel";
import SettingsRow from "@/components/estimate/SettingsRow";
import PhotosPanel from "@/components/estimate/PhotosPanel";
import SectionAccordion from "@/components/estimate/SectionAccordion";
import TotalsSummary from "@/components/estimate/TotalsSummary";
import CatalogSyncBanner from "@/components/estimate/CatalogSyncBanner";
import EstimatorTabs from "@/components/estimate/EstimatorTabs";
import QuoteModal from "@/components/QuoteModal";

export default function EstimateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const t = useT();
  const { lang } = useLang();
  const { company } = useCompany();
  const branding = useBranding();
  const { est, catalog, loading, emailStatus, update, updateLineQty, updateLineField, resetLineToDefault, save } = useEstimate(id);
  // Start with every section collapsed so the editor stays compact —
  // contractors expand only the categories they need for the job.
  const [openSections, setOpenSections] = useState({});
  const [saving, setSaving] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  // Active product-line tab. "vinyl" is the default for back-compat with
  // single-product legacy quotes — opening an existing estimate lands on
  // the Vinyl tab regardless of what's saved.
  const [activeTab, setActiveTab] = useState("vinyl");

  const totals = useMemo(() => (est ? calcTotals(est) : null), [est]);

  if (loading || !est) {
    if (est === false) {
      setTimeout(() => nav("/"), 0);
    }
    return (
      <div className="flex items-center justify-center h-[60vh] text-[#52525B]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t("est.loading")}
      </div>
    );
  }

  // Filter catalog sections to those that belong to the active tab. Each
  // section declares its `product_lines` (vinyl / ascend / lp_smart). Legacy
  // tier docs without this field default to ["vinyl", "ascend"] server-side.
  const visibleSections = catalog.filter((s) =>
    (s.product_lines || ["vinyl", "ascend"]).includes(activeTab)
  );

  // Lines grouped by section, scoped to the active tab. The catalog merge
  // in useEstimate creates one line entry per (tab, section, name), so we
  // just slice by activeTab here.
  const linesBySection = est.lines
    .filter((l) => (l.tab || "vinyl") === activeTab)
    .reduce((acc, l) => {
      (acc[l.section] = acc[l.section] || []).push(l);
      return acc;
    }, {});

  const handleSave = async () => {
    setSaving(true);
    await save();
    setSaving(false);
  };

  const handleExportCsv = async () => {
    try {
      const res = await api.get(`/exports/estimates/${id}.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estimate_${est.estimate_number || id}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handlePrintMaterials = async () => {
    // Save first so the server has the latest qty/color before we render the PDF.
    await handleSave();
    // Build the material-list HTML on the client, then reuse the existing
    // estimate-PDF endpoint (which accepts arbitrary html).
    const html = buildMaterialListHtml({ estimate: est, company, branding, lang });
    try {
      const res = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/estimates/${id}/pdf`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_email: "noreply@noreply.com", html_quote: html }),
        }
      );
      if (!res.ok) throw new Error(`PDF render failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = materialListFilename(est);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Could not generate material list: ${e.message}`);
    }
  };

  return (
    <>
      <StickyBar est={est} totals={totals} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24" data-testid="estimate-editor">
        <CatalogSyncBanner est={est} update={update} />
        <JobInfoPanel est={est} update={update} />
        <SettingsRow est={est} update={update} />
        <PhotosPanel est={est} update={update} />

        <EstimatorTabs est={est} activeTab={activeTab} onChange={setActiveTab} />

        {visibleSections.length === 0 ? (
          <div
            className="card p-8 text-center"
            data-testid={`empty-tab-${activeTab}`}
          >
            <div className="section-tag mb-3">LP Smart Siding</div>
            <p className="text-sm text-[#52525B] max-w-md mx-auto">
              The LP SmartSide catalog hasn't been loaded yet. Send Howard your
              LP Smart Siding price sheet (Excel/CSV) and it'll populate here.
            </p>
          </div>
        ) : (
          visibleSections.map((s) => (
            <SectionAccordion
              key={s.title}
              section={s}
              lines={linesBySection[s.title] || []}
              isOpen={!!openSections[s.title]}
              onToggle={() => setOpenSections((o) => ({ ...o, [s.title]: !o[s.title] }))}
              onQty={updateLineQty}
              onField={updateLineField}
              onResetLine={resetLineToDefault}
              est={est}
              update={update}
              activeTab={activeTab}
            />
          ))
        )}

        <TotalsSummary
          est={est}
          totals={totals}
          saving={saving}
          onSave={handleSave}
          onOpenQuote={async () => {
            await handleSave();
            setShowQuote(true);
          }}
          onPrint={() => window.print()}
          onExportCsv={handleExportCsv}
          onPrintMaterials={handlePrintMaterials}
        />
      </main>

      {showQuote && (
        <QuoteModal
          estimate={est}
          totals={totals}
          onClose={() => setShowQuote(false)}
          emailConfigured={emailStatus.configured}
          onEmail={async ({ recipient_email, html, subject, accept_token }) => {
            try {
              await api.post(`/estimates/${id}/email`, {
                recipient_email,
                html_quote: html,
                subject,
                accept_token,
              });
              toast.success(t("quote.sentToast"));
              // Refresh local estimate so the dashboard badge updates.
              try {
                const { data } = await api.get(`/estimates/${id}`);
                if (data) Object.assign(est, data);
              } catch { /* non-fatal */ }
              return true;
            } catch (e) {
              toast.error(formatApiError(e.response?.data?.detail));
              return false;
            }
          }}
        />
      )}
    </>
  );
}
