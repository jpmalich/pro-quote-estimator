// Lines that the waste factor inflates: Vinyl Siding section + the 2 Ascend
// Composite siding products. Single source of truth shared between the
// per-estimate totals (calc.js) and the Material List PDF generator.
const WASTE_ASCEND_NAMES = new Set([
  'Ascend Composite Lap Siding 7"',
  'Ascend Composite B&B 12" (add 30% Waste)',
]);

export function isWasteLine(line) {
  if (line?.section === "Vinyl Siding") return true;
  // Iter 23: the 2 Ascend siding items moved into their own "Ascend
  // Cladding" section. Accept BOTH the new section name and the legacy
  // "Ascend Cladding/Accessories" name so old estimates that haven't been
  // re-saved (and thus haven't picked up the migration) still apply waste.
  return (
    (line?.section === "Ascend Cladding" ||
      line?.section === "Ascend Cladding/Accessories") &&
    WASTE_ASCEND_NAMES.has(line?.name)
  );
}

// Iter 36: each adder carries its own qty (independent of line.qty), so
// a 10-window line can have only 3 windows with Tempered glass etc.
// Adder mat/lab is multiplied by the adder's own qty and added to the
// line subtotal alongside the base line.qty * (line.mat + line.lab).
const addersMatTotal = (l) =>
  (l?.adders || []).reduce(
    (s, a) => s + (Number(a?.qty) || 0) * (Number(a?.mat) || 0),
    0
  );
const addersLabTotal = (l) =>
  (l?.adders || []).reduce(
    (s, a) => s + (Number(a?.qty) || 0) * (Number(a?.lab) || 0),
    0
  );

export function calcTotals(est, { tab } = {}) {
  // Filter lines + misc rows to a single tab when `tab` is provided. Lines
  // without an explicit tab fall back to "vinyl" (back-compat for legacy
  // estimates created before multi-product tabs existed).
  const allLines = est?.lines || [];
  const allMiscLab = est?.misc_labor || [];
  const allMiscMat = est?.misc_material || [];
  const inTab = (row) => !tab || (row?.tab || "vinyl") === tab;
  const lines = allLines.filter(inTab);
  const miscLab = allMiscLab.filter(inTab);
  const miscMat = allMiscMat.filter(inTab);
  const subMat =
    lines.reduce((s, l) => s + (l.qty || 0) * (l.mat || 0) + addersMatTotal(l), 0) +
    miscMat.reduce((s, l) => s + (l.mat || 0), 0) +
    // Iter 37: Mezzo openings only count when viewing the Mezzo tab (or
    // when no tab filter is applied — i.e. computing the grand total).
    // Iter 57v: when `mezzo_package_quote.enabled && total > 0` the
    // per-opening bucket sum is replaced by the contractor-entered
    // package total (rep / inside-sales hand quote).
    ((!tab || tab === "mezzo")
      ? (est?.mezzo_package_quote?.enabled && Number(est?.mezzo_package_quote?.total) > 0
          ? Number(est.mezzo_package_quote.total)
          : (est?.mezzo_openings || []).reduce((s, op) => {
              const base = (Number(op.qty) || 0) * (Number(op.base_mat) || 0);
              const ads = (op.adders || []).reduce(
                (a, x) => a + (Number(x.qty) || 0) * (Number(x.mat) || 0),
                0
              );
              return s + base + ads;
            }, 0))
      : 0) +
    // Iter 44: Vero now uses the Mezzo-style adders model. Per-window
    // price = base + sum(adder.qty × adder.mat). Older openings still
    // have glass_mat/tempered_mat/premium_mat fields — read those as a
    // fallback so historical estimates don't suddenly go to $0 until the
    // reconciliation hook migrates them.
    // Iter 57v: same package-quote override as Mezzo, brand-independent.
    ((!tab || tab === "windows")
      ? (est?.vero_package_quote?.enabled && Number(est?.vero_package_quote?.total) > 0
          ? Number(est.vero_package_quote.total)
          : (est?.vero_openings || []).reduce((s, op) => {
              const base = (Number(op.qty) || 0) * (Number(op.base_mat) || 0);
              const ads = (op.adders || []).reduce(
                (a, x) => a + (Number(x.qty) || 0) * (Number(x.mat) || 0),
                0
              );
              const legacy =
                (Number(op.qty) || 0) * (
                  (Number(op.glass_mat) || 0)
                  + (Number(op.tempered_mat) || 0)
                  + (Number(op.premium_mat) || 0)
                );
              return s + base + ads + legacy;
            }, 0))
      : 0);
  const subLab =
    lines.reduce((s, l) => s + (l.qty || 0) * (l.lab || 0) + addersLabTotal(l), 0) +
    miscMat.reduce((s, l) => s + (l.lab || 0), 0) +
    miscLab.reduce((s, l) => s + (l.lab || 0), 0);
  // Iter 78 — Waste is now baked into the line.qty itself on
  // HOVER/Blueprint import for cut-prone items (siding, soffit, J,
  // finish trim, corners, starter). The on-screen qty IS the order
  // qty, so we no longer add a separate dollar waste bump here —
  // that would double-count. `wasteAdd` stays at 0 to keep the
  // returned shape stable for callers that read it.
  const wasteAdd = 0;
  const wasted = subMat + wasteAdd;
  const tax = est?.tax_enabled ? wasted * ((est?.tax_rate || 0) / 100) : 0;
  const base = wasted + tax + subLab;
  const pct = (est?.margin_pct || 0) / 100;
  // Legacy estimates (no pricing_mode field) were saved under the old markup behavior.
  const mode = est?.pricing_mode || "markup";
  let sell;
  if (mode === "margin") {
    // True margin: sell = base / (1 - pct). Cap at 99% to avoid divide-by-zero.
    const denom = 1 - Math.min(pct, 0.99);
    sell = denom > 0 ? base / denom : base;
  } else {
    sell = base * (1 + pct);
  }
  const profit = sell - base;
  return { subMat, subLab, wasted, tax, base, sell, profit };
}
