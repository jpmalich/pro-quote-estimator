// Catalog item / section / unit translations.
// Brand-name products (Conquest, Coventry, Odyssey, Charter Oak, Greenbriar, T2,
// Ascend) stay in English — they're product names, not descriptions. Generic
// service descriptions and section titles do get translated.
//
// Catalog data lives in the backend in English; these maps translate at render
// time. If a key isn't here, we fall back to the original (English) string.

const SECTIONS_ES = {
  "Install Vinyl Siding": "Instalar vinil",
  "Ascend Cladding/Accessories": "Revestimiento Ascend / Accesorios",
  "Siding Accessories": "Accesorios de vinil",
  "Tear-Off / Clean Up": "Demolición / Limpieza",
  "Vinyl Soffit with Siding": "Plafón de vinil con vinil",
  "Porch Ceiling": "Techo de Porche",
  "Seamless Gutter": "Canalón sin uniones",
  "Misc. Labor Only": "Mano de obra (varios)",
  "Misc. Labor & Material": "Mano de obra y material (varios)",
  "Misc.": "Varios",
};

// Catalog item translations. Only translate generic descriptions; leave product
// model numbers and brand-name profiles alone.
const ITEMS_ES = {
  "vertical board and batten": "tabla y listón vertical",
  "Architectural color upcharge Vinyl": "Recargo por color arquitectónico (vinil)",
  "Shakes and Scallops": "Tejas y escamas",
  "Inside Corners": "Esquinas interiores",
  "Outside corners": "Esquinas exteriores",
  "Inside Corners (Siding)": "Esquinas interiores (vinil)",
  "Finish Trim": "Moldura de acabado",
  "Starter": "Tira de arranque",
  "House Wrap": "Membrana para casa",
  "Caulking (per color)": "Sellador (por color)",
  "J-blocks, Dryer vents": "Bloques J, ventilas de secadora",
  "Shutters (louvered, raised panel) standard sizes": "Contraventanas (persiana o panel) tamaños estándar",
  "Gable vents (round, octagon)": "Ventilas de hastial (redondas, octagonales)",
  "Tear-Off": "Demolición",
  "Wood shake tear off (requires a dumpster)": "Demolición de teja de madera (requiere contenedor)",
  "Clean up / haul away job debris": "Limpieza / retiro de escombros",
  "Dumpster": "Contenedor",
  "Cap porch band": "Forrar cinta del porche",
  "Wrap porch beam": "Forrar viga del porche",
  "Elbow": "Codo",
  "Mitre": "Inglete",
  "R&R gutter": "Quitar y reponer canalón",
  "R&R downspout": "Quitar y reponer bajante",
  "Cap window": "Forrar ventana",
  "Cap windows with wide crown": "Forrar ventana con corona ancha",
  "Capping general": "Forrado general",
  "Cap window headers only": "Forrar solo cabeceras de ventana",
  "Cap entry door": "Forrar puerta de entrada",
  "Cap patio door": "Forrar puerta de patio",
  "Cap single garage door": "Forrar puerta de cochera",
  "Build out for windows w/ furring (includes capping)": "Engrosar ventanas con listones (incluye forrado)",
  "R&R Gable louvers": "Quitar y reponer ventilas de hastial",
  "Fascia Return": "Retorno de fascia",
  "Bird box": "Caja de pájaros",
  "Flashing": "Flashing / tapajuntas",
  "Cap tops of bird boxes": "Forrar tapas de cajas de pájaros",
  "Dormer upcharge": "Recargo por buhardilla",
  "R&R Utilities": "Quitar y reponer instalaciones",
  "Cut out 4x4 section of wall and insulate": "Cortar sección de pared 4x4 y aislar",
};

// Unit abbreviations. Construction trades in the US often keep English shorthand
// even in Spanish work orders, but a few have clear translations.
const UNITS_ES = {
  "SQ": "MC",       // square (100 sq ft) → metro cuadrado conceptually; keep "MC" abbreviation
  "LF": "PL",       // linear foot → pie lineal
  "PCS": "PZA",     // pieces → piezas
  "Each": "C/U",    // each → cada uno
  "EA": "C/U",
  "JOB": "TRAB",    // job → trabajo
  "ROLL": "ROLLO",
  "PR": "PAR",      // pair → par
  "Box": "CAJA",
  "SQ FT": "PIE²",
};

export function tSection(name, lang) {
  if (lang !== "es") return name;
  return SECTIONS_ES[name] || name;
}

export function tItem(name, lang) {
  if (lang !== "es") return name;
  return ITEMS_ES[name] || name;
}

export function tUnit(unit, lang) {
  if (lang !== "es") return unit;
  return UNITS_ES[unit] || unit;
}
