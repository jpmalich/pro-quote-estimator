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
  "J-blocks - Split Blocks (82A009)",
  "Shutters (louvered, raised panel) standard sizes",
  "Tear-Off",
  "clean up/ haul away job debris",
  "Dumpster",
  'Fascia/rake or frieze up to 8" coverage',
  'Downspout 6"',
  "elbow",
  "End Cap",
  "Capping general",
  "Flashing",
  // Items the HOVER importer fills in — flag these for non-HOVER users too
  "Outside corners Standard color",
  "Inside Corners (Siding) Standard color",
  "Starter",
  "Finish Trim Standard color",
  '3/4" J-Channel Standard color (2 per Sq of siding)',
  "House Wrap",
  "RainDrop House Wrap",
  '2" Nails 30 lbs (1 per 15 Sq)',
  '1 1/4" Trim Nails',
  'Soffit & fascia up to 13" wide Charter Oak Standard color',
  '3/4" Soffit J-Channel (Charter Oak) Standard color',
  'Gutter 6"',
  ".019 Coil (1 per 50' fascia)",
  "Cap window",
  "Cap entry door",
  "Cap patio door",
  "Cap single garage door",
  // ----- Tab-default "headline" siding products (one per tab) -----
  // Even when a contractor isn't using HOVER, these are the most-quoted
  // items per product line — surface them so they always catch the eye.
  'Charter Oak Standard color Dutch Lap 4.5" .046',  // Vinyl tab default
  'Ascend Composite Lap Siding 7"',           // Ascend tab default
  // ----- Ascend Cladding/Accessories starter pack — Ascend installers
  // commonly need these but they're easy to overlook since the headline
  // Ascend siding row gets all the attention.
  'Ascend 5.5" Outside Corner  - MATTE',
  "Inside Corners",
  "Ascend - J - Channel  (2 per Sq of siding)",
  "ASCEND Finish Trim",
  "Ascend - Starter",
  // ----- LP SmartSide "starter pack" — items quoted on virtually every
  // LP job. Flagging them ensures the LP tab doesn't ship empty when a
  // contractor only fills the headline lap product.
  // Iter 67 (2026-06-22): renamed to BlueLinx names. Color Match Coil
  // dropped in favor of the 3 vinyl-matching coil rows.
  '38 Series Lap 3/8" x 8" x 16\'',
  '440 Series Trim 4/4" x 4" x 16\'',
  '540 Series Trim 5/4" x 4" x 16\'',
  '540 Series OSC 5/4" x 4" x 16\'',
  '.019 Coil',
  'Touch up kits',
  'OSI Quad Max Caulking',
  'J blocks',
  'Mini Splits',
  '38 Series Soffit 16 x 16 Vented',
  '38 Series Soffit 16 x 16 Closed',
  // ----- Windows tab common items -----
  "Vero - Double Hung 0-101 UI",
  "Window - Pocket Install",
  // Iter 57y — Howard's go-to install method for Vero + Mezzo jobs.
  // Highlight it so contractors notice the line before sending the
  // quote. Scoped below to "windows" + "mezzo" tabs only.
  "Window DH/Slider - Pocket Install",
  // Iter 57z — easy-to-forget window-job accessories. Both apply to
  // every window install regardless of brand. Scoped to "windows" +
  // "mezzo" tabs only (these line names are window-specific so they
  // wouldn't surface on siding tabs anyway, but explicit scope is safer).
  "Windows - .019 Coil",
  "Windows - Caulking (per color)",
  "Lead Safe Installation Practices For Window Installation",
  "Lead Safe - Test Fee (all homes 1978 and older are tested)",
  "Cap window (Windows)",
  'Vero - Sliding glass door 60" x 80"',
  "Vinyl Sliding Glass Door (5' & 6' width)",
  "Job Measure Standard Fee 4 days+",
  "Disposal Fee (Windows)",
]);

export function isCommonlyNeeded(itemName) {
  return COMMONLY_NEEDED_ITEMS.has(itemName);
}

// Some commonly-needed items only apply to specific product tabs. For
// example, the vinyl-style accessories ("Outside corners", "Starter", etc.)
// share a catalog section between Vinyl and Ascend tabs, but on the Ascend
// tab those rows are NOT the canonical accessory choice — Ascend has its
// own dedicated items ("Ascend 3.5" Outside Corner - MATTE", "Ascend -
// Starter", etc.) elsewhere. So we hide the lightbulb on the Ascend tab
// for those vinyl-side accessories.
//
// Shape: { itemName: Set<tabId> } — if missing, the flag applies to all tabs.
const COMMON_ITEM_TAB_SCOPE = {
  "Outside corners Standard color": new Set(["vinyl"]),
  "Inside Corners (Siding) Standard color": new Set(["vinyl"]),
  '3/4" J-Channel Standard color (2 per Sq of siding)': new Set(["vinyl"]),
  "Finish Trim Standard color": new Set(["vinyl"]),
  "Starter": new Set(["vinyl"]),
  // House Wrap is the canonical underlayment on Vinyl jobs; Ascend installers
  // typically use RainDrop House Wrap instead, so swap the highlight per tab.
  "House Wrap": new Set(["vinyl"]),
  "RainDrop House Wrap": new Set(["ascend"]),
  // Iter 57y — only highlight the Pocket Install row on the window tabs
  // (Vero / Mezzo) where contractors actually pick install method.
  "Window DH/Slider - Pocket Install": new Set(["windows", "mezzo"]),
  // Iter 57z — window accessory caulking + coil only show on window tabs.
  "Windows - .019 Coil": new Set(["windows", "mezzo"]),
  "Windows - Caulking (per color)": new Set(["windows", "mezzo"]),
};

/** Is this item commonly-needed on the given tab? Falls back to a global
 *  check (matches all tabs) when `tab` is omitted, for back-compat. */
export function isCommonOnTab(itemName, tab) {
  if (!COMMONLY_NEEDED_ITEMS.has(itemName)) return false;
  const scope = COMMON_ITEM_TAB_SCOPE[itemName];
  if (!scope) return true;
  return tab ? scope.has(tab) : true;
}

/** Returns the count of commonly-needed items in a section's line list that
 *  are still unfilled (qty <= 0). Used on collapsed section headers to show a
 *  small "N items to review" hint so the contractor knows to open it.
 *  `activeTab` scopes the count to flags actually visible on that tab. */
export function unfilledCommonCount(lines, activeTab) {
  return (lines || []).filter(
    (l) => isCommonOnTab(l.name, activeTab) && (l.qty || 0) <= 0
  ).length;
}
