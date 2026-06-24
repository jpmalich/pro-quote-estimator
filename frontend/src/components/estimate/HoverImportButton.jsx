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
import TakeoffReconCard from "@/components/estimate/TakeoffReconCard";
import { getSavedWasteDefault } from "@/lib/wasteDefaults";
import { bakeWasteIntoLines, steerLpSoffit } from "@/lib/wasteLogic";
// Iter 78t — same elevation drawing component as AI Measure, fed from
// Phase 2 vision data (`per_elevation_siding_from_drawing`).
import ElevationDrawing from "@/components/estimate/ElevationDrawing";
import { buildElevationsFromHoverVision } from "@/lib/elevationBuilder";

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
  "Vero 1-Lite Casement",
  // Iter 57t — Vero 3-Lite Slider + Vero Picture are frozen (pricing
  // unreliable). Drop them from the HOVER style dropdown so contractors
  // can't accidentally land an opening in a hidden Vero section.
];

// Mezzo has no Casement product type — fall back to DH on the Mezzo side
// when the Vero guess is Casement. Lets one edit drive both brands.
const VERO_TO_MEZZO = {
  "Vero Double Hung":     "Mezzo Double Hung",
  "Vero 2-Lite Slider":   "Mezzo 2-Lite Slider",
  "Vero 3-Lite Slider":   "Mezzo 3-Lite Slider",
  "Vero Picture":         "Mezzo Picture",
  "Vero 1-Lite Casement": "Mezzo Double Hung",
};

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
  // Iter 78n — when set, the preview modal was opened by "Restore HOVER
  // lines" (re-running the mapper against cached measurements) instead of
  // a fresh PDF read. Shown as a subtitle in the modal header so the
  // contractor knows no new LLM call was made.
  const [restoredAt, setRestoredAt] = useState(null);
  const hasCached = !!(est?.hover_measurements && Object.keys(est.hover_measurements).length);
  // Iter 78q — Phase 3 Deep Verify state. Keyed by warning code so multiple
  // elevations can be verified independently. Value shape:
  //   "loading" | { ok, label, scale_bar_found, measured_*, delta_vs_*, ... }
  const [deepVerify, setDeepVerify] = useState({});

  const runDeepVerify = async (warning) => {
    // Extract elevation label from the warning code, e.g.
    // "vision_elev_delta_front" -> "Front"
    const match = (warning.code || "").match(/^vision_elev_delta_(.+)$/);
    if (!match) return;
    const label = match[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const cacheKey = result?.deep_verify_cache_key;
    if (!cacheKey) {
      toast.error("Deep Verify is only available right after a fresh HOVER import");
      return;
    }
    setDeepVerify((prev) => ({ ...prev, [warning.code]: "loading" }));
    try {
      const { data } = await api.post("/estimates/hover-deep-verify", {
        cache_key: cacheKey,
        label,
        measurements: result?.measurements || {},
        phase2_drawing:
          (result?.measurements?.per_elevation_siding_from_drawing || {})[label] || {},
      });
      setDeepVerify((prev) => ({ ...prev, [warning.code]: data }));
    } catch (e) {
      setDeepVerify((prev) => ({ ...prev, [warning.code]: null }));
      toast.error(e?.response?.data?.detail || "Deep Verify failed");
    }
  };

  const upload = async (f) => {
    if (!f) return;
    // Iter 78 — silent auto-apply of the per-workspace default Waste %.
    // No prompt here (HOVER reports already include their own waste row);
    // we just respect the contractor's saved default so the
    // reconciliation card shows the right "Order @ X%" column. The
    // Blueprint button is the one place that prompts.
    if (typeof update === "function") {
      const kind = est?.kind || "siding";
      const currentWaste = Number(est?.waste_pct ?? 0);
      if (currentWaste <= 0) {
        const saved = getSavedWasteDefault(kind);
        if (saved) update({ waste_pct: saved });
      }
    }
    setBusy(true);
    setResult(null);
    setOpenings([]);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("overhang_in", String(est?.overhang_in ?? 12));
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

  // Iter 78n — Restore HOVER lines. Re-runs the takeoff mapper against
  // the measurements already cached on `est.hover_measurements`, no new
  // PDF upload + no new LLM call (free + instant). Opens the same
  // preview modal as a fresh import so the contractor can review +
  // selectively re-apply auto-fills that were accidentally cleared.
  const restore = async () => {
    if (!hasCached) return;
    setBusy(true);
    setResult(null);
    setOpenings([]);
    try {
      const { data } = await api.post("/measure/map", {
        measurements: est.hover_measurements,
      });
      setResult(data);
      setOpenings(data.vero_openings || []);
      setRestoredAt(new Date());
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const removeOpening = (id) => {
    setOpenings((prev) => prev.filter((op) => op.id !== id));
  };

  const apply = async () => {
    if (!result?.lines?.length && !openings.length) return;

    // ─── Split incoming data by which estimate-kind it belongs on ───────────
    // Source kind determines which slice stays on the current estimate vs
    // gets routed to the auto-paired estimate of the opposite kind.
    const srcKind = est.kind || "siding";
    const allLines = result?.lines || [];
    const SIDING_TABS = new Set(["vinyl", "ascend", "lp_smart"]);
    const WINDOWS_TABS = new Set(["windows"]);
    const sidingLines = allLines.filter((l) => SIDING_TABS.has(l.tab || "vinyl"));
    const windowsLines = allLines.filter((l) => WINDOWS_TABS.has(l.tab || "vinyl"));

    const sourceLines = srcKind === "windows" ? windowsLines : sidingLines;
    const pairedLines = srcKind === "windows" ? sidingLines : windowsLines;
    // Vero openings always belong on a windows-kind estimate; Mezzo openings
    // mirror the same set so the contractor can quote both brands side-by-side.
    const sourceOpenings = srcKind === "windows" ? openings : [];
    const pairedOpenings = srcKind === "windows" ? [] : openings;
    // Build the parallel Mezzo array from the same edits the contractor made
    // on the Vero side — one edit drives both brands. Strip Vero-only fields
    // (sister_color, glass_*, premium_*) since MezzoOpening has a leaner shape.
    const veroToMezzo = (op) => ({
      id: op.id,
      product_type: VERO_TO_MEZZO[op.product_type] || "Mezzo Double Hung",
      label: op.label || "",
      width: op.width,
      height: op.height,
      qty: op.qty || 1,
      bucket_label: "",
      base_mat: 0,
      adders: [],
    });
    const sourceMezzoOpenings = srcKind === "windows" ? openings.map(veroToMezzo) : [];
    const pairedMezzoOpenings = srcKind === "windows" ? [] : openings.map(veroToMezzo);

    // ─── Merge SOURCE-side lines into the current estimate ─────────────────
    // Iter 78 — bake the contractor's Waste % into qty for cut-prone items
    // before merging. Siding/soffit/J/finish-trim/corners/starter lines
    // come out already scaled (e.g. 18 SQ → 24 SQ at 33% waste) and stash
    // the original raw measurement in `raw_qty` so waste-% changes can
    // recompute later.
    const wastePct = Number(est?.waste_pct) || 0;
    const soffitType = est?.lp_soffit_type || "mix";
    const wastedSource = steerLpSoffit(bakeWasteIntoLines(sourceLines, wastePct), soffitType);
    const wastedPaired = steerLpSoffit(bakeWasteIntoLines(pairedLines, wastePct), soffitType);
    const existing = est.lines || [];
    const keyOf = (l) => `${l.tab || "vinyl"}::${l.section}::${l.name}`;
    const byKey = new Map(existing.map((l, i) => [keyOf(l), i]));
    const nextLines = [...existing];
    let added = 0;
    let updated = 0;
    for (const ln of wastedSource) {
      const key = keyOf(ln);
      const idx = byKey.get(key);
      if (idx == null) {
        nextLines.push({
          tab: ln.tab || "vinyl",
          section: ln.section,
          name: ln.name,
          unit: ln.unit,
          qty: ln.qty,
          raw_qty: ln.raw_qty ?? null,
          mat: 0, lab: 0,
        });
        added += 1;
      } else {
        nextLines[idx] = {
          ...nextLines[idx],
          qty: ln.qty,
          // Preserve raw_qty when present so future waste-% changes
          // recompute correctly. null clears prior raw_qty for items
          // that re-imported as non-cut-prone (rare).
          raw_qty: ln.raw_qty ?? null,
        };
        updated += 1;
      }
    }
    const nextOpenings = [
      ...(est.vero_openings || []),
      ...sourceOpenings.map(({ hover_id, ...op }) => op),
    ];
    const nextMezzoOpenings = [
      ...(est.mezzo_openings || []),
      ...sourceMezzoOpenings,
    ];

    // Iter 78t — merge any contractor nudges into the elevation drawings
    // and stash on hover_measurements._ai_elevations so the customer PDF
    // can render them. Same shape as the AI Measure path.
    let hoverMeasurementsWithDrawings = result?.measurements || null;
    try {
      const elevs = buildElevationsFromHoverVision(result?.measurements || {});
      if (elevs.length) {
        const edits = result?.measurements?._ai_elevation_edits || {};
        const merged = elevs.map((e) => {
          const ee = edits[e.label] || {};
          const opEdits = ee.openings || {};
          return {
            ...e,
            roof_style: ee.roof_style || e.roof_style,
            openings: e.openings.map((op) =>
              opEdits[op.id]
                ? { ...op, x_pct: opEdits[op.id].x_pct, y_pct: opEdits[op.id].y_pct }
                : op
            ),
          };
        });
        hoverMeasurementsWithDrawings = {
          ...(result?.measurements || {}),
          _ai_elevations: merged,
        };
      }
    } catch {
      /* non-fatal */
    }

    update({ lines: nextLines, vero_openings: nextOpenings, mezzo_openings: nextMezzoOpenings, hover_measurements: hoverMeasurementsWithDrawings });
    setApplying(true);
    try {
      if (save) {
        await save({
          ...est,
          lines: nextLines,
          vero_openings: nextOpenings,
          mezzo_openings: nextMezzoOpenings,
          hover_measurements: hoverMeasurementsWithDrawings,
        });
      }

      // ─── Route paired-side slice to a paired estimate of opposite kind ──
      let pairedMsg = "";
      const hasPairedWork = pairedLines.length > 0 || pairedOpenings.length > 0;
      if (hasPairedWork) {
        const pair = (await api.post(`/estimates/${est.id}/pair`)).data;
        // Build the paired estimate's merged lines from scratch — it's
        // either brand-new (empty arrays) or already exists (merge by key).
        const pExisting = pair.lines || [];
        const pByKey = new Map(pExisting.map((l, i) => [keyOf(l), i]));
        const pNext = [...pExisting];
        for (const ln of wastedPaired) {
          const idx = pByKey.get(keyOf(ln));
          if (idx == null) {
            pNext.push({
              tab: ln.tab || "vinyl",
              section: ln.section,
              name: ln.name,
              unit: ln.unit,
              qty: ln.qty,
              raw_qty: ln.raw_qty ?? null,
              mat: 0, lab: 0,
            });
          } else {
            pNext[idx] = {
              ...pNext[idx],
              qty: ln.qty,
              raw_qty: ln.raw_qty ?? null,
            };
          }
        }
        const pNextOpenings = [
          ...(pair.vero_openings || []),
          ...pairedOpenings.map(({ hover_id, ...op }) => op),
        ];
        const pNextMezzoOpenings = [
          ...(pair.mezzo_openings || []),
          ...pairedMezzoOpenings,
        ];
        await api.put(`/estimates/${pair.id}`, {
          ...pair,
          lines: pNext,
          vero_openings: pNextOpenings,
          mezzo_openings: pNextMezzoOpenings,
        });
        const pairedKindLabel = pair.kind === "windows" ? "Windows" : "Siding";
        pairedMsg = ` · Also created paired ${pairedKindLabel} estimate ${pair.estimate_number || ""}`;
      }

      const winNote = sourceOpenings.length ? ` + ${sourceOpenings.length} windows` : "";
      toast.success(
        `Imported HOVER: ${added} new + ${updated} updated${winNote} · saved${pairedMsg}`
      );
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Saved locally but failed to persist — click Save");
    } finally {
      setApplying(false);
      setResult(null);
      setOpenings([]);
      setRestoredAt(null);
      setDeepVerify({});
    }
  };

  return (
    <div data-testid="hover-import" className="inline-flex items-center gap-2 flex-wrap">
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
      {/* Iter 78n — Restore HOVER lines. Only renders when this estimate has
          cached measurements from a previous import. Re-runs the mapper
          against those cached numbers — no new PDF, no new LLM call. */}
      {hasCached && (
        <button
          type="button"
          className="px-3 py-1.5 bg-white text-[#0369A1] border border-[#0EA5E9] hover:bg-[#F0F9FF] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
          onClick={restore}
          disabled={busy}
          data-testid="hover-restore-btn"
          title="Re-apply the auto-fills from the most recent HOVER import — no new upload needed"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Restore HOVER Lines
        </button>
      )}

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
          onClick={() => { setResult(null); setOpenings([]); setRestoredAt(null); setDeepVerify({}); }}
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
                  <div className="font-heading text-lg">
                    {restoredAt ? "HOVER Lines Restored (Cached)" : "HOVER Report Imported"}
                  </div>
                  <div className="text-xs opacity-90 mt-0.5">
                    {restoredAt
                      ? `Source: cached HOVER measurements (no new LLM call) · re-run at ${restoredAt.toLocaleTimeString()}`
                      : "Review measurements and line items below — click Apply when ready"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={() => { setResult(null); setOpenings([]); setRestoredAt(null); setDeepVerify({}); }}
                aria-label="Close"
                data-testid="hover-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Iter 78o — Phase 1 sanity-check warnings. Yellow banner
                  surfaces deterministic discrepancies the rule engine
                  caught (eaves×overhang vs soffit, rake/eave ratio,
                  opening-perim consistency, door-count integrity, corner
                  plausibility). Empty array = report looks consistent
                  (banner hidden). */}
              {Array.isArray(result.warnings) && result.warnings.length > 0 && (
                <div
                  className="border-b border-[#FCD34D] bg-[#FFFBEB] px-5 py-3"
                  data-testid="hover-warnings-banner"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-[#B45309]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#B45309]">
                      Sanity check · {result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {result.warnings.map((w) => {
                      const canDeepVerify =
                        (w.code || "").startsWith("vision_elev_delta_") &&
                        !!result?.deep_verify_cache_key;
                      const dv = deepVerify[w.code];
                      return (
                        <div
                          key={w.code}
                          className="text-[12px] text-[#78350F] leading-snug"
                          data-testid={`hover-warning-${w.code}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="font-bold">⚠ {w.message}</div>
                              {w.detail && (
                                <div className="text-[10px] font-mono-num text-[#B45309] mt-0.5">
                                  {w.detail}
                                </div>
                              )}
                            </div>
                            {canDeepVerify && dv !== "loading" && !dv?.ok && (
                              <button
                                type="button"
                                onClick={() => runDeepVerify(w)}
                                className="px-2 py-1 bg-white text-[#B45309] border border-[#B45309] hover:bg-[#FEF3C7] text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                                title="Re-measure this elevation using the scale bar (~$0.40, ~10s)"
                                data-testid={`deep-verify-${w.code}`}
                              >
                                🔍 Deep Verify
                              </button>
                            )}
                            {dv === "loading" && (
                              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#B45309] flex items-center gap-1.5 whitespace-nowrap">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Verifying…
                              </div>
                            )}
                          </div>
                          {/* Iter 78q — Deep Verify result panel: 3-way
                              comparison (deep-verify vs Phase 2 drawing
                              vs text). Renders inline under the warning
                              that triggered it. */}
                          {dv && dv !== "loading" && (
                            <div
                              className="mt-2 p-2.5 bg-white border border-[#B45309] space-y-1.5"
                              data-testid={`deep-verify-result-${w.code}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] uppercase tracking-wider font-bold text-[#B45309]">
                                  🔍 Deep Verify · {dv.label} Elevation
                                </div>
                                <div className="text-[9px] text-[#A1A1AA] uppercase tracking-wider">
                                  confidence: {dv.confidence || "—"}
                                </div>
                              </div>
                              {dv.scale_bar_found === false && (
                                <div className="text-[10px] text-[#B45309] italic">
                                  Scale bar not detected — measurement is best-effort.
                                </div>
                              )}
                              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono-num">
                                <div className="border border-[#FCD34D] bg-[#FFFBEB] p-1.5">
                                  <div className="text-[9px] uppercase tracking-wider font-bold text-[#B45309]">Scale-bar</div>
                                  <div className="text-[13px] font-bold text-[#09090B]">
                                    {dv.measured_gross_wall_sqft?.toFixed?.(0) || "—"} ft²
                                  </div>
                                  <div className="text-[9px] text-[#A1A1AA]">
                                    {dv.measured_width_ft?.toFixed?.(0) || "—"}×{dv.measured_height_ft?.toFixed?.(0) || "—"} ft
                                  </div>
                                </div>
                                <div className="border border-[#E4E4E7] p-1.5">
                                  <div className="text-[9px] uppercase tracking-wider font-bold text-[#71717A]">Phase 2 drawing</div>
                                  <div className="text-[13px] font-bold text-[#09090B]">
                                    {dv.phase2_gross_wall_sqft?.toFixed?.(0) || "—"} ft²
                                  </div>
                                  <div className="text-[9px] text-[#A1A1AA]">{dv.delta_vs_phase2 || "—"}</div>
                                </div>
                                <div className="border border-[#E4E4E7] p-1.5">
                                  <div className="text-[9px] uppercase tracking-wider font-bold text-[#71717A]">Text extract</div>
                                  <div className="text-[13px] font-bold text-[#09090B]">
                                    {dv.text_area_sqft?.toFixed?.(0) || "—"} ft²
                                  </div>
                                  <div className="text-[9px] text-[#A1A1AA]">{dv.delta_vs_text || "—"}</div>
                                </div>
                              </div>
                              {dv.notes && (
                                <div className="text-[10px] text-[#52525B] italic">📝 {dv.notes}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-[#92400E] mt-2 italic">
                    These are heuristic checks — review the elevation drawings to confirm before applying.
                  </div>
                </div>
              )}
              {/* Measurements block */}
              {(() => {
                const elevs = buildElevationsFromHoverVision(result.measurements || {});
                if (!elevs.length) return null;
                const edits = result.measurements?._ai_elevation_edits || {};
                const merged = elevs.map((e) => {
                  const editsForElev = edits[e.label] || {};
                  const opEdits = editsForElev.openings || {};
                  return {
                    ...e,
                    roof_style: editsForElev.roof_style || e.roof_style,
                    openings: e.openings.map((op) =>
                      opEdits[op.id]
                        ? { ...op, x_pct: opEdits[op.id].x_pct, y_pct: opEdits[op.id].y_pct }
                        : op
                    ),
                  };
                });
                const handleNudge = (lbl) => (opId, xPct, yPct) => {
                  setResult((r) => {
                    if (!r) return r;
                    const cur = r.measurements?._ai_elevation_edits || {};
                    const ee = cur[lbl] || { openings: {}, roof_style: null };
                    return {
                      ...r,
                      measurements: {
                        ...r.measurements,
                        _ai_elevation_edits: {
                          ...cur,
                          [lbl]: { ...ee, openings: { ...(ee.openings || {}), [opId]: { x_pct: xPct, y_pct: yPct } } },
                        },
                      },
                    };
                  });
                };
                const handleRoof = (lbl) => (shape) => {
                  setResult((r) => {
                    if (!r) return r;
                    const cur = r.measurements?._ai_elevation_edits || {};
                    const ee = cur[lbl] || { openings: {}, roof_style: null };
                    return {
                      ...r,
                      measurements: {
                        ...r.measurements,
                        _ai_elevation_edits: { ...cur, [lbl]: { ...ee, roof_style: shape } },
                      },
                    };
                  });
                };
                return (
                  <div className="p-5 border-b border-[#E4E4E7] bg-white" data-testid="hover-elevation-drawings">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-1">
                      Elevation Drawings
                    </div>
                    <p className="text-[11px] text-[#52525B] mb-3">
                      Reconstructed from the Phase 2 vision pass on the HOVER PDF drawings. Drag any opening to reposition or click the Roof toggle to fix the shape.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {merged.map((e) => (
                        <ElevationDrawing
                          key={e.label}
                          elevation={e}
                          editable
                          compact
                          onOpeningMove={handleNudge(e.label)}
                          onRoofToggle={handleRoof(e.label)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Extracted Measurements block */}
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

              {/* Iter 78 — Takeoff Reconciliation: raw → formula → ordered */}
              <TakeoffReconCard
                measurements={result.measurements || {}}
                lines={result.lines || []}
                wastePct={est?.waste_pct || 0}
                kind={est?.kind || "siding"}
                lpSoffitType={est?.lp_soffit_type || "mix"}
              />

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
                    Each row below was auto-guessed from W × H. <strong>Confirm or change</strong> the style per opening; one pick fills <strong>both Mezzo and Vero</strong> tabs on the paired Windows estimate (Mezzo has no Casement, so Casement rows default to DH on the Mezzo side).
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
