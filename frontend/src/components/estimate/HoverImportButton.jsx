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
import { Upload, FileText, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const KEY_LABELS = {
  siding_sqft: "Siding",
  siding_with_openings_sqft: "Siding (+10% small openings)",
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
  window_bottom_width_total_lf: "Window bottom widths",
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
  windows: "Windows",
};

const VERO_PRODUCT_TYPES = [
  "Vero Double Hung",
  "Vero 2-Lite Slider",
  "Vero 3-Lite Slider",
  "Vero 1-Lite Casement",
  "Vero Picture",
];

const UNIT_BY_KEY = (k) => {
  if (k.endsWith("_sqft")) return "ft²";
  if (k.endsWith("_lf")) return "LF";
  return "";
};

export default function HoverImportButton({ est, update, save }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [applying, setApplying] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  const upload = async (f) => {
    if (!f) return;
    setBusy(true);
    setResult(null);
    setOpenings([]);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/estimates/hover-import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      setResult(data);
      setOpenings(data.vero_openings || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const updateOpeningType = (id, productType) => {
    setOpenings((prev) =>
      prev.map((op) => (op.id === id ? { ...op, product_type: productType } : op))
    );
  };

  const removeOpening = (id) => {
    setOpenings((prev) => prev.filter((op) => op.id !== id));
  };

  const apply = async () => {
    if (!result?.lines?.length && !openings.length) return;
    // ─── Merge catalog lines (siding tabs + window labor rows) ─────────────
    const existing = est.lines || [];
    const tabOf = (l) => l.tab || "vinyl";
    const keyOf = (l) => `${tabOf(l)}::${l.section}::${l.name}`;
    const byKey = new Map(existing.map((l, i) => [keyOf(l), i]));
    const nextLines = [...existing];
    let added = 0;
    let updated = 0;
    for (const ln of result?.lines || []) {
      const key = `${ln.tab || "vinyl"}::${ln.section}::${ln.name}`;
      const idx = byKey.get(key);
      if (idx == null) {
        nextLines.push({
          tab: ln.tab || "vinyl",
          section: ln.section,
          name: ln.name,
          unit: ln.unit,
          qty: ln.qty,
          mat: 0, lab: 0,
        });
        added += 1;
      } else {
        nextLines[idx] = { ...nextLines[idx], qty: ln.qty };
        updated += 1;
      }
    }
    // ─── Append per-opening Vero rows (these are always brand-new — VeroPanel
    // recomputes bucket_label / base_mat from the live catalog on next render) ─
    const existingOpenings = est.vero_openings || [];
    const nextOpenings = [
      ...existingOpenings,
      ...openings.map(({ hover_id, ...op }) => op),  // strip the hover_id metadata
    ];

    update({ lines: nextLines, vero_openings: nextOpenings });
    setApplying(true);
    try {
      if (save) {
        await save({ ...est, lines: nextLines, vero_openings: nextOpenings });
      }
      const winNote = openings.length ? ` + ${openings.length} windows` : "";
      toast.success(
        `Imported HOVER: ${added} new + ${updated} updated${winNote} · saved`
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Saved locally but failed to persist — click Save");
    } finally {
      setApplying(false);
      setResult(null);
      setOpenings([]);
    }
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
        onClick={() => setShowWarning(true)}
        disabled={busy}
        data-testid="hover-import-btn"
        title="Import a HOVER measurement report (.pdf)"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {busy ? "Reading…" : "Import HOVER"}
      </button>

      {showWarning && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowWarning(false)}
          data-testid="hover-warning-backdrop"
        >
          <div
            className="bg-white max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
            data-testid="hover-warning-modal"
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
                data-testid="hover-warning-cancel"
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
                data-testid="hover-warning-agree"
                autoFocus
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => { setResult(null); setOpenings([]); }}
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
                onClick={() => { setResult(null); setOpenings([]); }}
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
                    .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
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

              {/* Vero Windows block — one row per HOVER opening with the
                  AI-guessed product type editable in a dropdown. Apply
                  appends these to est.vero_openings (VeroPanel resolves
                  bucket_label + price on next render). */}
              {openings.length > 0 && (
                <div className="p-5 border-b border-[#E4E4E7]">
                  <div className="flex items-center gap-2 mb-3 pb-1 border-b border-[#09090B]">
                    <span className="text-xs uppercase tracking-[0.18em] font-bold text-[#F97316]">
                      Vero Window Openings — Style Guess
                    </span>
                    <span className="text-[10px] text-[#A1A1AA]">
                      ({openings.length} {openings.length === 1 ? "opening" : "openings"} · edit any style before applying)
                    </span>
                  </div>
                  <p className="text-[10px] text-[#52525B] leading-snug mb-2">
                    HOVER reports don&apos;t say if a window is double-hung, slider, casement, or picture — only the dimensions.
                    Each row below was auto-guessed from W × H. <strong>Confirm or change</strong> the style per opening; they&apos;ll be added as a new Vero opening on the Windows tab.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                        <th className="py-1 pr-2">HOVER ID</th>
                        <th className="py-1 pr-2 text-right">W</th>
                        <th className="py-1 pr-2 text-right">H</th>
                        <th className="py-1 pr-2 text-right">UI</th>
                        <th className="py-1 pr-2">Style (Vero product)</th>
                        <th className="py-1 pr-1 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {openings.map((op) => (
                        <tr
                          key={op.id}
                          className="border-b border-[#F4F4F5]"
                          data-testid={`hover-opening-${op.hover_id || op.id}`}
                        >
                          <td className="py-1.5 pr-2 font-mono text-xs text-[#52525B]">
                            {op.hover_id || "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-mono-num text-xs">
                            {op.width}&quot;
                          </td>
                          <td className="py-1.5 pr-2 text-right font-mono-num text-xs">
                            {op.height}&quot;
                          </td>
                          <td className="py-1.5 pr-2 text-right font-mono-num text-xs text-[#52525B]">
                            {Math.round(op.width + op.height)}
                          </td>
                          <td className="py-1.5 pr-2">
                            <select
                              className="border border-[#E4E4E7] text-xs px-2 py-1 w-full bg-white font-semibold"
                              value={op.product_type}
                              onChange={(e) => updateOpeningType(op.id, e.target.value)}
                              data-testid={`hover-opening-style-${op.hover_id || op.id}`}
                            >
                              {VERO_PRODUCT_TYPES.map((pt) => (
                                <option key={pt} value={pt}>{pt}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5">
                            <button
                              type="button"
                              className="text-[#A1A1AA] hover:text-[#DC2626] p-1"
                              onClick={() => removeOpening(op.id)}
                              title="Skip this opening"
                              data-testid={`hover-opening-remove-${op.hover_id || op.id}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Lines block — grouped by tab so the contractor can see at a
                  glance what each option will look like. */}
              <div className="p-5">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-3">
                  Auto-generated Line Items ({result.lines?.length || 0} across {Object.keys(TAB_LABELS).filter(t => (result.lines || []).some(l => (l.tab || "vinyl") === t)).length} tabs)
                </div>
                {result.lines?.length ? (
                  ["vinyl", "ascend", "lp_smart", "windows"].map((tab) => {
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
                Existing lines with matching names will have their qty updated. Windows are appended as new openings.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider"
                  onClick={() => { setResult(null); setOpenings([]); }}
                  data-testid="hover-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-4 py-2 bg-[#F97316] text-white border border-[#F97316] hover:bg-[#EA580C] text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                  onClick={apply}
                  disabled={(!result.lines?.length && !openings.length) || applying}
                  data-testid="hover-apply-btn"
                >
                  {applying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {applying
                    ? "Saving…"
                    : `Apply ${result.lines?.length || 0} Lines${openings.length ? ` + ${openings.length} Windows` : ""} & Save`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
