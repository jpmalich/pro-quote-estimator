/**
 * Reconciles the persisted price snapshots on Mezzo / Vero openings against
 * the live catalog whenever an estimate first loads. The HOVER importer
 * creates openings with `base_mat: 0` (it can't price-resolve client-side),
 * and per-row UI components render fresh prices fine — but calc.js sums the
 * stored snapshot fields for the StickyBar/Snapshot totals. Without this
 * reconciliation, a freshly-imported windows estimate shows the correct
 * per-row prices alongside a $0.00 grand total until the contractor
 * touches a single row.
 *
 * Runs ONCE per estimate id (re-runs if id changes, e.g. nav to a paired
 * estimate). Skips silently if the estimate has no window openings.
 */
import { useEffect, useRef } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Vero buckets use min/max; Mezzo buckets use min_ui/max_ui.
const findBucketVero = (buckets, ui) =>
  (buckets || []).find((b) => ui >= b.min && ui <= b.max) || null;
const findBucketMezzo = (buckets, ui) =>
  (buckets || []).find((b) => b.min_ui <= ui && ui <= b.max_ui) || null;

// Vero — base + glass + tempered + premium, all bucket-resolved.
function resolveVeroSnapshot(pt, op) {
  if (pt.sizing === "fixed_model") {
    const base = Number(pt.fixed_models?.[op.model]?.base) || 0;
    const glass = op.glass_package
      ? Number(pt.glass_packages?.[op.glass_package]?.[op.model]) || 0
      : 0;
    return { base_mat: base, glass_mat: glass, tempered_mat: 0, premium_mat: 0, bucket_label: "" };
  }
  const ui = (Number(op.width) || 0) + (Number(op.height) || 0);
  const bucket = findBucketVero(pt.buckets, ui);
  if (!bucket) {
    return { base_mat: 0, glass_mat: 0, tempered_mat: 0, premium_mat: 0, bucket_label: "" };
  }
  const base = Number(pt.base_prices?.[bucket.label]) || 0;
  const glass = op.glass_package
    ? Number(pt.glass_packages?.[op.glass_package]?.[bucket.label]) || 0
    : 0;
  const temp = op.tempered_upcharge
    ? Number(pt.tempered?.[op.tempered_upcharge]?.[bucket.label]) || 0
    : 0;
  const premium = (op.premium_options || []).reduce(
    (s, name) => s + (Number(pt.premium_options?.[name]?.[bucket.label]) || 0),
    0
  );
  return {
    bucket_label: bucket.label,
    base_mat: base,
    glass_mat: glass,
    tempered_mat: temp,
    premium_mat: premium,
  };
}

// Mezzo — simpler: just bucket-resolved base + recomputed adder mats.
// Matches the canonical resolveAdderMat() shape inside MezzoPanel.jsx:
// adder.kind === "sqft" → rate × (w × h / 144); otherwise look up
// prices_by_bucket[bucket.label].
function resolveMezzoSnapshot(pt, op) {
  const ui = (Number(op.width) || 0) + (Number(op.height) || 0);
  const bucket = findBucketMezzo(pt.buckets, ui);
  const base = bucket ? Number(pt.base_prices?.[bucket.label]) || 0 : 0;
  const bucketLabel = bucket ? bucket.label : "";
  const freshAdders = (op.adders || []).map((a) => {
    const def = (pt.adders || []).find((x) => x.name === a.name);
    if (!def) return a;
    let mat = 0;
    if (def.kind === "sqft") {
      mat = (Number(def.rate) || 0) * ((Number(op.width) || 0) * (Number(op.height) || 0)) / 144;
    } else if (bucket) {
      mat = Number(def.prices_by_bucket?.[bucket.label]) || 0;
    }
    return { ...a, mat };
  });
  return { base_mat: base, bucket_label: bucketLabel, adders: freshAdders };
}

const equalAdders = (a, b) =>
  a.length === b.length &&
  a.every((x, i) => Math.round(Number(x.mat) || 0) === Math.round(Number(b[i]?.mat) || 0));

export default function useReconcileWindowSnapshots(est, update) {
  const lastReconciledIdRef = useRef(null);

  useEffect(() => {
    if (!est?.id) return;
    const hasMezzo = (est.mezzo_openings || []).length > 0;
    const hasVero = (est.vero_openings || []).length > 0;
    if (!hasMezzo && !hasVero) return;
    if (lastReconciledIdRef.current === est.id) return;
    lastReconciledIdRef.current = est.id;

    let alive = true;
    (async () => {
      const fetches = [];
      if (hasMezzo) fetches.push(axios.get(`${API}/mezzo/catalog`));
      else fetches.push(Promise.resolve(null));
      if (hasVero) fetches.push(axios.get(`${API}/vero/catalog`));
      else fetches.push(Promise.resolve(null));

      let mezzoCat = null, veroCat = null;
      try {
        const [m, v] = await Promise.all(fetches);
        mezzoCat = m?.data || null;
        veroCat = v?.data || null;
      } catch {
        return;
      }
      if (!alive) return;

      const patch = {};
      if (hasMezzo && mezzoCat?.product_types) {
        let dirty = false;
        const next = (est.mezzo_openings || []).map((op) => {
          const pt = mezzoCat.product_types.find((p) => p.name === op.product_type);
          if (!pt) return op;
          const fresh = resolveMezzoSnapshot(pt, op);
          if (
            Math.round(Number(op.base_mat) || 0) !== Math.round(fresh.base_mat) ||
            (op.bucket_label || "") !== fresh.bucket_label ||
            !equalAdders(op.adders || [], fresh.adders)
          ) {
            dirty = true;
            return { ...op, ...fresh };
          }
          return op;
        });
        if (dirty) patch.mezzo_openings = next;
      }
      if (hasVero && veroCat?.product_types) {
        let dirty = false;
        const next = (est.vero_openings || []).map((op) => {
          const pt = veroCat.product_types.find((p) => p.name === op.product_type);
          if (!pt) return op;
          const fresh = resolveVeroSnapshot(pt, op);
          if (
            Math.round(Number(op.base_mat) || 0) !== Math.round(fresh.base_mat) ||
            Math.round(Number(op.glass_mat) || 0) !== Math.round(fresh.glass_mat) ||
            Math.round(Number(op.tempered_mat) || 0) !== Math.round(fresh.tempered_mat) ||
            Math.round(Number(op.premium_mat) || 0) !== Math.round(fresh.premium_mat) ||
            (op.bucket_label || "") !== (fresh.bucket_label || "")
          ) {
            dirty = true;
            return { ...op, ...fresh };
          }
          return op;
        });
        if (dirty) patch.vero_openings = next;
      }
      if (Object.keys(patch).length > 0) update(patch);
    })();

    return () => { alive = false; };
    // Key off est.id only — content-level deps would re-loop forever once we
    // push the patch back via update().
  }, [est?.id]);
}
