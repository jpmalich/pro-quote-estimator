// Iter 57aa — Item help descriptions.
//
// Keyed by EXACT catalog item name → { en, es } strings. When a name
// is present here, SectionAccordion renders a small `?` button next
// to the row name. Clicking it pops a Radix Popover with the matching
// description in the user's active language. No entry → no button.
//
// To add a new description, drop a new key/value pair below. Multi-line
// JS strings are fine — the popover wraps text. Howard writes these
// in English first; ES translation can be added at any time.
//
// Conventions:
// - Use exact catalog item name as the key (case + punctuation matter).
// - When multiple catalog rows share the same physical item (e.g.
//   Standard color vs Architectural color), repeat the description
//   under each key so the popover works regardless of which row is
//   clicked.

const ITEM_DESCRIPTIONS = {
  // ----- Finish trim (3 catalog rows share the same description) -----
  "Finish Trim Standard color": {
    en: "Finish trim is used to lock down the cut edge of a siding panel where there's no built-in lock to grab onto. Used under window sills and eaves, or under any horizontal trim or band where a panel terminates against it.",
    es: "El finish trim (riel de cierre) se usa para fijar el borde cortado de un panel de revestimiento cuando no hay un seguro integrado para sujetarlo. Se instala bajo los alféizares de las ventanas, los aleros, o debajo de cualquier moldura horizontal donde un panel termina contra ella.",
  },
  "Finish Trim Architectural color": {
    en: "Finish trim is used to lock down the cut edge of a siding panel where there's no built-in lock to grab onto. Used under window sills and eaves, or under any horizontal trim or band where a panel terminates against it.",
    es: "El finish trim (riel de cierre) se usa para fijar el borde cortado de un panel de revestimiento cuando no hay un seguro integrado para sujetarlo. Se instala bajo los alféizares de las ventanas, los aleros, o debajo de cualquier moldura horizontal donde un panel termina contra ella.",
  },
  "ASCEND Finish Trim": {
    en: "Finish trim is used to lock down the cut edge of a siding panel where there's no built-in lock to grab onto. Used under window sills and eaves, or under any horizontal trim or band where a panel terminates against it.",
    es: "El finish trim (riel de cierre) se usa para fijar el borde cortado de un panel de revestimiento cuando no hay un seguro integrado para sujetarlo. Se instala bajo los alféizares de las ventanas, los aleros, o debajo de cualquier moldura horizontal donde un panel termina contra ella.",
  },

  // ----- Window install methods -----
  "Window DH/Slider - Pocket Install": {
    en: "Pocket Install (also called insert, retrofit, or frame-in-frame) is the method. The new window is set into the existing window frame — you pull out just the old sashes, balances, and stops, then slide the new unit into the pocket that's left and fasten it to the old frame. The existing exterior trim, brickmould, casing, and interior trim all stay put.",
    es: "Instalación tipo Pocket (también llamada insert, retrofit o marco dentro de marco). La ventana nueva se coloca dentro del marco existente: se quitan solo las hojas viejas, los balanceadores y los topes, luego se desliza la unidad nueva en el hueco que queda y se fija al marco existente. La moldura exterior, el brickmould, los marcos y la moldura interior se mantienen en su lugar.",
  },
  "Window - Full Fin Replacement": {
    en: "Window – Fin-Cut Replacement: New-construction window with the nailing fin trimmed off, installed into the existing opening as a replacement unit. Fastened through the frame jambs rather than the fin, so existing siding and exterior trim remain undisturbed.",
    es: "Ventana – Reemplazo con aleta cortada: ventana de nueva construcción con la aleta de clavado recortada, instalada en la abertura existente como unidad de reemplazo. Se fija a través de las jambas del marco en lugar de por la aleta, por lo que el revestimiento y la moldura exterior existentes permanecen intactos.",
  },

  // ----- Underlayments -----
  "RainDrop House Wrap": {
    en: "RainDrop House Wrap: A drainable weather-resistive barrier whose surface is embossed with raised vertical channels (the \"3D\" texture) that hold the wrap slightly off the sheathing. This creates a built-in drainage gap so any water that gets behind the cladding has a continuous path to run down and out, rather than sitting against the wall. Like standard housewrap, it blocks air and bulk water infiltration while staying vapor-permeable so the wall can dry.",
    es: "RainDrop House Wrap: barrera de drenaje resistente a la intemperie cuya superficie está grabada con canales verticales en relieve (la textura \"3D\") que mantienen la envoltura ligeramente separada del tablero. Esto crea un hueco de drenaje integrado para que el agua que se cuele detrás del revestimiento tenga un camino continuo para bajar y salir, en lugar de quedarse contra la pared. Como las envolturas estándar, bloquea el aire y la infiltración masiva de agua manteniéndose permeable al vapor para que la pared pueda secarse.",
  },
  // ----- LP SmartSide coverage notes (Iter 78d) -----
  // Howard's per-square piece counts — these are quick mental
  // refreshers for ordering. The catalog already converts SQ → PCS
  // via the HOVER mapping; these popovers let the contractor sanity-
  // check the count against industry-standard LP coverage.
  '38 Series Lap 3/8" x 8" x 16\'': {
    en: "LP 38 Series Lap, 8\" face × 16' boards. Industry standard coverage: 11 pieces per square at 7\" exposure (1\" overlap).",
    es: "LP 38 Series Lap, 8\" cara × 16' tablas. Cobertura estándar: 11 piezas por cuadrado (square) con exposición de 7\" (1\" de traslape).",
  },
  '38 Series Lap 3/8" x 6" x 16\'': {
    en: "LP 38 Series Lap, 6\" face × 16' boards. Industry standard coverage: 16 pieces per square at 5\" exposure (1\" overlap).",
    es: "LP 38 Series Lap, 6\" cara × 16' tablas. Cobertura estándar: 16 piezas por cuadrado (square) con exposición de 5\" (1\" de traslape).",
  },
  "Shake": {
    en: "LP Cedar Shake panels. Coverage depends on reveal: minimum reveal (tightest exposure) ≈ 44 pieces per square; maximum reveal (widest exposure) ≈ 31 pieces per square. Choose your reveal at install time based on the look you want.",
    es: "Paneles LP Cedar Shake. La cobertura depende de la exposición: mínima exposición (más ajustada) ≈ 44 piezas por cuadrado; máxima exposición (más amplia) ≈ 31 piezas por cuadrado. Elige la exposición según el estilo deseado.",
  },
};

export function getItemDescription(name, lang = "en") {
  if (!name) return null;
  const entry = ITEM_DESCRIPTIONS[name];
  if (!entry) return null;
  return entry[lang] || entry.en || null;
}

export function hasItemDescription(name) {
  return !!ITEM_DESCRIPTIONS[name];
}

export default ITEM_DESCRIPTIONS;
