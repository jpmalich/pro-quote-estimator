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
  const wasted = subMat * (1 + (est?.waste_pct || 0) / 100);
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
