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
