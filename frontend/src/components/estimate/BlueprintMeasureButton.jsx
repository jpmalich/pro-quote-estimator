// AI Blueprint Reader button.
//
// Sister flow to HOVER Import + AI Photo Measure. Where the photo flow
// *estimates* dimensions (±20%), this one *reads* the printed dims on
// an architectural plan set — so accuracy follows the drawing itself.
//
// Workflow:
//   click → upload PDF (multi-page) OR images of plan sheets →
//   Claude Opus 4.5 vision pass → preview measurements + extracted
//   window schedule → Apply.
//
// Apply behavior matches the HOVER importer's contract: siding lines
// merge into the current estimate; the window schedule routes to the
// paired Windows estimate (auto-created via /estimates/{id}/pair).
import React, { useRef, useState } from "react";
import { FileText, Loader2, X, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import TakeoffReconCard from "@/components/estimate/TakeoffReconCard";
import {
  getSavedWasteDefault,
  saveWasteDefault,
  clearWasteDefault,
  workspaceLabel,
} from "@/lib/wasteDefaults";
import { bakeWasteIntoLines, steerLpSoffit } from "@/lib/wasteLogic";
// Iter 78t — shared elevation drawing renderer. Blueprint may produce
// AI-Measure-shaped data (walls + openings) OR HOVER-vision-shaped data
// (per_elevation_siding_from_drawing) depending on the source PDF.
import ElevationDrawing from "@/components/estimate/ElevationDrawing";
import {
  buildElevationsFromAIMeasure,
  buildElevationsFromHoverVision,
} from "@/lib/elevationBuilder";

const SIDING_TABS = new Set(["vinyl", "ascend", "lp_smart"]);
const WINDOWS_TABS = new Set(["windows"]);

// Mirror of HoverImportButton's Vero → Mezzo map (Mezzo has no Casement
// — falls back to DH). Kept inline so we don't have to refactor the
// HOVER button just to share two dozen lines.
const VERO_TO_MEZZO = {
  "Vero Double Hung":     "Mezzo Double Hung",
  "Vero 2-Lite Slider":   "Mezzo 2-Lite Slider",
  "Vero 3-Lite Slider":   "Mezzo 3-Lite Slider",
  "Vero Picture":         "Mezzo Picture",
  "Vero 1-Lite Casement": "Mezzo Double Hung",
};
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

const fmtNum = (n) => Number(n || 0).toLocaleString();
const UNIT_BY_KEY = (k) =>
  k.endsWith("_sqft") ? "ft²" : k.endsWith("_lf") ? "LF" : "";

const SUMMARY_KEYS = [
  "siding_sqft",
  "eaves_lf",
  "rakes_lf",
  "starter_lf",
  "outside_corner_lf",
  "window_count",
  "entry_door_count",
  "patio_door_count",
  "garage_door_count",
];

const KEY_LABEL = {
  siding_sqft: "Siding",
  eaves_lf: "Eaves",
  rakes_lf: "Rakes",
  starter_lf: "Starter",
  outside_corner_lf: "Outside corners",
  window_count: "Windows",
  entry_door_count: "Entry doors",
  patio_door_count: "Patio doors",
  garage_door_count: "Garage doors",
};

export default function BlueprintMeasureButton({ est, update, save, applyLines }) {
  // ISS mode: when `applyLines` is provided we route through that callback
  // (mirroring ISSHoverImportButton's contract) and skip the pairing
  // logic entirely, since the ISS workspace has no separate Windows
  // estimate to pair with. Siding mode keeps the est/update/save +
  // /estimates/{id}/pair flow.
  const issMode = typeof applyLines === "function";
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  // Iter 57q-bp — surface the worker's current stage in the toast/UI
  // so contractors know progress is happening on long blueprint reads.
  const [busyStage, setBusyStage] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null); // { measurements, lines, vero_openings, mezzo_openings, raw_ai, pages_processed }
  const [showRawJson, setShowRawJson] = useState(false);
  // Iter 57x — Resume support. When Cloudflare 502s the upload (slow
  // connection on a multi-MB PDF), the backend worker still completes.
  // On modal open we check for a recent blueprint run on this estimate
  // and offer a one-tap "Restore" so Howard can recover the orphaned
  // result instead of re-uploading.
  const [resumeRun, setResumeRun] = useState(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);

  // Check for a recoverable run on mount + after the busy flag drops
  // (so a 502 immediately surfaces a recovery offer).
  React.useEffect(() => {
    if (!est?.id || resumeDismissed) return;
    if (busy || result) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get(
          `/measure/ai-blueprint/latest-for-estimate/${est.id}`,
          { timeout: 8000 }
        );
        const run = resp?.data?.run;
        if (cancelled || !run) return;
        // Only surface if recent (< 30 min) and final-ish (done/error). A
        // still-running worker is fine too — frontend will poll its
        // status when the user clicks "Restore".
        const ageOk = (run.age_seconds ?? 99999) < 1800;
        const restorable = ["done", "error", "running"].includes(run.status);
        if (ageOk && restorable) setResumeRun(run);
      } catch {
        /* offline / not authed → silently no banner */
      }
    })();
    return () => { cancelled = true; };
  }, [est?.id, busy, result, resumeDismissed]);

  const restoreResume = async () => {
    if (!resumeRun) return;
    if (resumeRun.status === "done" && resumeRun.result) {
      setResult(resumeRun.result);
      setResumeRun(null);
      toast.success("Restored previous blueprint read");
      return;
    }
    if (resumeRun.status === "error") {
      toast.error(resumeRun.error || "Previous blueprint read errored — try again");
      setResumeDismissed(true);
      setResumeRun(null);
      return;
    }
    // status === "running" — pick up polling
    setBusy(true);
    setBusyStage(resumeRun.stage || "running");
    setResumeRun(null);
    try {
      let pollResult = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let statusResp;
        try {
          statusResp = await api.get(`/measure/ai-blueprint/status/${resumeRun.run_id}`);
        } catch { continue; }
        const s = statusResp?.data || {};
        if (s.stage && s.stage !== busyStage) setBusyStage(s.stage);
        if (s.status === "error") throw new Error(s.error || "Blueprint read failed");
        if (s.status === "done") { pollResult = s.result; break; }
      }
      if (!pollResult) throw new Error("Resume timed out — try a fresh upload");
      setResult(pollResult);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Resume failed");
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  };

  const pickAndUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setBusyStage("starting");
    setResult(null);
    setShowRawJson(false);
    try {
      const fd = new FormData();
      // Backend accepts either `file` (PDF) or `files[]` (image sheets)
      const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
      fd.append(isPdf ? "file" : "files", f);
      if (est?.address) fd.append("address", est.address);
      fd.append("overhang_in", String(est?.overhang_in ?? 12));
      // Iter 57x — Send estimate_id so the backend tags the run record;
      // enables the "Restore" banner to find this run if the upload
      // 502s before the response makes it back to the frontend.
      if (est?.id) fd.append("estimate_id", est.id);
      // Iter 57q-bp — async launcher + polling. Backend now returns
      // `{run_id, status: "running"}` in under a second instead of
      // waiting 60–120 s for Claude. We poll the status endpoint
      // every 3 s until the worker writes the result. Kills the
      // Cloudflare 524 timeouts that bit Howard's blueprint uploads.
      // Iter 57x — 180 s upload window so the multi-MB PDF transit
      // over slow connections finishes before axios bails. The
      // backend still finishes the read even on 502 — Restore banner
      // recovers it.
      const launch = await api.post("/measure/ai-blueprint", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 180000,
      });
      const runId = launch?.data?.run_id;
      if (!runId) throw new Error("Backend didn't return a run_id");
      setBusyStage(launch?.data?.stage || "starting");
      let pollResult = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let statusResp;
        try {
          statusResp = await api.get(`/measure/ai-blueprint/status/${runId}`);
        } catch (pollErr) {
          if (i >= 5) console.warn("ai-blueprint status poll failed", pollErr?.message);
          continue;
        }
        const s = statusResp?.data || {};
        if (s.stage && s.stage !== busyStage) setBusyStage(s.stage);
        if (s.status === "error") throw new Error(s.error || "Blueprint read failed");
        if (s.status === "done") { pollResult = s.result; break; }
      }
      if (!pollResult) {
        throw new Error("Blueprint read timed out after 5 minutes — try a smaller PDF or fewer pages");
      }
      setResult(pollResult);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Blueprint read failed";
      // Iter 57x — Cloudflare 502 / axios timeout: the upload may have
      // 502'd but the backend often still completed the read. The
      // useEffect-driven Restore banner will re-check on busy=false
      // because resumeDismissed defaults to false.
      const isTimeout =
        /timeout|502|bad gateway|network|aborted/i.test(detail) ||
        err?.code === "ECONNABORTED";
      toast.error(
        isTimeout
          ? "Upload timed out — your read may still be processing. Check the 'Restore' banner in a moment."
          : detail
      );
    } finally {
      setBusy(false);
      setBusyStage("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Cancel preview without applying anything.
  const dismissPreview = () => {
    if (applying) return;
    setResult(null);
    setShowRawJson(false);
  };

  // Apply the preview to the estimate. Mirrors HoverImportButton.applyResult
  // — siding lines into current siding estimate; window schedule + opening
  // rows route to a paired Windows estimate via /estimates/{id}/pair.
  //
  // In ISS mode (applyLines prop provided), the preview's measurements
  // are passed through `buildISSLinesFromMeasurements` and handed back
  // via applyLines() — no pairing, no Vero/Mezzo openings.
  const applyResult = async () => {
    if (!result) return;
    if (issMode) {
      setApplying(true);
      try {
        const { buildISSLinesFromMeasurements } = await import(
          "@/components/estimate/ISSHoverImportButton"
        );
        const rows = buildISSLinesFromMeasurements(result.measurements || {});
        await applyLines(rows);
        toast.success(
          `Read ${result.pages_processed || "blueprint"} page(s) · ${rows.length} ISS line item(s) ready`
        );
        setResult(null);
      } catch (err) {
        toast.error(err?.response?.data?.detail || err?.message || "Apply failed");
      } finally {
        setApplying(false);
      }
      return;
    }
    const allLines = result.lines || [];
    const srcKind = est.kind || "siding";

    const sidingLines  = allLines.filter((l) => SIDING_TABS.has(l.tab || "vinyl"));
    const windowsLines = allLines.filter((l) => WINDOWS_TABS.has(l.tab || "vinyl"));

    const sourceLines  = srcKind === "windows" ? windowsLines : sidingLines;
    const pairedLines  = srcKind === "windows" ? sidingLines  : windowsLines;
    const allVero  = result.vero_openings  || [];
    const allMezzo = result.mezzo_openings || [];
    const sourceVero   = srcKind === "windows" ? allVero  : [];
    const pairedVero   = srcKind === "windows" ? []       : allVero;
    const sourceMezzo  = srcKind === "windows" ? allMezzo : [];
    const pairedMezzo  = srcKind === "windows" ? []       : allMezzo;

    // Merge source-side lines into the current estimate.
    // Iter 78 — bake the contractor's Waste % into qty for cut-prone
    // items before merging so the line shows the order qty directly.
    const wastePct = Number(est?.waste_pct) || 0;
    const wastedSource = bakeWasteIntoLines(sourceLines, wastePct);
    const wastedPaired = bakeWasteIntoLines(pairedLines, wastePct);
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
          raw_qty: ln.raw_qty ?? null,
        };
        updated += 1;
      }
    }
    const nextVero  = [...(est.vero_openings  || []), ...sourceVero];
    const nextMezzo = [...(est.mezzo_openings || []), ...sourceMezzo];

    // Iter 78t — merge any contractor nudges and persist the drawings on
    // hover_measurements._ai_elevations so the customer PDF can render
    // them. Same shape as the AI Measure path.
    let nextHoverMeasurements = est.hover_measurements;
    try {
      const fromAI = buildElevationsFromAIMeasure({
        walls: result?.raw_ai?.walls,
        openings: result?.raw_ai?.openings,
        avg_wall_height_ft: result?.measurements?._ai_avg_wall_height_ft,
      });
      const fromVision = buildElevationsFromHoverVision(result?.measurements || {});
      const elevs = fromAI.length ? fromAI : fromVision;
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
        nextHoverMeasurements = {
          ...(est.hover_measurements || result?.measurements || {}),
          _ai_elevations: merged,
        };
      }
    } catch {
      /* non-fatal */
    }

    setApplying(true);
    try {
      update({ lines: nextLines, vero_openings: nextVero, mezzo_openings: nextMezzo, hover_measurements: nextHoverMeasurements });
      if (save) {
        await save({
          ...est,
          lines: nextLines,
          vero_openings: nextVero,
          mezzo_openings: nextMezzo,
          hover_measurements: nextHoverMeasurements,
        });
      }

      // Route window schedule slice to paired Windows estimate.
      let pairedMsg = "";
      const hasPairedWork = pairedLines.length > 0 || pairedVero.length > 0;
      if (hasPairedWork) {
        const pair = (await api.post(`/estimates/${est.id}/pair`)).data;
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
        const pNextVero  = [...(pair.vero_openings  || []), ...pairedVero];
        const pNextMezzo = [...(pair.mezzo_openings || []), ...pairedMezzo.map((o) => ({ ...o }))];
        await api.put(`/estimates/${pair.id}`, {
          ...pair,
          lines: pNext,
          vero_openings: pNextVero,
          mezzo_openings: pNextMezzo,
        });
        const pairedLabel = pair.kind === "windows" ? "Windows" : "Siding";
        pairedMsg = ` · routed window schedule to paired ${pairedLabel} estimate ${pair.estimate_number || ""}`;
      }

      const winNote = sourceVero.length ? ` + ${sourceVero.length} windows` : "";
      toast.success(
        `Read ${result.pages_processed || "blueprint"} page(s): ${added} new + ${updated} updated${winNote}${pairedMsg}`
      );
      setResult(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const measurements = result?.measurements || {};
  const sheets = measurements._blueprint_sheets || [];
  const schedWindows = (result?.raw_ai?.windows) || [];
  const schedDoors = (result?.raw_ai?.doors) || [];

  return (
    <div data-testid="blueprint-import">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={pickAndUpload}
        data-testid="blueprint-import-input"
      />
      <button
        type="button"
        className="px-3 py-1.5 bg-white text-[#7C3AED] border border-[#7C3AED] hover:bg-[#FAF5FF] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        onClick={() => {
          // Iter 78 — Waste % flow:
          //   1. If estimate already has waste_pct > 0 → respect it, no prompt.
          //   2. Else if a saved default exists for this workspace → silently
          //      apply it and proceed. ("Save as Job Standard" behavior.)
          //   3. Else → prompt once; the entered value is saved as the
          //      per-workspace default + applied to this estimate.
          const kind = est?.kind || "siding";
          const currentWaste = Number(est?.waste_pct ?? 0);
          const canUpdate = typeof update === "function";
          if (currentWaste > 0 || !canUpdate) {
            fileRef.current?.click();
            return;
          }
          const savedDefault = getSavedWasteDefault(kind);
          if (savedDefault) {
            update({ waste_pct: savedDefault });
            fileRef.current?.click();
            return;
          }
          const raw = window.prompt(
            `Set Waste Factor % for ${workspaceLabel(kind)} quotes (applies to Siding + Soffit panel orders).\n\nThis value will be saved as your default for this workspace — you won't be asked again on future uploads (use the "change" link under the button to update it later).\n\nTypical: 10% small, 15% standard, 25–33% complex / lots of cuts.`,
            "15"
          );
          if (raw === null) return;
          const pct = Number(raw);
          if (!isNaN(pct) && pct > 0) {
            update({ waste_pct: pct });
            saveWasteDefault(kind, pct);
          }
          fileRef.current?.click();
        }}
        disabled={busy}
        data-testid="blueprint-import-btn"
        title="Read a blueprint PDF and pull window schedule + wall dims"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        {busy
          ? (busyStage === "claude" ? "Reading plans…"
            : busyStage === "aggregating" ? "Aggregating walls…"
            : busyStage === "mapping" ? "Mapping to catalog…"
            : busyStage === "starting" ? "Uploading…"
            : "Reading plans…")
          : "Read Blueprints"}
      </button>

      {/* Iter 78 — Default waste % caption. Shown when a saved default
          exists for this workspace; provides quick "change" + "clear"
          affordances so Howard can update or reset without leaving the
          page. Hidden when no default is saved yet (the upload button's
          first-click prompt creates it). */}
      {typeof update === "function" && (() => {
        const kind = est?.kind || "siding";
        const saved = getSavedWasteDefault(kind);
        if (!saved) return null;
        return (
          <div
            className="mt-1.5 text-[10px] uppercase tracking-wider text-[#71717A] flex items-center gap-2"
            data-testid="blueprint-waste-default-caption"
          >
            <span>
              Default waste · <span className="font-bold text-[#09090B]">{saved}%</span>
            </span>
            <button
              type="button"
              className="text-[#7C3AED] hover:underline font-bold"
              onClick={() => {
                const raw = window.prompt(
                  `Update default Waste Factor % for ${workspaceLabel(kind)} quotes.\n\nThis replaces the saved default and applies to this estimate too.`,
                  String(saved)
                );
                if (raw === null) return;
                const pct = Number(raw);
                if (!isNaN(pct) && pct > 0) {
                  update({ waste_pct: pct });
                  saveWasteDefault(kind, pct);
                }
              }}
              data-testid="blueprint-waste-default-change"
            >
              change
            </button>
            <span className="text-[#D4D4D8]">·</span>
            <button
              type="button"
              className="text-[#71717A] hover:text-[#DC2626] font-bold"
              onClick={() => {
                clearWasteDefault(kind);
                // Force re-render by nudging the estimate (any update will do)
                update({ waste_pct: est?.waste_pct || 0 });
              }}
              data-testid="blueprint-waste-default-clear"
              title="Clear the saved default — next upload will prompt again"
            >
              clear
            </button>
          </div>
        );
      })()}

      {/* Iter 57x — Restore banner. Surfaces when a blueprint run for
          this estimate completed on the backend but the frontend never
          received the run_id (typical Cloudflare 502 on slow upload). */}
      {resumeRun && !busy && !result && (
        <div
          className="mt-2 px-3 py-2 bg-[#FEF3C7] border border-[#F59E0B] flex items-center justify-between gap-3 text-xs"
          data-testid="blueprint-resume-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-[#92400E] flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-bold uppercase tracking-wider text-[10px] text-[#92400E]">
                Previous read available
              </div>
              <div className="text-[#92400E] truncate">
                {resumeRun.status === "done"
                  ? `Completed ${Math.round((resumeRun.age_seconds || 0) / 60)} min ago · ${resumeRun.page_count || "?"} page(s) · click to restore preview`
                  : resumeRun.status === "running"
                  ? `Still processing in background · click to resume polling`
                  : "Errored — see toast"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={restoreResume}
              className="px-2.5 py-1 bg-[#F59E0B] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[#D97706]"
              data-testid="blueprint-resume-btn"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => { setResumeDismissed(true); setResumeRun(null); }}
              className="px-2.5 py-1 bg-transparent text-[#92400E] text-[10px] font-bold uppercase tracking-wider hover:bg-[#FDE68A]"
              data-testid="blueprint-resume-dismiss"
              aria-label="Dismiss restore banner"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={dismissPreview}
          data-testid="blueprint-preview-backdrop"
        >
          <div
            className="bg-white max-w-3xl w-full max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="blueprint-preview-modal"
          >
            <div className="bg-[#7C3AED] text-white px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5" />
                <div>
                  <div className="font-heading text-lg">Blueprint Takeoff Preview</div>
                  <div className="text-xs opacity-90 mt-0.5">
                    {result.pages_processed} page(s) read · model {result.model || "Opus 4.5"}
                  </div>
                </div>
              </div>
              <button type="button" onClick={dismissPreview} className="text-white/90 hover:text-white" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Confidence + notes banner */}
              {measurements._ai_notes && (
                <div className="px-3 py-2 bg-[#FEF3C7] border-l-2 border-[#F59E0B] text-[12px] text-[#92400E] flex items-start gap-2" data-testid="blueprint-ai-notes">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold uppercase text-[10px] tracking-wider">AI notes · verify before applying</span>
                    <div className="mt-0.5 leading-snug">{measurements._ai_notes}</div>
                  </div>
                </div>
              )}

              {/* Sheets identified */}
              {sheets.length > 0 && (
                <section>
                  <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                    Plan sheets read
                  </div>
                  <ul className="text-xs space-y-0.5" data-testid="blueprint-sheets">
                    {sheets.map((s, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="font-mono-num text-[#A1A1AA] w-8">p.{s.page}</span>
                        <span className="font-bold">{s.sheet_title || "—"}</span>
                        <span className="text-[10px] uppercase tracking-wider text-[#71717A]">· {s.useful_for}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Iter 78o — Phase 1 sanity-check warnings (deterministic
                  reasonableness rules over the extracted measurements).
                  Shared component with the HOVER import preview banner. */}
              {Array.isArray(result.warnings) && result.warnings.length > 0 && (
                <section
                  className="border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2.5"
                  data-testid="blueprint-warnings-banner"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-[#B45309]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-[#B45309]">
                      Sanity check · {result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {result.warnings.map((w) => (
                      <div
                        key={w.code}
                        className="text-[12px] text-[#78350F] leading-snug"
                        data-testid={`blueprint-warning-${w.code}`}
                      >
                        <div className="font-bold">⚠ {w.message}</div>
                        {w.detail && (
                          <div className="text-[10px] font-mono-num text-[#B45309] mt-0.5">
                            {w.detail}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Iter 78t — Elevation drawings (shared with AI Measure +
                  HOVER). Blueprint vision pass produces AI-Measure-shaped
                  raw_ai.walls + openings OR HOVER-vision-shaped per-elev
                  data; try AI-shaped first, fall back to vision-shaped. */}
              {(() => {
                const fromAI = buildElevationsFromAIMeasure({
                  walls: result.raw_ai?.walls,
                  openings: result.raw_ai?.openings,
                  avg_wall_height_ft: result.measurements?._ai_avg_wall_height_ft,
                });
                const fromVision = buildElevationsFromHoverVision(result.measurements || {});
                const elevs = fromAI.length ? fromAI : fromVision;
                if (!elevs.length) return null;
                const edits = result.measurements?._ai_elevation_edits || {};
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
                const setEdit = (lbl, fn) => {
                  setResult((r) => {
                    if (!r) return r;
                    const cur = r.measurements?._ai_elevation_edits || {};
                    return {
                      ...r,
                      measurements: {
                        ...r.measurements,
                        _ai_elevation_edits: fn(cur, lbl),
                      },
                    };
                  });
                };
                const handleNudge = (lbl) => (opId, xPct, yPct) =>
                  setEdit(lbl, (cur) => {
                    const ee = cur[lbl] || { openings: {}, roof_style: null };
                    return { ...cur, [lbl]: { ...ee, openings: { ...(ee.openings || {}), [opId]: { x_pct: xPct, y_pct: yPct } } } };
                  });
                const handleRoof = (lbl) => (shape) =>
                  setEdit(lbl, (cur) => {
                    const ee = cur[lbl] || { openings: {}, roof_style: null };
                    return { ...cur, [lbl]: { ...ee, roof_style: shape } };
                  });
                return (
                  <section data-testid="blueprint-elevation-drawings">
                    <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                      Elevation Drawings
                    </div>
                    <p className="text-[11px] text-[#52525B] mb-2">
                      Reconstructed from the Blueprint vision pass. Drag any opening to reposition or click Roof to fix the shape.
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
                  </section>
                );
              })()}

              {/* Summary numbers */}
              <section>
                <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                  Takeoff
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs" data-testid="blueprint-summary">
                  {SUMMARY_KEYS.map((k) => {
                    const v = measurements[k];
                    if (v == null) return null;
                    return (
                      <div key={k} className="border border-[#E4E4E7] px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">{KEY_LABEL[k]}</div>
                        <div className="font-mono-num font-bold">
                          {fmtNum(v)} <span className="text-[10px] text-[#71717A]">{UNIT_BY_KEY(k)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Iter 78 — Takeoff Reconciliation: AI raw → formula → ordered */}
              <TakeoffReconCard
                measurements={measurements || {}}
                lines={result.lines || []}
                wastePct={est?.waste_pct || 0}
                kind={est?.kind || "siding"}
                lpSoffitType={est?.lp_soffit_type || "mix"}
              />

              {/* Window schedule */}
              {schedWindows.length > 0 && (
                <section>
                  <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                    Window schedule ({schedWindows.length} mark{schedWindows.length === 1 ? "" : "s"})
                  </div>
                  <div className="border border-[#E4E4E7] max-h-44 overflow-y-auto" data-testid="blueprint-window-schedule">
                    <table className="w-full text-xs">
                      <thead className="bg-[#FAFAFA] text-[10px] uppercase tracking-wider text-[#71717A]">
                        <tr>
                          <th className="text-left px-2 py-1">Mark</th>
                          <th className="text-right px-2 py-1">W (in)</th>
                          <th className="text-right px-2 py-1">H (in)</th>
                          <th className="text-right px-2 py-1">Qty</th>
                          <th className="text-left px-2 py-1">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedWindows.map((w, i) => (
                          <tr key={i} className="border-t border-[#F4F4F5]">
                            <td className="px-2 py-1 font-mono-num">{w.id || "—"}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(w.width_in)}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(w.height_in)}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(w.qty || 1)}</td>
                            <td className="px-2 py-1 text-[11px] text-[#71717A]">{w.type_hint || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[10px] text-[#A1A1AA] mt-1.5">
                    {issMode
                      ? "Window schedule shown for reference only — ISS estimates don't have a Windows tab. Take counts manually if needed."
                      : `Will populate ${est.kind === "windows" ? "this Windows estimate" : "the paired Windows estimate"} on Apply.`}
                  </div>
                </section>
              )}

              {/* Door schedule */}
              {schedDoors.length > 0 && (
                <section>
                  <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                    Door schedule ({schedDoors.length} mark{schedDoors.length === 1 ? "" : "s"})
                  </div>
                  <div className="border border-[#E4E4E7] max-h-32 overflow-y-auto" data-testid="blueprint-door-schedule">
                    <table className="w-full text-xs">
                      <thead className="bg-[#FAFAFA] text-[10px] uppercase tracking-wider text-[#71717A]">
                        <tr>
                          <th className="text-left px-2 py-1">Mark</th>
                          <th className="text-right px-2 py-1">W (in)</th>
                          <th className="text-right px-2 py-1">H (in)</th>
                          <th className="text-right px-2 py-1">Qty</th>
                          <th className="text-left px-2 py-1">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedDoors.map((d, i) => (
                          <tr key={i} className="border-t border-[#F4F4F5]">
                            <td className="px-2 py-1 font-mono-num">{d.id || "—"}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(d.width_in)}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(d.height_in)}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{fmtNum(d.qty || 1)}</td>
                            <td className="px-2 py-1 text-[11px] text-[#71717A]">{d.type_hint || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Iter 57ee — Formula breakdowns. Shows the per-job math
                  behind dynamic line counts (today: J-channel; future:
                  any rule whose note is a callable). One line per
                  unique breakdown so a 3-tab spec doesn't dump 3 copies. */}
              {(() => {
                const seen = new Set();
                const dynamicNotes = (result.lines || [])
                  .filter((l) => l.note && /÷/.test(l.note))
                  .filter((l) => {
                    const k = `${l.section}::${l.name}`;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                  });
                if (dynamicNotes.length === 0) return null;
                return (
                  <section data-testid="blueprint-formula-notes">
                    <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                      Formula breakdown
                    </div>
                    <div className="border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-2 space-y-1.5">
                      {dynamicNotes.map((l, i) => (
                        <div key={i} className="text-[11px]">
                          <span className="font-bold text-[#52525B]">{l.name}:</span>{" "}
                          <span className="font-mono-num text-[#71717A]">{l.note}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {/* Raw JSON expander (parity with AI Measure debug panel) */}
              <details
                open={showRawJson}
                onToggle={(e) => setShowRawJson(e.currentTarget.open)}
                className="border border-[#E4E4E7]"
              >
                <summary className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#71717A] font-bold cursor-pointer bg-[#FAFAFA]">
                  Raw AI JSON
                </summary>
                <pre className="text-[10px] font-mono-num p-3 overflow-x-auto max-h-64 bg-[#09090B] text-[#E4E4E7]" data-testid="blueprint-raw-json">
                  {JSON.stringify(result.raw_ai, null, 2)}
                </pre>
              </details>
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-3 flex justify-between items-center">
              <div className="text-[10px] text-[#A1A1AA]">
                Tip: Plans should include elevations + a window schedule for best accuracy.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                  onClick={dismissPreview}
                  disabled={applying}
                  data-testid="blueprint-cancel-btn"
                >Cancel</button>
                <button
                  type="button"
                  onClick={applyResult}
                  disabled={applying}
                  className="px-3 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="blueprint-apply-btn"
                >
                  {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {applying ? "Applying…" : "Apply Takeoff"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
