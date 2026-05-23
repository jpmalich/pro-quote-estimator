import React from "react";
import { fmt } from "@/lib/api";
import { Save, FileText, Printer, Download } from "lucide-react";

export default function TotalsSummary({ est, totals, saving, onSave, onOpenQuote, onPrint, onExportCsv }) {
  return (
    <section className="card p-6" data-testid="totals-summary">
      <div className="section-tag mb-4">Summary</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Stat label="Material" val={fmt(totals.subMat)} />
        <Stat label={`+ Waste (${est.waste_pct || 0}%)`} val={fmt(totals.wasted)} />
        <Stat label={`Tax (${est.tax_enabled ? est.tax_rate : 0}%)`} val={fmt(totals.tax)} />
        <Stat label="Labor" val={fmt(totals.subLab)} />
        <Stat label="Base Cost" val={fmt(totals.base)} bold />
        <Stat label={`Sell (${est.margin_pct}% ${est.pricing_mode === "markup" ? "markup" : "margin"})`} val={fmt(totals.sell)} orange />
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" onClick={onSave} disabled={saving} data-testid="save-btn">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn-secondary" onClick={onOpenQuote} data-testid="open-quote-btn">
          <FileText className="w-4 h-4" /> Customer Quote
        </button>
        <button className="btn-secondary" onClick={onPrint} data-testid="print-btn">
          <Printer className="w-4 h-4" /> Print
        </button>
        <button className="btn-secondary" onClick={onExportCsv} data-testid="export-csv-btn">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
    </section>
  );
}

function Stat({ label, val, orange, bold }) {
  return (
    <div className="border-l-2 border-[#E4E4E7] pl-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold">{label}</div>
      <div
        className={`font-mono-num mt-1 ${
          orange
            ? "text-2xl font-bold text-[#F97316]"
            : bold
            ? "text-lg font-bold text-[#09090B]"
            : "text-base text-[#09090B]"
        }`}
      >
        {val}
      </div>
    </div>
  );
}
