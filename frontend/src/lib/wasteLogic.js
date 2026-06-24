// Cut-waste logic — baked into line qty on import.
//
// Iter 78 (Howard's "1C · 2C · 3A"):
//   • Waste % is applied directly to the qty of cut-prone items on HOVER /
//     Blueprint import. The estimate then SHOWS the wasted total (e.g.
//     Siding line displays 24 SQ instead of 18) so the contractor sees
//     "what they need to order" in the editor, not just on the Material
//     List PDF.
//   • The separate $ Waste Factor card no longer adds dollars on top —
//     waste is in the qty, so the dollar bump would double-count. The
//     Waste % field remains as the master knob.
//   • When the contractor changes Waste % later, every line with a
//     stored `raw_qty` recomputes: qty = raw_qty × (1 + waste/100),
//     rounded to the nearest 0.5 unit. Lines without `raw_qty` were
//     entered manually and are left alone.
//
// Cut-prone items per Howard's 1C choice:
//   - Siding panels (Vinyl Siding section, Ascend Composite Lap/B&B)
//   - Soffit panels (Charter Oak Soffit)
//   - J-Channel (all variants: vinyl, ascend, soffit-J)
//   - Finish Trim (vinyl + ascend)
//   - Outside corners + Inside corners
//   - Starter strip

const ASCEND_SIDING_NAMES = new Set([
  'Ascend Composite Lap Siding 7"',
  'Ascend Composite B&B 12" (add 30% Waste)',
]);

export function isCutProneItem(line) {
  if (!line) return false;
  const section = String(line.section || "").toLowerCase();
  const name = String(line.name || "").toLowerCase();

  // Siding panels — full section gets waste in Vinyl; only the two
  // composite SKUs in Ascend.
  if (section === "vinyl siding") return true;
  if (
    (line.section === "Ascend Cladding" ||
      line.section === "Ascend Cladding/Accessories") &&
    ASCEND_SIDING_NAMES.has(line.name)
  ) {
    return true;
  }

  // LP SmartSide cut-prone sections (Iter 78a bug fix) — all panel,
  // trim, and soffit boards ship as 16'-long PCS that incur cut waste.
  // Without this branch the contractor's waste % was being silently
  // ignored on LP estimates, producing under-counted order qtys (Howard
  // reported 194 PCS for 18 SQ where 232+ was expected at 20%).
  if (section === "lp smart siding") return true;
  if (section === "lp smartside trim") return true;
  if (section === "lp smartside soffit") return true;
  // LP Outside Corner lives in "LP Siding Accessories" alongside
  // small-count items (coil, touch-up kits, J blocks, mini splits).
  // Only the OSC + Series-540 trim variants need waste.
  if (
    section === "lp siding accessories" &&
    (name.includes("osc") || name.includes("outside corner"))
  ) {
    return true;
  }

  // Soffit panels (Charter Oak)
  if (
    section === "vinyl soffit with siding" &&
    name.includes("charter oak soffit")
  ) {
    return true;
  }

  // J-Channel (regular accessory J + Ascend J + Soffit J)
  if (
    name.includes("j-channel") ||
    name.includes("j - channel") ||
    name.includes("j channel")
  ) {
    return true;
  }

  // Finish Trim (both vinyl + ascend variants)
  if (name.includes("finish trim")) return true;

  // Outside / Inside corners — handle "Outside corners" + "Inside Corners"
  // + Ascend variants like "Outside Corner Post".
  if (name.includes("outside corner")) return true;
  if (name.includes("inside corner")) return true;

  // Starter strip
  if (name === "starter" || name.startsWith("starter ")) return true;

  // Iter 78l — House Wrap. Wrap rolls are full-coverage so contractors
  // cut waste at every opening, seam, and corner. Howard's request: the
  // waste % should apply to House Wrap (regular + RainDrop) the same
  // way it applies to siding panels.
  if (name === "house wrap" || name === "raindrop house wrap") return true;

  // Iter 78m — Fan Fold (3/8") insulation board. Same install reality
  // as House Wrap: full-coverage, cut around openings + corners.
  if (name === '3/8" fan fold' || name.includes("fan fold")) return true;

  return false;
}

// Round to nearest 0.5 unit, rounding up. Mirrors materialList.js so the
// PDF Order column and the on-screen qty match exactly. Items like
// J-channel pcs round to whole numbers naturally because (raw × waste)
// of an integer is rarely fractional — but soffit/siding SQ can land at
// 23.7 and we want to bump to 24.0 for ordering.
function roundUpHalf(n) {
  const x = Number(n);
  if (!isFinite(x) || x <= 0) return 0;
  return Math.ceil(x * 2) / 2;
}

