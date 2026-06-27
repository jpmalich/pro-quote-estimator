// AI Photo Measure button.
//
// Mirrors the HOVER import button visually + behaviorally so contractors
// have a familiar workflow:
//   click → upload 2-8 phone photos (and optional reference dim) →
//   preview Claude's diff → Apply.
//
// The backend (/api/measure/ai-measure) returns the same `measurements`
// shape as HOVER, so we hand it to the same `onApply` callback the page
// already uses for HOVER.
import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Check, Loader2, AlertTriangle, Camera, Upload, Ruler, RotateCcw, Wand2, FileText } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import PhotoMeasureButton from "@/components/estimate/PhotoMeasureButton";
import PhotoAnnotateModal from "@/components/estimate/PhotoAnnotateModal";
// Iter 78z — Profile annotator: lets contractor draw boxes tagged
// Shake / B&B / etc. so the AI worker treats those regions as
// authoritative accent material. Both AI Measure + Blueprint share it.
import ProfileAnnotator from "@/components/estimate/ProfileAnnotator";
import GuidedCaptureWizard from "@/components/estimate/GuidedCaptureWizard";
import { renderAnnotated, describeAnnotations } from "@/lib/photoAnnotate";
// Iter 78s — HOVER-style elevation drawings, generated from the AI Measure
// raw_ai output.
import ElevationDrawing from "@/components/estimate/ElevationDrawing";
// Iter 78u — Optional 3D preview (Three.js orthographic). Same scene
// factory the headless PNG renderer uses for the customer Quote PDF.
import Elevation3DPreview from "@/components/estimate/Elevation3DPreview";
import { buildElevationsFromAIMeasure } from "@/lib/elevationBuilder";
// Iter 78z (P1.3) — Per-Elevation Breakdown card + "+ Add Accent" override
import PerElevationBreakdownCard from "@/components/estimate/PerElevationBreakdownCard";

const ELEVATION_OPTIONS = [
  { key: "",            label: "Untagged" },
  { key: "front",       label: "Front" },
  { key: "front-left",  label: "Front-Left corner" },
  { key: "left",        label: "Left" },
  { key: "rear-left",   label: "Rear-Left corner" },
  { key: "back",        label: "Back" },
  { key: "rear-right",  label: "Rear-Right corner" },
  { key: "right",       label: "Right" },
  { key: "front-right", label: "Front-Right corner" },
  { key: "aerial",      label: "Aerial (satellite)" },
  { key: "detail",      label: "Detail" },
];
const annotEmpty = (a) =>
  !a || (!a.reference && !a.windowReference && (!a.zones || a.zones.length === 0) && (!a.elevation || a.elevation === "") && !a.targetPin);

const KEY_LABELS = {
  siding_sqft: "Siding",
  siding_with_openings_sqft: "Siding (+openings)",
  opening_sqft: "Openings (ft²)",
  eaves_lf: "Eaves",
  rakes_lf: "Rakes",
  opening_count: "Openings",
  window_count: "Windows",
  entry_door_count: "Entry doors",
  patio_door_count: "Patio doors",
  garage_door_count: "Garage doors",
  opening_perimeter_lf: "Opening perimeter",
};
const fmt = (n) => Number(n || 0).toLocaleString();
const unitOf = (k) =>
  k.endsWith("_sqft") ? "ft²" : k.endsWith("_lf") ? "LF" : "";

