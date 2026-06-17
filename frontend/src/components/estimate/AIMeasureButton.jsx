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
import { Sparkles, X, Check, Loader2, AlertTriangle, Camera, Upload, Ruler, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import PhotoMeasureButton from "@/components/estimate/PhotoMeasureButton";

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
  const [resumePrompt, setResumePrompt] = useState(false); // shows banner
  const [refDim, setRefDim] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [sidingPct, setSidingPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // {measurements, raw_ai}
  const [refineOpen, setRefineOpen] = useState(false);
  // Iter 51: Optional "quote gables as shake" override. Adds a shake-
  // siding line for the total gable ft² and deducts that area from the
  // main Charter Oak / Ascend siding qty so we don't double-count.
  const [quoteGablesAsShake, setQuoteGablesAsShake] = useState(false);
  const [shakeSku, setShakeSku] = useState("Pelican Bay Shakes 9\"");
  // Iter 47: contractor can override Claude's wall geometry inline.
  // Tracks whether walls were edited so apply() refreshes lines via
  // /measure/map (otherwise the pre-rolled lines are reused).
  const [wallsDirty, setWallsDirty] = useState(false);

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
        })
        .catch(() => {
          // Non-fatal: autosave failures are silent so they don't
          // interrupt the contractor's flow. Local state is still good.
        });
    }, 1000);
    return () => clearTimeout(t);
  }, [estimateId, open, sessionChecked, photoUrls, refDim, wallHeight, sidingPct, overhangIn, preview]);

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
    const arr = Array.from(e.target.files || []).slice(0, 8 - photoUrls.length);
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

  const removePhoto = (idx) => {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== idx));
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
      // Reference the already-uploaded files by name so we don't have to
      // re-upload bytes that already live on the server.
      fd.append("photo_paths", photoUrls.join(","));
      // Roll the optional fields into a single reference_dim string so
      // the backend doesn't need extra plumbing — Claude reads it as
      // contractor-provided context inside the user prompt.
      const refBits = [];
      if (refDim) refBits.push(refDim);
      if (wallHeight) refBits.push(`average wall height = ${wallHeight} ft`);
      if (sidingPct) refBits.push(`siding covers ~${sidingPct}% of total wall area (rest is brick / stone / garage / etc.)`);
      const refCombined = refBits.join("; ");
      if (refCombined) fd.append("reference_dim", refCombined);
      if (address) fd.append("address", address);
      fd.append("kind", kind || "siding");
      // Soffit pieces are computed server-side using this overhang.
      fd.append("overhang_in", String(overhangIn ?? 12));
      const { data } = await api.post("/measure/ai-measure", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      setPreview(data);
      setWallsDirty(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "AI measure failed");
    } finally {
      setBusy(false);
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

      // "Quote gables as shake" — replace the gable ft² portion of the
      // main siding line with the chosen shake SKU. Math:
      //   gable_sq    = ceil(total_gable_ft² / 100)
      //   shake line  = qty: gable_sq, unit SQ
      //   siding line = max(0, original_qty - gable_sq)
      // We pick the shake SKU's tab/section based on its name so it
      // lands in the right tab (Vinyl Siding for Pelican Bay, LP for LP).
      const gableSqft = preview?.measurements?._ai_gable_sqft || 0;
      if (quoteGablesAsShake && gableSqft > 0) {
        const isLpShake = shakeSku.startsWith("LP");
        const shakeTab = isLpShake ? "lp_smart" : "vinyl";
        const shakeSection = isLpShake ? "LP Smart Siding" : "Vinyl Siding";
        const shakeUnit = isLpShake ? "PCS" : "SQ";
        // For vinyl SQ math; LP shake panels are 4 sqft each (12" × 4').
        const shakeQty = isLpShake
          ? Math.ceil(gableSqft / 4)
          : Math.ceil(gableSqft / 100);
        const gableSq = Math.ceil(gableSqft / 100);
        const lines = (toApply.lines || []).map((ln) => ({ ...ln }));
        // Find the headline siding line in this tab to deduct from
        // (Charter Oak Clap by default). We match by name prefix.
        const sidingPrefix = isLpShake ? "LP Smart Side" : "Charter Oak";
        const idx = lines.findIndex(
          (l) => (l.tab || "vinyl") === shakeTab && (l.name || "").startsWith(sidingPrefix)
        );
        if (idx >= 0) {
          lines[idx] = {
            ...lines[idx],
            qty: Math.max(0, (Number(lines[idx].qty) || 0) - gableSq),
          };
        }
        // Append the shake line (deduped by name+tab).
        const existingShake = lines.findIndex(
          (l) => (l.tab || "vinyl") === shakeTab && l.name === shakeSku
        );
        if (existingShake >= 0) {
          lines[existingShake] = { ...lines[existingShake], qty: shakeQty };
        } else {
          lines.push({
            tab: shakeTab,
            section: shakeSection,
            name: shakeSku,
            unit: shakeUnit,
            qty: shakeQty,
            mat: 0,
            lab: 0,
          });
        }
        toApply = { ...toApply, lines };
      }

      // Pass the full preview {measurements, lines, vero_openings, raw_ai}
      // so the page can choose how to merge. ISS uses just measurements;
      // siding/windows merge `lines` directly.
      await onApply(toApply);
      toast.success("AI measurements applied — verify all quantities before quoting");
      // Successfully applied — clear the persisted session so the
      // contractor isn't prompted to "Resume" stale data next time.
      if (estimateId) {
        try {
          await api.delete(`/measure/sessions/${estimateId}`);
        } catch {
          // non-fatal
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
    <div data-testid="ai-measure">
      <button
        type="button"
        className="px-3 py-1.5 bg-white text-[#7C3AED] border border-[#7C3AED] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        onClick={() => setOpen(true)}
        data-testid="ai-measure-btn"
        title={preview ? "Resume AI measure session — add more photos or refine" : "AI photo measure — upload 2-8 phone photos of the house"}
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
                    Upload 2-8 phone photos · Claude Sonnet 4.5
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
                      Photos (2-8)
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
                        disabled={photoUrls.length >= 8}
                      >
                        {photoUrls.length > 0 ? "Add more photos" : "Choose / Take Photos"}
                      </button>
                      <div className="text-[10px] text-[#A1A1AA] mt-1">
                        Tip: front, back, left, right elevations + any tricky corners
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
                        <div className="mt-3 grid grid-cols-4 gap-2" data-testid="ai-measure-photo-grid">
                          {photoUrls.map((name, i) => (
                            <div key={name} className="relative aspect-square border border-[#E4E4E7] overflow-hidden bg-[#FAFAFA]">
                              <img
                                src={`/api/uploads/${name}`}
                                alt={`Photo ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                                className="absolute top-0.5 right-0.5 bg-[#09090B] text-white w-5 h-5 flex items-center justify-center text-xs hover:bg-[#DC2626]"
                                data-testid={`ai-measure-photo-remove-${i}`}
                                title="Remove this photo"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>

                  {/* Reference dim */}
                  <label className="block mb-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                      Reference dimension (optional, big accuracy boost)
                    </div>
                    <input
                      type="text"
                      className="input text-sm"
                      placeholder='e.g. "front door = 80 inches"  or  "house width = 36 ft"'
                      value={refDim}
                      onChange={(e) => setRefDim(e.target.value)}
                      data-testid="ai-measure-ref-dim"
                    />
                  </label>

                  {/* Wall height + Siding coverage — the two biggest
                      accuracy levers when photos alone aren't enough. */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <label className="block">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        Avg wall height (ft)
                      </div>
                      <input
                        type="number"
                        step="0.5"
                        min="6"
                        max="40"
                        className="input text-sm"
                        placeholder="9 = 1-story · 18 = 2-story"
                        value={wallHeight}
                        onChange={(e) => setWallHeight(e.target.value)}
                        data-testid="ai-measure-wall-height"
                      />
                    </label>
                    <label className="block">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        Siding coverage (%)
                      </div>
                      <input
                        type="number"
                        step="5"
                        min="0"
                        max="100"
                        className="input text-sm"
                        placeholder="100 = all siding · 60 = part brick"
                        value={sidingPct}
                        onChange={(e) => setSidingPct(e.target.value)}
                        data-testid="ai-measure-siding-pct"
                      />
                    </label>
                  </div>
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
                    </details>
                  )}
                </>
              )}
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-between items-center">
              <div className="text-[10px] text-[#A1A1AA]">
                Powered by Claude Sonnet 4.5
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
                {!preview ? (
                  <button
                    type="button"
                    onClick={runMeasure}
                    disabled={busy || photoUrls.length === 0 || files.length > 0}
                    className="px-3 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                    data-testid="ai-measure-run-btn"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {busy ? "Analyzing…" : files.length > 0 ? "Uploading…" : "Run AI Measure"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setRefineOpen(true)}
                      disabled={busy}
                      className="px-3 py-2 bg-white text-[#0EA5E9] border border-[#0EA5E9] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                      data-testid="ai-measure-refine-btn"
                      title="Pick one of your photos and tap-measure to override specific values"
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      Refine on Photo
                    </button>
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
      {/* Child modal: tap-on-photo refinement. Overrides any subset of
          the AI measurements with hand-measured values. The AI photos
          are handed down via prefillFiles so the user can skip the
          re-upload step. */}
      <PhotoMeasureButton
        hideTrigger
        externalOpen={refineOpen}
        onExternalClose={() => setRefineOpen(false)}
        prefillFiles={files}
        onApply={async ({ measurements: refined }) => {
          // Merge: any non-zero refined value overrides the AI's number.
          setPreview((prev) => {
            if (!prev) return prev;
            const next = { ...prev.measurements };
            for (const [k, v] of Object.entries(refined || {})) {
              if (k.startsWith("_")) continue;
              if (v && Number(v) > 0) next[k] = v;
            }
            return { ...prev, measurements: next };
          });
          setRefineOpen(false);
          toast.success("Refined measurements merged into AI estimate");
        }}
      />
    </div>
  );
}
