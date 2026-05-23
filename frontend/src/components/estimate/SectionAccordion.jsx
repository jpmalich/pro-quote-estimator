import React from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { fmt } from "@/lib/api";

/**
 * Renders one collapsible section.
 * Categories matching "Misc. Labor Only" and "Misc. Labor & Material" also
 * render a list of ad-hoc rows (misc_labor / misc_material).
 */
const MISC_LABOR_SECTION = "Misc. Labor Only";
const MISC_MATERIAL_SECTION = "Misc. Labor & Material";

export default function SectionAccordion({
  section,
  lines,
  isOpen,
  onToggle,
  onQty,
  est,
  update,
}) {
  const isMiscLab = section.title === MISC_LABOR_SECTION;
  const isMiscMat = section.title === MISC_MATERIAL_SECTION;
  const miscKey = isMiscLab ? "misc_labor" : isMiscMat ? "misc_material" : null;
  const miscRows = miscKey ? est[miscKey] || [] : [];

  const sectionSell =
    lines.reduce((sum, l) => sum + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)), 0) +
    miscRows.reduce((s, m) => s + (m.mat || 0) + (m.lab || 0), 0);

  const filledCount = lines.filter((l) => (l.qty || 0) > 0).length + miscRows.length;

  const addMisc = () => {
    const newRow = isMiscMat
      ? { _id: crypto.randomUUID(), desc: "", mat: 0, lab: 0 }
      : { _id: crypto.randomUUID(), desc: "", lab: 0 };
    update({ [miscKey]: [...miscRows, newRow] });
  };
  const updateMisc = (idx, key, val) => {
    const next = miscRows.map((r, i) =>
      i === idx ? { ...r, [key]: key === "desc" ? val : Number(val) || 0 } : r
    );
    update({ [miscKey]: next });
  };
  const removeMisc = (idx) => {
    update({ [miscKey]: miscRows.filter((_, i) => i !== idx) });
  };

  return (
    <section className="card mb-4" data-testid={`section-${section.title}`}>
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="section-tag">{section.title}</span>
          {filledCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 border border-[#F97316] text-[#F97316]">
              {filledCount} items
            </span>
          )}
        </div>
        <div className="font-mono-num text-sm text-[#52525B]">{fmt(sectionSell)}</div>
      </button>
      {isOpen && (
        <div className="border-t border-[#E4E4E7]">
          <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold border-b border-[#E4E4E7]">
            <div className="col-span-5">Item</div>
            <div className="col-span-1">Unit</div>
            <div className="col-span-2 text-right">Mat $</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-1 text-right">Lab $</div>
            <div className="col-span-2 text-right">Total</div>
          </div>
          {lines.map((l) => {
            const total = (l.qty || 0) * ((l.mat || 0) + (l.lab || 0));
            return (
              <div
                key={l.name}
                className="grid grid-cols-12 gap-3 px-5 py-2 border-b border-[#E4E4E7] items-center"
              >
                <div className="col-span-12 md:col-span-5 text-sm text-[#09090B]">{l.name}</div>
                <div className="col-span-3 md:col-span-1 text-xs text-[#A1A1AA] uppercase tracking-wider">
                  {l.unit}
                </div>
                <div className="col-span-3 md:col-span-2 text-right text-sm font-mono-num text-[#52525B]">
                  {fmt(l.mat)}
                </div>
                <div className="col-span-6 md:col-span-1">
                  <input
                    className="input num h-10 sm:h-9"
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={l.qty || ""}
                    placeholder="0"
                    onChange={(e) => onQty(l.section, l.name, e.target.value)}
                    data-testid={`qty-${section.title}-${l.name}`}
                  />
                </div>
                <div className="col-span-6 md:col-span-1 text-right text-sm font-mono-num text-[#52525B]">
                  {fmt(l.lab)}
                </div>
                <div className="col-span-12 md:col-span-2 text-right font-mono-num text-sm font-semibold text-[#09090B]">
                  {fmt(total)}
                </div>
              </div>
            );
          })}

          {/* Misc / ad-hoc rows */}
          {miscKey && (
            <>
              {miscRows.length > 0 && (
                <div className="hidden md:grid grid-cols-12 gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold">
                  <div className="col-span-6">Custom Description</div>
                  {isMiscMat && <div className="col-span-2 text-right">Material $</div>}
                  <div className={`col-span-${isMiscMat ? 2 : 4} text-right`}>Labor $</div>
                  <div className="col-span-2 text-right">Total</div>
                </div>
              )}
              {miscRows.map((r, i) => {
                const rowTotal = (r.mat || 0) + (r.lab || 0);
                return (
                  <div
                    key={r._id || i}
                    className="grid grid-cols-12 gap-3 px-5 py-2 border-b border-[#E4E4E7] items-center bg-[#FAFAFA]"
                    data-testid={`misc-row-${section.title}-${i}`}
                  >
                    <input
                      className="input col-span-12 md:col-span-6"
                      value={r.desc}
                      placeholder="Custom item description"
                      onChange={(e) => updateMisc(i, "desc", e.target.value)}
                      data-testid={`misc-desc-${section.title}-${i}`}
                    />
                    {isMiscMat && (
                      <input
                        className="input num col-span-4 md:col-span-2"
                        type="number"
                        step="0.01"
                        value={r.mat}
                        onChange={(e) => updateMisc(i, "mat", e.target.value)}
                        data-testid={`misc-mat-${section.title}-${i}`}
                      />
                    )}
                    <input
                      className={`input num col-span-${isMiscMat ? 4 : 8} md:col-span-${isMiscMat ? 2 : 4}`}
                      type="number"
                      step="0.01"
                      value={r.lab}
                      onChange={(e) => updateMisc(i, "lab", e.target.value)}
                      data-testid={`misc-lab-${section.title}-${i}`}
                    />
                    <div className="col-span-3 md:col-span-1 text-right font-mono-num text-sm font-semibold text-[#09090B]">
                      {fmt(rowTotal)}
                    </div>
                    <button
                      className="btn-danger col-span-1 justify-self-end"
                      onClick={() => removeMisc(i)}
                      aria-label="Remove misc row"
                      data-testid={`misc-remove-${section.title}-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
              <div className="px-5 py-3">
                <button
                  className="btn-ghost border border-dashed border-[#A1A1AA] hover:border-[#09090B] hover:text-[#09090B] w-full justify-center"
                  onClick={addMisc}
                  data-testid={`add-misc-${section.title}`}
                >
                  <Plus className="w-4 h-4" /> Add custom line
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
