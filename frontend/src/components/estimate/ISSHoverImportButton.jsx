// HOVER PDF importer for ISS estimates.
//
// Reuses the same backend extractor (/api/estimates/hover-import) but
// remaps the returned `measurements` onto ISS catalog rows (single-tier,
// `tab="iss"` with section + name keys from /api/iss/catalog).
//
// Mapping rules:
//   siding_with_openings_sqft / 100  →  Install Vinyl Siding :: Conquest (sq)
//   eaves_lf                          →  Seamless Gutter with Siding :: Gutter (lf)
//   window_count                      →  Misc. Labor and Material :: Cap windows (ea)
//   entry_door_count                  →  Misc. Labor and Material :: Cap entry door (ea)
//   patio_door_count                  →  Misc. Labor and Material :: Cap patio door (ea)
//   garage_door_count                 →  Misc. Labor and Material :: Cap single garage door (ea)
//
// Contractor can switch siding brand row after import (Charter Oak,
// Ascend Composite, etc.) — the Conquest qty becomes the starting baseline.
import React, { useRef, useState } from "react";
import { Upload, FileText, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const KEY_LABELS = {
  siding_sqft: "Siding",
  siding_with_openings_sqft: "Siding (+10%)",
  soffit_sqft: "Soffit",
  eaves_lf: "Eaves",
  rakes_lf: "Rakes",
  opening_count: "Openings",
  window_count: "Windows",
  entry_door_count: "Entry doors",
  patio_door_count: "Patio doors",
  garage_door_count: "Garage doors",
  opening_perimeter_lf: "Opening perimeter",
  address: "Address",
};

const UNIT_BY_KEY = (k) => {
  if (k.endsWith("_sqft")) return "ft²";
  if (k.endsWith("_lf")) return "LF";
  return "";
};

const fmt = (n) => Number(n || 0).toLocaleString();

// Build the ISS line items from HOVER measurements. Returns an array of
// { section, name, unit, qty } rows ready to merge into est.lines (with
// tab="iss" tacked on at apply time).
function buildISSLinesFromMeasurements(m) {
  const out = [];
  const push = (section, name, unit, qty) => {
    const q = Number(qty) || 0;
    if (q <= 0) return;
    out.push({ section, name, unit, qty: Math.round(q * 100) / 100 });
  };
  const sidingSqft = Number(m.siding_with_openings_sqft) || Number(m.siding_sqft) || 0;
  push("Install Vinyl Siding", "Conquest", "sq", sidingSqft / 100);
  push("Seamless Gutter with Siding", "Gutter", "lf", m.eaves_lf);
  push("Misc. Labor and Material", "Cap windows", "ea", m.window_count);
  push("Misc. Labor and Material", "Cap entry door", "ea", m.entry_door_count);
  push("Misc. Labor and Material", "Cap patio door", "ea", m.patio_door_count);
  push("Misc. Labor and Material", "Cap single garage door", "ea", m.garage_door_count);
  return out;
}

export default function ISSHoverImportButton({ est, applyLines }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [preview, setPreview] = useState(null); // { measurements, issLines }
  const [applying, setApplying] = useState(false);

  const upload = async (f) => {
    if (!f) return;
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/estimates/hover-import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      const issLines = buildISSLinesFromMeasurements(data.measurements || {});
      setPreview({ measurements: data.measurements || {}, issLines });
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const apply = async () => {
    if (!preview?.issLines?.length) return;
    setApplying(true);
    try {
      await applyLines(preview.issLines);
      toast.success(`Imported ${preview.issLines.length} ISS lines from HOVER`);
      setPreview(null);
    } catch (e) {
      toast.error(e?.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div data-testid="iss-hover-import">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
        data-testid="iss-hover-import-input"
      />
      <button
        type="button"
        className="px-3 py-1.5 bg-white text-[#09090B] border border-[#09090B] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        onClick={() => setShowWarning(true)}
        disabled={busy}
        data-testid="iss-hover-import-btn"
        title="Import a HOVER measurement report (.pdf)"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {busy ? "Reading…" : "Import HOVER"}
      </button>

      {showWarning && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowWarning(false)}
          data-testid="iss-hover-warning-backdrop"
        >
          <div
            className="bg-white max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
            data-testid="iss-hover-warning-modal"
          >
            <div className="bg-[#F97316] text-white px-5 py-4 flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <div className="font-heading text-lg">Quantity Verification Required</div>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#3F3F46] leading-relaxed">
                You are responsible for verifying all quantities before submitting this report.
              </p>
            </div>
            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider"
                onClick={() => setShowWarning(false)}
                data-testid="iss-hover-warning-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-[#F97316] text-white border border-[#F97316] hover:bg-[#EA580C] text-sm font-bold uppercase tracking-wider"
                onClick={() => {
                  setShowWarning(false);
                  fileRef.current?.click();
                }}
                data-testid="iss-hover-warning-agree"
                autoFocus
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
          data-testid="iss-hover-modal-backdrop"
        >
          <div
            className="bg-white max-w-2xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="iss-hover-modal"
          >
            <div className="bg-[#09090B] text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5" />
                <div>
                  <div className="font-heading text-lg">HOVER Report Imported</div>
                  <div className="text-xs opacity-90 mt-0.5">
                    Review the ISS line items below — click Apply when ready
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={() => setPreview(null)}
                aria-label="Close"
                data-testid="iss-hover-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="p-5 border-b border-[#E4E4E7] bg-[#FAFAFA]">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-3">
                  Extracted Measurements
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Object.entries(preview.measurements)
                    .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
                    .map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                          {KEY_LABELS[k] || k}
                        </div>
                        <div className="font-mono-num text-sm font-bold text-[#09090B] truncate" title={String(v)}>
                          {typeof v === "number"
                            ? `${fmt(v)} ${UNIT_BY_KEY(k)}`.trim()
                            : v}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="p-5">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-3">
                  ISS Line Items ({preview.issLines.length})
                </div>
                {preview.issLines.length ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] border-b border-[#E4E4E7]">
                        <th className="py-2 pr-3">Section</th>
                        <th className="py-2 pr-3">Item</th>
                        <th className="py-2 pr-3 text-right">Qty</th>
                        <th className="py-2 pr-3">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.issLines.map((l) => (
                        <tr
                          key={`${l.section}::${l.name}`}
                          className="border-b border-[#F4F4F5]"
                          data-testid={`iss-hover-row-${l.section}-${l.name}`}
                        >
                          <td className="py-2 pr-3 text-xs text-[#52525B]">{l.section}</td>
                          <td className="py-2 pr-3 text-xs text-[#09090B]">{l.name}</td>
                          <td className="py-2 pr-3 text-right font-mono-num text-sm font-bold">{l.qty}</td>
                          <td className="py-2 pr-3 text-xs text-[#52525B]">{l.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-[#52525B]">
                    No ISS line items could be derived — the report may be missing standard measurements.
                  </p>
                )}
                <p className="text-[10px] text-[#A1A1AA] mt-3 leading-snug">
                  Default siding line is <strong>Conquest</strong>. Switch to Charter Oak, Ascend Composite, Prodigy, etc.
                  by editing the qty on the appropriate row after import.
                </p>
              </div>
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-between items-center">
              <div className="text-[10px] text-[#A1A1AA]">
                Existing ISS lines with matching names will have their qty updated.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider"
                  onClick={() => setPreview(null)}
                  data-testid="iss-hover-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-4 py-2 bg-[#F97316] text-white border border-[#F97316] hover:bg-[#EA580C] text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                  onClick={apply}
                  disabled={!preview.issLines.length || applying}
                  data-testid="iss-hover-apply-btn"
                >
                  {applying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {applying ? "Saving…" : `Apply ${preview.issLines.length} Lines`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
