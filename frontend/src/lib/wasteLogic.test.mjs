/**
 * Iter 78 — wasteLogic regression. Locks in:
 *   1. Cut-prone classifier identifies the right items.
 *   2. bakeWasteIntoLines stamps raw_qty + wasted qty on cut-prone lines.
 *   3. bakeWasteIntoLines leaves non-cut-prone lines unchanged.
 *   4. recomputeWasteQtys honors raw_qty when waste % changes.
 */
import {
  isCutProneItem,
  bakeWasteIntoLines,
  recomputeWasteQtys,
  recomputeAllWaste,
  steerLpSoffit,
} from "./wasteLogic.js";

function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `  ✖ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("isCutProneItem:");
eq(
  isCutProneItem({ section: "Vinyl Siding", name: "Install Vinyl Siding" }),
  true,
  "Vinyl Siding (full section) = cut-prone"
);
eq(
  isCutProneItem({
    section: "Ascend Cladding",
    name: 'Ascend Composite Lap Siding 7"',
  }),
  true,
  "Ascend Composite Lap = cut-prone"
);
eq(
  isCutProneItem({
    section: "Ascend Cladding",
    name: "Some accessory",
  }),
  false,
  "Random Ascend accessory != cut-prone"
);
eq(
  isCutProneItem({
    section: "Vinyl Soffit with Siding",
    name: "Charter Oak Soffit Standard color",
  }),
  true,
  "Charter Oak Soffit = cut-prone"
);
eq(
  isCutProneItem({ section: "x", name: '3/4" J-Channel Standard color' }),
  true,
  "J-Channel = cut-prone"
);
eq(
  isCutProneItem({
    section: "x",
    name: 'Ascend - J - Channel  (2 per Sq of siding)',
  }),
  true,
  "Ascend J - Channel (spaced) = cut-prone"
);
eq(
  isCutProneItem({ section: "x", name: "Finish Trim Standard color" }),
  true,
  "Finish Trim = cut-prone"
);
eq(
  isCutProneItem({ section: "x", name: "Outside corners Standard color" }),
  true,
  "Outside corners = cut-prone"
);
eq(
  isCutProneItem({ section: "x", name: "Inside Corners (Siding) Standard color" }),
  true,
  "Inside Corners = cut-prone"
);
eq(
  isCutProneItem({ section: "x", name: "Starter" }),
  true,
  "Starter = cut-prone"
);
eq(
  isCutProneItem({ section: "Seamless Gutter", name: 'Gutter 6"' }),
  false,
  "Gutter != cut-prone"
);
eq(
  isCutProneItem({ section: "Seamless Gutter", name: 'Downspout 6"' }),
  false,
  "Downspouts != cut-prone"
);
eq(
  isCutProneItem({ section: "Seamless Gutter", name: "End Cap" }),
  false,
  "End Cap != cut-prone"
);

// Iter 78a bug fix — LP sections must now be cut-prone too.
eq(
  isCutProneItem({ section: "LP Smart Siding", name: '38 Series Lap 3/8" x 8" x 16\'' }),
  true,
  "LP Smart Siding (38 Series Lap) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP SmartSide Trim", name: '440 Series Trim 4/4" x 4" x 16\'' }),
  true,
  "LP SmartSide Trim (440 Series) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP SmartSide Trim", name: '540 Series Trim 5/4" x 4" x 16\'' }),
  true,
  "LP SmartSide Trim (540 Series) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP SmartSide Soffit", name: "38 Series Soffit 16 x 16 Vented" }),
  true,
  "LP SmartSide Soffit (Vented) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP SmartSide Soffit", name: "38 Series Soffit 16 x 16 Closed" }),
  true,
  "LP SmartSide Soffit (Closed) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP Siding Accessories", name: "540 Series OSC 5/4\" x 4\" x 16'" }),
  true,
  "LP Outside Corner (540 OSC) = cut-prone"
);
eq(
  isCutProneItem({ section: "LP Siding Accessories", name: ".019 Coil" }),
  false,
  "LP .019 Coil != cut-prone (ships in rolls)"
);
eq(
  isCutProneItem({ section: "LP Siding Accessories", name: "Touch up kits" }),
  false,
  "LP Touch-up kits != cut-prone"
);

// LP 18-SQ at 20% waste should now hit ~233 PCS (the LETRICK ask).
const lpBaked = bakeWasteIntoLines(
  [{ section: "LP Smart Siding", name: '38 Series Lap 3/8" x 8" x 16\'', qty: 198, unit: "PCS", tab: "lp_smart" }],
  20
);
eq(lpBaked[0].raw_qty, 198, "LP 38 Lap raw_qty preserved");
eq(lpBaked[0].qty, 238, "LP 38 Lap qty = ceil(198 × 1.20 = 237.6) → 238");

// Iter 78b — recomputeAllWaste retro-actively stamps raw_qty for legacy
// lines that were stored before the cut-prone fix landed.
console.log("\nrecomputeAllWaste (legacy LP estimate at 20% waste):");
const legacyLines = [
  // Legacy line: qty=194 raw, raw_qty=null (created before Iter 78a)
  { section: "LP Smart Siding", name: '38 Series Lap 3/8" x 8" x 16\'', qty: 194, unit: "PCS", tab: "lp_smart" },
  // Non-cut-prone (should NOT be touched)
  { section: "Seamless Gutter", name: 'Gutter 6"', qty: 108, unit: "LF", tab: "lp_smart" },
  // Already-stamped line (recomputes from raw_qty just like a waste-% change)
  { section: "LP SmartSide Soffit", name: "38 Series Soffit 16 x 16 Vented", qty: 10, raw_qty: 8, unit: "PCS", tab: "lp_smart" },
];
const recomputedAll = recomputeAllWaste(legacyLines, 20);
eq(recomputedAll[0].raw_qty, 194, "Legacy LP Lap: raw_qty stamped from current qty");
eq(recomputedAll[0].qty, 233, "Legacy LP Lap: qty = ceil(194 × 1.20 = 232.8) → 233");
eq(recomputedAll[1].raw_qty, undefined, "Gutter (not cut-prone) untouched");
eq(recomputedAll[1].qty, 108, "Gutter qty stays 108");
eq(recomputedAll[2].raw_qty, 8, "Already-stamped raw_qty preserved");
eq(recomputedAll[2].qty, 10, "Already-stamped qty recomputed = ceil(8 × 1.20 = 9.6) → 10");

console.log("\nbakeWasteIntoLines @ 15%:");
const baked = bakeWasteIntoLines(
  [
    { section: "Vinyl Siding", name: "Install Vinyl Siding", qty: 18, unit: "SQ", mat: 0 },
    { section: "Seamless Gutter", name: 'Gutter 6"', qty: 108, unit: "LF", mat: 0 },
    { section: "Vinyl Soffit with Siding", name: "Charter Oak Soffit Standard color", qty: 100, unit: "SQ", mat: 0 },
  ],
  15
);
eq(baked[0].raw_qty, 18, "Siding raw_qty preserved");
eq(baked[0].qty, 21, "Siding qty = ceil(18 × 1.15 = 20.7) → 21.0 (rounded up half)");
eq(baked[1].raw_qty, undefined, "Gutter has NO raw_qty (not cut-prone)");
eq(baked[1].qty, 108, "Gutter qty unchanged");
eq(baked[2].raw_qty, 100, "Soffit raw_qty preserved");
eq(baked[2].qty, 115, "Soffit qty = 100 × 1.15");

console.log("\nrecomputeWasteQtys: 15% → 25%:");
const recomputed = recomputeWasteQtys(baked, 25);
eq(recomputed[0].qty, 22.5, "Siding qty recomputes to 18 × 1.25 = 22.5");
eq(recomputed[0].raw_qty, 18, "Siding raw_qty unchanged");
eq(recomputed[1].qty, 108, "Gutter qty still unchanged (no raw_qty)");
eq(recomputed[2].qty, 125, "Soffit qty recomputes to 100 × 1.25");

console.log("\nsteerLpSoffit:");
const lpLines = [
  { name: "38 Series Soffit 16 x 16 Vented", qty: 7, raw_qty: 6, tab: "lp_smart" },
  { name: "38 Series Soffit 16 x 16 Closed", qty: 3, raw_qty: 2, tab: "lp_smart" },
  { name: '38 Series Lap 3/8" x 8" x 16\'', qty: 24, tab: "lp_smart" },
];
const mix = steerLpSoffit(lpLines, "mix");
eq(mix.length, 3, "mix: both soffit rows preserved");
const vented = steerLpSoffit(lpLines, "vented");
eq(vented.length, 2, "vented: closed collapsed away");
const ventedRow = vented.find((l) => l.name === "38 Series Soffit 16 x 16 Vented");
eq(ventedRow?.qty, 10, "vented: qty = 7 + 3");
eq(ventedRow?.raw_qty, 8, "vented: raw_qty = 6 + 2");
const closed = steerLpSoffit(lpLines, "closed");
eq(closed.length, 2, "closed: vented collapsed away");
const closedRow = closed.find((l) => l.name === "38 Series Soffit 16 x 16 Closed");
eq(closedRow?.qty, 10, "closed: qty = 7 + 3");

console.log(
  process.exitCode ? "\n❌ FAILED" : "\n✅ All wasteLogic tests passed"
);
