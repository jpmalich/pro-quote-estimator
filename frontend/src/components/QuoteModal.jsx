import React, { useState, useRef } from "react";
import { fmt } from "@/lib/api";
import { X, Printer, Mail, Send } from "lucide-react";

export default function QuoteModal({ estimate, totals, onClose, emailConfigured, onEmail }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const printRef = useRef();

  const linesWithQty = (estimate.lines || []).filter((l) => (l.qty || 0) > 0);
  const linesBySection = linesWithQty.reduce((acc, l) => {
    (acc[l.section] = acc[l.section] || []).push(l);
    return acc;
  }, {});

  const handleEmail = async () => {
    if (!email) return;
    setSending(true);
    const html = printRef.current?.outerHTML || "";
    const ok = await onEmail(email, html);
    setSending(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#09090B]/70 backdrop-blur-sm overflow-y-auto" data-testid="quote-modal">
      <div className="min-h-screen flex flex-col items-center py-6 sm:py-10 px-4">
        {/* Floating action bar */}
        <div className="no-print w-full max-w-3xl flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              className="input bg-white"
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="email-recipient"
              style={{ minWidth: 240 }}
            />
            <button
              className="btn-primary"
              onClick={handleEmail}
              disabled={!email || sending || !emailConfigured}
              data-testid="send-email-btn"
              title={!emailConfigured ? "Add RESEND_API_KEY in backend/.env to enable" : ""}
            >
              <Send className="w-4 h-4" /> {sending ? "Sending…" : "Email"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => window.print()} data-testid="quote-print-btn">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
            <button className="btn-ghost text-white hover:text-white" onClick={onClose} data-testid="quote-close-btn">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {!emailConfigured && (
          <div className="no-print w-full max-w-3xl mb-3 text-xs text-amber-200 bg-amber-900/40 border border-amber-200/40 px-3 py-2">
            Email service not configured. Add <code className="font-mono">RESEND_API_KEY</code> in <code className="font-mono">backend/.env</code> to enable sending.
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
              <div className="w-14 h-14 bg-[#09090B] text-[#F97316] flex items-center justify-center text-2xl font-black">
                W
              </div>
              <div>
                <div className="font-heading text-2xl text-[#09090B]">Wolf and Son</div>
                <div className="text-xs uppercase tracking-[0.25em] text-[#52525B]">
                  Renovations LLC
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

          <div className="px-8 sm:px-12 py-6">
            {Object.entries(linesBySection).map(([section, items]) => (
              <div key={section} className="mb-5">
                <div className="text-xs uppercase tracking-[0.18em] font-bold text-[#F97316] border-b border-[#09090B] pb-1 mb-2">
                  {section}
                </div>
                {items.map((l) => (
                  <div key={l.name} className="flex justify-between py-1 text-sm">
                    <span className="text-[#09090B]">{l.name}</span>
                    <span className="text-[#52525B] font-mono-num">
                      {l.qty} {l.unit}
                    </span>
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
                    key={i}
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
        </div>
      </div>
    </div>
  );
}
