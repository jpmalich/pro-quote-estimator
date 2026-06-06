// Color palettes per product line. Used by the dropdowns on the estimate
// page (Job Info → Material Colors / Window Colors blocks). One palette
// per field; the contractor must pick a value from the list — no free-text.
//
// Add or edit a palette here and the dropdown updates automatically. Order
// matters: items are rendered in this order, so put the most common picks
// at the top.

// Per-brand vinyl siding color palettes (Iter 37). Each siding brand
// (Conquest, Coventry, Odyssey Plus, Charter Oak) ships with its own
// color collection — sometimes a single Standard collection, sometimes
// split into Standard + Architectural. The estimate's siding color
// dropdown dynamically narrows to the brand the contractor is quoting:
// if exactly one brand has qty>0, show only that brand's collection(s);
// otherwise show all four as collapsible optgroups.
export const VINYL_BRAND_COLOR_GROUPS = {
  conquest: [
    {
      label: "Conquest Color Collection",
      colors: [
        "Glacier White", "Antique Parchment", "Natural Linen", "Platinum Gray",
        "Cape Cod Gray", "Mystic Blue", "Coastal Sage", "Juniper Ridge",
        "Adobe Cream", "Maple", "Monterey Sand", "Canyon Clay",
        "Vintage Wicker", "Tuscan Clay", "Storm", "Sterling Gray",
      ],
    },
  ],
  coventry: [
    {
      label: "Coventry Standard Color Collection",
      colors: [
        "Glacier White", "Antique Parchment", "Natural Linen", "Platinum Gray",
        "Cape Cod Gray", "Mystic Blue", "Coastal Sage", "Juniper Ridge",
        "Adobe Cream", "Maple", "Monterey Sand", "Canyon Clay",
        "Vintage Wicker", "Tuscan Clay",
      ],
    },
    {
      label: "Coventry Architectural Color Collection",
      colors: [
        "Canyon Drift", "Mountain Fern", "Harbor Blue", "Storm",
        "Sterling Gray", "Ageless Slate", "Charcoal Smoke",
      ],
    },
  ],
  odyssey: [
    {
      label: "Odyssey Plus Standard Color Collection",
      colors: [
        "Glacier White", "Antique Parchment", "Natural Linen", "Platinum Gray",
        "Cape Cod Gray", "Mystic Blue", "Coastal Sage", "Juniper Ridge",
        "Adobe Cream", "Maple", "Monterey Sand", "Vintage Wicker", "Tuscan Clay",
      ],
    },
    {
      label: "Odyssey Plus Architectural Color Collection",
      colors: [
        "Fired Brick", "Canyon Drift", "Flagship Brown", "Mountain Fern",
        "Deep Moss", "Harbor Blue", "Midnight Blue", "Storm",
        "Sterling Gray", "Ageless Slate", "Charcoal Smoke",
      ],
    },
  ],
  charter: [
    // Charter Oak uses the full collection that the previous Iter 36 dropdown shipped.
    {
      label: "Charter Oak Standard Color Collection",
      colors: [
        "Glacier White", "Juniper Ridge", "Platinum Gray", "Monterey Sand",
        "Tuscan Clay", "Antique Parchment", "Adobe Cream", "Natural Linen",
        "Cape Cod Gray", "Maple", "Vintage Wicker", "Mystic Blue", "Coastal Sage",
      ],
    },
    {
      label: "Charter Oak Architectural Color Collection",
      colors: [
        "Fired Brick", "Harbor Blue", "Deep Espresso", "Riviera Dusk",
        "Canyon Drift", "Midnight Blue", "Rustic Timber", "Storm",
        "Mountain Fern", "Deep Moss", "Sterling Gray", "Ageless Slate",
        "Flagship Brown", "Laguna Blue", "Charcoal Smoke", "Cast Iron",
      ],
    },
  ],
};

// Ordered list of brands as we want them to appear in the dropdown when
// multiple brands are quoted (or no brand is quoted yet).
const BRAND_ORDER = ["conquest", "coventry", "odyssey", "charter"];

