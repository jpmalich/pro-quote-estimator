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
