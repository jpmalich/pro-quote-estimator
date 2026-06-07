// Catalog item / section / unit translations.
// Brand-name products (Conquest, Coventry, Odyssey, Charter Oak, Greenbriar, T2,
// Ascend) stay in English — they're product names, not descriptions. Generic
// service descriptions and section titles do get translated.
//
// Catalog data lives in the backend in English; these maps translate at render
// time. If a key isn't here, we fall back to the original (English) string.

const SECTIONS_ES = {
  "Install Vinyl Siding": "Vinil",
  "Vinyl Siding": "Vinil",
  "Ascend Cladding": "Revestimiento Ascend",
  "Ascend Cladding/Accessories": "Revestimiento Ascend / Accesorios",
  "Siding Accessories": "Accesorios de vinil",
  "Tear-Off / Clean Up": "Demolición / Limpieza",
  "Vinyl Soffit with Siding": "Plafón de vinil con vinil",
  "Porch Ceiling": "Techo de Porche",
  "Seamless Gutter": "Canalón sin uniones",
  "Misc. Labor Only": "Mano de obra (varios)",
  "Misc. Labor & Material": "Mano de obra y material (varios)",
  "Misc.": "Varios",
  // Iter 38–40: window catalog sections (shared by Vero + Mezzo tabs)
  "Window Installation": "Instalación de ventanas",
  "Sliding Glass Door Install": "Instalación de puerta corrediza",
  "Window Material List": "Lista de materiales · ventanas",
  "Window Exterior Trim Work": "Moldura exterior · ventanas",
  "Window Interior Trim Work": "Moldura interior · ventanas",
  "Window Misc.": "Ventanas · varios",
  // Vero W×H product panels (rendered via VeroPanel's section-tag)
  "Vero Double Hung": "Vero Doble Colgante",
  "Vero 2-Lite Slider": "Vero Corrediza 2 hojas",
  "Vero 3-Lite Slider": "Vero Corrediza 3 hojas",
  "Vero Picture": "Vero Fija (Picture)",
  "Vero Patio Door": "Vero Puerta de Patio",
  "Vero 1-Lite Casement": "Vero Batiente 1 hoja",
  // Mezzo W×H product panels
  "Mezzo Double Hung": "Mezzo Doble Colgante",
  "Mezzo 2-Lite Slider": "Mezzo Corrediza 2 hojas",
  "Mezzo 3-Lite Slider": "Mezzo Corrediza 3 hojas",
  "Mezzo Picture": "Mezzo Fija (Picture)",
};

