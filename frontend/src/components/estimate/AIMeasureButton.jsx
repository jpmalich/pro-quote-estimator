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
import React, { useRef, useState } from "react";
import { Sparkles, X, Check, Loader2, AlertTriangle, Camera, Upload, Ruler } from "lucide-react";
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

export default function AIMeasureButton({ kind, onApply, address }) {
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const [refDim, setRefDim] = useState("");
  const [wallHeight, setWallHeight] = useState("");
  const [sidingPct, setSidingPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // {measurements, raw_ai}
  const [refineOpen, setRefineOpen] = useState(false);

  const pickFiles = (e) => {
    const arr = Array.from(e.target.files || []).slice(0, 8);
    setFiles(arr);
  };

  const runMeasure = async () => {
    if (!files.length) {
      toast.error("Add at least one photo");
      return;
    }
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
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
      const { data } = await api.post("/measure/ai-measure", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      setPreview(data);
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
      // Pass the full preview {measurements, lines, vero_openings, raw_ai}
      // so the page can choose how to merge. ISS uses just measurements;
      // siding/windows merge `lines` directly.
      await onApply(preview);
      toast.success("AI measurements applied — verify all quantities before quoting");
      // Close the modal but KEEP state — re-opening AI Measure lets the
      // contractor add more photos / refine more values without starting
      // over. State is wiped only when the user explicitly cancels via
      // the "Start Over" button.
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

  // Explicit "Start Over" button — wipes everything.
  const startOver = () => {
    if (busy) return;
    setPreview(null);
    setFiles([]);
    setRefDim("");
    setWallHeight("");
    setSidingPct("");
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
                      >
                        Choose / Take Photos
                      </button>
                      <div className="text-[10px] text-[#A1A1AA] mt-1">
                        Tip: front, back, left, right elevations + any tricky corners
                      </div>
                      {files.length > 0 && (
                        <div className="mt-3 text-xs text-[#52525B]" data-testid="ai-measure-file-count">
                          {files.length} photo{files.length === 1 ? "" : "s"} selected
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
                    <details className="text-xs mb-3">
                      <summary className="cursor-pointer text-[#7C3AED] font-bold uppercase tracking-wider">
                        Wall breakdown ({preview.raw_ai.walls.length})
                      </summary>
                      <table className="w-full mt-2 text-xs">
                        <thead className="text-left text-[#A1A1AA] uppercase tracking-wider text-[10px]">
                          <tr><th>Wall</th><th>W (ft)</th><th>H (ft)</th><th>Area (ft²)</th></tr>
                        </thead>
                        <tbody>
                          {preview.raw_ai.walls.map((w, i) => (
                            <tr key={i} className="border-b border-[#F4F4F5]">
                              <td className="py-1">{w.label}</td>
                              <td className="font-mono-num">{w.width_ft}</td>
                              <td className="font-mono-num">{w.height_ft}</td>
                              <td className="font-mono-num">{((w.width_ft||0)*(w.height_ft||0)).toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
                {(preview || files.length > 0) && (
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
                    disabled={busy || files.length === 0}
                    className="px-3 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                    data-testid="ai-measure-run-btn"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {busy ? "Analyzing…" : "Run AI Measure"}
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
          the AI measurements with hand-measured values. */}
      <PhotoMeasureButton
        hideTrigger
        externalOpen={refineOpen}
        onExternalClose={() => setRefineOpen(false)}
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
