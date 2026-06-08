import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Plus, Trash2, X, ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { v4 as uuid } from "uuid";
import { useT, useLang } from "@/lib/i18n";
import { tSection } from "@/lib/catalogTranslations";
import BulkApplyConfirm from "./BulkApplyConfirm";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Default sister color seeded onto every new Vero opening (most-common
// spec per Howard). Contractor can switch it in the per-opening picker.
const DEFAULT_SISTER_COLOR = "White Interior/White Exterior";

// Snap a UI value to the matching bucket (min_ui ≤ UI ≤ max_ui).
const findBucket = (buckets, ui) =>
  (buckets || []).find((b) => b.min_ui <= ui && ui <= b.max_ui) || null;

// Resolve all per-opening derived numbers from the catalog.
//   bucket  → which size bucket (W+H sums to UI)
//   base    → base_prices[bucket][sister_color]
//   glass   → glass_packages[glass_package][bucket]   (0 if none picked)
//   temp    → tempered[tempered_upcharge][bucket]     (0 if none picked)
//   premium → SUM premium_options[name][bucket] for every selected name
function resolveBucketOpening(pt, op) {
  const ui = (Number(op.width) || 0) + (Number(op.height) || 0);
  const bucket = findBucket(pt.buckets, ui);
  if (!bucket) {
    return { ui, bucket: null, base: 0, glass: 0, temp: 0, premium: 0 };
  }
  const bucketLabel = bucket.label;
  const base = Number(pt.base_prices?.[bucketLabel]?.[op.sister_color]) || 0;
  const glass = op.glass_package
    ? Number(pt.glass_packages?.[op.glass_package]?.[bucketLabel]) || 0
    : 0;
  const temp = op.tempered_upcharge
    ? Number(pt.tempered?.[op.tempered_upcharge]?.[bucketLabel]) || 0
    : 0;
  const premium = (op.premium_options || []).reduce(
    (s, name) => s + (Number(pt.premium_options?.[name]?.[bucketLabel]) || 0),
    0
  );
  return { ui, bucket, base, glass, temp, premium };
}

// Patio Door — uses fixed model + sister color + optional glass package.
function resolveFixedOpening(pt, op) {
  const base = Number(pt.patio_prices?.[op.model]?.[op.sister_color]) || 0;
  const glass = op.glass_package
    ? Number(pt.glass_packages?.[op.glass_package]?.[op.model]) || 0
    : 0;
  return { base, glass, temp: 0, premium: 0 };
}

export default function VeroPanel({ est, update }) {
  const t = useT();
  const { lang } = useLang();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [notesOpen, setNotesOpen] = useState(() => new Set());
  // Bulk-apply prompt state — fires after the contractor toggles an upgrade
  // option (glass / tempered / premium) on one opening, asks "apply to all
  // other uploaded windows?". Null = no prompt visible.
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

  // Iter 42d: reconcile stale price snapshots once the catalog loads. The
  // HOVER importer creates Vero openings with `base_mat: 0` (it can't know
  // the catalog price client-side); when those land on the paired estimate
  // the per-row UI renders the live price fine but the totals (calc.js)
  // sum the persisted snapshot fields and show $0. This effect detects
  // missing/stale snapshots and pushes a one-time recompute to the parent.
  useEffect(() => {
    if (!catalog || !catalog.product_types) return;
    const ops = est?.vero_openings || [];
    if (!ops.length) return;
    let dirty = false;
    const next = ops.map((op) => {
      const pt = catalog.product_types.find((p) => p.name === op.product_type);
      if (!pt) return op;
      // Snap stale sister_color to a valid value (e.g. Tan→White after the
      // catalog was reduced to a single color option).
      let work = op;
      const sisters = pt.sister_colors || [];
      if (sisters.length && !sisters.includes(op.sister_color)) {
        work = { ...op, sister_color: sisters.includes(DEFAULT_SISTER_COLOR) ? DEFAULT_SISTER_COLOR : sisters[0] };
      }
      // Filter out premium_options that no longer exist in the catalog
      // (e.g. after dropping legacy SKUs from the pricebook).
      const validPremiums = Object.keys(pt.premium_options || {});
      if (Array.isArray(work.premium_options) && work.premium_options.length) {
        const cleaned = work.premium_options.filter((n) => validPremiums.includes(n));
        if (cleaned.length !== work.premium_options.length) {
          work = { ...work, premium_options: cleaned };
        }
      }
      // Reset glass_package / tempered_upcharge if their name was removed
      if (work.glass_package && !Object.keys(pt.glass_packages || {}).includes(work.glass_package)) {
        work = { ...work, glass_package: "" };
      }
      if (work.tempered_upcharge && !Object.keys(pt.tempered || {}).includes(work.tempered_upcharge)) {
        work = { ...work, tempered_upcharge: "" };
      }
      const fresh = recomputeOpening(work, pt);
      if (
        work !== op ||
        Math.round(Number(op.base_mat) || 0) !== Math.round(Number(fresh.base_mat) || 0) ||
        Math.round(Number(op.glass_mat) || 0) !== Math.round(Number(fresh.glass_mat) || 0) ||
        Math.round(Number(op.tempered_mat) || 0) !== Math.round(Number(fresh.tempered_mat) || 0) ||
        Math.round(Number(op.premium_mat) || 0) !== Math.round(Number(fresh.premium_mat) || 0) ||
        (op.bucket_label || "") !== (fresh.bucket_label || "")
      ) {
        dirty = true;
        return fresh;
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
    const op = {
      id: uuid(),
      product_type: pt.name,
      sizing: pt.sizing,
      label: "",
      width: 0,
      height: 0,
      model: pt.sizing === "fixed_model" ? (pt.models?.[0] || "") : "",
      qty: 1,
      sister_color: pt.sister_colors?.includes(DEFAULT_SISTER_COLOR)
        ? DEFAULT_SISTER_COLOR
        : (pt.sister_colors?.[0] || ""),
      glass_package: "",
      tempered_upcharge: "",
      premium_options: [],
      bucket_label: "",
      base_mat: 0,
      glass_mat: 0,
      tempered_mat: 0,
      premium_mat: 0,
    };
    // Snap an initial price snapshot so the snapshot/totals reflect the
    // resolvable defaults (esp. Patio Door — model + sister color are
    // chosen at add-time, so the base is known immediately).
    const seeded = recomputeOpening(op, pt);
    setOpenings([...(est?.vero_openings || []), seeded]);
    setExpanded((p) => new Set(p).add(seeded.id));
  };

  // Recompute opening price snapshot whenever any input changes. The
  // snapshot fields (bucket_label / base_mat / glass_mat / tempered_mat /
  // premium_mat) are what calc.js sums and what backend stores.
  const recomputeOpening = (op, pt) => {
    if (pt.sizing === "fixed_model") {
      const { base, glass } = resolveFixedOpening(pt, op);
      return { ...op, base_mat: base, glass_mat: glass, tempered_mat: 0, premium_mat: 0, bucket_label: "" };
    }
    const { bucket, base, glass, temp, premium } = resolveBucketOpening(pt, op);
    return {
      ...op,
      bucket_label: bucket?.label || "",
      base_mat: base,
      glass_mat: glass,
      tempered_mat: temp,
      premium_mat: premium,
    };
  };

  const updateOpening = (id, patch) => {
    const pt = catalog?.product_types?.find(
      (p) => p.name === (est?.vero_openings?.find((o) => o.id === id)?.product_type)
    );
    const next = (est?.vero_openings || []).map((op) =>
      op.id === id ? recomputeOpening({ ...op, ...patch }, pt) : op
    );
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

  const togglePremiumOption = (id, name) => {
    const op = (est?.vero_openings || []).find((o) => o.id === id);
    if (!op) return;
    const have = (op.premium_options || []).includes(name);
    const next = have
      ? (op.premium_options || []).filter((n) => n !== name)
      : [...(op.premium_options || []), name];
    updateOpening(id, { premium_options: next });
    // After turning a premium ON, ask if it should propagate to every other
    // opening whose product type supports the same option.
    if (!have) {
      maybeOfferBulkApply({
        sourceId: id,
        optionLabel: name,
        applyToOpening: (other, otherPt) => {
          if (!otherPt?.premium_options || otherPt.premium_options[name] == null) return null;
          if ((other.premium_options || []).includes(name)) return null;
          return { premium_options: [...(other.premium_options || []), name] };
        },
      });
    }
  };

  // Apply a single upgrade selection across every other uploaded opening
  // whose product type supports the same option. `mapFn(other, otherPt)`
  // returns the patch for each opening (or null to skip).
  const applyToAll = (sourceId, mapFn) => {
    const next = (est?.vero_openings || []).map((op) => {
      if (op.id === sourceId) return op;
      const pt = catalog?.product_types?.find((p) => p.name === op.product_type);
      if (!pt) return op;
      const patch = mapFn(op, pt);
      if (!patch) return op;
      return recomputeOpening({ ...op, ...patch }, pt);
    });
    setOpenings(next);
  };

  // Open the confirm modal only when there are other uploaded openings to
  // apply to (zero or one window → no prompt). `applyToOpening` is the
  // per-opening patch builder (returns null = skip).
  const maybeOfferBulkApply = ({ sourceId, optionLabel, applyToOpening }) => {
    const allOpenings = est?.vero_openings || [];
    const otherCount = allOpenings.filter((o) => o.id !== sourceId).length;
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

  // Wrapper around updateOpening: detects glass / tempered selection and
  // surfaces the bulk-apply prompt after the single-opening update lands.
  const handleEditorUpdate = (id, patch) => {
    updateOpening(id, patch);
    if (patch.glass_package) {
      maybeOfferBulkApply({
        sourceId: id,
        optionLabel: patch.glass_package,
        applyToOpening: (other, otherPt) => {
          // Only apply if this product type has the same glass package
          // defined AND the opening doesn't already have it set.
          if (!otherPt?.glass_packages || otherPt.glass_packages[patch.glass_package] == null) return null;
          if (other.glass_package === patch.glass_package) return null;
          return { glass_package: patch.glass_package };
        },
      });
    } else if (patch.tempered_upcharge) {
      maybeOfferBulkApply({
        sourceId: id,
        optionLabel: patch.tempered_upcharge,
        applyToOpening: (other, otherPt) => {
          if (!otherPt?.tempered || otherPt.tempered[patch.tempered_upcharge] == null) return null;
          if (other.tempered_upcharge === patch.tempered_upcharge) return null;
          return { tempered_upcharge: patch.tempered_upcharge };
        },
      });
    }
  };

  if (loading) {
    return (
      <div className="card p-6 mb-4">
        <div className="text-sm text-[#A1A1AA]">{t("common.loading")}</div>
      </div>
    );
  }
  if (!catalog || !catalog.product_types?.length) {
    return (
      <div className="card p-6 mb-4 border-l-4 border-[#DC2626]">
        <div className="text-sm text-[#991B1B]">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <>
      {catalog.product_types.map((pt) => {
        const openings = openingsByType[pt.name] || [];
        const sectionTotal = openings.reduce((s, op) => {
          const per = (Number(op.base_mat) || 0)
            + (Number(op.glass_mat) || 0)
            + (Number(op.tempered_mat) || 0)
            + (Number(op.premium_mat) || 0);
          return s + (Number(op.qty) || 0) * per;
        }, 0);
        const isFixed = pt.sizing === "fixed_model";
        // Iter 42c: count usage of each upgrade option across ALL Vero
        // openings (across product types — option names are reused) so the
        // editor can show "applied on N of M windows" when mixed.
        const allOpenings = est?.vero_openings || [];
        const totalOpenings = allOpenings.length;
        const glassCounts = {};
        const temperedCounts = {};
        const premiumCounts = {};
        for (const o of allOpenings) {
          if (o.glass_package) glassCounts[o.glass_package] = (glassCounts[o.glass_package] || 0) + 1;
          if (o.tempered_upcharge) temperedCounts[o.tempered_upcharge] = (temperedCounts[o.tempered_upcharge] || 0) + 1;
          for (const p of o.premium_options || []) {
            premiumCounts[p] = (premiumCounts[p] || 0) + 1;
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
                dangerouslySetInnerHTML={{ __html: t("win.noOpenings") }}
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
                    onUpdate={(patch) => handleEditorUpdate(op.id, patch)}
                    onRemove={() => removeOpening(op.id)}
                    onTogglePremium={(name) => togglePremiumOption(op.id, name)}
                    glassCounts={glassCounts}
                    temperedCounts={temperedCounts}
                    premiumCounts={premiumCounts}
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
  onToggleExpand, onToggleNotes, onUpdate, onRemove, onTogglePremium,
  glassCounts = {}, temperedCounts = {}, premiumCounts = {}, totalOpenings = 0,
}) {
  const t = useT();
  const isFixed = pt.sizing === "fixed_model";

  // Live re-resolve so the visible price doesn't lag the snapshot on the
  // first keystroke. (Snapshot is updated by updateOpening in the parent.)
  const resolved = isFixed
    ? { ui: 0, bucket: null, ...resolveFixedOpening(pt, op) }
    : resolveBucketOpening(pt, op);
  const { ui, bucket } = resolved;
  const baseMat = resolved.base;
  const glassMat = resolved.glass;
  const tempMat = resolved.temp;
  const premiumMat = resolved.premium;
  const perWindow = baseMat + glassMat + tempMat + premiumMat;
  const total = (Number(op.qty) || 0) * perWindow;
  const inRange = isFixed || (!!bucket && ui > 0);
  const hasPremium = !!pt.premium_options && Object.keys(pt.premium_options).length > 0;
  const hasTempered = !!pt.tempered && Object.keys(pt.tempered).length > 0;

  return (
    <div className="px-4 md:px-5 py-3" data-testid={`vero-opening-${op.id}`}>
      {/* Top row — W/H (or Model) · Qty · UI hint · Base hint · Total · Notes / Remove */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isFixed && (
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold w-[80px] text-right pr-1 hidden md:block">
            {bucket ? `#${bucket.label}` : "—"}
          </div>
        )}
        {isFixed ? (
          <div className="flex-1 min-w-[180px]">
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
              isQty={false}
            />
            <NumField
              label={t("win.height")}
              value={op.height}
              onChange={(v) => onUpdate({ height: v })}
              testid={`vero-height-${op.id}`}
              isQty={false}
            />
          </>
        )}
        <NumField
          label={t("win.qty")}
          value={op.qty}
          onChange={(v) => onUpdate({ qty: v })}
          testid={`vero-qty-${op.id}`}
          minWidth={64}
          isQty={true}
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

      {/* Optional label/notes line */}
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

      {/* Color + glass + tempered + premium selectors */}
      <button
        type="button"
        className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#52525B] font-bold hover:text-[#09090B]"
        onClick={onToggleExpand}
        data-testid={`vero-options-toggle-${op.id}`}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {t("win.options")}
        {(op.glass_package || op.tempered_upcharge || (op.premium_options || []).length > 0) && (
          <span className="ml-1 bg-[#F97316] text-white px-1.5 py-0.5 text-[9px] font-bold rounded">
            {[op.glass_package, op.tempered_upcharge, ...(op.premium_options || [])].filter(Boolean).length}
          </span>
        )}
        <span className="ml-1.5 font-mono-num text-[10px] text-[#71717A] font-normal normal-case">
          {t("win.optionsPerWindow", { amt: fmt(glassMat + tempMat + premiumMat) })}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 pl-5 pb-2 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(pt.sister_colors || []).length > 1 && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-1">
                  {t("win.sisterColor")}
                </label>
                <select
                  className="input h-9 text-sm w-full"
                  value={op.sister_color || ""}
                  onChange={(e) => onUpdate({ sister_color: e.target.value })}
                  data-testid={`vero-sister-${op.id}`}
                >
                  {(pt.sister_colors || []).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-1 flex items-center gap-1.5">
                <span>{t("win.glassPackage")}</span>
                <span className="text-[9px] text-[#71717A] normal-case font-normal">({t("win.optional")})</span>
                {op.glass_package && glassCounts[op.glass_package] > 0 && glassCounts[op.glass_package] < totalOpenings && (
                  <span
                    className="text-[9px] font-mono-num bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] px-1 py-px tracking-tight ml-auto normal-case font-bold"
                    title={`This glass package is set on ${glassCounts[op.glass_package]} of ${totalOpenings} windows`}
                    data-testid={`vero-glass-usage-${op.id}`}
                  >
                    {glassCounts[op.glass_package]}/{totalOpenings}
                  </span>
                )}
              </label>
              <select
                className="input h-9 text-sm w-full"
                value={op.glass_package || ""}
                onChange={(e) => onUpdate({ glass_package: e.target.value })}
                data-testid={`vero-glass-${op.id}`}
              >
                <option value="">{t("win.none")}</option>
                {Object.keys(pt.glass_packages || {}).map((g) => (
                  <option key={g} value={g}>
                    {g}
                    {!isFixed && bucket && pt.glass_packages?.[g]?.[bucket.label] != null
                      ? ` (+${fmt(pt.glass_packages[g][bucket.label])})`
                      : isFixed && pt.glass_packages?.[g]?.[op.model] != null
                        ? ` (+${fmt(pt.glass_packages[g][op.model])})`
                        : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasTempered && !isFixed && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-1 flex items-center gap-1.5">
                <span>{t("win.tempered")}</span>
                <span className="text-[9px] text-[#71717A] normal-case font-normal">({t("win.optional")})</span>
                {op.tempered_upcharge && temperedCounts[op.tempered_upcharge] > 0 && temperedCounts[op.tempered_upcharge] < totalOpenings && (
                  <span
                    className="text-[9px] font-mono-num bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] px-1 py-px tracking-tight ml-auto normal-case font-bold"
                    title={`This tempered option is set on ${temperedCounts[op.tempered_upcharge]} of ${totalOpenings} windows`}
                    data-testid={`vero-tempered-usage-${op.id}`}
                  >
                    {temperedCounts[op.tempered_upcharge]}/{totalOpenings}
                  </span>
                )}
              </label>
              <select
                className="input h-9 text-sm w-full md:w-1/2"
                value={op.tempered_upcharge || ""}
                onChange={(e) => onUpdate({ tempered_upcharge: e.target.value })}
                data-testid={`vero-tempered-${op.id}`}
              >
                <option value="">{t("win.none")}</option>
                {Object.keys(pt.tempered || {}).map((tt2) => (
                  <option key={tt2} value={tt2}>
                    {tt2}
                    {bucket && pt.tempered?.[tt2]?.[bucket.label] != null
                      ? ` (+${fmt(pt.tempered[tt2][bucket.label])})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {hasPremium && !isFixed && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                {t("win.premiumOptions")} <span className="text-[9px] text-[#71717A] normal-case">({t("win.premiumOptionsHint")})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1 max-h-64 overflow-y-auto pr-1 border border-[#E4E4E7] p-2 bg-[#FAFAFA]">
                {Object.entries(pt.premium_options || {}).map(([name, grid]) => {
                  const checked = (op.premium_options || []).includes(name);
                  const price = bucket ? Number(grid[bucket.label]) || 0 : 0;
                  const isUnavailable = price >= 9999;
                  const usedOn = premiumCounts[name] || 0;
                  const mixed = usedOn > 0 && usedOn < totalOpenings;
                  return (
                    <label
                      key={name}
                      className={`flex items-center gap-1.5 py-1 px-1.5 text-[11px] cursor-pointer ${
                        checked ? "bg-[#FFF7ED] text-[#09090B]" : "hover:bg-white text-[#3F3F46]"
                      } ${isUnavailable ? "opacity-40 pointer-events-none" : ""}`}
                      data-testid={`vero-premium-${op.id}-${name.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    >
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[#F97316] flex-shrink-0"
                        checked={checked}
                        onChange={() => onTogglePremium(name)}
                        disabled={isUnavailable}
                      />
                      <span className={`flex-1 truncate ${checked ? "font-semibold" : ""}`} title={name}>
                        {name}
                      </span>
                      {mixed && (
                        <span
                          className="text-[9px] font-mono-num bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D] px-1 py-px tracking-tight flex-shrink-0 normal-case font-bold"
                          title={`Applied on ${usedOn} of ${totalOpenings} windows`}
                        >
                          {usedOn}/{totalOpenings}
                        </span>
                      )}
                      <span className="font-mono-num text-[10px] text-[#71717A] tabular-nums whitespace-nowrap">
                        {isUnavailable ? "n/a" : price > 0 ? `+${fmt(price)}` : "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-2 border-t border-[#E4E4E7] text-[11px] text-[#71717A]">
            <span>{t("win.perWindow")}</span>
            <span><strong className="text-[#09090B] font-mono-num">{fmt(baseMat)}</strong> {t("win.base").toLowerCase()}</span>
            {glassMat > 0 && <span>+ <strong className="text-[#09090B] font-mono-num">{fmt(glassMat)}</strong> {t("win.glassPackage").toLowerCase()}</span>}
            {tempMat > 0 && <span>+ <strong className="text-[#09090B] font-mono-num">{fmt(tempMat)}</strong> {t("win.tempered").toLowerCase()}</span>}
            {premiumMat > 0 && <span>+ <strong className="text-[#09090B] font-mono-num">{fmt(premiumMat)}</strong> {t("win.premiumOptions").toLowerCase()}</span>}
            <span className="ml-auto">= <strong className="text-[#F97316] font-mono-num">{fmt(perWindow)}</strong> × {Number(op.qty) || 0} = <strong className="text-[#09090B] font-mono-num">{fmt(total)}</strong></span>
          </div>
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