// Catalog item translations. Only translate generic descriptions; leave product
// model numbers and brand-name profiles alone.
const ITEMS_ES = {
  "vertical board and batten": "tabla y listón vertical",
  "Architectural color upcharge Vinyl": "Recargo por color arquitectónico (vinil)",
  "Shakes and Scallops": "Tejas y escamas",
  "Inside Corners": "Esquinas interiores",
  // Iter 34: split Standard / Architectural color variants
  "Outside corners Standard color": "Esquinas exteriores color estándar",
  "Outside corners Architectural color": "Esquinas exteriores color arquitectónico",
  "Inside Corners (Siding) Standard color": "Esquinas interiores (vinil) color estándar",
  "Inside Corners (Siding) Architectural color": "Esquinas interiores (vinil) color arquitectónico",
  '3/4" J-Channel Standard color (2 per Sq of siding)': '3/4" J-Channel color estándar (2 por MC de vinil)',
  '3/4" J-Channel Architectural color (2 per Sq of siding)': '3/4" J-Channel color arquitectónico (2 por MC de vinil)',
  "Finish Trim Standard color": "Moldura de acabado color estándar",
  "Finish Trim Architectural color": "Moldura de acabado color arquitectónico",
  'Soffit & fascia up to 13" wide Charter Oak Standard color': 'Plafón y fascia hasta 13" Charter Oak color estándar',
  'Soffit & fascia up to 13" wide Charter Oak Architectural color': 'Plafón y fascia hasta 13" Charter Oak color arquitectónico',
  'Soffit & fascia up to 13"-30" wide Charter Oak Standard color': 'Plafón y fascia 13"-30" Charter Oak color estándar',
  'Soffit & fascia up to 13"-30" wide Charter Oak Architectural color': 'Plafón y fascia 13"-30" Charter Oak color arquitectónico',
  '3/4" Soffit J-Channel (Charter Oak) Standard color': '3/4" Plafón J-Channel (Charter Oak) color estándar',
  '3/4" Soffit J-Channel (Charter Oak) Architectural color': '3/4" Plafón J-Channel (Charter Oak) color arquitectónico',
  // Legacy generic names (pre-Iter-34) — keep for old saved estimates.
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

  // Iter 38–40: Window Installation
  "Window DH/Slider - Pocket Install": "Ventana DH/Corrediza – Instalación de bolsillo",
  "Window - Full Fin Replacement": "Ventana – Reemplazo con aleta completa",
  "Window - Block Frame Replacement": "Ventana – Reemplazo con marco de bloque",
  "Large Window - adder for windows 30 sq-ft or larger": "Ventana grande – recargo para ventanas de 30 pies² o más",
  "Field Mull Assembly and/or Field Glaze (adder per each opening)": "Ensamble de mainel en sitio y/o vidriado en sitio (recargo por abertura)",
  "Lead Safe Installation Practices For Window Installation": "Prácticas de instalación seguras contra plomo",
  "Lead Safe - Test Fee (all homes 1978 and older are tested)": "Plomo seguro – tarifa de prueba (todas las casas de 1978 o anteriores)",
  "Cap window (Windows)": "Forrar ventana (ventanas)",
  "Job Measure Standard Fee 4 days+": "Medición estándar 4 días o más",
  "Disposal Fee (Windows)": "Tarifa de disposición (ventanas)",
  "Mullion Removal & Cut-Out of Non-Structural Framing Members": "Retiro de mainel y corte de elementos no estructurales",

  // Sliding Glass Door Install
  "Vinyl Sliding Glass Door (5' & 6' width)": "Puerta corrediza de vinil (5' y 6' de ancho)",
  "Vinyl Sliding Glass Door (8' width -or- a sliding door that needs to be field assembled)": "Puerta corrediza de vinil (8' de ancho o que requiere ensamble en sitio)",
  "Oversize Vinyl Door - (greater than 8' width)": "Puerta de vinil de gran tamaño (más de 8' de ancho)",

  // Window Material List
  "Windows - .019 Coil (1 per 5 Sq Siding)": "Ventanas – Bobina .019 (1 por cada 5 MC de vinil)",
  "Windows - PVC Trim Coil (1 per 5 Sq Siding)": "Ventanas – Bobina de PVC para moldura (1 por cada 5 MC de vinil)",
  "Windows - Performance G8 Trim Coil (1 per 5 Sq Siding)": "Ventanas – Bobina G8 Performance (1 por cada 5 MC de vinil)",
  "Windows - Caulking (per color)": "Ventanas – Sellador (por color)",

  // Window Exterior Trim Work
  "New Exterior Primed Stops or Snap Trim": "Topes o moldura exterior nueva imprimada",
  "New Exterior Primed Wood Trim": "Moldura exterior de madera nueva imprimada",
  "New Exterior Composite Trim": "Moldura exterior compuesta nueva",

  // Window Interior Trim Work
  "New Interior Stops or Flat Trim": "Topes o moldura plana interior nueva",
  "New Interior Casing": "Marco interior nuevo (casing)",
  "New Interior Jamb Extension": "Extensión de jamba interior nueva",
  "New Interior Sill - create or replace interior window sill - QUOTE ONLY": "Antepecho interior nuevo – crear o reemplazar – SOLO COTIZACIÓN",

  // Window Misc.
  "Interior Blinds - Remove For Window Install & Reinstall": "Persianas interiores – retirar para la instalación y reinstalar",
  "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)": "Contraventanas – bajar y volver a colocar (REUSAR LAS EXISTENTES)",
  "Storm Window Removal": "Retiro de ventana de tormenta",
  "Second/Third/Clear Story Fee": "Tarifa por segundo / tercer piso o piso libre",
  "Job Measure Rush Fee 3 days or less": "Medición urgente (3 días o menos)",
  "Add New Channel on ALL, Close up opening to match master Front opening": "Agregar canal nuevo en TODAS, cerrar abertura para coincidir con la frontal principal",
  "Minimum Job Charge For Window Installs": "Cargo mínimo por trabajo de ventanas",
};

// Unit abbreviations. Construction trades in the US often keep English shorthand
// even in Spanish work orders, but a few have clear translations.
const UNITS_ES = {
  "SQ": "MC",       // square (100 sq ft) → metro cuadrado conceptually; keep "MC" abbreviation
  "LF": "PL",       // linear foot → pie lineal
  "PCS": "PZA",     // pieces → piezas
  "Each": "C/U",    // each → cada uno
  "each": "C/U",
  "EA": "C/U",
  "JOB": "TRAB",    // job → trabajo
  "ROLL": "ROLLO",
  "PR": "PAR",      // pair → par
  "Box": "CAJA",
  "SQ FT": "PIE²",
  "ADD": "REC",     // surcharge / adder
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
