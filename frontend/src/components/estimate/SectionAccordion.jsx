import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Lightbulb } from "lucide-react";
import ItemHelpButton from "./ItemHelpButton";
import { fmt } from "@/lib/api";
import { useT, useLang } from "@/lib/i18n";
import { tSection, tItem, tUnit } from "@/lib/catalogTranslations";
import { isCommonOnTab, unfilledCommonCount } from "@/lib/commonItems";
import { groupLinesBySubCategory } from "@/lib/subCategories";

/**
 * Renders one collapsible section.
 * Categories matching "Misc. Labor Only" and "Misc. Labor & Material" also
 * render a list of ad-hoc rows (misc_labor / misc_material).
 */
const MISC_LABOR_SECTION = "Misc. Labor Only";
const MISC_MATERIAL_SECTION = "Misc. Labor & Material";

// Sections (other than the dedicated Misc sections above) that opt-in to
// editable "Add custom line" rows. The custom rows piggy-back on the
// existing `misc_material` storage but are tagged with `section` so they
// render under the opted-in section instead of Misc. Labor & Material.
//
// Currently: Window Installation only. Add more section titles here when
// contractors want freeform line items anywhere else.
const CUSTOM_LINE_SECTIONS = new Set([
  "Window Installation",
]);

// Whitelist of catalog items whose Material price the contractor can edit
// inline (just like Labor). Most items use the catalog's fixed price, but
// some (e.g. "Window Package Price") are job-specific bundles that need
// to be priced per quote.
const EDITABLE_MAT_ITEMS = new Set([
  "Vero Window Quote",
  "Vero - Sliding glass door Custom Size",
]);

