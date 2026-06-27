// Iter 78z — Profile Annotator modal.
//
// Lets the contractor draw bounding boxes on uploaded photos / blueprint
// pages and tag each box with a canonical profile family (Shake / B&B /
// Lap / etc.). Annotations are saved per-estimate and applied as
// authoritative accents in the AI Measure / Blueprint worker — guaranteeing
// the catalog mapper emits the right per-profile line on the material list.
//
// Workflow:
//   1. Pick an image from the strip on the left (photos OR blueprint pages).
//   2. Optionally set the scale reference: click "+ Set scale", drag a line
//      between two points of known length, enter the real-world distance.
//      All boxes drawn on this image will auto-compute their ft².
//   3. Pick a profile from the palette.
//   4. Click-drag on the image to draw a box. The box appears with the
//      profile chip + auto-computed ft² (editable).
//   5. Repeat for each accent region.
//   6. Save → annotations persist on the estimate.
//
// The boxes use NORMALIZED coordinates (0-1) so they survive image resizing.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Trash2, Ruler, Save, MousePointer2, ZoomIn, ZoomOut, Maximize2, Minimize2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const PROFILES = [
  { value: "lap",          label: "Lap",          short: "LP",  color: "#3B82F6", isSiding: true },
  { value: "dutch_lap",    label: "Dutch Lap",    short: "DL",  color: "#2563EB", isSiding: true },
  { value: "shake",        label: "Shake",        short: "SH",  color: "#F59E0B", isSiding: true },
  { value: "board_batten", label: "Board & Batten", short: "BB", color: "#EC4899", isSiding: true },
  { value: "vertical",     label: "Vertical",     short: "VT",  color: "#DB2777", isSiding: true },
  { value: "nickel_gap",   label: "Nickel Gap",   short: "NG",  color: "#A855F7", isSiding: true },
  { value: "stone",        label: "Stone",        short: "ST",  color: "#71717A", isSiding: false },
  { value: "brick",        label: "Brick",        short: "BR",  color: "#92400E", isSiding: false },
  { value: "stucco",       label: "Stucco",       short: "SC",  color: "#9CA3AF", isSiding: false },
];

const ELEVATIONS = ["front", "right", "back", "left", "front-left", "front-right", "rear-left", "rear-right", "porch", "dormer", "other"];
// Iter 78z+++ — Callout location within an elevation. Lets one elevation
// row carry mixed accents (e.g. Lap body + Shake gable + B&B dormer on
// the same wall). Routed through to the catalog mapper via the
// annotation `callout` text — the backend already parses it.
const CALLOUT_LOCATIONS = ["body", "gable", "dormer", "porch", "trim", "other"];

const newId = () => `box_${Math.random().toString(36).slice(2, 10)}`;

// Compute ft² for a box given the photo's scale reference (px_height for
// a known real-ft span). Falls back to a NaN / explicit "no scale" state
// when none is set — UI will surface "scale needed" + let the user
// manually type the ft².
function computeSqftFromBox(boxNorm, imgPx, scaleRef) {
  if (!scaleRef || !scaleRef.px_height || !scaleRef.real_ft || !imgPx?.h) return null;
  const ftPerPx = scaleRef.real_ft / scaleRef.px_height;
  const boxWpx = boxNorm.w_norm * imgPx.w;
  const boxHpx = boxNorm.h_norm * imgPx.h;
  const sqft = boxWpx * ftPerPx * boxHpx * ftPerPx;
  return Math.max(0, Math.round(sqft));
}

// Iter 78z+ — Polygon support. Shoelace area (in pixel space) → ft²
// via the same scale ref. Used for irregular shapes (gables, porch
// faces) where a bounding rectangle would massively over-count.
function polygonAreaPx(points, imgPx) {
  if (!points || points.length < 3 || !imgPx?.w || !imgPx?.h) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    a += (points[i].x_norm * imgPx.w) * (points[j].y_norm * imgPx.h);
    a -= (points[j].x_norm * imgPx.w) * (points[i].y_norm * imgPx.h);
  }
  return Math.abs(a / 2);
}

function computeSqftFromPolygon(points, imgPx, scaleRef) {
  if (!scaleRef || !scaleRef.px_height || !scaleRef.real_ft) return null;
  const areaPx = polygonAreaPx(points, imgPx);
  if (areaPx <= 0) return null;
  const ftPerPx = scaleRef.real_ft / scaleRef.px_height;
  return Math.max(0, Math.round(areaPx * ftPerPx * ftPerPx));
}

function pointsToBbox(points) {
  if (!points || !points.length) return { x_norm: 0, y_norm: 0, w_norm: 0, h_norm: 0 };
  const xs = points.map((p) => p.x_norm);
  const ys = points.map((p) => p.y_norm);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  return { x_norm: xMin, y_norm: yMin, w_norm: xMax - xMin, h_norm: yMax - yMin };
}

