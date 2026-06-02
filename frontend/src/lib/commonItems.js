// Catalog items that contractors commonly need but the HOVER report can't
// auto-quantify (or doesn't cover at all). These render with a yellow row
// background in SectionAccordion so the contractor visually scans them
// before sending a quote and can't forget them.
//
// This list is the union of:
//   1. The 12 "almost always needed but easy to forget" items (Tear-Off,
//      Dumpster, Caulking, Flashing, etc.)
//   2. Every line item the HOVER importer auto-populates — so contractors
//      who DON'T upload a HOVER report still get the same visual nudge.
//
// To add/remove from this list, just edit the set below — no other code
// change needed. Match must be EXACT (catalog item name).
export const COMMONLY_NEEDED_ITEMS = new Set([
  // "Easy to forget" items
  ".019 Coil (1 per 5 Sq Siding)",
  "Caulking (per color)",
  "J-blocks, Dryer vents",
  "Shutters (louvered, raised panel) standard sizes",
  "Tear-Off",
  "clean up/ haul away job debris",
  "Dumpster",
  'Fascia/rake or frieze up to 8" coverage',
  'Downspout 6"',
  "elbow",
  "Capping general",
  "Flashing",
  // Items the HOVER importer fills in — flag these for non-HOVER users too
  "Outside corners",
  "Inside Corners (Siding)",
  "Starter",
  "Finish Trim",
  '3/4" J-Channel (2 per Sq of siding)',
  "House Wrap",
  '2" Nails 30 lbs (1 per 15 Sq)',
  '1 1/4" Trim Nails',
  'Soffit & fascia up to 13" wide Charter Oak',
  '3/4" Soffit J-Channel (Charter Oak)',
  'Gutter 6"',
  ".019 Coil (1 per 50' fascia)",
  "Cap window",
  "Cap entry door",
  "Cap patio door",
  "Cap single garage door",
  // ----- Tab-default "headline" siding products (one per tab) -----
  // Even when a contractor isn't using HOVER, these are the most-quoted
  // items per product line — surface them so they always catch the eye.
  'Charter Oak Dutch Lap 4.5" .046',          // Vinyl tab default
  'Ascend Composite Lap Siding 7"',           // Ascend tab default
  // ----- LP SmartSide "starter pack" — items quoted on virtually every
  // LP job. Flagging them ensures the LP tab doesn't ship empty when a
  // contractor only fills the headline lap product.
  'LP Strand Lap Siding 3/8" x 8" x 16\'',
  'LP 440 Trim 3/4" x 4" x 16\'',
  'LP 540 Trim 3/4" x 4" x 16\'',
  "LP Color Match Coil",
  'LP Outside corners 4" x 16\'',
  "LP Touch-up Kit",
  "LP Caulking Color Match",
  'LP J-blocks 1" W/FLASHING',
  'LP Soffit 3/8" x 16" x 16\' Vented',
]);

export function isCommonlyNeeded(itemName) {
  return COMMONLY_NEEDED_ITEMS.has(itemName);
}

/** Returns the count of commonly-needed items in a section's line list that
 *  are still unfilled (qty <= 0). Used on collapsed section headers to show a
 *  small "N items to review" hint so the contractor knows to open it. */
export function unfilledCommonCount(lines) {
  return (lines || []).filter(
    (l) => COMMONLY_NEEDED_ITEMS.has(l.name) && (l.qty || 0) <= 0
  ).length;
}
