import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import DOMPurify from "dompurify";
import { Plus, Trash2, X, ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { v4 as uuid } from "uuid";
import { useT, useLang } from "@/lib/i18n";
import { tSection } from "@/lib/catalogTranslations";
import BulkApplyConfirm from "./BulkApplyConfirm";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const DEFAULT_SISTER_COLOR = "White Interior/White Exterior";

// Auto-applied on every new Vero opening (Howard's most-common spec).
const DEFAULT_ADDER = "Climatech Plus";

// Mutually-exclusive adder pairs. Selecting one auto-removes the other.
const EXCLUSIVE_PAIR = {
  "Climatech Plus": "Climatech TG2 Plus",
  "Climatech TG2 Plus": "Climatech Plus",
  "Climatech Plus Tempered": "Climatech TG2 Tempered",
  "Climatech TG2 Tempered": "Climatech Plus Tempered",
};

// Howard's preferred adder display order (Iter 44 conversation).
// Row 1 = most common · Row 2 = second-tier · Row 3 = situational.
const ADDER_ROWS = [
  ["Climatech Plus", "Solid Color Flat Grids", "Head Expander", "Sentry System"],
  ["Obscure Full", "Climatech TG2 Plus", "Foam Wrap", "Foam Frame"],
  ["Climatech Plus Tempered", "Climatech TG2 Tempered", "Integral Nailing Fin", "Oriel Style Double Hung"],
];

const findBucket = (buckets, ui) =>
  (buckets || []).find((b) => b.min_ui <= ui && ui <= b.max_ui) || null;

// Per-opening adder price lookup. Vero adders are all "flat" bucket-priced.
const resolveAdderMat = (adder, productType, w, h) => {
  if (!adder) return 0;
  const ui = (Number(w) || 0) + (Number(h) || 0);
  const bucket = findBucket(productType.buckets, ui);
  if (!bucket) return 0;
  return Number(adder.prices_by_bucket?.[bucket.label]) || 0;
};

export default function VeroPanel({ est, update }) {
  const t = useT();
  const { lang } = useLang();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [notesOpen, setNotesOpen] = useState(() => new Set());
  const [bulkPrompt, setBulkPrompt] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    axios
      .get(`${API}/vero/catalog`)
      .then((r) => alive && setCatalog(r.data))
      .catch(() => alive && setCatalog({ product_types: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Iter 44: reconcile stale snapshots + migrate legacy openings from the
  // old (glass_package / tempered_upcharge / premium_options) shape onto
  // the new (adders[]) shape so historical estimates keep their totals.
  useEffect(() => {
    if (!catalog || !catalog.product_types) return;
    const ops = est?.vero_openings || [];
    if (!ops.length) return;
    let dirty = false;
    const next = ops.map((op) => {
      const pt = catalog.product_types.find((p) => p.name === op.product_type);
      if (!pt) return op;
      let work = op;

      // Snap stale sister_color to a valid value.
      const sisters = pt.sister_colors || [];
      if (sisters.length && !sisters.includes(op.sister_color)) {
        work = { ...work, sister_color: sisters.includes(DEFAULT_SISTER_COLOR) ? DEFAULT_SISTER_COLOR : sisters[0] };
      }

      // Strip removed legacy fields (clean migration).
      if (work.glass_package || work.tempered_upcharge || (work.premium_options || []).length) {
        work = { ...work, glass_package: "", tempered_upcharge: "", premium_options: [], glass_mat: 0, tempered_mat: 0, premium_mat: 0 };
      }

      // Recompute base + adder mats from current catalog.
      if (pt.sizing === "ui_bucket") {
        const ui = (Number(work.width) || 0) + (Number(work.height) || 0);
        const bucket = findBucket(pt.buckets, ui);
        const freshBase = bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0;
        const freshBucketLabel = bucket ? bucket.label : "";
        const freshAdders = (work.adders || []).map((a) => {
          const def = (pt.adders || []).find((x) => x.name === a.name);
          return def ? { ...a, mat: resolveAdderMat(def, pt, work.width, work.height) } : a;
        });
        // Drop adders the new catalog no longer defines.
        const validAdders = freshAdders.filter((a) => (pt.adders || []).some((x) => x.name === a.name));
        const matChanged = (work.adders || []).some((a, i) =>
          Math.round(Number(a.mat) || 0) !== Math.round(Number(freshAdders[i]?.mat) || 0)
        );
        if (
          work !== op ||
          Math.round(Number(op.base_mat) || 0) !== Math.round(freshBase) ||
          (op.bucket_label || "") !== freshBucketLabel ||
          matChanged ||
          validAdders.length !== (work.adders || []).length
        ) {
          dirty = true;
          return { ...work, base_mat: freshBase, bucket_label: freshBucketLabel, adders: validAdders };
        }
      } else {
        // fixed_model (Patio Door): just recompute base from model.
        const freshBase = Number(pt.patio_prices?.[work.model] || 0);
        if (work !== op || Math.round(Number(op.base_mat) || 0) !== Math.round(freshBase)) {
          dirty = true;
          return { ...work, base_mat: freshBase, adders: [] };
        }
      }
      return op;
    });
    if (dirty) setOpenings(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, est?.vero_openings?.length, est?.id]);

  const openingsByType = useMemo(() => {
    const out = {};
    (est?.vero_openings || []).forEach((op) => {
      const key = op.product_type;
      if (!out[key]) out[key] = [];
      out[key].push(op);
    });
    return out;
  }, [est?.vero_openings]);

  const setOpenings = (next) => update({ vero_openings: next });

  const addOpening = (pt) => {
    const defaultDef = (pt.adders || []).find((a) => a.name === DEFAULT_ADDER);
    const isFixed = pt.sizing === "fixed_model";
    const model = isFixed ? (pt.models?.[0] || "") : "";
    const base_mat = isFixed ? Number(pt.patio_prices?.[model] || 0) : 0;
    const op = {
      id: uuid(),
      product_type: pt.name,
      sizing: pt.sizing,
      label: "",
      width: 0,
      height: 0,
      model,
      qty: 1,
      sister_color: pt.sister_colors?.includes(DEFAULT_SISTER_COLOR)
        ? DEFAULT_SISTER_COLOR
        : (pt.sister_colors?.[0] || ""),
      base_mat,
      bucket_label: "",
      adders: !isFixed && defaultDef
        ? [{ name: defaultDef.name, mat: 0, lab: 0, qty: 1 }]
        : [],
    };
    setOpenings([...(est?.vero_openings || []), op]);
    setExpanded((p) => new Set(p).add(op.id));
  };

  const updateOpening = (id, patch) => {
    const next = (est?.vero_openings || []).map((op) => {
      if (op.id !== id) return op;
      const merged = { ...op, ...patch };
      const pt = catalog?.product_types?.find((x) => x.name === merged.product_type);
      if (pt) {
        if (pt.sizing === "ui_bucket") {
          const ui = (Number(merged.width) || 0) + (Number(merged.height) || 0);
          const bucket = findBucket(pt.buckets, ui);
          merged.bucket_label = bucket ? bucket.label : "";
          merged.base_mat = bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0;
          merged.adders = (merged.adders || []).map((a) => {
            const def = (pt.adders || []).find((x) => x.name === a.name);
            return def ? { ...a, mat: resolveAdderMat(def, pt, merged.width, merged.height) } : a;
          });
        } else {
          merged.base_mat = Number(pt.patio_prices?.[merged.model] || 0);
        }
      }
      return merged;
    });
    setOpenings(next);
  };

  const removeOpening = (id) => {
    setOpenings((est?.vero_openings || []).filter((op) => op.id !== id));
    setExpanded((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  };

  const toggleAdder = (id, adderDef, productType) => {
    let didTurnOn = false;
    const next = (est?.vero_openings || []).map((op) => {
      if (op.id !== id) return op;
      const has = (op.adders || []).some((a) => a.name === adderDef.name);
      if (has) {
        return { ...op, adders: op.adders.filter((a) => a.name !== adderDef.name) };
      }
      didTurnOn = true;
      const exclude = EXCLUSIVE_PAIR[adderDef.name];
      const cleanedExisting = exclude
        ? (op.adders || []).filter((a) => a.name !== exclude)
        : op.adders || [];
      return {
        ...op,
        adders: [
          ...cleanedExisting,
          {
            name: adderDef.name,
            mat: resolveAdderMat(adderDef, productType, op.width, op.height),
            lab: 0,
            qty: Number(op.qty) || 1,
          },
        ],
      };
    });
    setOpenings(next);
    if (didTurnOn) {
      maybeOfferBulkApply({
        sourceId: id,
        optionLabel: adderDef.name,
        applyToOpening: (other, otherPt) => {
          const otherDef = (otherPt?.adders || []).find((a) => a.name === adderDef.name);
          if (!otherDef) return null;
          if ((other.adders || []).some((a) => a.name === adderDef.name)) return null;
          const exclude = EXCLUSIVE_PAIR[adderDef.name];
          const cleaned = exclude
            ? (other.adders || []).filter((a) => a.name !== exclude)
            : other.adders || [];
          return {
            adders: [
              ...cleaned,
              {
                name: adderDef.name,
                mat: resolveAdderMat(otherDef, otherPt, other.width, other.height),
                lab: 0,
                qty: Number(other.qty) || 1,
              },
            ],
          };
        },
      });
    }
  };

  const updateAdderQty = (id, name, qty) => {
    const next = (est?.vero_openings || []).map((op) => {
      if (op.id !== id) return op;
      return {
        ...op,
        adders: (op.adders || []).map((a) =>
          a.name === name ? { ...a, qty: Number(qty) || 0 } : a
        ),
      };
    });
    setOpenings(next);
  };

  const applyToAll = (sourceId, mapFn) => {
    const next = (est?.vero_openings || []).map((op) => {
      if (op.id === sourceId) return op;
      const pt = catalog?.product_types?.find((p) => p.name === op.product_type);
      if (!pt) return op;
      const patch = mapFn(op, pt);
      if (!patch) return op;
      return { ...op, ...patch };
    });
    setOpenings(next);
  };

  const maybeOfferBulkApply = ({ sourceId, optionLabel, applyToOpening }) => {
    const all = est?.vero_openings || [];
    const otherCount = all.filter((o) => o.id !== sourceId).length;
    if (otherCount < 1) return;
    setBulkPrompt({
      optionLabel,
      targetCount: otherCount,
      onApplyAll: () => {
        applyToAll(sourceId, applyToOpening);
        setBulkPrompt(null);
      },
      onSkip: () => setBulkPrompt(null),
    });
  };

  if (loading) {
    return <div className="card p-6 text-sm text-[#71717A]">{t("common.loading")}</div>;
  }
  if (!catalog?.product_types?.length) {
    return (
      <div className="card p-6 text-sm text-[#71717A]" data-testid="vero-empty">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <>
      {catalog.product_types.map((pt) => {
        const openings = openingsByType[pt.name] || [];
        const sectionTotal = openings.reduce((s, op) => {
          const base = (Number(op.qty) || 0) * (Number(op.base_mat) || 0);
          const ads = (op.adders || []).reduce(
            (a, x) => a + (Number(x.qty) || 0) * (Number(x.mat) || 0),
            0
          );
          return s + base + ads;
        }, 0);
        const isFixed = pt.sizing === "fixed_model";
        const allOpenings = est?.vero_openings || [];
        const totalOpenings = allOpenings.length;
        const adderCounts = {};
        for (const o of allOpenings) {
          for (const ad of o.adders || []) {
            adderCounts[ad.name] = (adderCounts[ad.name] || 0) + 1;
          }
        }
        return (
          <section
            key={pt.name}
            className="card mb-4"
            data-testid={`vero-section-${pt.name}`}
          >
            <header className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA]">
              <div>
                <div className="section-tag">{tSection(pt.name, lang)}</div>
                <div className="text-[10px] text-[#A1A1AA] mt-0.5">
                  {t(
                    isFixed
                      ? (openings.length === 1 ? "win.openingsLabelFixed" : "win.openingsLabelFixedPlural")
                      : (openings.length === 1 ? "win.openingsLabel" : "win.openingsLabelPlural"),
                    { n: openings.length }
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono-num text-sm text-[#52525B]">
                  {fmt(sectionTotal)}
                </span>
                <button
                  type="button"
                  className="px-3 py-1.5 bg-[#09090B] text-white hover:bg-[#27272A] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                  onClick={() => addOpening(pt)}
                  data-testid={`vero-add-${pt.name}`}
                >
                  <Plus className="w-3.5 h-3.5" /> {t("win.addOpening")}
                </button>
              </div>
            </header>

            {openings.length === 0 ? (
              <div
                className="px-5 py-8 text-center text-sm text-[#A1A1AA]"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("win.noOpenings")) }}
              />
            ) : (
              <div className="divide-y divide-[#E4E4E7]">
                {openings.map((op) => (
                  <VeroOpeningRow
                    key={op.id}
                    op={op}
                    pt={pt}
                    isExpanded={expanded.has(op.id)}
                    isNotesOpen={notesOpen.has(op.id)}
                    onToggleExpand={() =>
                      setExpanded((p) => {
                        const n = new Set(p);
                        if (n.has(op.id)) n.delete(op.id);
                        else n.add(op.id);
                        return n;
                      })
                    }
                    onToggleNotes={() =>
                      setNotesOpen((p) => {
                        const n = new Set(p);
                        if (n.has(op.id)) n.delete(op.id);
                        else n.add(op.id);
                        return n;
                      })
                    }
                    onUpdate={(patch) => updateOpening(op.id, patch)}
                    onRemove={() => removeOpening(op.id)}
                    onToggleAdder={(def) => toggleAdder(op.id, def, pt)}
                    onUpdateAdderQty={(name, qty) => updateAdderQty(op.id, name, qty)}
                    adderCounts={adderCounts}
                    totalOpenings={totalOpenings}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      <BulkApplyConfirm
        open={!!bulkPrompt}
        optionLabel={bulkPrompt?.optionLabel || ""}
        targetCount={bulkPrompt?.targetCount || 0}
        onApplyAll={() => bulkPrompt?.onApplyAll?.()}
        onSkip={() => bulkPrompt?.onSkip?.()}
        testid="vero-bulk-apply-confirm"
      />
    </>
  );
}

function VeroOpeningRow({
  op, pt, isExpanded, isNotesOpen,
  onToggleExpand, onToggleNotes, onUpdate, onRemove, onToggleAdder, onUpdateAdderQty,
  adderCounts = {}, totalOpenings = 0,
}) {
  const t = useT();
  const isFixed = pt.sizing === "fixed_model";
  const ui = isFixed ? 0 : (Number(op.width) || 0) + (Number(op.height) || 0);
  const bucket = isFixed ? null : findBucket(pt.buckets, ui);
  const inRange = isFixed || (!!bucket && ui > 0);
  const baseMat = isFixed
    ? Number(pt.patio_prices?.[op.model] || 0)
    : (bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0);
  const addersTotal = (op.adders || []).reduce(
    (s, a) => s + (Number(a.qty) || 0) * (Number(a.mat) || 0),
    0
  );
  const total = (Number(op.qty) || 0) * baseMat + addersTotal;
  const selectedByName = new Map((op.adders || []).map((a) => [a.name, a]));

  return (
    <div className="px-4 md:px-5 py-3" data-testid={`vero-opening-${op.id}`}>
      <div className="flex items-center gap-3 flex-wrap">
        {!isFixed && (
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold w-[80px] text-right pr-1 hidden md:block">
            {bucket ? `#${bucket.label}` : "—"}
          </div>
        )}
        {isFixed ? (
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">{t("win.model")}</label>
            <select
              className="input h-9 text-sm w-full"
              value={op.model || ""}
              onChange={(e) => onUpdate({ model: e.target.value })}
              data-testid={`vero-model-${op.id}`}
            >
              {(pt.models || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <NumField
              label={t("win.width")}
              value={op.width}
              onChange={(v) => onUpdate({ width: v })}
              testid={`vero-width-${op.id}`}
            />
            <NumField
              label={t("win.height")}
              value={op.height}
              onChange={(v) => onUpdate({ height: v })}
              testid={`vero-height-${op.id}`}
            />
          </>
        )}
        <NumField
          label={t("win.qty")}
          value={op.qty}
          onChange={(v) => onUpdate({ qty: v })}
          testid={`vero-qty-${op.id}`}
          minWidth={64}
          isQty
        />
        {!isFixed && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-0.5">{t("win.ui")} ({Number(op.width) || 0}+{Number(op.height) || 0})</div>
            <div
              className={`font-mono-num text-sm font-bold ${
                inRange ? "text-[#09090B]" : ui > 0 ? "text-[#DC2626]" : "text-[#A1A1AA]"
              }`}
              data-testid={`vero-ui-${op.id}`}
            >
              {ui || "—"} {bucket ? <span className="text-[10px] text-[#71717A] font-normal">({bucket.label})</span> : ui > 0 ? <span className="text-[10px] text-[#DC2626] font-normal">{t("win.outOfRange")}</span> : null}
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">{t("win.base")}</div>
            <div className="font-mono-num text-sm text-[#09090B]">{fmt(baseMat)}</div>
          </div>
          <div className="text-right pl-2 border-l border-[#E4E4E7]">
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">{t("win.total")}</div>
            <div className="font-mono-num text-base font-bold text-[#09090B]" data-testid={`vero-total-${op.id}`}>
              {fmt(total)}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleNotes}
            className="text-[#71717A] hover:text-[#09090B] p-1"
            title={t("win.addNote")}
            data-testid={`vero-notes-toggle-${op.id}`}
          >
            <StickyNote className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[#DC2626] hover:text-[#991B1B] p-1"
            title={t("win.removeOpening")}
            data-testid={`vero-remove-${op.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isNotesOpen && (
        <div className="mt-2 flex items-center gap-2">
          <input
            className="input h-8 text-xs flex-1"
            placeholder={t("win.notesPlaceholder")}
            value={op.label || ""}
            onChange={(e) => onUpdate({ label: e.target.value })}
            data-testid={`vero-label-${op.id}`}
          />
          <button
            type="button"
            className="text-[#71717A] hover:text-[#09090B] p-1"
            onClick={onToggleNotes}
            title={t("win.hideNotes")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {inRange && !isFixed && (pt.adders || []).length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] font-bold text-[#52525B] hover:text-[#09090B]"
            data-testid={`vero-adders-toggle-${op.id}`}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {t("win.upgradeOptions")}
            {(op.adders || []).length > 0 && (
              <span className="bg-[#F97316] text-white px-2 py-0.5 text-[10px] tracking-wider font-bold normal-case">
                {op.adders.length}
              </span>
            )}
            <span className="font-mono-num text-[#52525B] normal-case tracking-normal ml-1">
              {addersTotal > 0 ? `+${fmt(addersTotal)}` : ""}
            </span>
          </button>
          {isExpanded && (
            <div className="mt-2 pl-5 pb-2 space-y-2">
              {ADDER_ROWS.map((rowNames, rowIdx) => {
                const rowAdders = rowNames
                  .map((n) => (pt.adders || []).find((a) => a.name === n))
                  .filter(Boolean);
                if (rowAdders.length === 0) return null;
                return (
                  <div
                    key={`row-${rowIdx}`}
                    className="grid gap-x-4 gap-y-1"
                    style={{ gridTemplateColumns: `repeat(${rowAdders.length}, minmax(0, 1fr))` }}
                  >
                    {rowAdders.map((a) => {
                      const sel = selectedByName.get(a.name);
                      const checked = !!sel;
                      const adderMat = resolveAdderMat(a, pt, op.width, op.height);
                      const adderQty = checked ? (Number(sel.qty) || 0) : 0;
                      const adderTotalCell = adderQty * adderMat;
                      const unitHint = adderMat > 0 ? `+${fmt(adderMat)}/ea` : "—";
                      const usedOn = adderCounts[a.name] || 0;
                      const mixed = usedOn > 0 && usedOn < totalOpenings;
                      return (
                        <div
                          key={a.name}
                          className={`flex items-center gap-1.5 py-1.5 px-2 border ${
                            checked
                              ? "border-[#F97316] bg-[#FFF7ED] text-[#09090B]"
                              : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#FAFAFA]"
                          } text-[12px]`}
                          data-testid={`vero-adder-${op.id}-${a.name.replace(/[^a-zA-Z0-9]/g, "_")}`}
                        >
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 accent-[#F97316] cursor-pointer flex-shrink-0"
                            checked={checked}
                            onChange={() => onToggleAdder(a)}
                            data-testid={`vero-adder-cb-${op.id}-${a.name.replace(/[^a-zA-Z0-9]/g, "_")}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={`leading-tight flex items-center gap-1.5 ${checked ? "font-semibold" : ""}`}>
                              <span className="truncate" title={a.name}>{a.name}</span>
                              {mixed && (
                                <span
                                  className="text-[9px] font-mono-num bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] px-1 py-px tracking-tight flex-shrink-0 normal-case font-bold"
                                  title={`Applied on ${usedOn} of ${totalOpenings} windows`}
                                >
                                  {usedOn}/{totalOpenings}
                                </span>
                              )}
                            </div>
                            <div className="font-mono-num text-[10px] text-[#71717A] truncate">
                              {checked ? (adderTotalCell > 0 ? `+${fmt(adderTotalCell)} total` : "—") : unitHint}
                            </div>
                          </div>
                          {checked && (
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="1"
                              value={adderQty || ""}
                              placeholder={`${Number(op.qty) || 0}`}
                              onChange={(ev) => onUpdateAdderQty(a.name, ev.target.value)}
                              className="bg-white border border-[#E4E4E7] focus:border-[#F97316] outline-none h-7 text-xs w-12 px-1.5 text-right flex-shrink-0 font-mono-num"
                              data-testid={`vero-adder-qty-${op.id}-${a.name.replace(/[^a-zA-Z0-9]/g, "_")}`}
                              title={t("win.qty")}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, testid, minWidth = 78, isQty = false }) {
  return (
    <div style={{ minWidth }}>
      <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        className="input num h-9 text-sm text-center w-full"
        min="0"
        step={isQty ? "1" : "0.125"}
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        data-testid={testid}
      />
    </div>
  );
}
