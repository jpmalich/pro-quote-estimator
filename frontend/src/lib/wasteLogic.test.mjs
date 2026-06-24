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

console.log(
  process.exitCode ? "\n❌ FAILED" : "\n✅ All wasteLogic tests passed"
);
