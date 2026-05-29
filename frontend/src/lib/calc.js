// Lines that the waste factor inflates: Vinyl Siding section + the 2 Ascend
// Composite siding products. Single source of truth shared between the
// per-estimate totals (calc.js) and the Material List PDF generator.
const WASTE_ASCEND_NAMES = new Set([
  'Ascend Composite Lap Siding 7"',
  'Ascend Composite B&B 12" (add 30% Waste)',
]);

export function isWasteLine(line) {
  if (line?.section === "Vinyl Siding") return true;
  return (
    line?.section === "Ascend Cladding/Accessories" &&
    WASTE_ASCEND_NAMES.has(line?.name)
  );
}

export function calcTotals(est) {
  const lines = est?.lines || [];
  const miscLab = est?.misc_labor || [];
  const miscMat = est?.misc_material || [];
  const subMat =
    lines.reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0) +
    miscMat.reduce((s, l) => s + (l.mat || 0), 0);
  const subLab =
    lines.reduce((s, l) => s + (l.qty || 0) * (l.lab || 0), 0) +
    miscMat.reduce((s, l) => s + (l.lab || 0), 0) +
    miscLab.reduce((s, l) => s + (l.lab || 0), 0);
  // Waste factor only inflates siding material — Vinyl Siding section + the
  // 2 Ascend Composite siding products. Everything else is ordered to actual
  // count. See isWasteLine() for the canonical predicate.
  const wasteBase = lines
    .filter(isWasteLine)
    .reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0);
  const wasteAdd = wasteBase * ((est?.waste_pct || 0) / 100);
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