export default function SectionAccordion({
  section,
  lines,
  isOpen,
  onToggle,
  onQty,
  onField,
  onResetLine,
  onToggleAdder,
  onUpdateAdderQty,
  est,
  update,
  activeTab = "vinyl",
}) {
  const t = useT();
  const { lang } = useLang();
  const isMiscLab = section.title === MISC_LABOR_SECTION;
  const isMiscMat = section.title === MISC_MATERIAL_SECTION;
  const allowsCustomLines = CUSTOM_LINE_SECTIONS.has(section.title);
  // Whether to show the Material column on the editable misc rows. True
  // for the dedicated "Misc. Labor & Material" section AND any
  // CUSTOM_LINE_SECTIONS (Window Installation, etc.). "Misc. Labor Only"
  // shows labor only.
  const showMatCol = section.title === MISC_MATERIAL_SECTION || CUSTOM_LINE_SECTIONS.has(section.title);
  // For Misc sections, miscKey is the legacy storage key. For
  // CUSTOM_LINE_SECTIONS we use the same misc_material storage so all the
  // editable mat+lab+desc + add/remove plumbing is shared.
  const miscKey = isMiscLab
    ? "misc_labor"
    : isMiscMat || allowsCustomLines
    ? "misc_material"
    : null;
  // Misc rows are scoped per tab — each tab keeps its own custom labor /
  // custom material entries so multi-product quotes don't bleed into each
  // other. CUSTOM_LINE_SECTIONS are additionally scoped by `section` so
  // a Window-Installation custom line doesn't leak into the dedicated
  // Misc. Labor & Material section (or vice-versa).
  const allMiscRows = miscKey ? est[miscKey] || [] : [];
  const miscRows = allMiscRows.filter((r) => {
    if ((r.tab || "vinyl") !== activeTab) return false;
    const rowSection = r.section || "";
    if (allowsCustomLines) {
      return rowSection === section.title;
    }
    // Legacy Misc sections claim rows with no section tag (back-compat)
    // OR rows explicitly tagged with this misc title.
    return !rowSection || rowSection === section.title;
  });

  const sectionSell =
    // Iter 36: include selected adders (with their own qty) in the
    // section header total so toggling/qty'ing an upgrade visibly bumps
    // the section subtotal.
    lines.reduce((sum, l) => {
      const adders = Array.isArray(l.adders) ? l.adders : [];
      const aMat = adders.reduce((s, a) => s + (Number(a.qty) || 0) * (Number(a.mat) || 0), 0);
      const aLab = adders.reduce((s, a) => s + (Number(a.qty) || 0) * (Number(a.lab) || 0), 0);
      return sum + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)) + aMat + aLab;
    }, 0) +
    miscRows.reduce((s, m) => s + (m.mat || 0) + (m.lab || 0), 0);

  const filledCount = lines.filter((l) => (l.qty || 0) > 0).length + miscRows.length;
  // Yellow flag pill: shown on the collapsed section header so contractors
  // know which categories have commonly-needed items they haven't quoted yet.
  // Tab-scoped so the Ascend tab doesn't show flags for vinyl-style
  // accessories that aren't really "common" on that tab.
  const unfilledCommon = unfilledCommonCount(lines, activeTab);

  const addMisc = () => {
    // CUSTOM_LINE_SECTIONS always emit material+labor rows (Window Install
    // contractors want to bill both mat and lab for upcharges); legacy
    // Misc. Labor & Material keeps the same shape. Misc. Labor Only emits
    // a labor-only row. Section tag stamped so filtering above stays
    // correct when contractors flip between tabs/sections.
    const wantsMat = isMiscMat || allowsCustomLines;
    const newRow = wantsMat
      ? {
          _id: crypto.randomUUID(),
          desc: "",
          mat: 0,
          lab: 0,
          tab: activeTab,
          section: section.title,
        }
      : {
          _id: crypto.randomUUID(),
          desc: "",
          lab: 0,
          tab: activeTab,
          section: section.title,
        };
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

  // Sub-category support (currently only Vinyl Siding splits by brand).
  // openSubs tracks which nested drop-downs are expanded; defaults to the
  // Charter Oak brand expanded since it's the most-quoted siding line.
  const subGroups = groupLinesBySubCategory(section.title, lines);
  const [openSubs, setOpenSubs] = useState(() => {
    if (!subGroups) return new Set();
    // Prefer Charter Oak when present (Vinyl Siding); otherwise fall back
    // to the first sub-category so the section is never visually empty.
    const charter = subGroups.find((g) => g.id === "charter");
    return new Set([(charter || subGroups[0]).id]);
  });
  const toggleSub = (id) =>
    setOpenSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Iter 36: track which window lines have their adder block expanded.
  // Keyed by `${l.tab}::${l.name}` so multiple lines with the same name
  // across tabs stay independent.
  const [openAdders, setOpenAdders] = useState(() => new Set());
  const toggleAddersOpen = (key) =>
    setOpenAdders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderLine = (l) => {
    // Iter 36: per-line adders now carry their OWN qty (a 10-window
    // line can have only 3 tempered glass etc). Subtotals = base
    // line.qty * (mat+lab) PLUS adder.qty * (mat+lab) per selected adder.
    const lineAdders = Array.isArray(l.adders) ? l.adders : [];
    const adderMatSubtotal = lineAdders.reduce(
      (s, a) => s + (Number(a.qty) || 0) * (Number(a.mat) || 0), 0
    );
    const adderLabSubtotal = lineAdders.reduce(
      (s, a) => s + (Number(a.qty) || 0) * (Number(a.lab) || 0), 0
    );
    const total = (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)) + adderMatSubtotal + adderLabSubtotal;
    const labOverridden = l.defaultLab != null && Number(l.lab) !== Number(l.defaultLab);
    const isCommon = isCommonOnTab(l.name, activeTab);
    // The catalog ships per-section adders for window-product sections.
    // Only show the toggle row when the section actually has adders and
    // the line has a qty (no point picking upgrades on an empty row).
    const sectionAdders = Array.isArray(section.adders) ? section.adders : [];
    const showAdderUI = sectionAdders.length > 0 && (l.qty || 0) > 0;
    const adderKey = `${l.tab}::${l.name}`;
    const isAdderOpen = openAdders.has(adderKey);
    // Map of adder.name -> saved entry so we can read qty cheaply.
    const selectedByName = new Map(lineAdders.map((a) => [a.name, a]));
    return (
      <React.Fragment key={adderKey}>
      <div
        className={`grid grid-cols-12 gap-3 px-4 md:px-5 py-3 md:py-2 border-b border-[#E4E4E7] items-center ${
          isCommon ? "bg-yellow-50" : ""
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
            <ItemHelpButton itemName={l.name} />
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
          {EDITABLE_MAT_ITEMS.has(l.name) ? (
            <div className="relative">
              <input
                className={`input num h-11 md:h-9 text-base md:text-sm w-full text-right ${
                  l.defaultMat != null && Number(l.mat) !== Number(l.defaultMat)
                    ? "border-[#F97316] bg-orange-50"
                    : ""
                }`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={l.mat ?? 0}
                onChange={(e) => onField(l.tab, l.section, l.name, "mat", e.target.value)}
                data-testid={`mat-${section.title}-${l.name}`}
              />
              {l.defaultMat != null && Number(l.mat) !== Number(l.defaultMat) && (
                <button
                  type="button"
                  className="absolute -top-1 -right-1 w-5 h-5 md:w-4 md:h-4 rounded-full bg-[#F97316] text-white text-xs md:text-[10px] leading-none flex items-center justify-center"
                  onClick={() =>
                    onField(l.tab, l.section, l.name, "mat", l.defaultMat ?? 0)
                  }
                  title={`Reset to catalog default ($${l.defaultMat ?? 0})`}
                  data-testid={`reset-mat-${section.title}-${l.name}`}
                >
                  ↺
                </button>
              )}
            </div>
          ) : (
            fmt(l.mat)
          )}
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
          {/* Iter 78k (2026-02-25): Howard reversed the Iter 69 vinyl/ascend
              labor lockdown — labor is now editable on ALL siding tabs
              (vinyl, ascend, lp_smart) and windows. Single editable input
              with override styling shared across every tab. */}
          <>
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
          </>
        </div>
        <div className="col-span-12 md:col-span-2 text-right font-mono-num text-base md:text-sm font-bold md:font-semibold text-[#09090B] pt-2 md:pt-0 border-t md:border-t-0 border-[#F4F4F5]">
          <span className="md:hidden text-[10px] text-[#A1A1AA] uppercase tracking-wider mr-2">{t("est.col.total")}</span>
          {fmt(total)}
        </div>
      </div>
      {showAdderUI && (
        <div className="border-b border-[#E4E4E7] bg-[#FAFAFA]" data-testid={`adder-block-${l.name}`}>
          <button
            type="button"
            onClick={() => toggleAddersOpen(adderKey)}
            className="w-full flex items-center justify-between px-4 md:px-5 py-2 text-left text-[11px] uppercase tracking-[0.18em] text-[#52525B] hover:text-[#09090B]"
            data-testid={`adder-toggle-${l.name}`}
          >
            <span className="flex items-center gap-2">
              {isAdderOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Upgrade Options
              {lineAdders.length > 0 && (
                <span className="bg-[#F97316] text-white px-2 py-0.5 text-[10px] tracking-wider font-bold normal-case">
                  {lineAdders.length}
                </span>
              )}
            </span>
            <span className="font-mono-num text-[11px] text-[#52525B] normal-case tracking-normal">
              {adderMatSubtotal + adderLabSubtotal > 0
                ? `+${fmt(adderMatSubtotal + adderLabSubtotal)}`
                : ""}
            </span>
          </button>
          {isAdderOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 px-4 md:px-8 pb-3 pt-1">
              {sectionAdders.map((a) => {
                const selected = selectedByName.get(a.name);
                const checked = !!selected;
                const adderQty = checked ? Number(selected.qty) || 0 : 0;
                const unitCost = (Number(a.mat) || 0) + (Number(a.lab) || 0);
                const adderTotal = adderQty * unitCost;
                return (
                  <div
                    key={a.name}
                    className={`flex items-center gap-2.5 py-1.5 border-b border-[#EDEDF0] last:border-b-0 text-[13px] ${
                      checked ? "text-[#09090B] font-semibold" : "text-[#3F3F46]"
                    }`}
                    data-testid={`adder-option-${l.name}-${a.name}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#F97316] flex-shrink-0 cursor-pointer"
                      checked={checked}
                      onChange={() =>
                        onToggleAdder && onToggleAdder(l.tab, l.section, l.name, a)
                      }
                      data-testid={`adder-checkbox-${l.name}-${a.name}`}
                    />
                    <span className="flex-1 leading-snug">{a.name}</span>
                    {checked ? (
                      <>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="1"
                          value={adderQty || ""}
                          placeholder={`${Number(l.qty) || 0}`}
                          onChange={(ev) =>
                            onUpdateAdderQty &&
                            onUpdateAdderQty(l.tab, l.section, l.name, a.name, ev.target.value)
                          }
                          className="input num h-7 text-xs w-14 text-right"
                          title={`Of ${Number(l.qty) || 0} ${l.name.includes("Door") ? "doors" : "windows"}, how many get this`}
                          data-testid={`adder-qty-${l.name}-${a.name}`}
                        />
                        <span className="font-mono-num text-[11px] text-[#71717A] whitespace-nowrap w-16 text-right">
                          {adderTotal > 0 ? `+${fmt(adderTotal)}` : "—"}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono-num text-[11px] text-[#71717A] whitespace-nowrap">
                        {unitCost > 0 ? `+${fmt(unitCost)}/ea` : "—"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </React.Fragment>
    );
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
          {subGroups
            ? subGroups.map((g) => {
                const isOpenSub = openSubs.has(g.id);
                const subFilled = g.lines.filter((l) => (l.qty || 0) > 0).length;
                const subTotal = g.lines.reduce(
                  (s, l) => s + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)),
                  0
                );
                const subUnfilled = g.lines.filter(
                  (l) => isCommonOnTab(l.name, activeTab) && (l.qty || 0) <= 0
                ).length;
                return (
                  <div key={g.id} className="border-b border-[#E4E4E7]" data-testid={`subcat-${g.id}`}>
                    <button
                      type="button"
                      onClick={() => toggleSub(g.id)}
                      className="w-full flex items-center justify-between px-5 py-2.5 text-left bg-[#FAFAFA] hover:bg-[#F4F4F5]"
                      data-testid={`subcat-toggle-${g.id}`}
                    >
                      <div className="flex items-center gap-2.5">
                        {isOpenSub ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#71717A]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#71717A]" />
                        )}
                        <span className="text-xs uppercase tracking-[0.14em] font-semibold text-[#3F3F46]">
                          {g.label}
                        </span>
                        <span className="text-[10px] text-[#A1A1AA] font-mono-num">
                          {g.lines.length}
                        </span>
                        {subFilled > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 border border-[#F97316] text-[#F97316]">
                            {t("est.itemsBadge", { n: subFilled })}
                          </span>
                        )}
                        {subUnfilled > 0 && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 bg-yellow-100 border border-yellow-400 text-yellow-900 flex items-center gap-1"
                            title="Commonly-needed items in this sub-category haven't been quoted yet"
                          >
                            <Lightbulb className="w-3 h-3" />
                            {subUnfilled}
                          </span>
                        )}
                      </div>
                      <div className="font-mono-num text-xs text-[#52525B]">{fmt(subTotal)}</div>
                    </button>
                    {isOpenSub && <div>{g.lines.map(renderLine)}</div>}
                  </div>
                );
              })
            : lines.map(renderLine)}

          {/* Misc / ad-hoc rows */}
          {miscKey && (
            <>
              {miscRows.length > 0 && (
                <div className="hidden md:grid grid-cols-12 gap-3 px-5 pt-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold">
                  <div className="col-span-6">{t("est.customDesc")}</div>
                  {showMatCol && <div className="col-span-2 text-right">{t("cat.col.material")}</div>}
                  <div className={`col-span-${showMatCol ? 2 : 4} text-right`}>{t("cat.col.labor")}</div>
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
                    {showMatCol && (
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
                      className={`input num col-span-${showMatCol ? 4 : 8} md:col-span-${showMatCol ? 2 : 4}`}
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