// On import (HOVER / Blueprint): take freshly-computed catalog lines
// and bake the waste % into qty for cut-prone items. Stores the
// original raw value in `raw_qty` so future waste-% changes can
// recompute without losing the source measurement.
//
// Items that don't qualify (gutter, downspouts, end caps, elbows,
// labor, etc.) are returned unchanged.
export function bakeWasteIntoLines(lines, wastePct) {
  const pct = Math.max(0, Number(wastePct) || 0);
  const factor = 1 + pct / 100;
  return (lines || []).map((l) => {
    if (!isCutProneItem(l)) return l;
    const raw = Number(l.qty) || 0;
    if (raw <= 0) return l;
    return {
      ...l,
      raw_qty: raw,
      qty: roundUpHalf(raw * factor),
    };
  });
}

// On waste-% change: walk existing lines, recompute qty from raw_qty
// for any line that has it. Lines without raw_qty (manually entered or
// non-cut-prone) keep whatever qty the contractor typed.
export function recomputeWasteQtys(lines, wastePct) {
  const pct = Math.max(0, Number(wastePct) || 0);
  const factor = 1 + pct / 100;
  return (lines || []).map((l) => {
    const raw = Number(l?.raw_qty);
    if (!raw || !isFinite(raw) || raw <= 0) return l;
    return { ...l, qty: roundUpHalf(raw * factor) };
  });
}

// Iter 78b — "Recompute waste on existing lines" helper.
//
// Legacy LP estimates (created before the Iter 78a classifier fix
// shipped) have cut-prone lines stored with `qty = raw` and
// `raw_qty = null` — so a waste-% change can't recompute them. This
// helper walks every cut-prone line in the estimate and:
//   1. If `raw_qty` is missing, treats the current `qty` AS the raw
//      measurement and stamps it into `raw_qty`.
//   2. Recomputes `qty = roundUpHalf(raw_qty × (1 + waste/100))`.
//
// Non-cut-prone lines (gutter, downspouts, manual entries that
// don't match the classifier) are left untouched.
//
// Important: a line that was manually edited (user typed a custom qty
// AFTER the original raw import) is indistinguishable from a legacy
// line — both have raw_qty=null. The button MUST be gated behind a
// confirm dialog so contractors don't accidentally bump manual lines.
export function recomputeAllWaste(lines, wastePct) {
  const pct = Math.max(0, Number(wastePct) || 0);
  const factor = 1 + pct / 100;
  return (lines || []).map((l) => {
    if (!isCutProneItem(l)) return l;
    const stored = Number(l.raw_qty);
    const hasRaw = isFinite(stored) && stored > 0;
    const rawQty = hasRaw ? stored : (Number(l.qty) || 0);
    if (rawQty <= 0) return l;
    return {
      ...l,
      raw_qty: rawQty,
      qty: roundUpHalf(rawQty * factor),
    };
  });
}

// LP SmartSide soffit steering (Iter 78).
//
// The HOVER spec splits LP soffit into two rows by surface:
//   • "38 Series Soffit 16 x 16 Vented" — qty derived from eaves_lf
//   • "38 Series Soffit 16 x 16 Closed" — qty derived from rakes_lf
//
// Howard's "Soffit type" knob lets him steer those at apply time:
//   "mix"    — leave as-is (the smart default for most jobs)
//   "vented" — collapse Closed qty into Vented (all-vented job)
//   "closed" — collapse Vented qty into Closed (all-closed job)
//
// Combines both line.qty and line.raw_qty so a later waste-% change
// still recomputes correctly. Lines that aren't LP soffit are untouched.
const VENTED_SOFFIT = "38 Series Soffit 16 x 16 Vented";
const CLOSED_SOFFIT = "38 Series Soffit 16 x 16 Closed";

export function steerLpSoffit(lines, soffitType) {
  const type = soffitType || "mix";
  if (type === "mix") return lines || [];
  const out = [];
  let vented = null;
  let closed = null;
  for (const l of lines || []) {
    if (l?.name === VENTED_SOFFIT) {
      vented = l;
      continue;
    }
    if (l?.name === CLOSED_SOFFIT) {
      closed = l;
      continue;
    }
    out.push(l);
  }
  // Collapse the two LP soffit qtys into the winning row.
  const ventedQty = Number(vented?.qty) || 0;
  const closedQty = Number(closed?.qty) || 0;
  const ventedRaw = Number(vented?.raw_qty) || 0;
  const closedRaw = Number(closed?.raw_qty) || 0;
  const sumQty = ventedQty + closedQty;
  const sumRaw = ventedRaw + closedRaw;
  if (type === "vented" && (vented || closed)) {
    const base = vented || closed;
    out.push({
      ...base,
      name: VENTED_SOFFIT,
      qty: sumQty,
      raw_qty: sumRaw > 0 ? sumRaw : (base.raw_qty ?? null),
    });
  } else if (type === "closed" && (vented || closed)) {
    const base = closed || vented;
    out.push({
      ...base,
      name: CLOSED_SOFFIT,
      qty: sumQty,
      raw_qty: sumRaw > 0 ? sumRaw : (base.raw_qty ?? null),
    });
  } else {
    // No LP soffit rows in the input — nothing to steer
    if (vented) out.push(vented);
    if (closed) out.push(closed);
  }
  return out;
}
