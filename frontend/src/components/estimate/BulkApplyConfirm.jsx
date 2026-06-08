import React from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Confirm prompt asking the contractor whether the just-changed upgrade
 * option should propagate to every other uploaded window opening on the
 * same brand tab. Triggered by the glass / tempered / premium / adder
 * toggles in VeroPanel and MezzoPanel.
 *
 * Props:
 *   open           — visible?
 *   optionLabel    — human-readable upgrade name ("ClimaTech Plus")
 *   targetCount    — # of OTHER openings the same option will apply to
 *   onApplyAll     — yes — propagate
 *   onSkip         — no — leave the single opening edit only
 *   testid         — DOM hook for the modal container
 */
export default function BulkApplyConfirm({
  open,
  optionLabel,
  targetCount,
  onApplyAll,
  onSkip,
  testid = "bulk-apply-confirm",
}) {
  const t = useT();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center px-4"
      onClick={onSkip}
      data-testid={`${testid}-backdrop`}
    >
      <div
        className="bg-white max-w-md w-full border border-[#09090B] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
      >
        <div className="flex items-center justify-between border-b border-[#E4E4E7] px-5 py-3">
          <div className="text-sm uppercase tracking-[0.18em] font-bold text-[#09090B]">
            {t("win.bulkApply.title")}
          </div>
          <button
            type="button"
            className="p-1 text-[#71717A] hover:text-[#09090B]"
            onClick={onSkip}
            data-testid={`${testid}-close`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm text-[#09090B] leading-relaxed">
            {t("win.bulkApply.body", { option: optionLabel, count: targetCount })}
          </p>
          <p className="text-[11px] text-[#71717A] mt-2 leading-snug">
            {t("win.bulkApply.hint")}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#E4E4E7] px-5 py-3">
          <button
            type="button"
            className="px-3 py-2 text-xs uppercase tracking-wider font-bold text-[#52525B] hover:text-[#09090B]"
            onClick={onSkip}
            data-testid={`${testid}-skip`}
          >
            {t("win.bulkApply.skip")}
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-[#F97316] text-white border border-[#F97316] hover:bg-[#EA580C] text-xs font-bold uppercase tracking-wider"
            onClick={onApplyAll}
            data-testid={`${testid}-apply`}
          >
            {t("win.bulkApply.applyAll", { count: targetCount })}
          </button>
        </div>
      </div>
    </div>
  );
}
