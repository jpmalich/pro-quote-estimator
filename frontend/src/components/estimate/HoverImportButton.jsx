// HOVER PDF importer. Two-step flow:
//   1. Contractor drops a HOVER PDF → backend parses + returns a preview.
//   2. Preview modal shows extracted measurements + auto-generated lines
//      side-by-side; contractor clicks "Add to Estimate" → lines merge into
//      the current estimate (existing lines preserved, no duplicates by name).
//
// All measurements come from Claude via /api/estimates/hover-import. We render
// them read-only above the line list so the contractor can sanity-check before
// committing.
import React, { useRef, useState } from "react";
import { Upload, FileText, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const KEY_LABELS = {
  siding_sqft: "Siding",
  soffit_sqft: "Soffit",
  eaves_lf: "Eaves",
  rakes_lf: "Rakes",
  starter_lf: "Starter",
  outside_corner_count: "Outside corners",
  outside_corner_lf: "Outside corner LF",
  inside_corner_count: "Inside corners",
  inside_corner_lf: "Inside corner LF",
  opening_count: "Openings",
  window_count: "Windows",
  door_count: "Doors (total)",
  entry_door_count: "Entry doors",
  patio_door_count: "Patio doors",
  garage_door_count: "Garage doors",
  opening_perimeter_lf: "Opening perimeter",
  stories: "Stories",
  address: "Address",
};

const TAB_LABELS = {
  vinyl: "Vinyl",
  ascend: "Ascend",
  lp_smart: "LP Smart",
};

const UNIT_BY_KEY = (k) => {
  if (k.endsWith("_sqft")) return "ft²";
  if (k.endsWith("_lf")) return "LF";
  return "";
};

export default function HoverImportButton({ est, update }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const upload = async (f) => {
    if (!f) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/estimates/hover-import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      setResult(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const apply = () => {
    if (!result?.lines?.length) return;
    // Merge by (tab, section, name) — same item can exist on multiple tabs
    // with independent quantities, and the HOVER importer now emits a line
    // per tab. Overwriting an existing tab+section+name entry preserves its
    // catalog mat/lab and just updates qty.
    const existing = est.lines || [];
    const tabOf = (l) => l.tab || "vinyl";
    const keyOf = (l) => `${tabOf(l)}::${l.section}::${l.name}`;
    const byKey = new Map(existing.map((l, i) => [keyOf(l), i]));
    const next = [...existing];
    let added = 0;
    let updated = 0;
    for (const ln of result.lines) {
      const key = `${ln.tab || "vinyl"}::${ln.section}::${ln.name}`;
      const idx = byKey.get(key);
      if (idx == null) {
        // Should not happen in practice — useEstimate pre-creates entries
        // for every (tab, section, item) tuple — but stay defensive.
        next.push({
          tab: ln.tab || "vinyl",
          section: ln.section,
          name: ln.name,
          unit: ln.unit,
          qty: ln.qty,
          mat: 0, lab: 0,
        });
        added += 1;
      } else {
        next[idx] = { ...next[idx], qty: ln.qty };
        updated += 1;
      }
    }
    update({ lines: next });
    toast.success(`Imported HOVER: ${added} new + ${updated} updated across all tabs`);
    setResult(null);
  };

  return (
    <div data-testid="hover-import">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
        data-testid="hover-import-input"
      />
      <button
        type="button"
        className="px-3 py-1.5 bg-white text-[#09090B] border border-[#09090B] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        data-testid="hover-import-btn"
        title="Import a HOVER measurement report (.pdf)"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {busy ? "Reading…" : "Import HOVER"}
      </button>

      {result && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setResult(null)}
          data-testid="hover-modal-backdrop"
        >
          <div
            className="bg-white max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="hover-modal"
          >
            <div className="bg-[#09090B] text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5" />
                <div>
                  <div className="font-heading text-lg">HOVER Report Imported</div>
                  <div className="text-xs opacity-90 mt-0.5">
                    Review measurements and line items below — click Apply when ready
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={() => setResult(null)}
                aria-label="Close"
                data-testid="hover-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Measurements block */}
              <div className="p-5 border-b border-[#E4E4E7] bg-[#FAFAFA]">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-3">
                  Extracted Measurements
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Object.entries(result.measurements || {})
                    .filter(([, v]) => v !== null && v !== undefined && v !== "")
                    .map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                          {KEY_LABELS[k] || k}
                        </div>
                        <div className="font-mono-num text-sm font-bold text-[#09090B] truncate" title={String(v)}>
                          {typeof v === "number"
                            ? `${v.toLocaleString()} ${UNIT_BY_KEY(k)}`.trim()
                            : v}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Lines block — grouped by tab so the contractor can see at a
                  glance what each option will look like. */}
              <div className="p-5">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-3">
                  Auto-generated Line Items ({result.lines?.length || 0} across {Object.keys(TAB_LABELS).filter(t => (result.lines || []).some(l => (l.tab || "vinyl") === t)).length} tabs)
                </div>
                {result.lines?.length ? (
                  ["vinyl", "ascend", "lp_smart"].map((tab) => {
                    const tabLines = (result.lines || []).filter(
                      (l) => (l.tab || "vinyl") === tab
                    );
                    if (!tabLines.length) return null;
                    return (
                      <div key={tab} className="mb-5 last:mb-0">
                        <div className="flex items-center gap-2 mb-2 pb-1 border-b border-[#09090B]">
                          <span className="text-xs uppercase tracking-[0.18em] font-bold text-[#F97316]">
                            {TAB_LABELS[tab]} tab
                          </span>
                          <span className="text-[10px] text-[#A1A1AA]">
                            ({tabLines.length} {tabLines.length === 1 ? "line" : "lines"})
                          </span>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                              <th className="py-1 pr-3">Section</th>
                              <th className="py-1 pr-3">Item</th>
                              <th className="py-1 pr-3 text-right">Qty</th>
                              <th className="py-1 pr-3">Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tabLines.map((l) => (
                              <tr
                                key={`${l.tab}::${l.section}::${l.name}`}
                                className="border-b border-[#F4F4F5]"
                              >
                                <td className="py-2 pr-3 text-xs text-[#52525B]">{l.section}</td>
                                <td className="py-2 pr-3">
                                  <div className="text-xs text-[#09090B]">{l.name}</div>
                                  {l.note && (
                                    <div className="text-[10px] text-[#A1A1AA] mt-0.5">{l.note}</div>
                                  )}
                                </td>
                                <td className="py-2 pr-3 text-right font-mono-num text-sm font-bold">{l.qty}</td>
                                <td className="py-2 pr-3 text-xs text-[#52525B]">{l.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-[#52525B]">
                    No line items generated — the report may be missing standard measurements.
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-between items-center">
              <div className="text-[10px] text-[#A1A1AA]">
                Existing lines with matching names will have their qty updated.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider"
                  onClick={() => setResult(null)}
                  data-testid="hover-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-4 py-2 bg-[#F97316] text-white border border-[#F97316] hover:bg-[#EA580C] text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                  onClick={apply}
                  disabled={!result.lines?.length}
                  data-testid="hover-apply-btn"
                >
                  <Check className="w-4 h-4" />
                  Apply {result.lines?.length || 0} Lines
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
