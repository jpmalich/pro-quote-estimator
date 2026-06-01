import React from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Lightbulb } from "lucide-react";
import { fmt } from "@/lib/api";
import { useT, useLang } from "@/lib/i18n";
import { tSection, tItem, tUnit } from "@/lib/catalogTranslations";
import { isCommonlyNeeded, unfilledCommonCount } from "@/lib/commonItems";

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
  onField,
  onResetLine,
  est,
  update,
  activeTab = "vinyl",
}) {
  const t = useT();
  const { lang } = useLang();
  const isMiscLab = section.title === MISC_LABOR_SECTION;
  const isMiscMat = section.title === MISC_MATERIAL_SECTION;
  const miscKey = isMiscLab ? "misc_labor" : isMiscMat ? "misc_material" : null;
  // Misc rows are scoped per tab — each tab keeps its own custom labor /
  // custom material entries so multi-product quotes don't bleed into each
  // other.
  const allMiscRows = miscKey ? est[miscKey] || [] : [];
  const miscRows = allMiscRows.filter((r) => (r.tab || "vinyl") === activeTab);

  const sectionSell =
    lines.reduce((sum, l) => sum + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)), 0) +
    miscRows.reduce((s, m) => s + (m.mat || 0) + (m.lab || 0), 0);

  const filledCount = lines.filter((l) => (l.qty || 0) > 0).length + miscRows.length;
  // Yellow flag pill: shown on the collapsed section header so contractors
  // know which categories have commonly-needed items they haven't quoted yet.
  const unfilledCommon = unfilledCommonCount(lines);

  const addMisc = () => {
    const newRow = isMiscMat
      ? { _id: crypto.randomUUID(), desc: "", mat: 0, lab: 0, tab: activeTab }
      : { _id: crypto.randomUUID(), desc: "", lab: 0, tab: activeTab };
    update({ [miscKey]: [...allMiscRows, newRow] });
  };
  const updateMisc = (idx, key, val) => {
    // `idx` is an index into the FILTERED (tab-scoped) rows. Translate it
    // back to the full array before mutating so other tabs' misc rows are
    // not disturbed.
    const target = miscRows[idx];
    const next = allMiscRows.map((r) =>
      r === target ? { ...r, [key]: key === "desc" ? val : Number(val) || 0 } : r
    );
    update({ [miscKey]: next });
  };
  const removeMisc = (idx) => {
    const target = miscRows[idx];
    update({ [miscKey]: allMiscRows.filter((r) => r !== target) });
  };

  return (
    <section className="card mb-4" data-testid={`section-${section.title}`}>
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="section-tag">{tSection(section.title, lang)}</span>
          {filledCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 border border-[#F97316] text-[#F97316]">
              {t("est.itemsBadge", { n: filledCount })}
            </span>
          )}
          {unfilledCommon > 0 && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 bg-yellow-100 border border-yellow-400 text-yellow-900 flex items-center gap-1"
              title="Commonly-needed items in this section haven't been quoted yet"
              data-testid={`common-flag-${section.title}`}
            >
              <Lightbulb className="w-3 h-3" />
              {unfilledCommon}
            </span>
          )}
        </div>
        <div className="font-mono-num text-sm text-[#52525B]">{fmt(sectionSell)}</div>
      </button>
      {isOpen && (
        <div className="border-t border-[#E4E4E7]">
          <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold border-b border-[#E4E4E7]">
            <div className="col-span-5">{t("est.col.item")}</div>
            <div className="col-span-1">{t("est.col.unit")}</div>
            <div className="col-span-2 text-right">{t("est.col.mat")}</div>
            <div className="col-span-1 text-right">{t("est.col.qty")}</div>
            <div className="col-span-1 text-right">{t("est.col.lab")}</div>
            <div className="col-span-2 text-right">{t("est.col.total")}</div>
          </div>
          {lines.map((l) => {
            const total = (l.qty || 0) * ((l.mat || 0) + (l.lab || 0));
            const labOverridden = l.defaultLab != null && Number(l.lab) !== Number(l.defaultLab);
            const isCommon = isCommonlyNeeded(l.name);
            const isUnfilledCommon = isCommon && (l.qty || 0) <= 0;
            return (
              <div
                key={`${l.tab}::${l.name}`}
                className={`grid grid-cols-12 gap-3 px-4 md:px-5 py-3 md:py-2 border-b border-[#E4E4E7] items-center ${
                  isUnfilledCommon ? "bg-yellow-50" : ""
                }`}
                data-testid={`row-${section.title}-${l.name}`}
              >
                <div className="col-span-12 md:col-span-5">
                  <div className="text-sm font-semibold md:font-normal text-[#09090B] flex items-center gap-2 flex-wrap">
                    {isCommon && (
                      <Lightbulb
                        className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0"
                        title="Commonly needed — review qty"
                      />
                    )}
                    {tItem(l.name, lang)}
                    {l.ami_part && (
                      <span
                        className="ml-2 inline-block font-mono-num text-[10px] tracking-wider text-[#71717A] bg-[#F4F4F5] border border-[#E4E4E7] px-1.5 py-0.5 rounded-sm"
                        title="Alside part number"
                        data-testid={`ami-${section.title}-${l.name}`}
                      >
                        AMI #{l.ami_part}
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-3 md:col-span-1 text-xs text-[#A1A1AA] uppercase tracking-wider">
                  <span className="md:hidden text-[10px] text-[#A1A1AA] block">{t("est.col.unit")}</span>
                  {tUnit(l.unit, lang)}
                </div>
                <div className="col-span-3 md:col-span-2 text-right text-sm font-mono-num text-[#52525B]">
                  <span className="md:hidden text-[10px] text-[#A1A1AA] block text-right">{t("est.col.mat")}</span>
                  {fmt(l.mat)}
                </div>
                <div className="col-span-3 md:col-span-1">
                  <label className="md:hidden text-[10px] text-[#A1A1AA] block uppercase tracking-wider mb-1">{t("est.col.qty")}</label>
                  <input
                    className="input num h-11 md:h-9 text-base md:text-sm w-full"
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    value={l.qty || ""}
                    placeholder="0"
                    onChange={(e) => onQty(l.tab, l.section, l.name, e.target.value)}
                    data-testid={`qty-${section.title}-${l.name}`}
                  />
                </div>
                <div className="col-span-3 md:col-span-1 relative">
                  <label className="md:hidden text-[10px] text-[#A1A1AA] block uppercase tracking-wider mb-1">{t("est.col.lab")}</label>
                  <input
                    className={`input num h-11 md:h-9 text-base md:text-sm w-full ${labOverridden ? "border-[#F97316] bg-orange-50" : ""}`}
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min="0"
                    value={l.lab ?? 0}
                    onChange={(e) => onField(l.tab, l.section, l.name, "lab", e.target.value)}
                    title={labOverridden ? `Catalog default: $${l.defaultLab}` : ""}
                    data-testid={`lab-${section.title}-${l.name}`}
                  />
                  {labOverridden && (
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 w-5 h-5 md:w-4 md:h-4 rounded-full bg-[#F97316] text-white text-xs md:text-[10px] leading-none flex items-center justify-center"
                      onClick={() => onResetLine(l.tab, l.section, l.name)}
                      title={`Reset to catalog default ($${l.defaultLab})`}
                      data-testid={`reset-lab-${section.title}-${l.name}`}
                    >
                      ↺
                    </button>
                  )}
                </div>
                <div className="col-span-12 md:col-span-2 text-right font-mono-num text-base md:text-sm font-bold md:font-semibold text-[#09090B] pt-2 md:pt-0 border-t md:border-t-0 border-[#F4F4F5]">
                  <span className="md:hidden text-[10px] text-[#A1A1AA] uppercase tracking-wider mr-2">{t("est.col.total")}</span>
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
                  <div className="col-span-6">{t("est.customDesc")}</div>
                  {isMiscMat && <div className="col-span-2 text-right">{t("cat.col.material")}</div>}
                  <div className={`col-span-${isMiscMat ? 2 : 4} text-right`}>{t("cat.col.labor")}</div>
                  <div className="col-span-2 text-right">{t("est.col.total")}</div>
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
                      placeholder={t("est.customDescPlaceholder")}
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
                      aria-label={t("est.removeMisc")}
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
                  <Plus className="w-4 h-4" /> {t("est.addCustomLine")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