export default function ProfileAnnotator({
  estimateId, photos, initialAnnotations, defaultElevationByIdx,
  onClose, onSaved, onSaveAndRerun,
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [annotations, setAnnotations] = useState(initialAnnotations || {});
  const [activeProfile, setActiveProfile] = useState("shake");
  // Iter 78z+ — Draw mode toggle. Rectangles for body wall sections,
  // polygons for triangular gables / irregular porch B&B / etc.
  const [drawMode, setDrawMode] = useState("rect"); // "rect" | "polygon"
  const [drawing, setDrawing] = useState(null); // rect draft {x0, y0, x1, y1}
  const [polygonDraft, setPolygonDraft] = useState(null); // {points: [...], cursorX, cursorY}
  // Iter 78z+ — OCR auto-scale busy flag.
  const [ocrBusy, setOcrBusy] = useState(false);
  // Scale ref draft mode: when truthy, a click+drag draws a calibration line.
  const [scaleDraft, setScaleDraft] = useState(null); // {x0,y0,x1,y1,active}
  const [scaleRefInput, setScaleRefInput] = useState({ open: false, pxHeight: 0, realFt: "6.67" });
  const [imgPx, setImgPx] = useState({ w: 0, h: 0 }); // displayed image pixel size
  // Iter 78z++ — Zoom + pan + fullscreen so contractors can hit
  // small openings precisely on dense blueprint sheets. Wheel scrolls
  // change `zoom`; pan happens via the container's native overflow
  // (scrollbars) so click+drag remains dedicated to drawing.
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  // Iter 78z+++ — Track which blueprint pages we've already auto-OCR'd
  // so we don't waste Claude calls re-running on every page revisit.
  const autoOcrFiredRef = useRef(new Set());

  const currentPhoto = photos?.[selectedIdx];
  const photoKey = String(selectedIdx);
  const boxes = (annotations[photoKey] || []).filter((b) => b && typeof b === "object");
  const scaleRefs = annotations._scale_refs || {};
  const scaleRef = scaleRefs[photoKey] || null;

  // Default elevation label for new boxes — pulled from AI's auto-tag
  // when available, otherwise "other".
  const defaultElevation = defaultElevationByIdx?.[selectedIdx] || "other";

  // Sync displayed image dimensions on load + window resize
  const updateImgPx = () => {
    if (imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect();
      setImgPx({ w: rect.width, h: rect.height });
    }
  };
  useEffect(() => {
    updateImgPx();
    window.addEventListener("resize", updateImgPx);
    return () => window.removeEventListener("resize", updateImgPx);
  }, [selectedIdx]);

  // Iter 78z++ — Reset zoom + pan when switching between blueprint
  // pages so each page starts fitted to the viewport.
  useEffect(() => {
    setZoom(1);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, [selectedIdx]);

  // Iter 78z++ — Wheel-to-zoom anchored at cursor (no modifier needed),
  // ported from PhotoAnnotateModal. Non-passive listener so the page
  // doesn't scroll while zooming inside the canvas. Plain wheel up =
  // zoom in toward cursor, wheel down = zoom out. The wider the
  // delta, the bigger the step (exponential curve).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !currentPhoto) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left + el.scrollLeft;
      const cy = e.clientY - rect.top + el.scrollTop;
      setZoom((prev) => {
        const next = Math.max(0.5, Math.min(8, prev * Math.exp(-e.deltaY * 0.0015)));
        if (next === prev) return prev;
        requestAnimationFrame(() => {
          if (!containerRef.current) return;
          containerRef.current.scrollLeft = cx * (next / prev) - (e.clientX - rect.left);
          containerRef.current.scrollTop = cy * (next / prev) - (e.clientY - rect.top);
        });
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [currentPhoto, selectedIdx]);

  const bumpZoom = (factor) => {
    const container = containerRef.current;
    setZoom((prev) => {
      const next = Math.max(0.5, Math.min(8, prev * factor));
      if (next === prev || !container) return next;
      // Anchor zoom-button changes on the container center.
      const cx = container.clientWidth / 2 + container.scrollLeft;
      const cy = container.clientHeight / 2 + container.scrollTop;
      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollLeft = cx * (next / prev) - container.clientWidth / 2;
        containerRef.current.scrollTop = cy * (next / prev) - container.clientHeight / 2;
      });
      return next;
    });
  };
  const resetZoom = () => {
    setZoom(1);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  };

  const onMouseDown = (e) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (scaleDraft?.active) {
      setScaleDraft({ ...scaleDraft, x0: x, y0: y, x1: x, y1: y, dragging: true });
      return;
    }
    if (drawMode === "polygon") {
      // First click → start polygon; subsequent clicks → append vertex.
      const pts = polygonDraft?.points || [];
      // Closing rule: click within 2% of the first vertex → finalize.
      if (pts.length >= 3) {
        const dx = pts[0].x_norm - x;
        const dy = pts[0].y_norm - y;
        if (Math.hypot(dx, dy) < 0.025) {
          finalizePolygon(pts);
          return;
        }
      }
      setPolygonDraft({ points: [...pts, { x_norm: x, y_norm: y }], cursorX: x, cursorY: y });
      return;
    }
    setDrawing({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMouseMove = (e) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (scaleDraft?.dragging) {
      setScaleDraft({ ...scaleDraft, x1: x, y1: y });
    } else if (polygonDraft) {
      setPolygonDraft({ ...polygonDraft, cursorX: x, cursorY: y });
    } else if (drawing) {
      setDrawing({ ...drawing, x1: x, y1: y });
    }
  };

  const finalizePolygon = (points) => {
    if (!points || points.length < 3) return;
    const bbox = pointsToBbox(points);
    const newBox = {
      id: newId(),
      ...bbox,
      points,                       // <-- polygon vertices
      shape: "polygon",
      elevation_label: defaultElevation,
      profile: activeProfile,
      sqft: 50,
      callout: "",
      location: "body",  // Iter 78z+++ — body/gable/dormer/porch/trim/other
    };
    const sqftFromPoly = computeSqftFromPolygon(points, imgPx, scaleRef);
    if (sqftFromPoly != null) newBox.sqft = sqftFromPoly;
    setAnnotations((prev) => ({
      ...prev,
      [photoKey]: [...(prev[photoKey] || []), newBox],
    }));
    setPolygonDraft(null);
  };

  // Keyboard shortcuts: Enter closes polygon, Esc cancels,
  // 0/+/- control zoom (so user can always escape the zoom).
  useEffect(() => {
    const handler = (e) => {
      // Don't fire shortcuts when typing in an input/textarea (sqft, note)
      const t = e.target;
      const isEditing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        setPolygonDraft(null);
        setScaleDraft(null);
        setDrawing(null);
      }
      if (e.key === "Enter" && polygonDraft && polygonDraft.points?.length >= 3) {
        finalizePolygon(polygonDraft.points);
      }
      if (isEditing) return;
      if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        bumpZoom(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        bumpZoom(1 / 1.25);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [polygonDraft, activeProfile, photoKey, imgPx, scaleRef]);
  const onMouseUp = () => {
    if (scaleDraft?.dragging) {
      // finalize calibration line
      const dx = (scaleDraft.x1 - scaleDraft.x0) * imgPx.w;
      const dy = (scaleDraft.y1 - scaleDraft.y0) * imgPx.h;
      const pxHeight = Math.sqrt(dx * dx + dy * dy);
      if (pxHeight < 10) {
        toast.error("Calibration line too short — try again");
        setScaleDraft(null);
        return;
      }
      setScaleRefInput({ open: true, pxHeight, realFt: scaleRefInput.realFt });
      setScaleDraft(null);
      return;
    }
    // Polygon mode → no drag-up behavior; vertices added on click.
    if (drawMode === "polygon") return;
    if (!drawing) return;
    const xMin = Math.min(drawing.x0, drawing.x1);
    const yMin = Math.min(drawing.y0, drawing.y1);
    const w = Math.abs(drawing.x1 - drawing.x0);
    const h = Math.abs(drawing.y1 - drawing.y0);
    if (w < 0.01 || h < 0.01) {
      // ignore micro-drags / accidental clicks
      setDrawing(null);
      return;
    }
    const newBox = {
      id: newId(),
      x_norm: xMin, y_norm: yMin, w_norm: w, h_norm: h,
      shape: "rect",
      elevation_label: defaultElevation,
      profile: activeProfile,
      sqft: 50,
      callout: "",
      location: "body",  // Iter 78z+++ — body/gable/dormer/porch/trim/other
    };
    const computed = computeSqftFromBox(newBox, imgPx, scaleRef);
    if (computed != null) newBox.sqft = computed;
    setAnnotations((prev) => ({
      ...prev,
      [photoKey]: [...(prev[photoKey] || []), newBox],
    }));
    setDrawing(null);
  };

  const updateBox = (boxId, patch) => {
    setAnnotations((prev) => ({
      ...prev,
      [photoKey]: (prev[photoKey] || []).map((b) =>
        b.id === boxId ? { ...b, ...patch } : b,
      ),
    }));
  };
  const deleteBox = (boxId) => {
    setAnnotations((prev) => ({
      ...prev,
      [photoKey]: (prev[photoKey] || []).filter((b) => b.id !== boxId),
    }));
  };

  const confirmScale = () => {
    const realFt = Number(scaleRefInput.realFt);
    if (!realFt || realFt <= 0) {
      toast.error("Enter a positive real-world distance");
      return;
    }
    const newRefs = { ...(annotations._scale_refs || {}) };
    newRefs[photoKey] = {
      px_height: scaleRefInput.pxHeight,
      real_ft: realFt,
      // Iter 78z+++ — store the display image dimensions at calibration
      // time so the backend can recompute box sqft from normalized
      // coords if a sentinel 50-default ever slips through.
      img_w: imgPx?.w || 0,
      img_h: imgPx?.h || 0,
    };
    // Re-compute sqft for every existing box on this photo using the new ref
    const newBoxes = (annotations[photoKey] || []).map((b) => {
      const computed = computeSqftFromBox(b, imgPx, newRefs[photoKey]);
      return computed != null ? { ...b, sqft: computed } : b;
    });
    setAnnotations((prev) => ({
      ...prev,
      [photoKey]: newBoxes,
      _scale_refs: newRefs,
    }));
    setScaleRefInput({ open: false, pxHeight: 0, realFt: "6.67" });
    toast.success("Scale reference saved — sqft updated");
  };

  const save = async () => {
    try {
      await api.put(`/estimates/${estimateId}/profile-annotations`, { annotations });
      toast.success("Annotations saved");
      if (onSaved) onSaved(annotations);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Failed to save");
    }
  };

  // Iter 78z+ — Save AND immediately fire the worker (using cached
  // page bytes server-side). Skips the "click Read Blueprints again"
  // step. Parent provides `onSaveAndRerun(annotations)` and handles
  // the polling.
  const saveAndRerun = async () => {
    try {
      await api.put(`/estimates/${estimateId}/profile-annotations`, { annotations });
      if (onSaved) onSaved(annotations);
      if (onSaveAndRerun) await onSaveAndRerun(annotations);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Failed to save & re-run");
    }
  };

  const totalBoxes = useMemo(() => {
    return Object.entries(annotations).reduce((acc, [k, v]) => (
      k.startsWith("_") ? acc : acc + (Array.isArray(v) ? v.length : 0)
    ), 0);
  }, [annotations]);

  // Iter 78z+ — Derive the upload filename from photos[selectedIdx].url
  // ("/api/uploads/<name>") so the OCR endpoint can find the bytes
  // on disk. Empty for non-server-hosted photos (shouldn't happen).
  const currentUploadName = (() => {
    const url = photos?.[selectedIdx]?.url || "";
    const m = url.match(/\/api\/uploads\/([^?#]+)/);
    return m ? m[1] : "";
  })();

  // Iter 78z+++ — Auto-fire OCR scale detection on first visit to each
  // blueprint page that doesn't have a scale set yet. Without this,
  // every annotated box defaults to 50 ft² and contractors don't
  // realize they had to set scale manually — Shake / B&B would all
  // hit the materials list as 50 sqft regardless of the box size
  // drawn. Cheap one-time Claude OCR per page (and only when the page
  // is actually being viewed) is well worth the accuracy gain.
  useEffect(() => {
    if (!currentUploadName) return;
    if (scaleRef) return; // already calibrated for this page
    if (autoOcrFiredRef.current.has(currentUploadName)) return;
    if (ocrBusy) return;
    if (!imgPx.w || !imgPx.h) return; // wait until image dimensions are measured
    autoOcrFiredRef.current.add(currentUploadName);
    // Fire after a short delay so the page render doesn't block.
    // silent=true → no error toast (upload could be cleaned off disk
    // for old estimates; user already sees the warning banner +
    // broken image, no need to double-up with a red toast).
    const t = setTimeout(() => {
      autoDetectScale(true);
    }, 250);
    return () => clearTimeout(t);
  }, [currentUploadName, scaleRef, imgPx.w, imgPx.h]);

  // Iter 78z+ — Auto-detect scale via Claude OCR. Sets the scale_ref
  // for THIS photo on success. Boxes already on the photo get their
  // sqft recomputed using the new scale.
  // `silent=true` suppresses error toasts — used when auto-firing on
  // page open where the user didn't explicitly ask for OCR (e.g.
  // upload was cleaned off disk on an old estimate).
  const autoDetectScale = async (silent = false) => {
    if (!currentUploadName) {
      if (!silent) toast.error("This photo isn't server-hosted — can't auto-detect");
      return;
    }
    setOcrBusy(true);
    try {
      const { data } = await api.post("/measure/ocr-scale", { upload_name: currentUploadName });
      if (!data?.found) {
        if (!silent) {
          toast.error(
            data?.notes
              ? `No labeled dimension found · ${data.notes}`
              : "No labeled dimension found — try setting scale manually",
          );
        }
        return;
      }
      const pxHeight = Number(data.px_height) || 0;
      const realFt = Number(data.real_ft) || 0;
      if (pxHeight <= 0 || realFt <= 0) {
        if (!silent) toast.error("OCR returned a degenerate scale — try setting manually");
        return;
      }
      const newRefs = { ...(annotations._scale_refs || {}) };
      newRefs[photoKey] = {
        px_height: pxHeight,
        real_ft: realFt,
        img_w: imgPx?.w || 0,
        img_h: imgPx?.h || 0,
      };
      const newBoxes = (annotations[photoKey] || []).map((b) => {
        if (b.shape === "polygon" && Array.isArray(b.points)) {
          const recomputed = computeSqftFromPolygon(b.points, imgPx, newRefs[photoKey]);
          return recomputed != null ? { ...b, sqft: recomputed } : b;
        }
        const recomputed = computeSqftFromBox(b, imgPx, newRefs[photoKey]);
        return recomputed != null ? { ...b, sqft: recomputed } : b;
      });
      setAnnotations((prev) => ({
        ...prev,
        [photoKey]: newBoxes,
        _scale_refs: newRefs,
      }));
      toast.success(
        `Scale detected · ${realFt.toFixed(2)} ft over ${Math.round(pxHeight)} px (${data.source || "AI"})`,
      );
    } catch (e) {
      if (!silent) toast.error(e?.response?.data?.detail || e?.message || "OCR scale failed");
    } finally {
      setOcrBusy(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[60] bg-black/60 flex items-center justify-center ${isFullscreen ? "p-0" : "p-4"}`}
      data-testid="profile-annotator"
      onClick={onClose}
    >
      <div
        className={
          isFullscreen
            ? "bg-white w-full h-full max-w-none flex flex-col border border-[#E4E4E7]"
            : "bg-white max-w-6xl w-full h-[90vh] flex flex-col border border-[#E4E4E7]"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — matches PhotoAnnotateModal styling for cross-tool consistency */}
        <div className="bg-[#7C3AED] text-white px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-heading text-lg">Profile Annotator</div>
            <div className="text-xs opacity-90 mt-0.5">
              Tag Shake / B&B / etc. so AI can&apos;t miss them
              <span className="opacity-80 ml-2">
                · {totalBoxes} box{totalBoxes === 1 ? "" : "es"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onSaveAndRerun && (
              <button
                type="button"
                onClick={saveAndRerun}
                className="bg-white text-[#7C3AED] text-xs font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-[#FAFAFA] flex items-center gap-1"
                data-testid="annotator-save-rerun"
                title="Save annotations and immediately re-read the blueprint with them"
              >
                <Save size={12} /> Save & Re-read
              </button>
            )}
            <button
              type="button"
              onClick={save}
              className="bg-[#F97316] text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-[#EA580C] flex items-center gap-1"
              data-testid="annotator-save"
            >
              <Save size={12} /> Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-white/90 hover:text-white"
              data-testid="annotator-cancel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Image strip */}
          <div className="w-32 border-r border-[#E4E4E7] overflow-y-auto bg-[#FAFAFA] p-2 space-y-2">
            {(photos || []).map((p, i) => {
              const count = (annotations[String(i)] || []).length;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`block relative w-full border-2 ${i === selectedIdx ? "border-[#F97316]" : "border-[#E4E4E7]"}`}
                  data-testid={`annotator-strip-${i}`}
                >
                  <img src={p.url} alt={`photo ${i}`} className="w-full h-auto block" />
                  {count > 0 && (
                    <span className="absolute top-1 right-1 bg-[#F97316] text-white text-[9px] font-bold px-1.5 py-0.5">
                      {count}
                    </span>
                  )}
                  <span className="block text-[9px] text-center font-bold uppercase tracking-wider text-[#71717A] mt-0.5">
                    {p.label || `#${i + 1}`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Canvas */}
          <div
            className="flex-1 overflow-auto bg-[#27272A] relative"
            ref={containerRef}
          >
            {/* Iter 78z++ — Vertical zoom toolbar, ported from
                PhotoAnnotateModal so Blueprint/AI Measure feel
                identical. Stays sticky in the top-right while you
                scroll/zoom the canvas. */}
            {currentPhoto && (
              <div
                className="sticky top-2 z-20 flex flex-col gap-1 ml-auto mr-2 mt-2 w-fit"
                data-testid="annotator-zoom-toolbar"
              >
                <button
                  type="button"
                  onClick={() => bumpZoom(1.25)}
                  className="w-9 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center disabled:opacity-40 shadow-sm"
                  disabled={zoom >= 8 - 0.001}
                  title="Zoom in  ·  scroll wheel up"
                  data-testid="annotator-zoom-in"
                >
                  <ZoomIn className="w-4 h-4 text-[#09090B]" />
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  disabled={zoom === 1}
                  className="px-1.5 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center text-[10px] font-bold tabular-nums disabled:opacity-40 shadow-sm min-w-[36px]"
                  title="Reset zoom to 100%  ·  shortcut: 0"
                  data-testid="annotator-zoom-pct"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => bumpZoom(1 / 1.25)}
                  className="w-9 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center disabled:opacity-40 shadow-sm"
                  disabled={zoom <= 0.5 + 0.001}
                  title="Zoom out  ·  scroll wheel down"
                  data-testid="annotator-zoom-out"
                >
                  <ZoomOut className="w-4 h-4 text-[#09090B]" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen((f) => !f)}
                  className="w-9 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center shadow-sm"
                  title={isFullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
                  data-testid="annotator-fullscreen"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4 text-[#09090B]" /> : <Maximize2 className="w-4 h-4 text-[#09090B]" />}
                </button>
              </div>
            )}
            {/* Iter 78z++ — Scroll-wheel hint, mirrors PhotoAnnotateModal */}
            {currentPhoto && zoom === 1 && (
              <div
                className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 pointer-events-none hidden sm:flex items-center gap-1.5 z-20"
                data-testid="annotator-zoom-hint"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Scroll to zoom · scroll bars to pan when zoomed</span>
              </div>
            )}
            {/* Iter 78z+++ — Loud warning when this page has no scale.
                Every new box would default to 50 ft² and silently feed
                the materials list (the bug Howard reported). Either
                wait for the auto-OCR (if still running) or invite the
                contractor to set scale manually. */}
            {currentPhoto && !scaleRef && (
              <div
                className="mx-2 mt-2 px-3 py-2 bg-[#FEF3C7] border border-[#F59E0B] flex items-center gap-2 text-[11px] shadow-sm relative z-10"
                data-testid="annotator-no-scale-warning"
              >
                {ocrBusy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#92400E] flex-shrink-0" />
                    <span className="text-[#92400E] font-bold">
                      Auto-detecting scale from blueprint…
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#92400E] flex-shrink-0" />
                    <span className="text-[#92400E] font-bold flex-1">
                      No scale set on this page — new boxes default to 50 ft². Set scale so Shake / B&B come in at real square footage.
                    </span>
                    {currentUploadName && (
                      <button
                        type="button"
                        onClick={autoDetectScale}
                        className="px-2 py-1 bg-[#F59E0B] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[#D97706] flex-shrink-0"
                        data-testid="annotator-no-scale-auto-btn"
                      >
                        Auto-detect
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {currentPhoto ? (
              <div className="p-4">
                <div
                  ref={stageRef}
                  className="relative"
                  style={{ width: `${zoom * 100}%`, lineHeight: 0 }}
                >
                <img
                  ref={imgRef}
                  src={currentPhoto.url}
                  alt={`elevation ${selectedIdx}`}
                  className="select-none"
                  onLoad={updateImgPx}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  draggable={false}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    userSelect: "none",
                    cursor: scaleDraft?.active ? "crosshair" : "crosshair",
                  }}
                />
                {/* Existing boxes (rect + polygon) */}
                {boxes.map((b) => {
                  const profileDef = PROFILES.find((p) => p.value === b.profile) || PROFILES[0];
                  const isPolygon = b.shape === "polygon" && Array.isArray(b.points) && b.points.length >= 3;
                  return (
                    <React.Fragment key={b.id}>
                      {isPolygon ? (
                        <svg
                          className="absolute top-0 left-0 pointer-events-none"
                          style={{ display: "block", width: "100%", height: "100%" }}
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          data-testid={`annotator-poly-${b.id}`}
                        >
                          <polygon
                            points={b.points.map((p) => `${p.x_norm * 100},${p.y_norm * 100}`).join(" ")}
                            fill={`${profileDef.color}22`}
                            stroke={profileDef.color}
                            strokeWidth="0.4"
                          />
                        </svg>
                      ) : (
                        <div
                          className="absolute border-2 pointer-events-none"
                          style={{
                            left: `${b.x_norm * 100}%`,
                            top: `${b.y_norm * 100}%`,
                            width: `${b.w_norm * 100}%`,
                            height: `${b.h_norm * 100}%`,
                            borderColor: profileDef.color,
                            background: `${profileDef.color}22`,
                          }}
                          data-testid={`annotator-box-${b.id}`}
                        />
                      )}
                      {/* Iter 78z+ — Tiny corner label so it never blocks the drawing.
                          Short code (SH / BB / etc.) + ft² in 9px. */}
                      <div
                        className="absolute pointer-events-none text-white font-bold flex items-center justify-center"
                        style={{
                          left: `${b.x_norm * 100}%`,
                          top: `${b.y_norm * 100}%`,
                          background: profileDef.color,
                          fontSize: "9px",
                          padding: "1px 3px",
                          lineHeight: 1,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {profileDef.short}·{b.sqft}
                      </div>
                    </React.Fragment>
                  );
                })}
                {/* In-progress rect */}
                {drawing && drawMode === "rect" && (
                  <div
                    className="absolute border-2 border-dashed pointer-events-none"
                    style={{
                      left: `${Math.min(drawing.x0, drawing.x1) * 100}%`,
                      top: `${Math.min(drawing.y0, drawing.y1) * 100}%`,
                      width: `${Math.abs(drawing.x1 - drawing.x0) * 100}%`,
                      height: `${Math.abs(drawing.y1 - drawing.y0) * 100}%`,
                      borderColor: (PROFILES.find((p) => p.value === activeProfile) || PROFILES[0]).color,
                      background: `${(PROFILES.find((p) => p.value === activeProfile) || PROFILES[0]).color}33`,
                    }}
                  />
                )}
                {/* In-progress polygon (live edges + vertex dots) */}
                {polygonDraft && polygonDraft.points?.length > 0 && (
                  <svg
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ display: "block", width: "100%", height: "100%" }}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polyline
                      points={[
                        ...polygonDraft.points.map((p) => `${p.x_norm * 100},${p.y_norm * 100}`),
                        polygonDraft.cursorX != null
                          ? `${polygonDraft.cursorX * 100},${polygonDraft.cursorY * 100}`
                          : null,
                      ].filter(Boolean).join(" ")}
                      fill="none"
                      stroke={(PROFILES.find((p) => p.value === activeProfile) || PROFILES[0]).color}
                      strokeWidth="0.4"
                      strokeDasharray="1 0.5"
                    />
                    {polygonDraft.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x_norm * 100}
                        cy={p.y_norm * 100}
                        r={i === 0 ? 0.8 : 0.5}
                        fill={(PROFILES.find((px) => px.value === activeProfile) || PROFILES[0]).color}
                        stroke="white"
                        strokeWidth="0.15"
                      />
                    ))}
                  </svg>
                )}
                {/* Scale calibration line in progress */}
                {scaleDraft?.dragging && (
                  <svg
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ display: "block", width: "100%", height: "100%" }}
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <line
                      x1={scaleDraft.x0 * 100} y1={scaleDraft.y0 * 100}
                      x2={scaleDraft.x1 * 100} y2={scaleDraft.y1 * 100}
                      stroke="#10B981" strokeWidth="0.5" strokeDasharray="2 1"
                    />
                  </svg>
                )}
                </div>
              </div>
            ) : (
              <div className="text-white text-sm p-4">No photo selected</div>
            )}
          </div>

          {/* Right panel — palette + per-box editor */}
          <div className="w-72 border-l border-[#E4E4E7] flex flex-col">
            <div className="p-3 border-b border-[#E4E4E7]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-2">
                Draw mode
              </div>
              <div className="grid grid-cols-2 gap-1 mb-3">
                <button
                  type="button"
                  onClick={() => { setDrawMode("rect"); setPolygonDraft(null); }}
                  className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1.5 border ${drawMode === "rect" ? "bg-[#09090B] text-white border-[#09090B]" : "border-[#E4E4E7] hover:bg-[#FAFAFA]"}`}
                  data-testid="annotator-mode-rect"
                >
                  ▢ Rectangle
                </button>
                <button
                  type="button"
                  onClick={() => setDrawMode("polygon")}
                  className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1.5 border ${drawMode === "polygon" ? "bg-[#09090B] text-white border-[#09090B]" : "border-[#E4E4E7] hover:bg-[#FAFAFA]"}`}
                  data-testid="annotator-mode-polygon"
                  title="Click each corner of the area, then click the first point again (or press Enter) to close"
                >
                  ◇ Polygon
                </button>
              </div>
              {drawMode === "polygon" && (
                <div className="text-[10px] text-[#52525B] bg-[#FEF3C7] border border-[#F59E0B] px-2 py-1 mb-2">
                  <span className="font-bold">Polygon mode:</span> click each corner →
                  click first point (or press <kbd className="font-mono-num">Enter</kbd>) to close ·
                  <kbd className="font-mono-num">Esc</kbd> to cancel.
                  {polygonDraft?.points?.length > 0 && (
                    <span className="block mt-1 font-bold text-[#92400E]">
                      {polygonDraft.points.length} vertex{polygonDraft.points.length === 1 ? "" : "es"} placed
                    </span>
                  )}
                </div>
              )}
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-2">
                Profile {drawMode === "rect" ? "(drag to draw box)" : "(click corners on image)"}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {PROFILES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setActiveProfile(p.value)}
                    className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1.5 border ${activeProfile === p.value ? "ring-2 ring-[#F97316]" : "border-transparent"}`}
                    style={{ background: `${p.color}22`, color: p.color }}
                    data-testid={`annotator-profile-${p.value}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 border-b border-[#E4E4E7]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA]">
                  Scale reference
                </div>
                {scaleRef ? (
                  <span className="text-[10px] text-[#16A34A] font-bold">
                    ✓ {scaleRef.real_ft.toFixed(2)}ft / {Math.round(scaleRef.px_height)}px
                  </span>
                ) : (
                  <span className="text-[10px] text-[#A1A1AA]">not set</span>
                )}
              </div>
              <div className="flex gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => setScaleDraft({ active: true })}
                  className={`flex-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1.5 border flex items-center justify-center gap-1 ${scaleDraft?.active ? "bg-[#10B981] text-white" : "border-[#E4E4E7] hover:bg-[#FAFAFA]"}`}
                  data-testid="annotator-set-scale"
                >
                  <Ruler size={12} />
                  {scaleDraft?.active ? "Drag a known length…" : "+ Set scale"}
                </button>
                {/* Iter 78z+ — Auto-detect scale via Claude OCR. Only
                    surface on actual page uploads (we need the
                    upload_name, which is the photos[i].url tail). */}
                <button
                  type="button"
                  onClick={autoDetectScale}
                  disabled={ocrBusy || !currentUploadName}
                  className="flex-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1.5 border border-[#7C3AED] text-[#7C3AED] hover:bg-[#F5F3FF] flex items-center justify-center gap-1 disabled:opacity-50"
                  data-testid="annotator-auto-scale"
                  title="Use AI vision to find a labeled dimension on the image"
                >
                  {ocrBusy ? "Reading…" : "✨ Auto-detect"}
                </button>
              </div>
              {scaleRefInput.open && (
                <div className="mt-2 p-2 border border-[#10B981] bg-[#ECFDF5]">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-[#065F46] mb-1">
                    What real-world length is that?
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      value={scaleRefInput.realFt}
                      onChange={(e) => setScaleRefInput({ ...scaleRefInput, realFt: e.target.value })}
                      className="flex-1 border border-[#E4E4E7] px-2 py-1 text-xs font-mono-num"
                      placeholder="ft"
                      autoFocus
                      data-testid="annotator-scale-ft"
                    />
                    <button
                      type="button"
                      onClick={confirmScale}
                      className="bg-[#10B981] text-white text-[10px] uppercase font-bold px-2"
                      data-testid="annotator-scale-confirm"
                    >
                      OK
                    </button>
                  </div>
                  <div className="text-[10px] text-[#065F46] mt-1">
                    Common refs: door = 6.67 ft · siding course = 4 in
                  </div>
                </div>
              )}
              {!scaleRef && (
                <p className="text-[10px] text-[#71717A] mt-1 italic">
                  Without scale, sqft defaults to 50 — type the real ft² in each box below to override.
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA] mb-2">
                Boxes on this image ({boxes.length})
              </div>
              {boxes.length === 0 && (
                <div className="text-[11px] text-[#A1A1AA] italic">
                  <MousePointer2 size={12} className="inline mr-1" />
                  Click and drag on the image to draw a box.
                </div>
              )}
              {boxes.map((b) => {
                const profileDef = PROFILES.find((p) => p.value === b.profile) || PROFILES[0];
                return (
                  <div key={b.id} className="border border-[#E4E4E7] p-2 mb-2" data-testid={`annotator-list-${b.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <select
                        value={b.profile}
                        onChange={(e) => updateBox(b.id, { profile: e.target.value })}
                        className="text-[10px] uppercase font-bold tracking-wider border-0 bg-transparent"
                        style={{ color: profileDef.color }}
                        data-testid={`annotator-list-profile-${b.id}`}
                      >
                        {PROFILES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => deleteBox(b.id)}
                        className="text-[#71717A] hover:text-[#EF4444]"
                        data-testid={`annotator-list-delete-${b.id}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <label className="block mb-1">
                      <span className="text-[9px] uppercase tracking-wider text-[#71717A] font-bold">Elevation</span>
                      <select
                        value={b.elevation_label}
                        onChange={(e) => updateBox(b.id, { elevation_label: e.target.value })}
                        className="block w-full text-[11px] border border-[#E4E4E7] px-1 py-0.5"
                      >
                        {ELEVATIONS.map((el) => (
                          <option key={el} value={el}>{el}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block mb-1">
                      <span className="text-[9px] uppercase tracking-wider text-[#71717A] font-bold">Callout location</span>
                      <select
                        value={b.location || "body"}
                        onChange={(e) => updateBox(b.id, { location: e.target.value })}
                        className="block w-full text-[11px] border border-[#E4E4E7] px-1 py-0.5"
                        data-testid={`annotator-list-location-${b.id}`}
                        title="Where on this elevation the profile sits. Lets you carry mixed accents — Lap on body + Shake on gable + B&B on dormer — without splitting elevation rows."
                      >
                        {CALLOUT_LOCATIONS.map((loc) => (
                          <option key={loc} value={loc}>{loc}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block mb-1">
                      <span className="text-[9px] uppercase tracking-wider text-[#71717A] font-bold">ft²</span>
                      <input
                        type="number"
                        value={b.sqft}
                        onChange={(e) => updateBox(b.id, { sqft: Number(e.target.value) || 0 })}
                        className="block w-full text-[11px] border border-[#E4E4E7] px-1 py-0.5 font-mono-num"
                        data-testid={`annotator-list-sqft-${b.id}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[9px] uppercase tracking-wider text-[#71717A] font-bold">Note</span>
                      <input
                        type="text"
                        value={b.callout}
                        onChange={(e) => updateBox(b.id, { callout: e.target.value })}
                        placeholder="e.g. porch face"
                        className="block w-full text-[11px] border border-[#E4E4E7] px-1 py-0.5"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[#E4E4E7] bg-[#FAFAFA] text-[10px] text-[#71717A] leading-snug">
          <span className="font-bold text-[#3F3F46]">How this helps:</span>{" "}
          Boxes you draw here are saved on the estimate. When you click{" "}
          <span className="font-bold">Save &amp; Re-run / Re-read</span>, the AI worker
          loads your boxes and treats them as <span className="font-bold">authoritative</span>{" "}
          accent material — the listed sqft for each profile lands on the materials list,
          no matter what Claude&apos;s vision pass says. Use polygon mode for gables
          and irregular shapes; the rectangle bounding-box would over-count.
        </div>
      </div>
    </div>
  );
}
