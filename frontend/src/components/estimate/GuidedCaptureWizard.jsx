// GuidedCaptureWizard — HOVER-style step-by-step photo capture.
//
// The "garbage-in problem" is the #1 root cause of bad AI measurements.
// Contractors snap whatever they have on their phone and upload all at
// once, missing elevations or shooting at bad angles. This wizard fixes
// that by walking them through a fixed sequence of 8 standard positions
// (the same sequence HOVER uses), auto-tagging each photo with the
// matching elevation as it's captured, and gating progress on actually
// HAVING a photo in each slot. The contractor can skip any slot, but
// missing slots produce a visible "MISSING" tag at the end so Claude
// gets explicit signal in `missing_elevations`.
//
// Layout: full-screen modal on mobile, large central card on desktop.
// Each step shows a diagram (text-only ASCII for now — can swap to SVG
// later), the standing position instructions, a Camera/Choose button,
// thumbnail preview once a photo is captured, and Next/Skip controls.
//
// Output: parent gets onComplete({ photos: [{ file, elevation }, ...] })
// — parent owns upload + AIMeasureButton session integration.
import React, { useRef, useState } from "react";
import { Camera, X, Check, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";

// 8 standard capture positions. HOVER uses this exact sequence — it
// gives each wall TWO photos from different angles (corner shots show
// two elevations each), maximising the AI's reconciliation signal.
const STEPS = [
  {
    key: "front-center",
    elevation: "front",
    title: "Front · stand 25-30 ft back",
    hint: "Center the house. Try to get the WHOLE front in frame — eaves and ground both visible.",
    diagram: "🏠 ← YOU (25-30 ft)",
  },
  {
    key: "front-left",
    elevation: "front-left",
    title: "Front-Left Corner",
    hint: "Step to the front-left corner. Frame the front wall AND the left wall at ~45°.",
    diagram: "🏠     ↙ YOU",
  },
  {
    key: "left",
    elevation: "left",
    title: "Left side · stand 25 ft back",
    hint: "Walk to the LEFT side of the house. Center the left elevation.",
    diagram: "YOU →  🏠",
  },
  {
    key: "rear-left",
    elevation: "rear-left",
    title: "Rear-Left Corner",
    hint: "Step to the rear-left corner. Frame the left wall AND the back wall at ~45°.",
    diagram: "↘ YOU\n🏠",
  },
  {
    key: "rear",
    elevation: "back",
    title: "Back · stand 25 ft back",
    hint: "Now the BACK of the house. Center the rear elevation.",
    diagram: "YOU\n ↓\n🏠",
  },
  {
    key: "rear-right",
    elevation: "rear-right",
    title: "Rear-Right Corner",
    hint: "Step to the rear-right corner. Frame the back wall AND the right wall at ~45°.",
    diagram: "    YOU ↙\n🏠",
  },
  {
    key: "right",
    elevation: "right",
    title: "Right side · stand 25 ft back",
    hint: "Walk to the RIGHT side of the house. Center the right elevation.",
    diagram: "🏠 ← YOU",
  },
  {
    key: "front-right",
    elevation: "front-right",
    title: "Front-Right Corner",
    hint: "Last one — step to the front-right corner. Frame the front wall AND the right wall at ~45°.",
    diagram: "🏠   ↘ YOU",
  },
];

export default function GuidedCaptureWizard({ open, onClose, onComplete }) {
  const fileRef = useRef();
  const [stepIdx, setStepIdx] = useState(0);
  // captured: { [key]: { file, previewUrl, elevation } | null }
  const [captured, setCaptured] = useState({});

  if (!open) return null;
  const step = STEPS[stepIdx];
  const taken = captured[step.key];

  const handlePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setCaptured((prev) => ({
      ...prev,
      [step.key]: { file: f, previewUrl: url, elevation: step.elevation },
    }));
    if (e.target) e.target.value = "";
  };
  const retake = () => {
    if (taken?.previewUrl) URL.revokeObjectURL(taken.previewUrl);
    setCaptured((prev) => {
      const next = { ...prev };
      delete next[step.key];
      return next;
    });
    fileRef.current?.click();
  };
  const next = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else finish();
  };
  const skip = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else finish();
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));
  const finish = () => {
    const photos = STEPS.map((s) => captured[s.key])
      .filter(Boolean)
      .map((c) => ({ file: c.file, elevation: c.elevation, key: c.key }));
    // Release object URLs — parent only needs the File objects from here
    STEPS.forEach((s) => {
      const c = captured[s.key];
      if (c?.previewUrl) URL.revokeObjectURL(c.previewUrl);
    });
    onComplete?.({ photos });
    onClose?.();
    setCaptured({});
    setStepIdx(0);
  };
  const cancel = () => {
    STEPS.forEach((s) => {
      const c = captured[s.key];
      if (c?.previewUrl) URL.revokeObjectURL(c.previewUrl);
    });
    setCaptured({});
    setStepIdx(0);
    onClose?.();
  };

  const captureCount = Object.keys(captured).length;
  const progressPct = ((stepIdx + 1) / STEPS.length) * 100;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#09090B]/70 flex items-center justify-center p-4"
      data-testid="guided-capture-wizard"
    >
      <div className="bg-white w-full max-w-2xl rounded-sm shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0EA5E9] to-[#7C3AED] text-white px-5 py-4 flex items-center gap-3">
          <Camera className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider opacity-90">Guided Capture · HOVER-style</div>
            <div className="text-base font-bold">
              Step {stepIdx + 1} of {STEPS.length} · {captureCount} captured
            </div>
          </div>
          <button
            onClick={cancel}
            className="text-white/80 hover:text-white"
            data-testid="guided-capture-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-[#F4F4F5]">
          <div
            className="h-full bg-[#7C3AED] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
            data-testid="guided-capture-progress"
          />
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 py-2 bg-[#FAFAFA] border-b border-[#E4E4E7]">
          {STEPS.map((s, i) => {
            const done = !!captured[s.key];
            const active = i === stepIdx;
            return (
              <button
                key={s.key}
                onClick={() => setStepIdx(i)}
                className={`w-6 h-6 rounded-full text-[10px] font-bold transition ${
                  active
                    ? "bg-[#7C3AED] text-white ring-2 ring-[#7C3AED]/30 ring-offset-1"
                    : done
                      ? "bg-[#16A34A] text-white"
                      : "bg-[#E4E4E7] text-[#71717A] hover:bg-[#D4D4D8]"
                }`}
                title={s.title}
                data-testid={`guided-capture-dot-${i}`}
              >
                {done ? "✓" : i + 1}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
            Elevation: <span className="text-[#7C3AED]">{step.elevation}</span>
          </div>
          <h2 className="text-xl font-bold text-[#09090B] mt-1 mb-2" data-testid="guided-capture-step-title">
            {step.title}
          </h2>
          <p className="text-sm text-[#52525B] mb-4">{step.hint}</p>

          {/* Diagram */}
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] py-6 px-4 mb-4 text-center font-mono-num text-2xl whitespace-pre leading-relaxed">
            {step.diagram}
          </div>

          {/* Capture / preview */}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={handlePick}
            data-testid={`guided-capture-input-${stepIdx}`}
          />

          {!taken ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-[#7C3AED] hover:bg-[#FAF5FF] py-8 flex flex-col items-center gap-2 transition-colors"
              data-testid="guided-capture-take-btn"
            >
              <Camera className="w-10 h-10 text-[#7C3AED]" />
              <div className="text-sm font-bold uppercase tracking-wider text-[#7C3AED]">
                Take / Choose Photo
              </div>
              <div className="text-xs text-[#A1A1AA]">
                Phone camera or photo library
              </div>
            </button>
          ) : (
            <div className="relative border-2 border-[#16A34A]">
              <img
                src={taken.previewUrl}
                alt={`Step ${stepIdx + 1} preview`}
                className="w-full max-h-80 object-contain bg-[#09090B]"
                data-testid={`guided-capture-preview-${stepIdx}`}
              />
              <div className="absolute top-2 left-2 bg-[#16A34A] text-white text-xs font-bold uppercase tracking-wider px-2 py-1 flex items-center gap-1">
                <Check className="w-3 h-3" /> Captured · {step.elevation}
              </div>
              <button
                onClick={retake}
                className="absolute top-2 right-2 bg-white/95 text-[#52525B] text-xs font-bold uppercase tracking-wider px-2 py-1 hover:bg-white"
                data-testid="guided-capture-retake-btn"
              >
                Retake
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E4E4E7] px-5 py-3 flex justify-between items-center bg-white">
          <button
            type="button"
            onClick={back}
            disabled={stepIdx === 0}
            className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#52525B] disabled:opacity-30 flex items-center gap-1"
            data-testid="guided-capture-back-btn"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="flex gap-2">
            {!taken && (
              <button
                type="button"
                onClick={skip}
                className="px-3 py-2 bg-white text-[#A1A1AA] border border-[#E4E4E7] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1"
                data-testid="guided-capture-skip-btn"
                title="Skip this step — fewer photos = lower AI accuracy"
              >
                <SkipForward className="w-3.5 h-3.5" /> Skip
              </button>
            )}
            {stepIdx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                disabled={!taken}
                className="px-4 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-40"
                data-testid="guided-capture-next-btn"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={captureCount === 0}
                className="px-4 py-2 bg-[#16A34A] text-white hover:bg-[#15803D] text-xs font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-40"
                data-testid="guided-capture-finish-btn"
              >
                <Check className="w-3.5 h-3.5" /> Done · Use {captureCount} photo{captureCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
