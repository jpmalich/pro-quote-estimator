// Color palettes per product line. Used by the dropdowns on the estimate
// page (Job Info → Material Colors / Window Colors blocks). One palette
// per field; the contractor must pick a value from the list — no free-text.
//
// Add or edit a palette here and the dropdown updates automatically. Order
// matters: items are rendered in this order, so put the most common picks
// at the top.

// Vinyl siding colors split into Standard and Architectural collections.
// The contractor sees them as two labelled groups in the dropdown so they
// can quickly tell which palette they're picking from (and avoid the
// Architectural-color upcharge by mistake).
export const VINYL_SIDING_COLOR_GROUPS = [
  {
    label: "Standard Color Collection",
    colors: [
      "Glacier White",
      "Juniper Ridge",
      "Platinum Gray",
      "Monterey Sand",
      "Tuscan Clay",
      "Antique Parchment",
      "Adobe Cream",
      "Natural Linen",
      "Cape Cod Gray",
      "Maple",
      "Vintage Wicker",
      "Mystic Blue",
      "Coastal Sage",
    ],
  },
  {
    label: "Architectural Color Collection",
    colors: [
      "Fired Brick",
      "Harbor Blue",
      "Deep Espresso",
      "Riviera Dusk",
      "Canyon Drift",
      "Midnight Blue",
      "Rustic Timber",
      "Storm",
      "Mountain Fern",
      "Deep Moss",
      "Sterling Gray",
      "Ageless Slate",
      "Flagship Brown",
      "Laguna Blue",
      "Charcoal Smoke",
      "Cast Iron",
    ],
  },
];

// Flat fallback for any consumer that just needs the full list.
export const VINYL_SIDING_COLORS = VINYL_SIDING_COLOR_GROUPS.flatMap((g) => g.colors);

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

// Aluminum seamless-gutter & downspout palette. Standard Alside aluminum
// coil colors — narrower than the soffit/fascia palette since gutter coil
// only ships in a subset.
export const GUTTER_COLORS = [
  "White",
  "Almond",
  "Cream",
  "Pearl Gray",
  "Cape Cod Gray",
  "Tuxedo Gray",
  "Wicker",
  "Royal Brown",
  "Musket Brown",
  "Buckskin",
  "Bronze",
  "Antique Bronze",
  "Coffee",
  "Hunter Green",
  "Terratone",
  "Black",
];