export default function AIMeasureButton({ kind, onApply, address, overhangIn, estimateId }) {
  const fileRef = useRef();
  // `files` is the locally-selected file objects (used for previews until
  // upload completes); `photoUrls` is the canonical server-side list that
  // survives across sessions. Once a file finishes uploading, the URL is
  // appended to photoUrls and the local File is discarded.
  const [files, setFiles] = useState([]);
  const [photoUrls, setPhotoUrls] = useState([]); // ["/api/uploads/<uuid>.jpg", …]
  // Iter 56: per-photo pre-AI annotations. Keyed by photo filename
  // (matches the value stored in photoUrls). Each entry holds:
  //   { elevation: "front"|"back"|"left"|"right"|"detail"|"",
  //     reference: { p1, p2, inches } | null,
  //     zones: Array<{ kind, category, points }> }
  // Annotations are burned into the photo via Canvas in runMeasure()
  // before sending to Claude, and described as text alongside.
  const [photoAnnotations, setPhotoAnnotations] = useState({});
  const [annotateOpenFor, setAnnotateOpenFor] = useState(null); // filename or null
  // Iter 78z — Profile annotator modal (box-tag Shake / B&B regions).
  const [profileAnnotatorOpen, setProfileAnnotatorOpen] = useState(false);
  const [savedProfileAnnotations, setSavedProfileAnnotations] = useState({});
  // Iter 56c — free aerial fetch via Esri World Imagery.
  const [satBusy, setSatBusy] = useState(false);
  const [resumePrompt, setResumePrompt] = useState(false); // shows banner
  const [refDim, setRefDim] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [sidingPct, setSidingPct] = useState("");
  // Iter 57g — optional course-counting calibration. If the contractor
  // tells us the brick course size or the siding exposure, Claude can
  // size windows by counting visible rows in the photo — far more
  // accurate than estimating pixel ratios. Defaults:
  //   • Brick: 8 in (standard 3-bricks-per-8" course w/ 3/8" mortar)
  //   • Siding D5: 5 in, D6: 6 in, Cedar Impressions: 7 in (default 5)
  // Blank = "don't pass to Claude"; user can also disable each
  // independently by emptying the field.
  const [brickCourse, setBrickCourse] = useState("");
  const [sidingExposure, setSidingExposure] = useState("");
  // Iter 57j — Deep Dormer Scan toggle. When ON, the backend runs a
  // parallel Claude pass per ground-level photo that crops + upscales
  // the roofline strip to surface small dormers that get lost when
  // Claude downsizes full-house shots. Default OFF — keeps the fast
  // path fast for the 90% of jobs without dormers.
  // Iter 78u — Default ON. Missing dormers is the #1 source of
  // under-quoting on 1.5-story Capes / dormer-rich homes. The deep
  // scan only adds ~5-10s and catches what the main pass misses
  // because phone photos get downsized to ~1568px before tokenization.
  const [deepDormerScan, setDeepDormerScan] = useState(true);
  // Iter 57h — popover state for the inline "📐 Calibrate window sizing"
  // mini-panel that hangs next to the Run AI Measure button.
  const [calibOpen, setCalibOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Iter 57q — when AI Measure is running, show the worker's current
  // stage ("claude" → "dormer_scan" → "aggregating" → "mapping") in the
  // Run button so the contractor knows progress is happening. Empty
  // string when idle.
  const [busyStage, setBusyStage] = useState("");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // {measurements, raw_ai}
  // Iter 57r — Resume support. When the modal opens we ask the
  // backend for the most recent AI Measure run for this estimate
  // (regardless of status). If it's still "running" or finished within
  // the last 30 minutes, we surface a small banner that lets the
  // contractor pick up where they left off after a page reload or
  // screen lock — no re-uploading photos, no re-running Claude.
  const [lastRun, setLastRun] = useState(null);  // { run_id, status, stage, age_seconds, photo_paths, result }
  // Iter 78z (Cross-Check) — track the active run's ID so the
  // PerElevationBreakdownCard can fire the cross-check endpoint.
  // Populated by both the fresh-run path and the resume path.
  const [currentRunId, setCurrentRunId] = useState(null);
  const [refineOpen, setRefineOpen] = useState(false);
  // Iter 51: Optional "quote gables as shake" override. Adds a shake-
  // siding line for the total gable ft² and deducts that area from the
  // main Charter Oak / Ascend siding qty so we don't double-count.
  const [quoteGablesAsShake, setQuoteGablesAsShake] = useState(false);
  const [shakeSku, setShakeSku] = useState("Pelican Bay Shakes 9\"");
  // Iter 52: Same idea for dormer faces — homeowners often want shake or
  // an accent siding on the dormer for visual interest. Independent
  // toggle + SKU from gables so they can be quoted differently.
  const [quoteDormersAsShake, setQuoteDormersAsShake] = useState(false);
  const [dormerShakeSku, setDormerShakeSku] = useState("Pelican Bay Shakes 9\"");
  // Iter 47: contractor can override Claude's wall geometry inline.
  // Tracks whether walls were edited so apply() refreshes lines via
  // /measure/map (otherwise the pre-rolled lines are reused).
  const [wallsDirty, setWallsDirty] = useState(false);
  // Iter 55: how to merge the values coming out of Refine on Photo into
  // the AI's aggregate. Howard's mental model is "I'm tapping each
  // elevation in turn; the LFs and counts should ADD together across
  // refines." Previously the merge was a hard overwrite which silently
  // downgraded the multi-photo aggregate (136 LF eaves → 58 LF, 11
  // windows → 3) whenever the contractor refined a single elevation.
  //   "add"     — running total grows with each refine (default)
  //   "max"     — take the larger of refined vs current (safe baseline)
  //   "replace" — refined wins (legacy Iter 39 behavior)
  // Stored in localStorage so the contractor's pick sticks across jobs.
  const [refineMergeMode, setRefineMergeMode] = useState(() => {
    try {
      const v = localStorage.getItem("aiMeasureRefineMergeMode");
      return v === "max" || v === "replace" || v === "add" ? v : "max";
    } catch {
      return "max";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("aiMeasureRefineMergeMode", refineMergeMode); } catch { /* ignore */ }
  }, [refineMergeMode]);
  // Iter 57: hide Refine on Photo behind an Advanced Tools toggle.
  // Now that pre-AI annotations (Iter 56) cover most use cases, Refine
  // on Photo is the rare-case escape hatch — keep it accessible but out
  // of the primary flow.
  const [showAdvanced, setShowAdvanced] = useState(() => {
    try {
      return localStorage.getItem("aiMeasureShowAdvanced") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("aiMeasureShowAdvanced", showAdvanced ? "1" : "0");
    } catch { /* ignore */ }
  }, [showAdvanced]);

  // Iter 57d — Window styles dropdown. Kept in display order grouped
  // by category so the contractor can scan it quickly. Empty option
  // at the top means "not a window / not known yet".
  const WINDOW_STYLES = [
    { value: "", label: "— Select / N/A —" },
    { value: "Double Hung", label: "Double Hung" },
    { value: "Single Hung", label: "Single Hung" },
    { value: "Casement", label: "Casement" },
    { value: "Twin Casement", label: "Twin Casement" },
    { value: "Awning", label: "Awning" },
    { value: "Hopper", label: "Hopper" },
    { value: "2-Lite Slider", label: "2-Lite Slider (XO)" },
    { value: "3-Lite Slider", label: "3-Lite Slider (XOX)" },
    { value: "Picture", label: "Picture / Fixed" },
    { value: "Twin Double Hung", label: "Twin Double Hung" },
    { value: "Twin Single Hung", label: "Twin Single Hung" },
    { value: "Triple Double Hung", label: "Triple Double Hung" },
    { value: "Bay Window", label: "Bay Window" },
    { value: "Bow Window", label: "Bow Window" },
    { value: "Half-Round", label: "Half-Round" },
    { value: "Quarter-Round", label: "Quarter-Round" },
    { value: "Arch", label: "Arch / Eyebrow" },
    { value: "Octagon", label: "Octagon" },
    { value: "Hexagon", label: "Hexagon" },
    { value: "Garden Window", label: "Garden Window" },
    { value: "Other Shape", label: "Other / Custom Shape" },
  ];

  // Update the AI-detected style for one opening_schedule row. We mutate
  // the saved preview.measurements._ai_openings_schedule so the change
  // sticks across re-renders + the autosave hook pushes it back to the
  // ai_measure_sessions doc. Also propagates to preview.raw_ai.openings
  // (best-effort match by wall+size+type) so the Apply Measurements
  // step uses the corrected style when populating Vero rows.
  const updateOpeningStyle = (elev, type, sizeLabel, w, h, newStyle) => {
    setPreview((prev) => {
      if (!prev) return prev;
      const m = prev.measurements || {};
      const sched = m._ai_openings_schedule || [];
      const nextSched = sched.map((row) => {
        if (
          (row.elevation || "").toLowerCase() === (elev || "").toLowerCase() &&
          (row.type || "").toLowerCase() === (type || "").toLowerCase() &&
          (row.size_label || "") === (sizeLabel || "") &&
          Math.round(Number(row.width_in) || 0) === Math.round(Number(w) || 0) &&
          Math.round(Number(row.height_in) || 0) === Math.round(Number(h) || 0)
        ) {
          return { ...row, style: newStyle };
        }
        return row;
      });
      // Also propagate to raw_ai.openings so Apply uses the new style.
      const raw = prev.raw_ai || {};
      const rawOps = (raw.openings || []).map((op) => {
        const sameWall = (op.wall || "").toLowerCase() === (elev || "").toLowerCase();
        const sameType = (op.type || "").toLowerCase() === (type || "").toLowerCase();
        const sameW = Math.round(Number(op.width_in) || 0) === Math.round(Number(w) || 0);
        const sameH = Math.round(Number(op.height_in) || 0) === Math.round(Number(h) || 0);
        if (sameWall && sameType && sameW && sameH) {
          return { ...op, style: newStyle };
        }
        return op;
      });
      return {
        ...prev,
        measurements: { ...m, _ai_openings_schedule: nextSched },
        raw_ai: { ...raw, openings: rawOps },
      };
    });
  };


  // Hits /api/measure/report-pdf with the current estimate_id; backend
  // reads the saved session and renders a 1–2 page report with photos,
  // confidence chips, openings schedule, and notes.
  const [reportBusy, setReportBusy] = useState(false);
  // Iter 78u — Toggle between 2D nudgeable SVG editor and the 3D
  // orthographic preview (what the customer will see when 3D
  // drawings are re-enabled in the Quote PDF).
  const [show3DPreview, setShow3DPreview] = useState(false);
  const downloadReportPdf = async () => {
    if (!estimateId) {
      toast.error("Save the estimate first — the report needs an estimate ID");
      return;
    }
    setReportBusy(true);
    try {
      const res = await api.post(
        "/measure/report-pdf",
        { estimate_id: estimateId },
        { responseType: "blob" },
      );
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${estimateId.slice(0, 8)}-measurement.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Measurement report downloaded");
    } catch (err) {
      // Blob responses make the JSON error invisible — decode manually
      let detail = err?.response?.data?.detail || err?.message || "Report failed";
      if (err?.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          detail = JSON.parse(text)?.detail || text || detail;
        } catch { /* ignore */ }
      }
      toast.error(detail);
    } finally {
      setReportBusy(false);
    }
  };

  // Apply Howard's geometry math to the edited wall list and update
  // siding_sqft / gable / dormer totals on the preview in-place. Mirrors
  // backend `_aggregate_to_hover_shape` so the headline number tracks
  // every keystroke without a round-trip.
  const recomputeFromWalls = (walls) => {
    let sidingSqft = 0;
    let gableSqft = 0;
    let dormerSqft = 0;
    for (const w of walls) {
      const width = Number(w.width_ft) || 0;
      const eave = Number(w.height_ft) || 0;
      const gross = width * eave;
      let pct = Number(w.siding_pct_this_wall);
      if (!pct || pct <= 0) pct = 100;
      if (pct > 100) pct = 100;
      sidingSqft += gross * (pct / 100);
      const gableH = Number(w.gable_triangle_height_ft) || 0;
      if (gableH > 0 && width > 0) gableSqft += 0.5 * width * gableH;
      dormerSqft += Number(w.dormer_face_sqft) || 0;
    }
    sidingSqft += gableSqft + dormerSqft;
    return {
      siding_sqft: Math.round(sidingSqft * 10) / 10,
      _ai_gable_sqft: Math.round(gableSqft * 10) / 10,
      _ai_dormer_sqft: Math.round(dormerSqft * 10) / 10,
    };
  };

  // Edit one cell on one wall and recompute totals so the headline
  // sqft figure on the preview shifts immediately.
  const setWall = (idx, key, val) => {
    setPreview((p) => {
      if (!p?.raw_ai?.walls) return p;
      const walls = p.raw_ai.walls.map((w, i) =>
        i === idx ? { ...w, [key]: val === "" ? 0 : Number(val) } : w
      );
      const totals = recomputeFromWalls(walls);
      return {
        ...p,
        raw_ai: { ...p.raw_ai, walls },
        measurements: {
          ...p.measurements,
          siding_sqft: totals.siding_sqft,
          siding_with_openings_sqft: totals.siding_sqft,
          _ai_gable_sqft: totals._ai_gable_sqft,
          _ai_dormer_sqft: totals._ai_dormer_sqft,
        },
      };
    });
    setWallsDirty(true);
  };

  // Edit any of the linear-measurement fields (eaves, rakes, starter,
  // corners, opening perimeter) inline. ISS soffit/gutter/etc. and the
  // siding-flow soffit/J-channel rows all derive their qty from these,
  // so a one-line override here propagates everywhere through the
  // /measure/map refresh on Apply.
  const setMeasurementField = (key, val) => {
    setPreview((p) => {
      if (!p?.measurements) return p;
      return {
        ...p,
        measurements: {
          ...p.measurements,
          [key]: val === "" ? 0 : Number(val),
        },
      };
    });
    setWallsDirty(true);
  };


  // ------------------------------------------------------------------
  // Server-side session persistence (Iter 50).
  // ------------------------------------------------------------------
  // On first modal open for this estimate, check for an existing session
  // and offer the contractor a Resume / Start Over choice. Without an
  // estimateId we just skip persistence entirely (e.g. ISS new-quote
  // flow before the doc has been saved).
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    if (!estimateId || !open || sessionChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/measure/sessions/${estimateId}`);
        if (cancelled) return;
        // If the modal already has fresh state (user just selected files
        // before we finished the GET), don't clobber. Otherwise prompt.
        const hasFreshState = photoUrls.length > 0 || preview != null;
        if (!hasFreshState && (data.photo_urls?.length || data.preview)) {
          setResumePrompt(true);
          // Stash for the Resume button to consume.
          window.__aiMeasurePendingSession = data;
        }
      } catch {
        // 404 — no session, normal first run.
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [estimateId, open, sessionChecked, photoUrls.length, preview]);

  // Iter 78z — Load saved profile annotations for this estimate.
  useEffect(() => {
    if (!estimateId || !open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/estimates/${estimateId}/profile-annotations`);
        if (!cancelled) setSavedProfileAnnotations(data?.annotations || {});
      } catch {
        // No annotations yet — that's fine
      }
    })();
    return () => { cancelled = true; };
  }, [estimateId, open]);

  // Iter 57r — Resume support. On modal open, fetch the most recent
  // AI Measure run for this estimate. If it's still "running" or
  // finished within the last 30 min, set `lastRun` so the banner
  // surfaces. The actual Resume / Restore button click is wired below.
  useEffect(() => {
    if (!estimateId || !open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/measure/ai-measure/latest-for-estimate/${estimateId}`);
        if (cancelled) return;
        const r = data?.run || null;
        if (!r) { setLastRun(null); return; }
        // Only surface fresh runs (< 30 min) so we don't nag the
        // contractor about ancient runs they already applied.
        if (r.status === "running" || (r.age_seconds || 0) < 30 * 60) {
          setLastRun(r);
        } else {
          setLastRun(null);
        }
      } catch {
        setLastRun(null);
      }
    })();
    return () => { cancelled = true; };
  }, [estimateId, open]);

  // Iter 57r — handler: resume polling an in-flight run.
  const _applyAIResult = (data) => {
    // Resume path: load the preview directly. The full per-wall
    // recompute + auto-elevation-tagging that the fresh-run path
    // performs assumes the contractor was watching the run live; on
    // resume we trust whatever Claude returned and let them re-edit.
    setPreview(data);
  };

  // Iter 78z+ — Re-fire AI Measure using cached photo bytes server-side
  // (no re-upload). Triggered from ProfileAnnotator's "Save & Re-run".
  // Mirrors `resumeRunPolling` but kicks off a fresh worker first.
  const rerunWithAnnotations = async () => {
    if (!currentRunId) {
      toast.error("No previous AI Measure run to re-fire — upload photos first");
      return;
    }
    setBusy(true);
    setBusyStage("starting");
    try {
      const launch = await api.post(`/measure/ai-measure/rerun/${currentRunId}`);
      const newRunId = launch?.data?.run_id;
      if (!newRunId) throw new Error("Backend didn't return a new run_id");
      setCurrentRunId(newRunId);
      setBusyStage(launch?.data?.stage || "starting");
      // Poll the new run to completion using the same 5-min loop.
      let result = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let statusResp;
        try {
          statusResp = await api.get(`/measure/ai-measure/status/${newRunId}`);
        } catch (e) {
          if (i >= 5) console.warn("ai-measure rerun status poll failed", e?.message);
          continue;
        }
        const s = statusResp?.data || {};
        if (s.stage && s.stage !== busyStage) setBusyStage(s.stage);
        if (s.status === "error") throw new Error(s.error || "AI measure re-run failed");
        if (s.status === "done") { result = s.result; break; }
      }
      if (!result) throw new Error("Re-run timed out after 5 minutes");
      _applyAIResult(result);
      toast.success("Re-run complete · annotations applied to materials list");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Re-run failed");
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  };

  const resumeRunPolling = async () => {
    if (!lastRun || !lastRun.run_id) return;
    setBusy(true);
    setBusyStage(lastRun.stage || "running");
    setCurrentRunId(lastRun.run_id);
    // Restore the photo grid from the saved photo_paths so the UI
    // matches the run the worker is processing.
    if (lastRun.photo_paths) {
      const paths = String(lastRun.photo_paths).split(",").map((s) => s.trim()).filter(Boolean);
      if (paths.length) setPhotoUrls(paths);
    }
    setLastRun(null);
    try {
      let result = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let statusResp;
        try {
          statusResp = await api.get(`/measure/ai-measure/status/${lastRun.run_id}`);
        } catch {
          continue;
        }
        const s = statusResp?.data || {};
        if (s.stage && s.stage !== busyStage) setBusyStage(s.stage);
        if (s.status === "error") throw new Error(s.error || "AI measure failed");
        if (s.status === "done") { result = s.result; break; }
      }
      if (!result) throw new Error("Resume timed out");
      // Mimic the same downstream flow as a normal run completion.
      _applyAIResult(result);
      toast.success("AI Measure resumed — preview loaded");
    } catch (e) {
      toast.error(e?.message || "Resume failed");
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  };

  // Iter 57r — handler: restore the preview from a finished run.
  const restoreLastRun = () => {
    if (!lastRun || !lastRun.result) return;
    if (lastRun.photo_paths) {
      const paths = String(lastRun.photo_paths).split(",").map((s) => s.trim()).filter(Boolean);
      if (paths.length) setPhotoUrls(paths);
    }
    setCurrentRunId(lastRun.run_id);
    _applyAIResult(lastRun.result);
    setLastRun(null);
    toast.success("Last AI run restored — preview loaded");
  };

  // Debounced autosave: any time the persisted state changes, push to
  // /measure/sessions. 1 second debounce keeps wall-edit keystrokes from
  // hammering the backend.
  useEffect(() => {
    if (!estimateId || !open || !sessionChecked) return;
    // Skip empty initial state to avoid creating an empty session doc.
    if (!photoUrls.length && !preview) return;
    const t = setTimeout(() => {
      api
        .put(`/measure/sessions/${estimateId}`, {
          estimate_id: estimateId,
          photo_urls: photoUrls,
          reference_dim: refDim,
          wall_height: wallHeight,
          siding_pct: sidingPct,
          overhang_in: Number(overhangIn ?? 12),
          preview,
          // Iter 56f: persist per-photo annotations so they survive
          // page navigation / refresh too. Previously these were
          // dropped on close because they weren't in the payload —
          // contractors lost all their pin / scale / mask work.
          photo_annotations: photoAnnotations,
        })
        .catch(() => {
          // Non-fatal: autosave failures are silent so they don't
          // interrupt the contractor's flow. Local state is still good.
        });
    }, 1000);
    return () => clearTimeout(t);
  }, [estimateId, open, sessionChecked, photoUrls, refDim, wallHeight, sidingPct, overhangIn, preview, photoAnnotations]);

  const resumeSession = () => {
    const data = window.__aiMeasurePendingSession;
    if (!data) {
      setResumePrompt(false);
      return;
    }
    setPhotoUrls(data.photo_urls || []);
    setRefDim(data.reference_dim || "");
    setWallHeight(data.wall_height || "");
    setSidingPct(data.siding_pct || "");
    if (data.preview) setPreview(data.preview);
    // Iter 56f: also restore per-photo annotations.
    if (data.photo_annotations) setPhotoAnnotations(data.photo_annotations);
    setResumePrompt(false);
    delete window.__aiMeasurePendingSession;
    toast.success("Resumed your last AI Measure session");
  };

  const startOver = async () => {
    setResumePrompt(false);
    setPreview(null);
    setPhotoUrls([]);
    setFiles([]);
    setRefDim("");
    setWallHeight("");
    setSidingPct("");
    setWallsDirty(false);
    setPhotoAnnotations({});
    delete window.__aiMeasurePendingSession;
    if (estimateId) {
      try {
        await api.delete(`/measure/sessions/${estimateId}`);
      } catch {
        // ignore
      }
    }
  };


  // Upload-on-select. Photos hit /api/uploads immediately so they're
  // safe across page refreshes; only the resulting server URLs go into
  // photoUrls. The transient `files` list lives just long enough to
  // show previews during upload.
  const pickFiles = async (e) => {
    const arr = Array.from(e.target.files || []).slice(0, 9 - photoUrls.length);
    if (!arr.length) return;
    setFiles((prev) => [...prev, ...arr]);
    // Parallel uploads.
    const uploaded = await Promise.all(
      arr.map(async (f) => {
        try {
          const fd = new FormData();
          fd.append("file", f);
          const { data } = await api.post("/uploads", fd, {
            headers: { "Content-Type": "multipart/form-data" },
            timeout: 60000,
          });
          return data.name; // store the bare filename
        } catch (err) {
          toast.error(`Upload failed for ${f.name}`);
          return null;
        }
      })
    );
    const ok = uploaded.filter(Boolean);
    setPhotoUrls((prev) => [...prev, ...ok]);
    // Drop the local File objects now that the URLs are persisted.
    setFiles((prev) => prev.filter((f) => !arr.includes(f)));
  };

  // Iter 57: Guided capture wizard. After the wizard completes,
  // upload all files at once and pre-tag each photo's elevation
  // (front / back / left / right) so Claude doesn't have to guess.
  const [wizardOpen, setWizardOpen] = useState(false);
  const handleWizardComplete = async ({ photos }) => {
    if (!photos?.length) return;
    const room = 9 - photoUrls.length;
    if (room <= 0) {
      toast.error("Already at 8 photos — remove some before importing wizard captures");
      return;
    }
    const batch = photos.slice(0, room);
    setFiles((prev) => [...prev, ...batch.map((p) => p.file)]);
    const uploaded = await Promise.all(
      batch.map(async (p) => {
        try {
          const fd = new FormData();
          fd.append("file", p.file);
          const { data } = await api.post("/uploads", fd, {
            headers: { "Content-Type": "multipart/form-data" },
            timeout: 60000,
          });
          return { name: data.name, elevation: p.elevation };
        } catch (err) {
          toast.error(`Upload failed for ${p.file.name}`);
          return null;
        }
      }),
    );
    const ok = uploaded.filter(Boolean);
    setPhotoUrls((prev) => [...prev, ...ok.map((u) => u.name)]);
    // Apply the elevation tags from the wizard so Claude gets ground truth.
    setPhotoAnnotations((prev) => {
      const next = { ...prev };
      ok.forEach(({ name, elevation }) => {
        next[name] = { ...(next[name] || {}), elevation };
      });
      return next;
    });
    setFiles((prev) => prev.filter((f) => !batch.find((b) => b.file === f)));
    toast.success(`${ok.length} photo${ok.length !== 1 ? "s" : ""} added & elevation-tagged from wizard`);
  };

  // Iter 56c: pull a free Esri aerial tile for the estimate's address
  // and add it as an 8th photo. The endpoint resolves the address →
  // lat/lon → satellite JPEG and writes the file straight into the same
  // UPLOAD_DIR /api/uploads uses, so we just append the filename to
  // photoUrls and auto-tag it as "aerial" so Claude knows what it is.
  const fetchSatellite = async () => {
    if (satBusy) return;
    if (!address || !String(address).trim()) {
      toast.error("Fill in the Address in Job Information first — I need it to find the property");
      return;
    }
    if (photoUrls.length >= 9) {
      toast.error("Already at 9 photos — remove one to add the aerial view");
      return;
    }
    setSatBusy(true);
    try {
      const fd = new FormData();
      fd.append("address", address);
      const { data } = await api.post("/measure/satellite-tile", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 30000,
      });
      const name = data?.filename;
      if (!name) throw new Error("No filename in response");
      setPhotoUrls((prev) => [...prev, name]);
      setPhotoAnnotations((prev) => ({
        ...prev,
        [name]: { ...(prev[name] || {}), elevation: "aerial" },
      }));
      toast.success(`Aerial view added · ${(data.bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || "Satellite fetch failed";
      toast.error(detail);
    } finally {
      setSatBusy(false);
    }
  };

  const removePhoto = (idx) => {    setPhotoUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const runMeasure = async () => {
    if (!photoUrls.length) {
      toast.error("Add at least one photo");
      return;
    }
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();

      // Iter 56: photo annotations. For each photo that has annotations
      // (scale anchor, no-siding zones, or elevation tag), we render an
      // annotated PNG client-side and upload it as a fresh file. The
      // un-annotated photos stay referenced by their existing
      // /api/uploads path for free.
      const annotatedFiles = [];   // [{ name (original), file }]
      const passThroughUrls = [];  // original photoUrls that have no annot
      const elevations = {};       // { originalName: elevation }
      // Iter 57j — track per-photo elevation aligned to backend order
      // (photo_paths first, then files). Empty strings preserve slot
      // alignment when an elevation is unknown.
      const passThroughElevs = [];
      const annotatedElevs = [];
      for (const name of photoUrls) {
        const a = photoAnnotations[name];
        if (annotEmpty(a)) {
          passThroughUrls.push(name);
          passThroughElevs.push((a && a.elevation) || "");
          continue;
        }
        try {
          const blob = await renderAnnotated(`/api/uploads/${name}`, a);
          const file = new File([blob], `annotated-${name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" });
          annotatedFiles.push({ name, file });
          annotatedElevs.push(a.elevation || "");
          if (a.elevation) elevations[name] = a.elevation;
        } catch (e) {
          // Render failed (e.g. CORS) — fall back to the original photo
          // path. Still pass the structured description as text so
          // Claude has at least that.
          console.warn("annotate render failed for", name, e);
          passThroughUrls.push(name);
          passThroughElevs.push((a && a.elevation) || "");
        }
      }
      if (passThroughUrls.length) {
        fd.append("photo_paths", passThroughUrls.join(","));
      }
      for (const { file } of annotatedFiles) {
        fd.append("files", file);
      }

      // Reference dim + structured annotation description go into the
      // SAME reference_dim field — Claude reads it as contractor-
      // provided context inside the user prompt.
      const refBits = [];
      if (refDim) refBits.push(refDim);
      if (wallHeight) refBits.push(`average wall height = ${wallHeight} ft`);
      if (sidingPct) refBits.push(`siding covers ~${sidingPct}% of total wall area (rest is brick / stone / garage / etc.)`);
      // Build a per-photo description from the annotations so Claude has
      // BOTH visual (burned-in marks) and structured (text) cues.
      const annotEntries = photoUrls
        .map((name) => ({ photoName: name, ...(photoAnnotations[name] || {}) }))
        .filter((e) => !annotEmpty(e));
      const annotText = describeAnnotations(annotEntries);
      if (annotText) refBits.push(`Pre-AI photo annotations:\n${annotText}`);
      const refCombined = refBits.join("; ");
      if (refCombined) fd.append("reference_dim", refCombined);
      if (address) fd.append("address", address);
      fd.append("kind", kind || "siding");
      // Soffit pieces are computed server-side using this overhang.
      fd.append("overhang_in", String(overhangIn ?? 12));
      // Iter 57g — pass the contractor's course-counting overrides
      // (blank = use Claude's defaults). Backend feeds these into the
      // prompt as additional sizing context.
      if (brickCourse && parseFloat(brickCourse) > 0) {
        fd.append("brick_course_in", String(parseFloat(brickCourse)));
      }
      if (sidingExposure && parseFloat(sidingExposure) > 0) {
        fd.append("siding_exposure_in", String(parseFloat(sidingExposure)));
      }
      // Iter 57j — Deep Dormer Scan. Backend runs a parallel
      // crop-and-upscale pass per ground-level photo when enabled.
      if (deepDormerScan) {
        fd.append("deep_dormer_scan", "true");
      }
      // Elevation tags aligned with the backend photo order
      // (photo_paths first, then files). Used to skip aerial/detail
      // shots in the dormer pass and seed wall hints.
      const elevTagList = [...passThroughElevs, ...annotatedElevs];
      if (elevTagList.length) {
        fd.append("elevation_tags", elevTagList.join(","));
      }
      // Iter 57r — link the run to this estimate so a later modal open
      // can offer to Resume / Restore the most recent run for this job.
      if (estimateId) {
        fd.append("estimate_id", estimateId);
      }
      // Iter 57q — async launcher + polling. The backend used to do
      // all the Claude work synchronously in a single 60–120 s
      // request which hit the Kubernetes ingress timeout on 8-photo
      // houses. Now we POST → get `run_id` in <300 ms → poll
      // `/measure/ai-measure/status/{run_id}` every 3 s until status
      // is "done" or "error". Timeouts are no longer possible.
      const launch = await api.post("/measure/ai-measure", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,   // 60 s is generous for just uploading the photos
      });
      const runId = launch?.data?.run_id;
      if (!runId) {
        throw new Error("Backend didn't return a run_id");
      }
      setCurrentRunId(runId);
      setBusyStage(launch?.data?.stage || "starting");
      // Poll until done. Max ~5 min (100 polls × 3 s); each poll is a
      // tiny GET so a misbehaving Claude doesn't hang the UI either.
      let result = null;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let statusResp;
        try {
          statusResp = await api.get(`/measure/ai-measure/status/${runId}`);
        } catch (e) {
          // Transient network blip — just retry on the next tick.
          if (i >= 5) console.warn("ai-measure status poll failed", e?.message);
          continue;
        }
        const s = statusResp?.data || {};
        if (s.stage && s.stage !== busyStage) {
          setBusyStage(s.stage);
        }
        if (s.status === "error") {
          throw new Error(s.error || "AI measure failed");
        }
        if (s.status === "done") {
          result = s.result;
          break;
        }
      }
      if (!result) {
        throw new Error("AI measure timed out after 5 minutes — please try again with fewer photos or turn off Deep Dormer Scan");
      }
      const data = result;
      // Iter 57: trust the walls. Claude occasionally returns
      // siding_pct_this_wall in a way the aggregator can't recover
      // (e.g. 0.5 meaning 50% but post-clamp becomes 0.5%, deflating
      // siding_sqft by 100×). The wall table totals — computed from
      // width × eave height directly — are the honest geometry. Apply
      // recomputeFromWalls right away so measurements.siding_sqft
      // matches what the contractor sees in the Wall Breakdown.
      if (data?.raw_ai?.walls?.length) {
        const totals = recomputeFromWalls(data.raw_ai.walls);
        // Iter 58: force all LF / count fields back to whatever Claude
        // just returned. Previously stale edits from the Linear
        // Measurements panel (or a restored session with overrides)
        // could leak through and produce mismatches like
        // raw_ai.eaves_lf=72 but measurements.eaves_lf=5.
        const r = data.raw_ai;
        data.measurements = {
          ...data.measurements,
          siding_sqft: totals.siding_sqft,
          siding_with_openings_sqft: totals.siding_sqft,
          _ai_gable_sqft: totals._ai_gable_sqft,
          _ai_dormer_sqft: totals._ai_dormer_sqft,
          eaves_lf: Number(r.eaves_lf) || data.measurements.eaves_lf || 0,
          rakes_lf: Number(r.rakes_lf) || data.measurements.rakes_lf || 0,
          starter_lf:
            Number(r.starter_lf) ||
            Number(r.eaves_lf) ||
            data.measurements.starter_lf ||
            0,
          outside_corner_lf:
            Number(r.outside_corner_lf) ||
            data.measurements.outside_corner_lf ||
            0,
          inside_corner_lf:
            Number(r.inside_corner_lf) ||
            data.measurements.inside_corner_lf ||
            0,
        };
        // Lines came back from the backend with the OLD tiny qty — flag
        // dirty so Apply re-runs /measure/map with the corrected
        // measurements. ISS apply already re-derives from measurements
        // directly, so that path is fine without /measure/map.
        setWallsDirty(true);
      } else {
        setWallsDirty(false);
      }
      setPreview(data);
      // Iter 57: auto-apply Claude's per-photo elevation guesses to
      // any photo that isn't already explicitly tagged. Saves the
      // contractor 4-8 dropdown taps per measurement. Manual tags
      // always win — we only fill blanks.
      const aiPhotos = data?.measurements?._ai_photos || data?.raw_ai?.photos || [];
      if (aiPhotos.length > 0 && photoUrls.length > 0) {
        setPhotoAnnotations((prev) => {
          const next = { ...prev };
          let autoTagged = 0;
          aiPhotos.forEach((ap) => {
            const idx = Number(ap?.index);
            if (!Number.isFinite(idx) || idx < 0 || idx >= photoUrls.length) return;
            const name = photoUrls[idx];
            const claudeElev = ap?.elevation;
            if (!claudeElev) return;
            const cur = next[name] || {};
            if (cur.elevation && cur.elevation !== "") return; // user tag wins
            const conf = Number(ap?.elevation_confidence) || 0;
            if (conf < 40) return; // skip very low-confidence guesses
            next[name] = { ...cur, elevation: claudeElev, _auto: true };
            autoTagged += 1;
          });
          if (autoTagged > 0) {
            toast.success(`Auto-tagged ${autoTagged} elevation${autoTagged > 1 ? "s" : ""} from AI`);
          }
          return next;
        });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "AI measure failed");
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  };

  const apply = async () => {
    if (!preview?.measurements) return;
    setBusy(true);
    try {
      let toApply = preview;
      // If the contractor edited wall geometry, refresh the line items
      // via /measure/map so Charter Oak qty etc. reflect the override
      // before the page merges them into the estimate.
      if (wallsDirty) {
        try {
          const { data } = await api.post("/measure/map", {
            measurements: preview.measurements,
          });
          toApply = { ...preview, lines: data.lines || preview.lines };
        } catch {
          // Non-fatal: fall back to original lines if /measure/map fails.
        }
      }

      // Shared swap routine: pull `swapSqft` ft² out of the headline
      // siding line and add it as a separate shake line. Used for both
      // the gable and dormer toggles below.
      const swapSidingToShake = (currentToApply, swapSqft, sku) => {
        if (!sku || swapSqft <= 0) return currentToApply;
        const isLp = sku.startsWith("LP");
        const tab = isLp ? "lp_smart" : "vinyl";
        const section = isLp ? "LP Smart Siding" : "Vinyl Siding";
        const unit = isLp ? "PCS" : "SQ";
        const qty = isLp ? Math.ceil(swapSqft / 4) : Math.ceil(swapSqft / 100);
        const deductSq = Math.ceil(swapSqft / 100);
        const lines = (currentToApply.lines || []).map((ln) => ({ ...ln }));
        const sidingPrefix = isLp ? "LP Smart Side" : "Charter Oak";
        const idx = lines.findIndex(
          (l) => (l.tab || "vinyl") === tab && (l.name || "").startsWith(sidingPrefix)
        );
        if (idx >= 0) {
          lines[idx] = {
            ...lines[idx],
            qty: Math.max(0, (Number(lines[idx].qty) || 0) - deductSq),
          };
        }
        const existing = lines.findIndex(
          (l) => (l.tab || "vinyl") === tab && l.name === sku
        );
        if (existing >= 0) {
          lines[existing] = {
            ...lines[existing],
            qty: (Number(lines[existing].qty) || 0) + qty,
          };
        } else {
          lines.push({ tab, section, name: sku, unit, qty, mat: 0, lab: 0 });
        }
        return { ...currentToApply, lines };
      };

      const gableSqft = preview?.measurements?._ai_gable_sqft || 0;
      const dormerSqft = preview?.measurements?._ai_dormer_sqft || 0;
      if (quoteGablesAsShake && gableSqft > 0) {
        toApply = swapSidingToShake(toApply, gableSqft, shakeSku);
      }
      if (quoteDormersAsShake && dormerSqft > 0) {
        toApply = swapSidingToShake(toApply, dormerSqft, dormerShakeSku);
      }

      // Iter 78s — stash the rendered elevation drawings (with any
      // contractor nudges + roof overrides) on `measurements._ai_elevations`
      // so the customer Quote PDF can embed them as HOVER-style takeoff
      // sheets. The shape is the same one `ElevationDrawing` consumes.
      try {
        const elevs = buildElevationsFromAIMeasure({
          walls: preview.raw_ai?.walls,
          openings: preview.raw_ai?.openings,
          avg_wall_height_ft: preview.measurements?._ai_avg_wall_height_ft,
        });
        const edits = preview.measurements?._ai_elevation_edits || {};
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
        if (merged.length) {
          // Iter 78u — write to source-keyed bucket so Compare modal can
          // surface drift across multiple measurement sources. Keep
          // `_ai_elevations` populated with the most recent set (used by
          // the customer Quote PDF).
          const prevBySource =
            toApply.measurements?._ai_elevations_by_source || {};
          toApply = {
            ...toApply,
            measurements: {
              ...(toApply.measurements || {}),
              _ai_elevations: merged,
              _ai_elevations_by_source: { ...prevBySource, ai_photo: merged },
            },
          };
        }
      } catch {
        /* non-fatal */
      }

      // Pass the full preview {measurements, lines, vero_openings, raw_ai}
      // so the page can choose how to merge. ISS uses just measurements;
      // siding/windows merge `lines` directly.
      await onApply(toApply);
      toast.success("AI measurements applied — verify all quantities before quoting");
      // Iter 56g: KEEP + FLUSH the session after Apply.
      // Previously (Iter 50) we deleted the session on Apply. That made
      // logout/login lose everything (photos, annotations, target pin,
      // wall edits) even though re-applying is idempotent. Now we
      // proactively SAVE the session before closing so even a quick
      // Apply (< 1s after AI Measure) gets persisted ahead of the
      // debounced autosave. Session is cleared only by Start Over.
      if (estimateId) {
        try {
          await api.put(`/measure/sessions/${estimateId}`, {
            estimate_id: estimateId,
            photo_urls: photoUrls,
            reference_dim: refDim,
            wall_height: wallHeight,
            siding_pct: sidingPct,
            overhang_in: Number(overhangIn ?? 12),
            preview,
            photo_annotations: photoAnnotations,
          });
        } catch {
          // non-fatal — local state still good; the next autosave will
          // catch up if the modal stays open.
        }
      }
      // Close the modal but KEEP local state — re-opening AI Measure
      // lets the contractor add more photos / refine more values without
      // starting over. State is wiped only when the user explicitly
      // cancels via the "Start Over" button.
      setOpen(false);
    } catch (e) {
      toast.error(e.message || "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    if (busy) return;
    // "Cancel" / X button: just hide the modal. State (photos, AI result,
    // refinements) is preserved so re-opening picks up where we left off.
    //
    // Iter 56f: flush the autosave IMMEDIATELY before closing. The 1-second
    // debounce was getting cancelled if the contractor closed the modal
    // within 1s of uploading photos / saving annotations — those changes
    // would silently never reach MongoDB and the "Resume" prompt wouldn't
    // appear when the contractor came back. Fire-and-forget; local state
    // is the source of truth either way.
    if (estimateId && (photoUrls.length > 0 || preview != null)) {
      api
        .put(`/measure/sessions/${estimateId}`, {
          estimate_id: estimateId,
          photo_urls: photoUrls,
          reference_dim: refDim,
          wall_height: wallHeight,
          siding_pct: sidingPct,
          overhang_in: Number(overhangIn ?? 12),
          preview,
          photo_annotations: photoAnnotations,
        })
        .catch(() => { /* non-fatal */ });
    }
    setOpen(false);
  };

  const conf = preview?.measurements?._ai_scale_confidence || "low";
  const confColor =
    conf === "high"
      ? "text-[#16A34A] border-[#16A34A] bg-green-50"
      : conf === "medium"
      ? "text-[#D97706] border-[#D97706] bg-yellow-50"
      : "text-[#DC2626] border-[#DC2626] bg-red-50";

  return (
    <div data-testid="ai-measure" className="w-full">
      <button
        type="button"
        className="w-full justify-center px-3 py-1.5 bg-white text-[#7C3AED] border border-[#7C3AED] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        onClick={() => setOpen(true)}
        data-testid="ai-measure-btn"
        title={preview ? "Resume AI measure session — add more photos or refine" : "AI photo measure — upload 2-8 phone photos of the house (+ optional aerial)"}
      >
        <Sparkles className="w-3.5 h-3.5" />
        {preview ? "AI Measure (Resume)" : "AI Measure"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={closeAll}
          data-testid="ai-measure-backdrop"
        >
          <div
            className="bg-white max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="ai-measure-modal"
          >
            <div className="bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5" />
                <div>
                  <div className="font-heading text-lg">AI Photo Measure</div>
                  <div className="text-xs opacity-90 mt-0.5">
                    Upload 2-8 phone photos · + free aerial · Claude Opus 4.5
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={closeAll}
                aria-label="Close"
                data-testid="ai-measure-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              {resumePrompt && (
                <div
                  className="mb-4 p-3 border border-[#0EA5E9] bg-sky-50 flex items-center justify-between gap-3 flex-wrap"
                  data-testid="ai-measure-resume-banner"
                >
                  <div className="text-xs text-[#075985]">
                    <span className="font-bold uppercase tracking-wider text-[10px] mr-2">Resume?</span>
                    You have a saved AI Measure session for this estimate — photos, AI result, and any edits.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resumeSession}
                      className="px-3 py-1.5 bg-[#0EA5E9] text-white hover:bg-[#0284C7] text-xs font-bold uppercase tracking-wider flex items-center gap-1"
                      data-testid="ai-measure-resume-btn"
                    >
                      <RotateCcw className="w-3 h-3" /> Resume
                    </button>
                    <button
                      type="button"
                      onClick={startOver}
                      className="px-3 py-1.5 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider"
                      data-testid="ai-measure-discard-btn"
                    >
                      Start fresh
                    </button>
                  </div>
                </div>
              )}
              {/* Iter 57r — Resume last AI run banner */}
              {lastRun && (lastRun.status === "running" || (lastRun.status === "done" && lastRun.result) || lastRun.status === "error") && (
                <div
                  className="mb-4 p-3 border border-[#7C3AED] bg-purple-50 flex items-center justify-between gap-3 flex-wrap"
                  data-testid="ai-measure-resume-run-banner"
                >
                  <div className="text-xs text-[#581C87]">
                    <span className="font-bold uppercase tracking-wider text-[10px] mr-2">
                      {lastRun.status === "running" ? "AI run in progress" : lastRun.status === "error" ? "Last AI run failed" : "Recent AI run"}
                    </span>
                    {lastRun.status === "running" && (
                      <>
                        {lastRun.photo_count || 0} photo{(lastRun.photo_count || 0) === 1 ? "" : "s"} —
                        started {Math.round((lastRun.age_seconds || 0))}s ago, currently <b>{lastRun.stage || "running"}</b>.
                        Reconnect to keep watching progress.
                      </>
                    )}
                    {lastRun.status === "done" && (
                      <>
                        Finished {Math.round((lastRun.age_seconds || 0) / 60)} min ago on {lastRun.photo_count || 0} photo{(lastRun.photo_count || 0) === 1 ? "" : "s"}.
                        Restore the preview without re-running Claude.
                      </>
                    )}
                    {lastRun.status === "error" && (
                      <>
                        {lastRun.error || "Worker crashed"} — try a smaller photo set.
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {lastRun.status === "running" && (
                      <button
                        type="button"
                        onClick={resumeRunPolling}
                        className="px-3 py-1.5 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1"
                        data-testid="ai-measure-resume-run-btn"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" /> Reconnect
                      </button>
                    )}
                    {lastRun.status === "done" && (
                      <button
                        type="button"
                        onClick={restoreLastRun}
                        className="px-3 py-1.5 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1"
                        data-testid="ai-measure-restore-run-btn"
                      >
                        <Check className="w-3 h-3" /> Restore preview
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLastRun(null)}
                      className="px-3 py-1.5 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider"
                      data-testid="ai-measure-dismiss-run-btn"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              {/* Warning banner — set expectations honestly */}
              <div className="border border-yellow-400 bg-yellow-50 px-3 py-2 mb-4 text-xs text-yellow-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  AI photo measurement is an <strong>estimate, not a survey</strong>.
                  Upload <strong>all 4 elevations</strong> (front, back, left, right) for best
                  accuracy — Claude will only count walls it can actually see and will
                  flag any missing sides in the result.
                </div>
              </div>

              {!preview && (
                <>
                  {/* File picker */}
                  <label className="block mb-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                      Photos (2-8 + aerial)
                    </div>
                    <div className="border-2 border-dashed border-[#E4E4E7] rounded-sm px-4 py-6 text-center hover:border-[#7C3AED] transition-colors cursor-pointer">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={pickFiles}
                        data-testid="ai-measure-file-input"
                      />
                      <Camera className="w-8 h-8 mx-auto mb-2 text-[#7C3AED]" />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="text-sm font-bold text-[#7C3AED] uppercase tracking-wider"
                        disabled={photoUrls.length >= 9}
                      >
                        {photoUrls.length > 0 ? "Add more photos" : "Choose / Take Photos"}
                      </button>
                      <div className="text-[10px] text-[#A1A1AA] mt-1">
                        Tip: front, back, left, right elevations + any tricky corners
                      </div>
                      {/* Iter 57: HOVER-style guided capture wizard. Walks
                          contractor through 8 standard positions and
                          auto-tags each photo's elevation as it captures.
                          Biggest single accuracy lever — eliminates the
                          "garbage in" problem at the source. */}
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setWizardOpen(true)}
                          disabled={photoUrls.length >= 9}
                          className="px-3 py-1.5 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50"
                          data-testid="ai-measure-wizard-btn"
                          title="HOVER-style step-by-step capture — walks you through 8 elevation positions, auto-tags each photo"
                        >
                          <Sparkles className="w-3 h-3" />
                          Guided Capture (recommended)
                        </button>
                      </div>
                      {/* Iter 56c: free aerial view via Esri World Imagery.
                          Auto-fetches a top-down photo of the property
                          from the estimate address — dramatically
                          sharpens eaves/rakes since rooflines read much
                          cleaner from above. No API key required.
                          Iter 56d: button stays visible even when the
                          address is missing so contractors can see the
                          option exists; clicking it without an address
                          gives a helpful toast pointing them to the
                          right field. */}
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={fetchSatellite}
                          disabled={satBusy || photoUrls.length >= 9}
                          className="px-3 py-1.5 bg-white text-[#0EA5E9] border border-[#0EA5E9] hover:bg-[#F0F9FF] text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50"
                          data-testid="ai-measure-satellite-btn"
                          title={address ? "Fetch a free top-down satellite view from Esri World Imagery" : "Fill in the Address field in Job Information first"}
                        >
                          {satBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {satBusy ? "Fetching aerial…" : "Add aerial view (free)"}
                        </button>
                        {!address && (
                          <div className="text-[10px] text-[#A1A1AA] mt-1">
                            Address required — fill in <b>Address</b> in Job Information first.
                          </div>
                        )}
                      </div>
                      {(photoUrls.length > 0 || files.length > 0) && (
                        <div className="mt-3 text-xs text-[#52525B] flex items-center justify-center gap-2 flex-wrap" data-testid="ai-measure-file-count">
                          <span>
                            {photoUrls.length} uploaded
                            {files.length > 0 && ` · ${files.length} uploading…`}
                          </span>
                        </div>
                      )}
                      {photoUrls.length > 0 && (
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="ai-measure-photo-grid">
                          {photoUrls.map((name, i) => {
                            const annot = photoAnnotations[name] || {};
                            const hasRef = !!annot.reference;
                            const hasWinRef = !!annot.windowReference;
                            const zoneCount = (annot.zones || []).length;
                            const elev = annot.elevation || "";
                            // Iter 57o — when an AI Measure run has
                            // produced an openings_schedule with bboxes,
                            // overlay HOVER-style labeled callouts on
                            // each photo. Same look as the PDF, but in
                            // the live preview so the contractor can
                            // catch a misplaced label and edit BEFORE
                            // generating the report.
                            const aiSched = (preview && (
                              preview.measurements?._ai_openings_schedule ||
                              preview.raw_ai?.openings_schedule || []
                            )) || [];
                            const photoCallouts = [];
                            const seenKeys = new Set();
                            for (const row of aiSched) {
                              for (const loc of (row.locations || [])) {
                                if (Number(loc.photo_idx) !== i) continue;
                                const bb = loc.bbox || {};
                                const bx = Number(bb.x), by = Number(bb.y);
                                const bw = Number(bb.w || 0), bh = Number(bb.h || 0);
                                if (!(bx >= 0 && bx <= 1 && by >= 0 && by <= 1 && bw > 0 && bh > 0 && bx + bw <= 1.001 && by + bh <= 1.001)) continue;
                                const key = `${bx.toFixed(3)},${by.toFixed(3)},${bw.toFixed(3)},${bh.toFixed(3)}`;
                                if (seenKeys.has(key)) continue;
                                seenKeys.add(key);
                                const wi = Math.round(Number(row.width_in) || 0);
                                const hi = Math.round(Number(row.height_in) || 0);
                                const t = String(row.type || "window").toLowerCase();
                                const style = String(row.style || "");
                                let label = `${wi}×${hi}`;
                                if (t === "garage_door") label = `${wi}×${hi} Garage`;
                                else if (t === "entry_door") label = `${wi}×${hi} Entry`;
                                else if (t === "patio_door") label = `${wi}×${hi} Patio`;
                                else {
                                  let short = "";
                                  if (/Double Hung|Twin Double/i.test(style)) short = "DH";
                                  else if (/Single Hung/i.test(style)) short = "SH";
                                  else if (/Casement/i.test(style)) short = "CS";
                                  else if (/Slider/i.test(style)) short = "SL";
                                  else if (/Picture/i.test(style)) short = "PIC";
                                  else if (/Awning/i.test(style)) short = "AW";
                                  else if (/Hopper/i.test(style)) short = "HP";
                                  if (short) label = `${short} ${label}`;
                                }
                                const labelY = by > 0.07 ? by - 0.025 : by + 0.005;
                                const lcx = bx + bw / 2;
                                const lblFs = 3.0;
                                const bgW = Math.min(0.98 - lcx + 0.5, Math.max(0.10, label.length * lblFs * 0.0048));
                                const bgX = Math.max(0.005, Math.min(1 - bgW - 0.005, lcx - bgW / 2));
                                photoCallouts.push(
                                  <g key={key}>
                                    <rect x={bx * 100} y={by * 100} width={bw * 100} height={bh * 100}
                                          fill="none" stroke="#FACC15" strokeWidth={0.6} />
                                    <rect x={bgX * 100} y={labelY * 100} width={bgW * 100} height={lblFs + 0.6}
                                          fill="#09090B" />
                                    <text x={(bgX + bgW / 2) * 100} y={labelY * 100 + lblFs * 0.85}
                                          textAnchor="middle" fontSize={lblFs} fontWeight={700} fill="#FACC15">
                                      {label}
                                    </text>
                                  </g>
                                );
                              }
                            }
                            return (
                              <div key={name} className="relative border border-[#E4E4E7] overflow-hidden bg-[#FAFAFA]">
                                <div className="relative aspect-video">
                                  <img
                                    src={`/api/uploads/${name}`}
                                    alt={`Photo ${i + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                  {photoCallouts.length > 0 && (
                                    <svg
                                      viewBox="0 0 100 100"
                                      preserveAspectRatio="none"
                                      className="absolute inset-0 w-full h-full pointer-events-none"
                                      data-testid={`ai-measure-photo-callouts-${i}`}
                                    >
                                      {photoCallouts}
                                    </svg>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                                    className="absolute top-0.5 right-0.5 bg-[#09090B] text-white w-5 h-5 flex items-center justify-center text-xs hover:bg-[#DC2626]"
                                    data-testid={`ai-measure-photo-remove-${i}`}
                                    title="Remove this photo"
                                  >×</button>
                                  {/* Status badges */}
                                  <div className="absolute bottom-0.5 left-0.5 flex gap-1 flex-wrap">
                                    {elev && elev !== "" && (
                                      <span className="bg-[#7C3AED] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold">
                                        {elev}
                                      </span>
                                    )}
                                    {hasRef && (
                                      <span className="bg-[#DC2626] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold">
                                        Wall ✓
                                      </span>
                                    )}
                                    {hasWinRef && (
                                      <span className="bg-[#2563EB] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold" data-testid={`ai-measure-photo-winref-badge-${i}`}>
                                        Win ✓
                                      </span>
                                    )}
                                    {annot.targetPin && (
                                      <span className="bg-[#10B981] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold">
                                        Pin ✓
                                      </span>
                                    )}
                                    {zoneCount > 0 && (
                                      <span className="bg-[#B45309] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold">
                                        {zoneCount} mask{zoneCount > 1 ? "s" : ""}
                                      </span>
                                    )}
                                    {(annot.windows?.length || 0) > 0 && (
                                      <span className="bg-[#FBBF24] text-[#92400E] text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold border border-[#92400E]" data-testid={`ai-measure-photo-windows-badge-${i}`}>
                                        {annot.windows.length} win
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="p-1.5 space-y-1 border-t border-[#E4E4E7] bg-white">
                                  <select
                                    className="input h-7 text-[11px] w-full"
                                    value={elev}
                                    onChange={(e) => setPhotoAnnotations((prev) => ({
                                      ...prev,
                                      [name]: { ...(prev[name] || {}), elevation: e.target.value },
                                    }))}
                                    data-testid={`ai-measure-photo-elev-${i}`}
                                  >
                                    {ELEVATION_OPTIONS.map((o) => (
                                      <option key={o.key} value={o.key}>{o.label}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => setAnnotateOpenFor(name)}
                                    className="w-full px-2 py-1 bg-white text-[#7C3AED] border border-[#7C3AED] hover:bg-[#FAF5FF] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1"
                                    data-testid={`ai-measure-photo-annotate-${i}`}
                                    title="Mark a reference scale anchor and/or no-siding zones BEFORE sending to AI"
                                  >
                                    <Wand2 className="w-2.5 h-2.5" />
                                    {hasRef || zoneCount > 0 ? "Edit annotations" : "Annotate"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </label>

                </>
              )}

              {/* Result preview */}
              {preview && (
                <>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${confColor}`} data-testid="ai-measure-confidence">
                      Confidence: {conf}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                      Reference: {preview.measurements._ai_reference_used || "none"}
                    </span>
                    {preview.measurements._ai_story_count != null && (
                      <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                        {preview.measurements._ai_story_count}-story
                      </span>
                    )}
                    {preview.measurements._ai_avg_wall_height_ft != null && (
                      <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                        wall ht {preview.measurements._ai_avg_wall_height_ft} ft
                      </span>
                    )}
                    {preview.measurements._ai_siding_coverage_pct != null && (
                      <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                        siding {preview.measurements._ai_siding_coverage_pct}%
                      </span>
                    )}
                  </div>
                  {preview.measurements._ai_story_count_reasoning && (
                    <div className="text-[11px] text-[#71717A] mb-2 italic">
                      Story count: {preview.measurements._ai_story_count_reasoning}
                    </div>
                  )}
                  {((preview.measurements._ai_gable_sqft || 0) > 0 ||
                    (preview.measurements._ai_dormer_sqft || 0) > 0) && (
                    <div className="text-[11px] text-[#71717A] mb-2 italic" data-testid="ai-measure-geometry-breakdown">
                      Geometry: rectangular walls
                      {(preview.measurements._ai_gable_sqft || 0) > 0 && (
                        <> · gable triangles add <span className="font-bold not-italic">{preview.measurements._ai_gable_sqft} ft²</span></>
                      )}
                      {(preview.measurements._ai_dormer_sqft || 0) > 0 && (
                        <> · dormer faces add <span className="font-bold not-italic">{preview.measurements._ai_dormer_sqft} ft²</span></>
                      )}
                      {" "}— if this doesn&apos;t match the photos, lower the affected wall&apos;s height_ft.
                    </div>
                  )}
                  {preview.measurements._ai_notes && (
                    <div className="text-xs text-[#52525B] mb-3 italic border-l-2 border-[#7C3AED] pl-3" data-testid="ai-measure-notes">
                      {preview.measurements._ai_notes}
                    </div>
                  )}
                  {/* Iter 78z (P1.3 + Cross-Check) — Per-Elevation Breakdown,
                      "+ Add Accent", and "🔁 Re-check with AI" button */}
                  <PerElevationBreakdownCard
                    measurements={preview.measurements || {}}
                    runId={currentRunId}
                    onUpdate={({ measurements: newMeas, lines: newLines }) => {
                      setPreview((p) => p && ({
                        ...p,
                        measurements: newMeas,
                        ...(newLines ? { lines: newLines } : {}),
                      }));
                    }}
                  />
                  {/* Iter 78s — HOVER-style elevation drawings, generated
                      from raw_ai.walls + raw_ai.openings. Includes any
                      contractor-applied nudges + roof-shape overrides
                      stashed on preview.measurements._ai_elevation_edits. */}
                  {(() => {
                    const elevs = buildElevationsFromAIMeasure({
                      walls: preview.raw_ai?.walls,
                      openings: preview.raw_ai?.openings,
                      avg_wall_height_ft: preview.measurements?._ai_avg_wall_height_ft,
                    });
                    if (!elevs.length) return null;
                    const edits = preview.measurements?._ai_elevation_edits || {};
                    const handleNudge = (elevLabel) => (opId, xPct, yPct) => {
                      setPreview((p) => {
                        if (!p) return p;
                        const cur = p.measurements?._ai_elevation_edits || {};
                        const elevEdits = cur[elevLabel] || { openings: {}, roof_style: null };
                        const next = {
                          ...cur,
                          [elevLabel]: {
                            ...elevEdits,
                            openings: { ...(elevEdits.openings || {}), [opId]: { x_pct: xPct, y_pct: yPct } },
                          },
                        };
                        return { ...p, measurements: { ...p.measurements, _ai_elevation_edits: next } };
                      });
                    };
                    const handleRoof = (elevLabel) => (shape) => {
                      setPreview((p) => {
                        if (!p) return p;
                        const cur = p.measurements?._ai_elevation_edits || {};
                        const elevEdits = cur[elevLabel] || { openings: {}, roof_style: null };
                        const next = { ...cur, [elevLabel]: { ...elevEdits, roof_style: shape } };
                        return { ...p, measurements: { ...p.measurements, _ai_elevation_edits: next } };
                      });
                    };
                    // Merge edits into each elevation's openings + roof
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
                    return (
                      <div className="mb-4" data-testid="ai-elevation-drawings">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-2 flex items-center justify-between">
                          <span>Elevation Drawings <span className="text-[9px] not-italic text-[#71717A]">· {show3DPreview ? "3D orthographic preview — customer PDF look" : "HOVER-style 2D editor · drag any opening to nudge"}</span></span>
                          <button
                            type="button"
                            onClick={() => setShow3DPreview((v) => !v)}
                            className="text-[9px] uppercase tracking-wider font-bold text-[#7C3AED] bg-[#FAF5FF] border border-[#E9D5FF] px-2 py-0.5 hover:bg-[#F3E8FF]"
                            data-testid="toggle-3d-elevation-preview"
                          >
                            {show3DPreview ? "Edit (2D)" : "View 3D"}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {merged.map((e) => (
                            show3DPreview ? (
                              <Elevation3DPreview key={e.label} elevation={e} pxHeight={220} />
                            ) : (
                              <ElevationDrawing
                                key={e.label}
                                elevation={e}
                                editable
                                compact
                                onOpeningMove={handleNudge(e.label)}
                                onRoofToggle={handleRoof(e.label)}
                              />
                            )
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {Object.entries(preview.measurements)
                      .filter(([k, v]) => !k.startsWith("_") && v !== 0 && v !== null && v !== undefined)
                      .map(([k, v]) => (
                        <div key={k} data-testid={`ai-measure-stat-${k}`}>
                          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">{KEY_LABELS[k] || k}</div>
                          <div className="font-mono-num text-sm font-bold text-[#09090B]">
                            {fmt(v)} {unitOf(k)}
                          </div>
                        </div>
                      ))}
                  </div>
                  {preview.raw_ai?.walls?.length > 0 && (
                    <details className="text-xs mb-3" open>
                      <summary className="cursor-pointer text-[#7C3AED] font-bold uppercase tracking-wider">
                        Wall breakdown ({preview.raw_ai.walls.length}) — tap to edit
                      </summary>
                      <div className="text-[11px] text-[#71717A] mt-2 italic">
                        If the AI got the geometry wrong (e.g. called a 1-story dormer a 2-story wall),
                        edit the numbers below. Siding ft² updates live. Apply re-runs the line math.
                      </div>
                      <table className="w-full mt-2 text-xs" data-testid="ai-measure-wall-table">
                        <thead className="text-left text-[#A1A1AA] uppercase tracking-wider text-[10px]">
                          <tr>
                            <th>Wall</th>
                            <th>W (ft)</th>
                            <th>H eave (ft)</th>
                            <th>Gable h (ft)</th>
                            <th>Dormer (ft²)</th>
                            <th>Gable ft²</th>
                            <th>Total ft²</th>
                            <th title="Claude's per-wall confidence — green = high, amber = medium, red = low. Verify low/medium walls in the field.">Conf</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.raw_ai.walls.map((w, i) => {
                            const width = Number(w.width_ft) || 0;
                            const eave = Number(w.height_ft) || 0;
                            const gable = Number(w.gable_triangle_height_ft) || 0;
                            const dormer = Number(w.dormer_face_sqft) || 0;
                            const gableArea = 0.5 * width * gable;
                            const area = width * eave + gableArea + dormer;
                            const confScore = Math.round(Number(w.confidence) || 0);
                            const confTier = confScore >= 80 ? "high" : confScore >= 60 ? "med" : confScore >= 30 ? "low" : "guess";
                            const confChip = {
                              high:  { bg: "bg-[#16A34A]", label: "HIGH" },
                              med:   { bg: "bg-[#CA8A04]", label: "MED" },
                              low:   { bg: "bg-[#EA580C]", label: "LOW" },
                              guess: { bg: "bg-[#DC2626]", label: "GUESS" },
                            }[confTier];
                            return (
                              <tr key={i} className="border-b border-[#F4F4F5]">
                                <td className="py-1 font-bold text-[#52525B] uppercase tracking-wider text-[10px]">{w.label}</td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.5"
                                    className="w-16 px-1 py-0.5 border border-[#E4E4E7] font-mono-num text-xs"
                                    value={width}
                                    onChange={(e) => setWall(i, "width_ft", e.target.value)}
                                    data-testid={`ai-measure-wall-w-${i}`}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.5"
                                    className="w-16 px-1 py-0.5 border border-[#E4E4E7] font-mono-num text-xs"
                                    value={eave}
                                    onChange={(e) => setWall(i, "height_ft", e.target.value)}
                                    data-testid={`ai-measure-wall-h-${i}`}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    className="w-16 px-1 py-0.5 border border-[#E4E4E7] font-mono-num text-xs"
                                    value={gable}
                                    onChange={(e) => setWall(i, "gable_triangle_height_ft", e.target.value)}
                                    data-testid={`ai-measure-wall-gable-${i}`}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    className="w-16 px-1 py-0.5 border border-[#E4E4E7] font-mono-num text-xs"
                                    value={dormer}
                                    onChange={(e) => setWall(i, "dormer_face_sqft", e.target.value)}
                                    data-testid={`ai-measure-wall-dormer-${i}`}
                                  />
                                </td>
                                <td className="font-mono-num font-bold text-[#7C3AED]" data-testid={`ai-measure-wall-gable-ft2-${i}`}>
                                  {gableArea > 0 ? gableArea.toFixed(0) : "—"}
                                </td>
                                <td className="font-mono-num font-bold">{area.toFixed(0)}</td>
                                <td
                                  className="text-center"
                                  title={(w.confidence_reasoning || "") + (confScore ? ` · score ${confScore}/100` : "")}
                                  data-testid={`ai-measure-wall-conf-${i}`}
                                >
                                  {confScore > 0 ? (
                                    <span className={`inline-block ${confChip.bg} text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm tracking-wider`}>
                                      {confChip.label} {confScore}
                                    </span>
                                  ) : (
                                    <span className="text-[#A1A1AA]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Totals row — emphasizes the gable ft² so the
                              contractor can spec shake siding for those
                              areas if the homeowner wants it. */}
                          {(() => {
                            const totalGable = preview.raw_ai.walls.reduce((a, w) => {
                              const ww = Number(w.width_ft) || 0;
                              const gh = Number(w.gable_triangle_height_ft) || 0;
                              return a + 0.5 * ww * gh;
                            }, 0);
                            const totalArea = preview.raw_ai.walls.reduce((a, w) => {
                              const ww = Number(w.width_ft) || 0;
                              const eh = Number(w.height_ft) || 0;
                              const gh = Number(w.gable_triangle_height_ft) || 0;
                              const dr = Number(w.dormer_face_sqft) || 0;
                              return a + ww * eh + 0.5 * ww * gh + dr;
                            }, 0);
                            return (
                              <tr className="border-t-2 border-[#09090B]" data-testid="ai-measure-wall-totals">
                                <td colSpan={5} className="py-1 text-[10px] uppercase tracking-wider font-bold text-[#52525B] text-right">
                                  Totals
                                </td>
                                <td className="font-mono-num font-bold text-[#7C3AED]" data-testid="ai-measure-total-gable-ft2">
                                  {totalGable > 0 ? totalGable.toFixed(0) : "—"}
                                </td>
                                <td className="font-mono-num font-bold">{totalArea.toFixed(0)}</td>
                                <td>&nbsp;</td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                      {preview.raw_ai.walls.some((w) => Number(w.gable_triangle_height_ft) > 0) && (
                        <>
                          <div className="text-[11px] text-[#7C3AED] mt-2" data-testid="ai-measure-gable-shake-hint">
                            💡 Gable ft² is broken out so you can quote shake / scallop siding for those triangles if the homeowner wants a different look up top.
                          </div>
                          <label className="mt-2 flex items-center gap-2 cursor-pointer p-2 border border-[#E4E4E7] hover:border-[#7C3AED] transition-colors">
                            <input
                              type="checkbox"
                              checked={quoteGablesAsShake}
                              onChange={(e) => setQuoteGablesAsShake(e.target.checked)}
                              data-testid="ai-measure-quote-gables-shake"
                            />
                            <span className="text-xs font-bold uppercase tracking-wider text-[#52525B]">
                              Quote gables as shake
                            </span>
                            {quoteGablesAsShake && (
                              <select
                                value={shakeSku}
                                onChange={(e) => setShakeSku(e.target.value)}
                                className="ml-2 px-1 py-0.5 border border-[#E4E4E7] text-xs"
                                data-testid="ai-measure-shake-sku"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value={'Pelican Bay Shakes 9"'}>Pelican Bay Shakes 9&quot; (vinyl)</option>
                                <option value={'LP Strand Shake 3/8" x 12" x 4\''}>LP Strand Shake 3/8&quot; × 12&quot; × 4&apos;</option>
                              </select>
                            )}
                          </label>
                          {quoteGablesAsShake && (
                            <div className="text-[10px] text-[#52525B] mt-1 ml-7" data-testid="ai-measure-shake-preview">
                              On Apply: <span className="font-bold">{shakeSku}</span> qty = {shakeSku.startsWith("LP") ? Math.ceil((preview?.measurements?._ai_gable_sqft || 0) / 4) + " PCS" : Math.ceil((preview?.measurements?._ai_gable_sqft || 0) / 100) + " SQ"} · main siding reduced by {Math.ceil((preview?.measurements?._ai_gable_sqft || 0) / 100)} SQ
                            </div>
                          )}
                        </>
                      )}
                      {wallsDirty && (
                        <div className="text-[10px] text-[#F97316] uppercase tracking-wider font-bold mt-2" data-testid="ai-measure-walls-dirty">
                          ✎ Edited — line items will refresh on Apply
                        </div>
                      )}
                      {preview.raw_ai.walls.some((w) => Number(w.dormer_face_sqft) > 0) && (
                        <>
                          <label className="mt-2 flex items-center gap-2 cursor-pointer p-2 border border-[#E4E4E7] hover:border-[#7C3AED] transition-colors">
                            <input
                              type="checkbox"
                              checked={quoteDormersAsShake}
                              onChange={(e) => setQuoteDormersAsShake(e.target.checked)}
                              data-testid="ai-measure-quote-dormers-shake"
                            />
                            <span className="text-xs font-bold uppercase tracking-wider text-[#52525B]">
                              Quote dormers as shake
                            </span>
                            {quoteDormersAsShake && (
                              <select
                                value={dormerShakeSku}
                                onChange={(e) => setDormerShakeSku(e.target.value)}
                                className="ml-2 px-1 py-0.5 border border-[#E4E4E7] text-xs"
                                data-testid="ai-measure-dormer-shake-sku"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value={'Pelican Bay Shakes 9"'}>Pelican Bay Shakes 9&quot; (vinyl)</option>
                                <option value={'LP Strand Shake 3/8" x 12" x 4\''}>LP Strand Shake 3/8&quot; × 12&quot; × 4&apos;</option>
                              </select>
                            )}
                          </label>
                          {quoteDormersAsShake && (
                            <div className="text-[10px] text-[#52525B] mt-1 ml-7" data-testid="ai-measure-dormer-shake-preview">
                              On Apply: <span className="font-bold">{dormerShakeSku}</span> qty = {dormerShakeSku.startsWith("LP") ? Math.ceil((preview?.measurements?._ai_dormer_sqft || 0) / 4) + " PCS" : Math.ceil((preview?.measurements?._ai_dormer_sqft || 0) / 100) + " SQ"} · main siding reduced by {Math.ceil((preview?.measurements?._ai_dormer_sqft || 0) / 100)} SQ
                            </div>
                          )}
                        </>
                      )}
                    </details>
                  )}

                  {/* Iter 57: HOVER-style extras.
                      • Missing-elevations banner — warn if Claude didn't see all 4 walls
                      • Openings schedule — collapsed grouped view (elevation × type × size)
                      • Double-count check — Claude's reconciliation note */}
                  {(preview.measurements?._ai_missing_elevations?.length ?? 0) > 0 && (
                    <div
                      className="border border-[#F59E0B] bg-[#FEF3C7] px-3 py-2 mb-3 text-xs text-[#78350F] flex items-start gap-2"
                      data-testid="ai-measure-missing-elevs"
                    >
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        Claude couldn&apos;t see these elevations —
                        add photos to capture them: {" "}
                        <strong>
                          {preview.measurements._ai_missing_elevations
                            .map((e) => e.toUpperCase())
                            .join(", ")}
                        </strong>
                        .
                      </div>
                    </div>
                  )}

                  {/* Iter 57o — Labeled photos preview. Surfaces the
                      bbox callouts (yellow boxes + labels) on each photo
                      so the contractor can spot-check Claude's
                      per-opening placements BEFORE generating the PDF. */}
                  {(() => {
                    const schedule = preview.measurements?._ai_openings_schedule
                      || preview.raw_ai?.openings_schedule || [];
                    const totalLocs = schedule.reduce(
                      (n, r) => n + (Array.isArray(r.locations) ? r.locations.length : 0), 0
                    );
                    if (totalLocs === 0 || photoUrls.length === 0) return null;
                    return (
                      <details className="text-xs mb-3" open data-testid="ai-measure-labeled-photos">
                        <summary className="cursor-pointer text-[#7C3AED] font-bold uppercase tracking-wider">
                          Labeled photos — {totalLocs} opening{totalLocs === 1 ? "" : "s"} tagged by Claude
                        </summary>
                        <div className="text-[11px] text-[#71717A] mt-2 italic">
                          Same yellow boxes + labels appear on the photos in the downloaded measurement PDF. If one looks wrong, edit the opening size/style in the Openings schedule below — the label updates automatically.
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {photoUrls.map((name, i) => {
                            // Build the callouts for THIS photo, same
                            // logic as the upload-grid overlay above.
                            const photoCallouts = [];
                            const seenKeys = new Set();
                            for (const row of schedule) {
                              for (const loc of (row.locations || [])) {
                                if (Number(loc.photo_idx) !== i) continue;
                                const bb = loc.bbox || {};
                                const bx = Number(bb.x), by = Number(bb.y);
                                const bw = Number(bb.w || 0), bh = Number(bb.h || 0);
                                if (!(bx >= 0 && bx <= 1 && by >= 0 && by <= 1 && bw > 0 && bh > 0 && bx + bw <= 1.001 && by + bh <= 1.001)) continue;
                                const key = `${bx.toFixed(3)},${by.toFixed(3)},${bw.toFixed(3)},${bh.toFixed(3)}`;
                                if (seenKeys.has(key)) continue;
                                seenKeys.add(key);
                                const wi = Math.round(Number(row.width_in) || 0);
                                const hi = Math.round(Number(row.height_in) || 0);
                                const t = String(row.type || "window").toLowerCase();
                                const style = String(row.style || "");
                                let label = `${wi}×${hi}`;
                                if (t === "garage_door") label = `${wi}×${hi} Garage`;
                                else if (t === "entry_door") label = `${wi}×${hi} Entry`;
                                else if (t === "patio_door") label = `${wi}×${hi} Patio`;
                                else {
                                  let short = "";
                                  if (/Double Hung|Twin Double/i.test(style)) short = "DH";
                                  else if (/Single Hung/i.test(style)) short = "SH";
                                  else if (/Casement/i.test(style)) short = "CS";
                                  else if (/Slider/i.test(style)) short = "SL";
                                  else if (/Picture/i.test(style)) short = "PIC";
                                  else if (/Awning/i.test(style)) short = "AW";
                                  else if (/Hopper/i.test(style)) short = "HP";
                                  if (short) label = `${short} ${label}`;
                                }
                                const labelY = by > 0.07 ? by - 0.025 : by + 0.005;
                                const lcx = bx + bw / 2;
                                const lblFs = 3.0;
                                const bgW = Math.min(0.98 - lcx + 0.5, Math.max(0.10, label.length * lblFs * 0.0048));
                                const bgX = Math.max(0.005, Math.min(1 - bgW - 0.005, lcx - bgW / 2));
                                photoCallouts.push(
                                  <g key={key}>
                                    <rect x={bx * 100} y={by * 100} width={bw * 100} height={bh * 100}
                                          fill="none" stroke="#FACC15" strokeWidth={0.6} />
                                    <rect x={bgX * 100} y={labelY * 100} width={bgW * 100} height={lblFs + 0.6}
                                          fill="#09090B" />
                                    <text x={(bgX + bgW / 2) * 100} y={labelY * 100 + lblFs * 0.85}
                                          textAnchor="middle" fontSize={lblFs} fontWeight={700} fill="#FACC15">
                                      {label}
                                    </text>
                                  </g>
                                );
                              }
                            }
                            const meta = (preview.measurements?._ai_photos || preview.raw_ai?.photos || [])
                              .find((p) => Number(p.index) === i) || {};
                            const elev = (meta.elevation || "").toUpperCase();
                            return (
                              <div key={name} className="relative border border-[#E4E4E7] bg-[#FAFAFA]" data-testid={`ai-measure-labeled-photo-${i}`}>
                                <div className="relative aspect-video overflow-hidden">
                                  <img
                                    src={`/api/uploads/${name}`}
                                    alt={`Labeled photo ${i + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                  {photoCallouts.length > 0 && (
                                    <svg
                                      viewBox="0 0 100 100"
                                      preserveAspectRatio="none"
                                      className="absolute inset-0 w-full h-full pointer-events-none"
                                    >
                                      {photoCallouts}
                                    </svg>
                                  )}
                                  {elev && (
                                    <span className="absolute top-1 left-1 bg-[#7C3AED] text-white text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold">
                                      {elev}
                                    </span>
                                  )}
                                  <span className="absolute bottom-1 right-1 bg-[#FACC15] text-[#09090B] text-[9px] px-1.5 py-0.5 uppercase tracking-wider font-bold" data-testid={`ai-measure-labeled-photo-count-${i}`}>
                                    {photoCallouts.length} tag{photoCallouts.length === 1 ? "" : "s"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })()}

                  {(preview.measurements?._ai_openings_schedule?.length ?? 0) > 0 && (
                    <details className="text-xs mb-3" open data-testid="ai-measure-openings-schedule">
                      <summary className="cursor-pointer text-[#7C3AED] font-bold uppercase tracking-wider">
                        Openings schedule — grouped by elevation × size
                      </summary>
                      <div className="text-[11px] text-[#71717A] mt-2 italic">
                        Each elevation is grouped together with a colored chip and total count so it&apos;s easy to verify against the house. Sizes are listed underneath.
                      </div>
                      {/* Iter 57c — Option B: rows grouped by elevation
                          with a colored chip + total opening count per
                          group. Kills the visual confusion of seeing
                          "LEFT, LEFT, LEFT" repeated. */}
                      {(() => {
                        const ELEVATION_COLORS = {
                          front:  { bg: "bg-[#3B82F6]", soft: "bg-[#EFF6FF]", text: "text-[#1E40AF]" },
                          back:   { bg: "bg-[#16A34A]", soft: "bg-[#F0FDF4]", text: "text-[#166534]" },
                          left:   { bg: "bg-[#EA580C]", soft: "bg-[#FFF7ED]", text: "text-[#9A3412]" },
                          right:  { bg: "bg-[#7C3AED]", soft: "bg-[#FAF5FF]", text: "text-[#5B21B6]" },
                          other:  { bg: "bg-[#52525B]", soft: "bg-[#FAFAFA]", text: "text-[#27272A]" },
                        };
                        const schedule = preview.measurements._ai_openings_schedule || [];
                        // Group by elevation in a fixed display order.
                        const order = ["front", "back", "left", "right", "other"];
                        const groups = {};
                        schedule.forEach((o) => {
                          const elev = (o.elevation || "other").toLowerCase();
                          const k = order.includes(elev) ? elev : "other";
                          if (!groups[k]) groups[k] = [];
                          groups[k].push(o);
                        });
                        const orderedGroups = order
                          .filter((k) => groups[k]?.length)
                          .map((k) => [k, groups[k]]);

                        return (
                          <div className="mt-2" data-testid="ai-measure-openings-grouped">
                            {/* Tiny house diagram so the colors map to spatial position */}
                            <div className="flex items-center justify-center gap-3 py-2 mb-2 border-y border-[#E4E4E7]" data-testid="ai-measure-elevation-legend">
                              <svg width="56" height="56" viewBox="0 0 56 56" className="flex-shrink-0">
                                <rect x="14" y="14" width="28" height="28" fill="#FAFAFA" stroke="#A1A1AA" strokeWidth="1" />
                                <rect x="14" y="11" width="28" height="3" fill="#3B82F6" />
                                <rect x="14" y="42" width="28" height="3" fill="#16A34A" />
                                <rect x="11" y="14" width="3" height="28" fill="#EA580C" />
                                <rect x="42" y="14" width="3" height="28" fill="#7C3AED" />
                                <text x="28" y="9" fontSize="6" fill="#3B82F6" textAnchor="middle" fontWeight="700">FRONT</text>
                                <text x="28" y="52" fontSize="6" fill="#16A34A" textAnchor="middle" fontWeight="700">BACK</text>
                                <text x="8" y="30" fontSize="5" fill="#EA580C" textAnchor="middle" fontWeight="700" transform="rotate(-90 8 30)">LEFT</text>
                                <text x="48" y="30" fontSize="5" fill="#7C3AED" textAnchor="middle" fontWeight="700" transform="rotate(90 48 30)">RIGHT</text>
                              </svg>
                              <div className="text-[10px] text-[#A1A1AA] uppercase tracking-wider">
                                Color = which side of the house
                              </div>
                            </div>
                            {orderedGroups.map(([elev, items]) => {
                              const color = ELEVATION_COLORS[elev] || ELEVATION_COLORS.other;
                              const totalCount = items.reduce((sum, o) => sum + (Number(o.count) || 0), 0);
                              return (
                                <div
                                  key={elev}
                                  className="mb-2"
                                  data-testid={`ai-measure-opening-group-${elev}`}
                                >
                                  <div className={`${color.soft} flex items-center gap-2 px-2 py-1.5 border-l-4 ${color.bg.replace("bg-", "border-")}`}>
                                    <span className={`${color.bg} text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider`}>
                                      {elev}
                                    </span>
                                    <span className={`text-[11px] font-bold ${color.text}`}>
                                      {totalCount} opening{totalCount !== 1 ? "s" : ""}
                                    </span>
                                    <span className="text-[10px] text-[#71717A] ml-2 italic">
                                      {items.map((o) => {
                                        const sz = o.size_label || `${Math.round(Number(o.width_in) || 0)}×${Math.round(Number(o.height_in) || 0)} in`;
                                        const st = (o.style || "").trim();
                                        return st ? `${st} ${sz}×${o.count}` : `${sz}×${o.count}`;
                                      }).join(" · ")}
                                    </span>
                                  </div>
                                  <table className="w-full text-xs border-b border-[#E4E4E7]">
                                    <tbody>
                                      {items.map((o, i) => {
                                        const isWindow = (o.type || "").toLowerCase() === "window";
                                        const styleVal = o.style || "";
                                        const styleConf = Number(o.style_confidence) || 0;
                                        const confChip = styleConf >= 80 ? "bg-[#16A34A]" : styleConf >= 60 ? "bg-[#CA8A04]" : styleConf >= 30 ? "bg-[#EA580C]" : "bg-[#DC2626]";
                                        const sizeLabel = o.size_label || `${Math.round(Number(o.width_in) || 0)}×${Math.round(Number(o.height_in) || 0)} in`;
                                        return (
                                          <tr key={i} className="hover:bg-[#FAFAFA]" data-testid={`ai-measure-opening-row-${elev}-${i}`}>
                                            <td className="py-1 pl-4 capitalize text-[#52525B]" style={{ width: "22%" }}>
                                              {(o.type || "—").replace(/_/g, " ")}
                                            </td>
                                            <td className="font-mono-num text-[#27272A]" style={{ width: "20%" }}>
                                              {sizeLabel}
                                            </td>
                                            <td className="py-1" style={{ width: "45%" }}>
                                              {isWindow ? (
                                                <div className="flex items-center gap-1">
                                                  <select
                                                    value={styleVal}
                                                    onChange={(e) => updateOpeningStyle(elev, o.type, o.size_label, o.width_in, o.height_in, e.target.value)}
                                                    className="text-xs border border-[#E4E4E7] px-1 py-0.5 bg-white hover:border-[#7C3AED] cursor-pointer w-full max-w-[180px]"
                                                    data-testid={`ai-measure-opening-style-${elev}-${i}`}
                                                    title={styleVal ? `Claude's guess: ${styleVal} (${styleConf}% confident). Change if wrong — this flows to the customer PDF and the Vero quote.` : "Pick a window style — flows to the customer PDF and the Vero quote"}
                                                  >
                                                    {WINDOW_STYLES.map((s) => (
                                                      <option key={s.value} value={s.value}>{s.label}</option>
                                                    ))}
                                                  </select>
                                                  {styleVal && styleConf > 0 && (
                                                    <span
                                                      className={`${confChip} text-white text-[8px] font-bold px-1 rounded-sm tracking-wider`}
                                                      title={`Claude is ${styleConf}% confident on this style`}
                                                    >
                                                      {styleConf}
                                                    </span>
                                                  )}
                                                </div>
                                              ) : (
                                                <span className="text-[#A1A1AA] italic text-[11px]">—</span>
                                              )}
                                            </td>
                                            <td className="font-mono-num font-bold text-right pr-2" style={{ width: "13%" }}>
                                              ×{Number(o.count) || 0}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </details>
                  )}

                  {preview.measurements?._ai_double_count_check && (
                    <div
                      className="text-[11px] text-[#52525B] italic border-l-2 border-[#0EA5E9] pl-3 mb-3"
                      data-testid="ai-measure-double-count"
                    >
                      <span className="not-italic font-bold text-[#0EA5E9] mr-1">Cross-check:</span>
                      {preview.measurements._ai_double_count_check}
                    </div>
                  )}
                  {preview.measurements && (
                    <details className="text-xs mb-3" open data-testid="ai-measure-lf-table">
                      <summary className="cursor-pointer text-[#7C3AED] font-bold uppercase tracking-wider">
                        Linear measurements — tap to edit
                      </summary>
                      <div className="text-[11px] text-[#71717A] mt-2 italic">
                        If the AI under-counted (often because not every elevation was photographed),
                        type the real numbers. ISS soffit / gutter / capping qty re-derives from these on Apply.
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                        {[
                          ["eaves_lf", "Eaves LF"],
                          ["rakes_lf", "Rakes LF"],
                          ["starter_lf", "Starter LF"],
                          ["outside_corner_lf", "Outside corner LF"],
                          ["inside_corner_lf", "Inside corner LF"],
                          ["opening_perimeter_lf", "Opening perimeter LF"],
                          ["window_count", "Window count"],
                          ["entry_door_count", "Entry door count"],
                          ["patio_door_count", "Patio door count"],
                          ["garage_door_count", "Garage door count"],
                        ].map(([key, label]) => (
                          <label key={key} className="flex flex-col text-[10px] text-[#71717A] uppercase tracking-wider">
                            <span className="mb-1">{label}</span>
                            <input
                              type="number"
                              step={key.endsWith("_count") ? "1" : "0.5"}
                              min="0"
                              value={Number(preview.measurements[key] || 0)}
                              onChange={(e) => setMeasurementField(key, e.target.value)}
                              className="px-2 py-1 border border-[#E4E4E7] font-mono-num text-sm text-[#09090B] normal-case"
                              data-testid={`ai-measure-lf-${key}`}
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Iter 56: Raw AI JSON for debugging — collapsed by
                      default. Useful when the numbers look wrong and we
                      need to see exactly what Claude returned. */}
                  {(preview.raw_ai || preview.measurements) && (
                    <details className="text-xs mb-3" data-testid="ai-measure-raw-debug">
                      <summary className="cursor-pointer text-[#71717A] font-bold uppercase tracking-wider text-[10px]">
                        🔍 Show raw AI output (debug)
                      </summary>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                            raw_ai (what Claude returned)
                          </div>
                          <pre className="bg-[#09090B] text-[#22D3EE] p-2 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap break-all" data-testid="ai-measure-raw-ai-json">
{JSON.stringify(preview.raw_ai || {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                            measurements (post-aggregator)
                          </div>
                          <pre className="bg-[#09090B] text-[#A78BFA] p-2 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap break-all" data-testid="ai-measure-measurements-json">
{JSON.stringify(preview.measurements || {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            JSON.stringify(
                              { raw_ai: preview.raw_ai, measurements: preview.measurements },
                              null,
                              2,
                            ),
                          );
                          toast.success("Raw AI output copied to clipboard");
                        }}
                        className="mt-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-white border border-[#E4E4E7] hover:bg-[#FAFAFA]"
                        data-testid="ai-measure-copy-raw"
                      >
                        Copy to clipboard
                      </button>
                    </details>
                  )}


                </>
              )}
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-between items-center relative">
              {/* Iter 57h — inline calibration popover. Hidden by default;
                  pops up just above the Run button when the contractor
                  hits the "Calibrate window sizing" link. Stays out of
                  the way for the 80% of jobs that don't need it. */}
              {calibOpen && (
                <div
                  className="absolute bottom-full right-5 mb-2 bg-white border border-[#7C3AED] shadow-xl p-3 min-w-[280px] z-10"
                  data-testid="ai-measure-course-sizing"
                  onMouseLeave={() => { /* keep open on hover-leave — user explicitly closes */ }}
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-[#7C3AED] font-bold leading-tight">
                      Calibrate window sizing
                      <div className="text-[9px] text-[#A1A1AA] font-normal mt-0.5">
                        Tell Claude the brick course or siding row height. Optional — leave blank for defaults.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCalibOpen(false)}
                      className="text-[#A1A1AA] hover:text-[#09090B]"
                      title="Close"
                      data-testid="ai-measure-course-sizing-close"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[9px] uppercase tracking-wider text-[#A1A1AA] font-bold">Brick course (in)</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        className="input text-sm"
                        placeholder="8 = standard"
                        value={brickCourse}
                        onChange={(e) => setBrickCourse(e.target.value)}
                        data-testid="ai-measure-brick-course"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[9px] uppercase tracking-wider text-[#A1A1AA] font-bold">Siding exposure (in)</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        className="input text-sm"
                        placeholder="D5=5, D6=6, CI=7"
                        value={sidingExposure}
                        onChange={(e) => setSidingExposure(e.target.value)}
                        data-testid="ai-measure-siding-exposure"
                      />
                    </label>
                  </div>
                  <div className="text-[9px] text-[#A1A1AA] mt-2 italic">
                    Backend snaps every window to nearest standard size after Claude runs, regardless.
                  </div>
                  {/* Iter 57j — Deep Dormer Scan toggle. Catches small
                      dormers / gable windows / eyebrow vents that get
                      lost when Claude downsizes full-house photos. */}
                  <label
                    className="flex items-start gap-2 mt-3 pt-3 border-t border-[#E4E4E7] cursor-pointer"
                    data-testid="ai-measure-deep-dormer-row"
                  >
                    <input
                      type="checkbox"
                      checked={deepDormerScan}
                      onChange={(e) => setDeepDormerScan(e.target.checked)}
                      className="mt-0.5 accent-[#7C3AED]"
                      data-testid="ai-measure-deep-dormer-toggle"
                    />
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-wider text-[#09090B] font-bold leading-tight">
                        🔍 Deep dormer scan
                      </div>
                      <div className="text-[9px] text-[#A1A1AA] mt-0.5">
                        Runs an extra Claude pass on the cropped roofline of each ground photo. Catches small dormers / eyebrow vents. Adds ~5–10 s.
                      </div>
                    </div>
                  </label>
                </div>
              )}
              <div className="text-[10px] text-[#A1A1AA] flex items-center gap-3">
                <span>Powered by Claude Opus 4.5</span>
                <button
                  type="button"
                  onClick={() => setCalibOpen((v) => !v)}
                  className={`text-[10px] uppercase tracking-wider font-bold flex items-center gap-1 ${
                    (brickCourse || sidingExposure || deepDormerScan) ? "text-[#7C3AED]" : "text-[#A1A1AA] hover:text-[#7C3AED]"
                  }`}
                  data-testid="ai-measure-course-sizing-toggle"
                  title="Tell Claude the brick course or siding row height, or enable Deep Dormer Scan (optional)"
                >
                  <Ruler className="w-3 h-3" />
                  {(brickCourse || sidingExposure || deepDormerScan) ? "Calibration on" : "Calibrate window sizing"}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider"
                  onClick={closeAll}
                  disabled={busy}
                  data-testid="ai-measure-cancel"
                >
                  Close
                </button>
                {(preview || photoUrls.length > 0 || files.length > 0) && (
                  <button
                    type="button"
                    className="px-3 py-2 bg-white text-[#DC2626] border border-[#DC2626] hover:bg-red-50 text-xs font-bold uppercase tracking-wider"
                    onClick={startOver}
                    disabled={busy}
                    data-testid="ai-measure-start-over"
                    title="Wipe photos + AI result and start fresh"
                  >
                    Start Over
                  </button>
                )}
                {preview && estimateId && (
                  <button
                    type="button"
                    onClick={downloadReportPdf}
                    disabled={reportBusy || busy}
                    className="px-3 py-2 bg-white text-[#0EA5E9] border border-[#0EA5E9] hover:bg-[#F0F9FF] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                    data-testid="ai-measure-report-pdf-btn"
                    title="Download a branded HOVER-style measurement report (photos + confidence chips + openings schedule)"
                  >
                    {reportBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    {reportBusy ? "Generating…" : "Report PDF"}
                  </button>
                )}
                {!preview ? (
                  <>
                    {photoUrls.length > 0 && estimateId && (
                      <button
                        type="button"
                        onClick={() => setProfileAnnotatorOpen(true)}
                        disabled={busy}
                        className="px-3 py-2 bg-white text-[#F97316] border border-[#F97316] hover:bg-[#FFF7ED] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 mr-1"
                        data-testid="ai-measure-tag-profiles-btn"
                        title="Draw boxes to tag Shake / B&B / etc. — guarantees those materials hit the quote"
                      >
                        Tag Profiles
                        {Object.entries(savedProfileAnnotations).filter(([k, v]) => !k.startsWith("_") && Array.isArray(v) && v.length > 0).length > 0 && (
                          <span className="bg-[#F97316] text-white px-1 py-0 text-[9px]">
                            {Object.entries(savedProfileAnnotations).reduce((a, [k, v]) => a + (k.startsWith("_") ? 0 : (Array.isArray(v) ? v.length : 0)), 0)}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={runMeasure}
                      disabled={busy || photoUrls.length === 0 || files.length > 0}
                      className="px-3 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                      data-testid="ai-measure-run-btn"
                    >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {busy
                      ? (busyStage === "claude" ? "Claude vision…"
                        : busyStage === "dormer_scan" ? "Deep dormer scan…"
                        : busyStage === "aggregating" ? "Aggregating walls…"
                        : busyStage === "mapping" ? "Mapping to catalog…"
                        : busyStage === "starting" ? "Starting…"
                        : "Analyzing…")
                      : files.length > 0 ? "Uploading…" : "Run AI Measure"}
                  </button>
                  </>
                ) : (
                  <>
                    {/* Advanced tools toggle — gates Refine on Photo.
                        Pre-AI annotations (Iter 56) cover most use cases;
                        Refine is the manual-measure escape hatch. */}
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border ${
                        showAdvanced
                          ? "bg-[#FAFAFA] text-[#52525B] border-[#A1A1AA]"
                          : "bg-white text-[#A1A1AA] border-[#E4E4E7] hover:text-[#52525B]"
                      } mr-1`}
                      data-testid="ai-measure-advanced-toggle"
                      title="Show / hide the Refine on Photo manual-measure tool"
                    >
                      {showAdvanced ? "Hide" : "Advanced"}
                    </button>
                    {/* Merge-mode picker — controls how Refine on Photo
                        deltas roll into the AI's aggregate measurements.
                        Add accumulates LFs/counts across per-elevation
                        refines; Max keeps the larger of the two; Replace
                        is the legacy overwrite. */}
                    {showAdvanced && (
                    <div className="flex items-center gap-1 mr-1 border border-[#E4E4E7] rounded-sm overflow-hidden" data-testid="refine-merge-mode">
                      <span className="px-2 py-2 text-[9px] uppercase tracking-wider text-[#A1A1AA] font-bold bg-[#FAFAFA]" title="How to merge values from Refine on Photo into the AI aggregate">
                        Refine merge
                      </span>
                      {[
                        { key: "add",     label: "+ Add",   hint: "Refines ADD to the aggregate — best when measuring each elevation separately" },
                        { key: "max",     label: "Max",    hint: "Keep the larger of the AI value vs the refined value — never lowers your totals" },
                        { key: "replace", label: "Replace", hint: "Refined value wins — overwrites the AI aggregate (legacy behavior)" },
                      ].map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setRefineMergeMode(m.key)}
                          className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition ${
                            refineMergeMode === m.key
                              ? "bg-[#0EA5E9] text-white"
                              : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
                          }`}
                          data-testid={`refine-merge-${m.key}`}
                          title={m.hint}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    )}
                    {showAdvanced && (
                    <button
                      type="button"
                      onClick={() => setRefineOpen(true)}
                      disabled={busy}
                      className="px-3 py-2 bg-white text-[#0EA5E9] border border-[#0EA5E9] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                      data-testid="ai-measure-refine-btn"
                      title="Pick one of your photos and tap-measure. Merge mode controls whether refines ADD, take MAX, or REPLACE the AI aggregate."
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      Refine on Photo
                    </button>
                    )}
                    <button
                      type="button"
                      onClick={apply}
                      disabled={busy}
                      className="px-3 py-2 bg-[#F97316] text-white hover:bg-[#EA580C] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                      data-testid="ai-measure-apply-btn"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {busy ? "Saving…" : "Apply Measurements"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Iter 56: pre-AI annotation modal. Lets the contractor mark a
          reference scale anchor + no-siding zones on each photo BEFORE
          submitting to Claude. The annotations are burned into the
          rendered image in runMeasure() and described as text alongside. */}
      <PhotoAnnotateModal
        open={!!annotateOpenFor}
        onClose={() => setAnnotateOpenFor(null)}
        photoUrl={annotateOpenFor ? `/api/uploads/${annotateOpenFor}` : null}
        elevation={
          annotateOpenFor
            ? (photoAnnotations[annotateOpenFor]?.elevation || "")
            : ""
        }
        reference={
          annotateOpenFor ? (photoAnnotations[annotateOpenFor]?.reference || null) : null
        }
        windowReference={
          annotateOpenFor ? (photoAnnotations[annotateOpenFor]?.windowReference || null) : null
        }
        zones={
          annotateOpenFor ? (photoAnnotations[annotateOpenFor]?.zones || []) : []
        }
        targetPin={
          annotateOpenFor ? (photoAnnotations[annotateOpenFor]?.targetPin || null) : null
        }
        windows={
          annotateOpenFor ? (photoAnnotations[annotateOpenFor]?.windows || []) : []
        }
        onSave={({ reference, windowReference, zones, targetPin, windows }) => {
          if (!annotateOpenFor) return;
          setPhotoAnnotations((prev) => ({
            ...prev,
            [annotateOpenFor]: {
              ...(prev[annotateOpenFor] || {}),
              reference,
              windowReference,
              zones,
              targetPin,
              windows,
            },
          }));
          toast.success("Annotations saved · Claude will see them when you Run AI Measure");
        }}
      />
      {/* Child modal: tap-on-photo refinement. Overrides any subset of
          the AI measurements with hand-measured values. The AI photos
          are handed down via prefillUrls (session-persistent server
          URLs) so the user can skip the re-upload step. */}
      <PhotoMeasureButton
        hideTrigger
        externalOpen={refineOpen}
        onExternalClose={() => setRefineOpen(false)}
        prefillUrls={photoUrls}
        onApply={async ({ measurements: refined }) => {
          // Iter 55: Merge ONLY the linear / count fields. The
          // `siding_sqft` from PhotoMeasureButton is partial (only the
          // walls the contractor tapped this session) and would clobber
          // the AI's full-house geometry. Siding stays anchored to the
          // editable Wall Breakdown table.
          //
          // The merge MODE (add / max / replace) lets the contractor pick
          // semantics. Default = "add" so refining each elevation in turn
          // accumulates LFs and counts naturally. Mode is selectable
          // inside the Refine on Photo modal header.
          const MERGEABLE_KEYS = new Set([
            "eaves_lf",
            "rakes_lf",
            "starter_lf",
            "outside_corner_lf",
            "inside_corner_lf",
            "opening_perimeter_lf",
            "opening_count",
            "window_count",
            "entry_door_count",
            "patio_door_count",
            "garage_door_count",
          ]);
          const mergeOne = (prev, refinedVal) => {
            const p = Number(prev) || 0;
            const r = Number(refinedVal) || 0;
            if (refineMergeMode === "add") return p + r;
            if (refineMergeMode === "max") return Math.max(p, r);
            return r; // "replace"
          };
          const diffs = []; // [{ key, prev, refined, after }]
          setPreview((prev) => {
            if (!prev) return prev;
            const next = { ...prev.measurements };
            for (const [k, v] of Object.entries(refined || {})) {
              if (!MERGEABLE_KEYS.has(k)) continue;
              const num = Number(v) || 0;
              if (num <= 0) continue;
              const before = Number(next[k] || 0);
              const after = mergeOne(before, num);
              if (after !== before) {
                next[k] = after;
                diffs.push({ key: k, prev: before, refined: num, after });
              }
            }
            return { ...prev, measurements: next };
          });
          setWallsDirty(true);
          setRefineOpen(false);
          // Surface the actual deltas so the contractor can see what
          // moved. e.g. "+ eaves 40 → 176, + windows 3 → 14" on Add mode.
          if (diffs.length) {
            const sample = diffs.slice(0, 3).map((d) =>
              `${d.key.replace(/_/g, " ")} ${d.prev}→${d.after}`
            ).join(", ");
            const more = diffs.length > 3 ? ` (+${diffs.length - 3} more)` : "";
            toast.success(`Refined (${refineMergeMode}): ${sample}${more} · siding ft² unchanged`);
          } else {
            toast.success(`Refine applied — no changes vs ${refineMergeMode} mode · siding ft² unchanged`);
          }
        }}
      />
      <GuidedCaptureWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={handleWizardComplete}
      />
      {/* Iter 78z — Profile Annotator (Tag Shake / B&B / etc.) */}
      {profileAnnotatorOpen && estimateId && (
        <ProfileAnnotator
          estimateId={estimateId}
          photos={photoUrls.map((name, i) => ({
            url: `/api/uploads/${name}`,
            label: photoAnnotations[name]?.elevation || `#${i + 1}`,
          }))}
          initialAnnotations={savedProfileAnnotations}
          defaultElevationByIdx={photoUrls.map((name) => photoAnnotations[name]?.elevation || "other")}
          onClose={() => setProfileAnnotatorOpen(false)}
          onSaved={(saved) => {
            setSavedProfileAnnotations(saved);
          }}
          onSaveAndRerun={currentRunId ? async () => {
            rerunWithAnnotations();
          } : null}
        />
      )}
    </div>
  );
}
