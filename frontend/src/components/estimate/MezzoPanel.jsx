import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { v4 as uuid } from "uuid";
import { useT, useLang } from "@/lib/i18n";
import { tSection } from "@/lib/catalogTranslations";
import BulkApplyConfirm from "./BulkApplyConfirm";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Default adder auto-applied to every new Mezzo opening (Howard's most-
// common spec). The user can uncheck it or upgrade to the TG2 pack.
const DEFAULT_ADDER = "ClimaTech Plus - 9E";

// ClimaTech Plus-9E and ClimaTech TG2 Plus are mutually exclusive glass
// packages — picking one always removes the other from an opening.
const EXCLUSIVE_PAIR = {
  "ClimaTech Plus - 9E": "ClimaTech TG2 Plus",
  "ClimaTech TG2 Plus": "ClimaTech Plus - 9E",
};

// Howard's preferred adder display order (independent of catalog/Excel order).
// Row 1 (most common): glass packs + color + grid. Row 2: situational extras.
const ADDER_ROWS = [
  [
    "ClimaTech Plus - 9E",
    "ClimaTech TG2 Plus",
    "Extruded Beige or Clay",
    'Grid - 1" Contour Full',
  ],
  [
    "Obscure Full",
    "Tempered Full",
    "Black Exterior Paint",
    "CHERRY LAMINATE",
    'NAILFIN 1 3/8" W/ J',
  ],
];

// Display-only label overrides — DB keys stay original so the price
// matrix in /branding-admin remains the canonical Alside spelling.
const ADDER_DISPLAY_LABELS = {
  "CHERRY LAMINATE": "Interior Laminate",
  "Black Exterior Paint": "Exterior Paint",
};
const displayAdderLabel = (name) => ADDER_DISPLAY_LABELS[name] || name;

// Iter 37: snap a UI value to the matching bucket (min_ui ≤ UI ≤ max_ui).
const findBucket = (buckets, ui) =>
  (buckets || []).find((b) => b.min_ui <= ui && ui <= b.max_ui) || null;

// Per-opening adder price lookup. Uses the size-bucket matrix for flat
// adders; for sqft adders returns rate × (W × H / 144).
const resolveAdderMat = (adder, productType, w, h) => {
  if (!adder) return 0;
  if (adder.kind === "sqft") {
    return (Number(adder.rate) || 0) * ((Number(w) || 0) * (Number(h) || 0)) / 144;
  }
  const ui = (Number(w) || 0) + (Number(h) || 0);
  const bucket = findBucket(productType.buckets, ui);
  if (!bucket) return 0;
  return Number(adder.prices_by_bucket?.[bucket.label]) || 0;
};

export default function MezzoPanel({ est, update }) {
  const t = useT();
  const { lang } = useLang();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [notesOpen, setNotesOpen] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    axios
      .get(`${API}/mezzo/catalog`)
      .then((r) => alive && setCatalog(r.data))
      .catch(() => alive && setCatalog({ product_types: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Iter 42d: reconcile stale price snapshots once the catalog loads. The
  // HOVER importer creates Mezzo openings with `base_mat: 0`; on the paired
  // estimate the per-row UI renders the live price fine but calc.js totals
  // sum the persisted snapshot fields and show $0 until a recompute pushes
  // a fresh value back. This effect detects the gap and patches once.
  useEffect(() => {
    if (!catalog || !catalog.product_types) return;
    const ops = est?.mezzo_openings || [];
    if (!ops.length) return;
    let dirty = false;
    const next = ops.map((op) => {
      const pt = catalog.product_types.find((p) => p.name === op.product_type);
      if (!pt) return op;
      const ui = (Number(op.width) || 0) + (Number(op.height) || 0);
      const bucket = findBucket(pt.buckets, ui);
      const freshBase = bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0;
      const freshBucketLabel = bucket ? bucket.label : "";
      const freshAdders = (op.adders || []).map((a) => {
        const def = pt.adders.find((x) => x.name === a.name);
        return def ? { ...a, mat: resolveAdderMat(def, pt, op.width, op.height) } : a;
      });
      const adderMatChanged = (op.adders || []).some((a, i) =>
        Math.round(Number(a.mat) || 0) !== Math.round(Number(freshAdders[i]?.mat) || 0)
      );
      if (
        Math.round(Number(op.base_mat) || 0) !== Math.round(freshBase) ||
        (op.bucket_label || "") !== freshBucketLabel ||
        adderMatChanged
      ) {
        dirty = true;
        return { ...op, base_mat: freshBase, bucket_label: freshBucketLabel, adders: freshAdders };
      }
      return op;
    });
    if (dirty) setOpenings(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, est?.mezzo_openings?.length, est?.id]);

  // Group existing openings by product_type so each Mezzo section can
  // render its own openings independently.
  const openingsByType = useMemo(() => {
    const out = {};
    (est?.mezzo_openings || []).forEach((op) => {
      const key = op.product_type;
      if (!out[key]) out[key] = [];
      out[key].push(op);
    });
    return out;
  }, [est?.mezzo_openings]);

  const setOpenings = (next) => update({ mezzo_openings: next });
  // Bulk-apply prompt — fires after the contractor turns an adder ON on
  // one opening; asks "apply to all other uploaded windows?".
  const [bulkPrompt, setBulkPrompt] = useState(null);

  const addOpening = (pt) => {
    // Auto-attach the default ClimaTech Plus - 9E adder. mat=0 here; the
    // moment the contractor enters W/H, updateOpening() re-resolves it
    // against the bucket matrix.
    const defaultDef = pt.adders.find((a) => a.name === DEFAULT_ADDER);
    const op = {
      id: uuid(),
      product_type: pt.name,
      label: "",
      width: 0,
      height: 0,
      qty: 1,
      base_mat: 0,
      bucket_label: "",
      adders: defaultDef
        ? [{ name: defaultDef.name, mat: 0, lab: 0, qty: 1 }]
        : [],
    };
    setOpenings([...(est?.mezzo_openings || []), op]);
    setExpanded((p) => new Set(p).add(op.id));
  };

  const updateOpening = (id, patch) => {
    const next = (est?.mezzo_openings || []).map((op) => {
      if (op.id !== id) return op;
      const merged = { ...op, ...patch };
      // Whenever W/H change, re-resolve bucket + base + every adder mat
      // so the saved snapshot always matches the current matrix.
      const pt = catalog?.product_types?.find((x) => x.name === merged.product_type);
      if (pt) {
        const ui = (Number(merged.width) || 0) + (Number(merged.height) || 0);
        const bucket = findBucket(pt.buckets, ui);
        merged.bucket_label = bucket ? bucket.label : "";
        merged.base_mat = bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0;
        merged.adders = (merged.adders || []).map((a) => {
          const def = pt.adders.find((x) => x.name === a.name);
          return { ...a, mat: resolveAdderMat(def, pt, merged.width, merged.height) };
        });
      }
      return merged;
    });
    setOpenings(next);
  };

  const removeOpening = (id) => {
    setOpenings((est?.mezzo_openings || []).filter((op) => op.id !== id));
  };

  const toggleAdder = (id, adderDef, productType) => {
    let didTurnOn = false;
    const next = (est?.mezzo_openings || []).map((op) => {
      if (op.id !== id) return op;
      const has = (op.adders || []).some((a) => a.name === adderDef.name);
      if (has) {
        return { ...op, adders: op.adders.filter((a) => a.name !== adderDef.name) };
      }
      didTurnOn = true;
      // Turning the adder ON — drop any mutually-exclusive partner first
      // (e.g. selecting ClimaTech TG2 Plus auto-removes ClimaTech Plus - 9E).
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
    // After turning an adder ON, prompt to propagate to every other uploaded
    // opening whose product type defines the same adder name. Adders are
    // resolved per-product-type so we have to look up the adderDef from the
    // OTHER opening's catalog entry (not just reuse the source one — sqft
    // rate × W×H differs per window).
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

  // Apply a single adder selection to every other uploaded opening on this
  // Mezzo tab whose product type defines the same adder name.
  const applyToAll = (sourceId, mapFn) => {
    const next = (est?.mezzo_openings || []).map((op) => {
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
    const all = est?.mezzo_openings || [];
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

  const updateAdderQty = (id, name, qty) => {
    const next = (est?.mezzo_openings || []).map((op) => {
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

  if (loading) {
    return <div className="card p-6 text-sm text-[#71717A]">Loading Mezzo catalog…</div>;
  }
  if (!catalog?.product_types?.length) {
    return (
      <div className="card p-6 text-sm text-[#71717A]" data-testid="mezzo-empty">
        Mezzo catalog isn&apos;t loaded yet.
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
        // Iter 42c: across all openings on this Mezzo tab (not just this
        // product type — adders share names across DH / Slider / Picture),
        // count how many have each adder. Surfaces a "N of 29" badge next
        // to mixed adders so the contractor can spot odd-one-out windows.
        const allOpenings = est?.mezzo_openings || [];
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
            data-testid={`mezzo-section-${pt.name}`}
          >
            <header className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA]">
              <div>
                <div className="section-tag">{tSection(pt.name, lang)}</div>
                <div className="text-[10px] text-[#A1A1AA] mt-0.5">
                  {t(openings.length === 1 ? "win.openingsLabel" : "win.openingsLabelPlural", { n: openings.length })}
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
                  data-testid={`mezzo-add-${pt.name}`}
                >
                  <Plus className="w-3.5 h-3.5" /> {t("win.addOpening")}
                </button>
              </div>
            </header>

            {openings.length === 0 ? (
              <div
                className="px-5 py-8 text-center text-sm text-[#A1A1AA]"
                dangerouslySetInnerHTML={{ __html: t("win.noOpenings") }}
              />
            ) : (
              <div className="divide-y divide-[#E4E4E7]">
                {openings.map((op) => (
                  <OpeningRow
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
        testid="mezzo-bulk-apply-confirm"
      />
    </>
  );
}

function OpeningRow({
  op,
  pt,
  isExpanded,
  isNotesOpen,
  onToggleExpand,
  onToggleNotes,
  onUpdate,
  onRemove,
  onToggleAdder,
  onUpdateAdderQty,
  adderCounts = {},
  totalOpenings = 0,
}) {
  const t = useT();
  const ui = (Number(op.width) || 0) + (Number(op.height) || 0);
  const bucket = findBucket(pt.buckets, ui);
  const inRange = !!bucket && ui > 0;
  const baseMat = bucket ? Number(pt.base_prices[bucket.label]) || 0 : 0;
  const addersTotal = (op.adders || []).reduce(
    (s, a) => s + (Number(a.qty) || 0) * (Number(a.mat) || 0),
    0
  );
  const total = (Number(op.qty) || 0) * baseMat + addersTotal;
  const selectedByName = new Map((op.adders || []).map((a) => [a.name, a]));

  return (
    <div className="px-4 md:px-5 py-3" data-testid={`mezzo-opening-${op.id}`}>
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className="col-span-12 md:col-span-1 text-[11px] uppercase tracking-wider text-[#A1A1AA] font-bold pb-2 md:pb-1">
          #{(op.label || (bucket ? bucket.label : "—"))}
        </div>
        <div className="col-span-4 md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
            {t("win.width")}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.125"
            min="0"
            className="input num h-9 text-sm"
            value={op.width || ""}
            placeholder='in'
            onChange={(e) => onUpdate({ width: Number(e.target.value) || 0 })}
            data-testid={`mezzo-width-${op.id}`}
          />
        </div>
        <div className="col-span-4 md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
            {t("win.height")}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.125"
            min="0"
            className="input num h-9 text-sm"
            value={op.height || ""}
            placeholder='in'
            onChange={(e) => onUpdate({ height: Number(e.target.value) || 0 })}
            data-testid={`mezzo-height-${op.id}`}
          />
        </div>
        <div className="col-span-4 md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
            {t("win.qty")}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            className="input num h-9 text-sm"
            value={op.qty || ""}
            onChange={(e) => onUpdate({ qty: Number(e.target.value) || 0 })}
            data-testid={`mezzo-qty-${op.id}`}
          />
        </div>
        <div className="col-span-4 md:col-span-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
            {t("win.ui")} ({(Number(op.width) || 0)}+{(Number(op.height) || 0)})
          </div>
          <div className={`font-mono-num text-sm font-bold ${inRange ? "text-[#09090B]" : "text-[#DC2626]"}`}>
            {ui > 0 ? ui : "—"} {bucket && <span className="text-[10px] text-[#71717A] font-normal">({bucket.label})</span>}
            {!inRange && ui > 0 && (
              <span className="text-[10px] text-[#DC2626] font-normal block">{t("win.outOfRange")}</span>
            )}
          </div>
        </div>
        <div className="col-span-4 md:col-span-1 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">{t("win.base")}</div>
          <div className="font-mono-num text-sm">{fmt(baseMat)}</div>
        </div>
        <div className="col-span-4 md:col-span-2 text-right">
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">{t("win.total")}</div>
          <div className="font-mono-num text-base font-bold text-[#09090B]">{fmt(total)}</div>
        </div>
        <div className="col-span-12 md:col-span-1 flex md:justify-end gap-1">
          <button
            type="button"
            className="p-1.5 text-[#71717A] hover:text-[#09090B]"
            title={t("win.addNote")}
            onClick={onToggleNotes}
            data-testid={`mezzo-notes-${op.id}`}
          >
            <StickyNote className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-1.5 text-[#71717A] hover:text-[#DC2626]"
            title={t("win.removeOpening")}
            onClick={onRemove}
            data-testid={`mezzo-remove-${op.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isNotesOpen && (
        <div className="mt-2 pl-0 md:pl-[8.333%]">
          <input
            type="text"
            className="input h-8 text-sm"
            placeholder={t("win.notesPlaceholder")}
            value={op.label || ""}
            onChange={(e) => onUpdate({ label: e.target.value })}
            data-testid={`mezzo-label-${op.id}`}
          />
        </div>
      )}

      {inRange && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] font-bold text-[#52525B] hover:text-[#09090B]"
            data-testid={`mezzo-adders-toggle-${op.id}`}
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
                  .map((n) => pt.adders.find((a) => a.name === n))
                  .filter(Boolean);
                if (rowAdders.length === 0) return null;
                return (
                  <div
                    key={`row-${rowIdx}`}
                    className={`grid grid-cols-2 sm:grid-cols-${rowAdders.length} gap-x-4 gap-y-1`}
                    style={{ gridTemplateColumns: `repeat(${rowAdders.length}, minmax(0, 1fr))` }}
                  >
                    {rowAdders.map((a) => {
                      const sel = selectedByName.get(a.name);
                      const checked = !!sel;
                      const adderMat = resolveAdderMat(a, pt, op.width, op.height);
                      const adderQty = checked ? (Number(sel.qty) || 0) : 0;
                      const adderTotal = adderQty * adderMat;
                      const unitHint =
                        a.kind === "sqft"
                          ? `$${(Number(a.rate) || 0).toFixed(2)}/sqft`
                          : adderMat > 0
                            ? `+${fmt(adderMat)}/ea`
                            : "—";
                      const label = displayAdderLabel(a.name);
                      // Iter 42c: surface "applied on N of M" badge when the
                      // adder is in mixed use (some openings have it, others
                      // don't). Skip when uniform (0 or all) — no cognitive
                      // load needed.
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
                          data-testid={`mezzo-adder-${op.id}-${a.name}`}
                        >
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 accent-[#F97316] cursor-pointer flex-shrink-0"
                            checked={checked}
                            onChange={() => onToggleAdder(a)}
                            data-testid={`mezzo-adder-cb-${op.id}-${a.name}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={`leading-tight flex items-center gap-1.5 ${checked ? "font-semibold" : ""}`}>
                              <span className="truncate" title={label}>{label}</span>
                              {mixed && (
                                <span
                                  className="text-[9px] font-mono-num bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] px-1 py-px tracking-tight flex-shrink-0 normal-case font-bold"
                                  title={`Applied on ${usedOn} of ${totalOpenings} windows`}
                                  data-testid={`mezzo-adder-usage-${a.name.replace(/[^a-zA-Z0-9]/g, "_")}`}
                                >
                                  {usedOn}/{totalOpenings}
                                </span>
                              )}
                            </div>
                            <div className="font-mono-num text-[10px] text-[#71717A] truncate">
                              {checked ? (adderTotal > 0 ? `+${fmt(adderTotal)} total` : "—") : unitHint}
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
                              data-testid={`mezzo-adder-qty-${op.id}-${a.name}`}
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