// Map a siding catalog item name -> brand key. Matches the same regexes
// used by /app/frontend/src/lib/subCategories.js so the dropdown
// filtering aligns with the section sub-categories the contractor sees.
function brandKeyOf(itemName) {
  if (!itemName) return null;
  if (/^Conquest /.test(itemName)) return "conquest";
  if (/^Coventry /.test(itemName)) return "coventry";
  if (/^Odyssey /.test(itemName)) return "odyssey";
  if (/^Charter Oak /.test(itemName)) return "charter";
  return null;
}

/**
 * Return the optgroup definitions to render in the vinyl-siding color
 * dropdown based on which brands actually have qty > 0 lines in the
 * current estimate.
 *
 *  - Zero brands chosen → show ALL 4 brands as collapsible groups.
 *  - Exactly one brand chosen → show that brand's groups only.
 *  - Two+ brands chosen → show all chosen brands' groups.
 *
 * Each returned group has { label, colors }.
 */
export function vinylSidingColorGroupsForEstimate(lines) {
  const activeBrands = new Set();
  for (const l of lines || []) {
    if ((l.qty || 0) <= 0) continue;
    const b = brandKeyOf(l.name);
    if (b) activeBrands.add(b);
  }
  const brands = activeBrands.size === 0 ? BRAND_ORDER : BRAND_ORDER.filter((b) => activeBrands.has(b));
  return brands.flatMap((b) => VINYL_BRAND_COLOR_GROUPS[b]);
}

// Legacy export: a flat list of every color from every brand collection.
// Kept for any consumer that hasn't migrated to the smart picker yet.
export const VINYL_SIDING_COLOR_GROUPS = BRAND_ORDER.flatMap(
  (b) => VINYL_BRAND_COLOR_GROUPS[b]
);
export const VINYL_SIDING_COLORS = [
  ...new Set(VINYL_SIDING_COLOR_GROUPS.flatMap((g) => g.colors)),
];

export const ASCEND_COLORS = [
  "Glacier White",
  "Almond",
  "Monterey Sand",
  "Pebble",
  "Canyon Drift",
  "Flagship Brown",
  "Rustic Timber",
  "Dover Gray",
  "Cape Cod Gray",
  "Sterling Gray",
  "Storm",
  "Ageless Slate",
  "Charcoal Smoke",
  "Cast Iron",
  "Laguna Blue",
  "Harbor Blue",
  "Midnight Blue",
  "Riviera Dusk",
  "Mountain Fern",
  "Deep Moss",
  "Fired Brick",
];

// Soffit / Fascia palette split into Standard and Architectural (premium)
// collections — same rendering pattern as the Vinyl Siding dropdown.
// Premium colors include Musket Brown + Black which only ship on aluminum
// soffit/fascia stock.
export const SOFFIT_COLOR_GROUPS = [
  {
    label: "Standard Color Collection",
    colors: [
      "Glacier White",
      "Antique Parchment",
      "Natural Linen",
      "Platinum Gray",
      "Cape Cod Gray",
      "Mystic Blue",
      "Coastal Sage",
      "Juniper Ridge",
      "Adobe Cream",
      "Maple",
      "Monterey Sand",
      "Vintage Wicker",
      "Tuscan Clay",
    ],
  },
  {
    label: "Architectural Color Collection (premium)",
    colors: [
      "Fired Brick",
      "Canyon Drift",
      "Flagship Brown",
      "Deep Espresso",
      "Musket Brown",
      "Rustic Timber",
      "Mountain Fern",
      "Deep Moss",
      "Harbor Blue",
      "Midnight Blue",
      "Laguna Blue",
      "Riviera Dusk",
      "Storm",
      "Sterling Gray",
      "Ageless Slate",
      "Charcoal Smoke",
      "Cast Iron",
      "Black",
    ],
  },
];

// Flat fallback for any consumer that just needs the full list.
export const SOFFIT_COLORS = SOFFIT_COLOR_GROUPS.flatMap((g) => g.colors);

// Aluminum seamless-gutter & downspout palette. Narrowed to the 5
// SKUs Howard actually stocks; "Other" is the catch-all for the rare
// custom color the contractor types into the line note.
export const GUTTER_COLORS = [
  "White",
  "Black",
  "Beige/Clay",
  "Musket Brown",
  "Other",
];
