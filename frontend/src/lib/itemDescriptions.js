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
  "38 Series Soffit 16 x 16 Vented": {
    en: "LP 38 Series Vented Soffit, 16\" wide × 16' long. Used along eaves where attic ventilation is required (allows soffit-to-ridge airflow). 1 piece covers 16 LF of eave run.",
    es: "Soffit Ventilado LP 38 Series, 16\" ancho × 16' largo. Se usa en aleros donde se requiere ventilación del ático (permite flujo de aire del soffit al caballete). 1 pieza cubre 16 LF de alero.",
  },
  "38 Series Soffit 16 x 16 Closed": {
    en: "LP 38 Series Closed Soffit, 16\" wide × 16' long. Used at rake gables and porch ceilings where no ventilation is needed (no attic behind). 1 piece covers 16 LF of run.",
    es: "Soffit Cerrado LP 38 Series, 16\" ancho × 16' largo. Se usa en aleros de hastial y cielos de porches donde no se necesita ventilación (sin ático detrás). 1 pieza cubre 16 LF.",
  },
  "440 Series Trim 4/4\" x 4\" x 16'": {
    en: "LP 440 Series Trim — 4/4 (1\") thick × 4\" wide × 16' long. Standard flat-profile trim for window/door surrounds, band boards, and finish edges. Thinner than the 540 series — use where you don't need the deeper reveal.",
    es: "LP 440 Series Trim — 4/4 (1\") grueso × 4\" ancho × 16' largo. Moldura plana estándar para marcos de ventanas/puertas, bandas de cintura y bordes de acabado. Más delgada que la serie 540 — úsala donde no necesites una sombra profunda.",
  },
  "540 Series Trim 5/4\" x 4\" x 16'": {
    en: "LP 540 Series Trim — 5/4 (~1¼\") thick × 4\" wide × 16' long. Heavier profile trim with a deeper reveal — use around windows, doors, corners, and bandboards where a more substantial shadow line is wanted. Common for Modern Farmhouse and Craftsman looks.",
    es: "LP 540 Series Trim — 5/4 (~1¼\") grueso × 4\" ancho × 16' largo. Moldura con perfil más grueso y sombra más profunda. Se usa alrededor de ventanas, puertas, esquinas y bandas donde se quiere una línea de sombra más marcada. Común en estilos Modern Farmhouse y Craftsman.",
  },
  "540 Series OSC 5/4\" x 4\" x 16'": {
    en: "LP 540 Series Outside Corner Trim, 5/4 (~1¼\") thick × 4\" wide × 16' long pre-mitered. Wraps the outside corners of the home.",
    es: "LP 540 Series Esquinero Exterior, 5/4 (~1¼\") grueso × 4\" ancho × 16' largo pre-mitrado. Cubre las esquinas exteriores de la casa.",
  },

  // ----- Iter 78z++++ (follow-up) — Alside Siding Lines Reference -----
  // Source: Alside_Siding_Lines_Reference (Howard, Feb 2026). One
  // PDF description per panel product; the catalog splits each panel
  // by Standard / Architectural color, so the same description is
  // repeated under every catalog key that maps to that physical panel.
  // ES translations parallel the EN copy line-for-line. Items in the
  // PDF that don't exist in our catalog (Odyssey Plus, Pelican Bay,
  // 2-T Soffit, Charter Oak XL Grain / XL Matte) are intentionally
  // skipped per Howard's instruction.

  // Charter Oak — Double 4-1/2" Clapboard
  "Charter Oak Standard color Clap 4.5\" .046": {
    en: "Charter Oak® — Double 4-1/2\" Clapboard. Double 4-1/2\" exposure; 12'1\" panel length; 3/4\" field butt height; TriBeam system; rollover nail hem; oak grain texture; low-gloss finish; 0.046\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Charter Oak® — Clapboard doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 3/4\"; sistema TriBeam; pestaña de clavado enrollada; textura grano de roble; acabado bajo brillo; espesor nom. 0.046\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },
  "Charter Oak Architectural color Clap 4.5\" .046": {
    en: "Charter Oak® — Double 4-1/2\" Clapboard. Double 4-1/2\" exposure; 12'1\" panel length; 3/4\" field butt height; TriBeam system; rollover nail hem; oak grain texture; low-gloss finish; 0.046\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Charter Oak® — Clapboard doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 3/4\"; sistema TriBeam; pestaña de clavado enrollada; textura grano de roble; acabado bajo brillo; espesor nom. 0.046\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },

  // Charter Oak — Double 4-1/2" Dutch Lap
  "Charter Oak Standard color Dutch Lap 4.5\" .046": {
    en: "Charter Oak® — Double 4-1/2\" Dutch Lap. Double 4-1/2\" exposure; 12'1\" panel length; 3/4\" field butt height; TriBeam system; rollover nail hem; oak grain texture; low-gloss finish; 0.046\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Charter Oak® — Dutch Lap doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 3/4\"; sistema TriBeam; pestaña de clavado enrollada; textura grano de roble; acabado bajo brillo; espesor nom. 0.046\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },
  "Charter Oak Architectural color Dutch Lap 4.5\" .046": {
    en: "Charter Oak® — Double 4-1/2\" Dutch Lap. Double 4-1/2\" exposure; 12'1\" panel length; 3/4\" field butt height; TriBeam system; rollover nail hem; oak grain texture; low-gloss finish; 0.046\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Charter Oak® — Dutch Lap doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 3/4\"; sistema TriBeam; pestaña de clavado enrollada; textura grano de roble; acabado bajo brillo; espesor nom. 0.046\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },

  // Board & Batten® — 7" Vertical
  "vertical board and batten Standard color 7\"": {
    en: "Board & Batten® — 7\" Vertical. 7\" overall exposure; 10'0\" panel length; 5-1/2\" board width, 1-1/2\" batten width/height; light roughsawn texture; low-gloss finish; 0.050\" nom. thickness. Packaging: 1 square per carton; 17 panels per carton.",
    es: "Board & Batten® — 7\" Vertical. Exposición total 7\"; longitud de panel 10'0\"; ancho de tabla 5-1/2\", ancho/alto de listón 1-1/2\"; textura aserrada ligera; acabado bajo brillo; espesor nom. 0.050\". Empaque: 1 cuadrado por caja; 17 paneles por caja.",
  },
  "vertical board and batten Architectural color 7\"": {
    en: "Board & Batten® — 7\" Vertical. 7\" overall exposure; 10'0\" panel length; 5-1/2\" board width, 1-1/2\" batten width/height; light roughsawn texture; low-gloss finish; 0.050\" nom. thickness. Packaging: 1 square per carton; 17 panels per carton.",
    es: "Board & Batten® — 7\" Vertical. Exposición total 7\"; longitud de panel 10'0\"; ancho de tabla 5-1/2\", ancho/alto de listón 1-1/2\"; textura aserrada ligera; acabado bajo brillo; espesor nom. 0.050\". Empaque: 1 cuadrado por caja; 17 paneles por caja.",
  },

  // Coventry by Alside® — Double 4" Clap
  "Coventry Standard color Clap 4\" .042": {
    en: "Coventry by Alside® — Double 4\" Clapboard. Double 4\" exposure; 12'6\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 24 panels per carton.",
    es: "Coventry by Alside® — Clapboard doble 4\". Exposición doble 4\"; longitud de panel 12'6\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 24 paneles por caja.",
  },
  "Coventry Architectural color Clap 4\" .042": {
    en: "Coventry by Alside® — Double 4\" Clapboard. Double 4\" exposure; 12'6\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 24 panels per carton.",
    es: "Coventry by Alside® — Clapboard doble 4\". Exposición doble 4\"; longitud de panel 12'6\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 24 paneles por caja.",
  },

  // Coventry by Alside® — Double 4" Dutch Lap
  "Coventry Standard color Dutch lap 4\" .042": {
    en: "Coventry by Alside® — Double 4\" Dutch Lap. Double 4\" exposure; 12'6\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 24 panels per carton.",
    es: "Coventry by Alside® — Dutch Lap doble 4\". Exposición doble 4\"; longitud de panel 12'6\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 24 paneles por caja.",
  },
  "Coventry Architectural color Dutch lap 4\" .042": {
    en: "Coventry by Alside® — Double 4\" Dutch Lap. Double 4\" exposure; 12'6\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 24 panels per carton.",
    es: "Coventry by Alside® — Dutch Lap doble 4\". Exposición doble 4\"; longitud de panel 12'6\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 24 paneles por caja.",
  },

  // Coventry by Alside® — Double 5" Clap
  "Coventry Standard color Clap 5\" .042": {
    en: "Coventry by Alside® — Double 5\" Clapboard. Double 5\" exposure; 12'0\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 20 panels per carton.",
    es: "Coventry by Alside® — Clapboard doble 5\". Exposición doble 5\"; longitud de panel 12'0\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 20 paneles por caja.",
  },
  "Coventry Architectural color Clap 5\" .042": {
    en: "Coventry by Alside® — Double 5\" Clapboard. Double 5\" exposure; 12'0\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 20 panels per carton.",
    es: "Coventry by Alside® — Clapboard doble 5\". Exposición doble 5\"; longitud de panel 12'0\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 20 paneles por caja.",
  },

  // Coventry by Alside® — Double 5" Dutch Lap
  "Coventry Standard color Dutch lap 5\" .042": {
    en: "Coventry by Alside® — Double 5\" Dutch Lap. Double 5\" exposure; 12'0\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 20 panels per carton.",
    es: "Coventry by Alside® — Dutch Lap doble 5\". Exposición doble 5\"; longitud de panel 12'0\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 20 paneles por caja.",
  },
  "Coventry Architectural color Dutch lap 5\" .042": {
    en: "Coventry by Alside® — Double 5\" Dutch Lap. Double 5\" exposure; 12'0\" panel length; 1/2\" field butt height; rolled-top nail hem; natural cedar grain texture; low-gloss finish; 0.042\" nom. thickness. Packaging: 2 squares per carton; 20 panels per carton.",
    es: "Coventry by Alside® — Dutch Lap doble 5\". Exposición doble 5\"; longitud de panel 12'0\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura grano de cedro natural; acabado bajo brillo; espesor nom. 0.042\". Empaque: 2 cuadrados por caja; 20 paneles por caja.",
  },

  // Conquest® — Double 4-1/2" Clap
  "Conquest Standard color Clap 4.5\" .040": {
    en: "Conquest® — Double 4-1/2\" Clapboard. Double 4-1/2\" exposure; 12'1\" panel length; 1/2\" field butt height; rolled-top nail hem; subtle cedar grain texture; low-gloss finish; 0.040\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Conquest® — Clapboard doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura sutil grano de cedro; acabado bajo brillo; espesor nom. 0.040\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },
  "Conquest Architectural color Clap 4.5\" .040": {
    en: "Conquest® — Double 4-1/2\" Clapboard. Double 4-1/2\" exposure; 12'1\" panel length; 1/2\" field butt height; rolled-top nail hem; subtle cedar grain texture; low-gloss finish; 0.040\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Conquest® — Clapboard doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura sutil grano de cedro; acabado bajo brillo; espesor nom. 0.040\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },

  // Conquest® — Double 4-1/2" Dutch Lap
  "Conquest Standard color Dutch lap 4.5\" .040": {
    en: "Conquest® — Double 4-1/2\" Dutch Lap. Double 4-1/2\" exposure; 12'1\" panel length; 1/2\" field butt height; rolled-top nail hem; subtle cedar grain texture; low-gloss finish; 0.040\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Conquest® — Dutch Lap doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura sutil grano de cedro; acabado bajo brillo; espesor nom. 0.040\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },
  "Conquest Architectural color Dutch lap 4.5\" .040": {
    en: "Conquest® — Double 4-1/2\" Dutch Lap. Double 4-1/2\" exposure; 12'1\" panel length; 1/2\" field butt height; rolled-top nail hem; subtle cedar grain texture; low-gloss finish; 0.040\" nom. thickness. Packaging: 2 squares per carton; 22 panels per carton.",
    es: "Conquest® — Dutch Lap doble 4-1/2\". Exposición doble 4-1/2\"; longitud de panel 12'1\"; alto de cara 1/2\"; pestaña de clavado enrollada; textura sutil grano de cedro; acabado bajo brillo; espesor nom. 0.040\". Empaque: 2 cuadrados por caja; 22 paneles por caja.",
  },

  // Charter Oak Soffit — Aerated and Solid variants combined (catalog
  // has a single SKU per color tier; the PDF splits the spec across
  // two pages, so we surface both NFA notes inside one popover.)
  "Charter Oak Soffit Standard color": {
    en: "Charter Oak Soffit — 10\". Triple 3-1/3\" exposure; 12'0\" panel length; 3/4\" field butt height; TriBeam system; smooth texture; low-gloss finish; 0.042\" nom. thickness. Aerated variant: 8.06 sq.in. NFA / lineal ft, 9.68 sq.in. NFA / sq ft. Solid / Vertical variant: no venting. Packaging: 2 squares per carton; 20 panels per carton (both Aerated and Solid variants).",
    es: "Charter Oak Soffit — 10\". Exposición triple 3-1/3\"; longitud de panel 12'0\"; alto de cara 3/4\"; sistema TriBeam; textura lisa; acabado bajo brillo; espesor nom. 0.042\". Variante aireada: 8.06 pulg² NFA/pie lineal; 9.68 pulg² NFA/pie². Variante sólida/vertical: sin ventilación. Empaque: 2 cuadrados por caja; 20 paneles por caja (tanto variante aireada como sólida).",
  },
  "Charter Oak Soffit Architectural color": {
    en: "Charter Oak Soffit — 10\". Triple 3-1/3\" exposure; 12'0\" panel length; 3/4\" field butt height; TriBeam system; smooth texture; low-gloss finish; 0.042\" nom. thickness. Aerated variant: 8.06 sq.in. NFA / lineal ft, 9.68 sq.in. NFA / sq ft. Solid / Vertical variant: no venting. Packaging: 2 squares per carton; 20 panels per carton (both Aerated and Solid variants).",
    es: "Charter Oak Soffit — 10\". Exposición triple 3-1/3\"; longitud de panel 12'0\"; alto de cara 3/4\"; sistema TriBeam; textura lisa; acabado bajo brillo; espesor nom. 0.042\". Variante aireada: 8.06 pulg² NFA/pie lineal; 9.68 pulg² NFA/pie². Variante sólida/vertical: sin ventilación. Empaque: 2 cuadrados por caja; 20 paneles por caja (tanto variante aireada como sólida).",
  },

  // Greenbriar® Vintage Beaded Soffit — 8" (Aerated + Solid combined)
  "Greenbriar Soffit": {
    en: "Greenbriar® Vintage Beaded Soffit — 8\". Triple 2-1/2\" exposure; 12'6\" panel length; 3/8\" field butt height; smooth texture; low-gloss finish; 0.042\" nom. thickness. Aerated variant: 2.8 sq.in. NFA / lineal ft, 4.2 sq.in. NFA / sq ft. Solid variant: no venting. Packaging: 1 square per carton; 12 panels per carton (both Aerated and Solid variants).",
    es: "Greenbriar® Vintage Beaded Soffit — 8\". Exposición triple 2-1/2\"; longitud de panel 12'6\"; alto de cara 3/8\"; textura lisa; acabado bajo brillo; espesor nom. 0.042\". Variante aireada: 2.8 pulg² NFA/pie lineal; 4.2 pulg² NFA/pie². Variante sólida: sin ventilación. Empaque: 1 cuadrado por caja; 12 paneles por caja (tanto variante aireada como sólida).",
  },

  // ----- Iter 78z++++ — Alside Vinyl Accessories Reference (Howard, Feb 2026)
  // Source PDF: Alside_Vinyl_Accessories_Reference. The PDF is one
  // page with four physical SKUs but the catalog splits Standard /
  // Architectural color, so the same spec is repeated under every
  // matching catalog key. Items already covered earlier (Charter Oak,
  // Coventry, Conquest, etc.) are not repeated here.

  // Outside Corner Post — 4" woodgrain
  "Outside corners Standard color": {
    en: "4\" Woodgrain Outside Corner Post. 4\" outside corner post; 3/4\" receiving channel; 10'0\" length; woodgrain texture; low-gloss finish. Packaging: 100' per carton; 10 pieces per carton.",
    es: "Esquinero exterior 4\" textura grano de madera. Esquinero exterior 4\"; canal receptor 3/4\"; longitud 10'0\"; textura grano de madera; acabado bajo brillo. Empaque: 100' por caja; 10 piezas por caja.",
  },
  "Outside corners Architectural color": {
    en: "4\" Woodgrain Outside Corner Post. 4\" outside corner post; 3/4\" receiving channel; 10'0\" length; woodgrain texture; low-gloss finish. Packaging: 100' per carton; 10 pieces per carton.",
    es: "Esquinero exterior 4\" textura grano de madera. Esquinero exterior 4\"; canal receptor 3/4\"; longitud 10'0\"; textura grano de madera; acabado bajo brillo. Empaque: 100' por caja; 10 piezas por caja.",
  },

  // Inside Corner Post
  "Inside Corners": {
    en: "Inside Corner Post. 10'0\" length; 3/4\" receiving channel; matte texture; low-gloss finish. Packaging: 100' per carton; 10 pieces per carton.",
    es: "Esquinero interior. Longitud 10'0\"; canal receptor 3/4\"; textura mate; acabado bajo brillo. Empaque: 100' por caja; 10 piezas por caja.",
  },
  "Inside Corners (Siding) Standard color": {
    en: "Inside Corner Post. 10'0\" length; 3/4\" receiving channel; matte texture; low-gloss finish. Packaging: 100' per carton; 10 pieces per carton.",
    es: "Esquinero interior. Longitud 10'0\"; canal receptor 3/4\"; textura mate; acabado bajo brillo. Empaque: 100' por caja; 10 piezas por caja.",
  },
  "Inside Corners (Siding) Architectural color": {
    en: "Inside Corner Post. 10'0\" length; 3/4\" receiving channel; matte texture; low-gloss finish. Packaging: 100' per carton; 10 pieces per carton.",
    es: "Esquinero interior. Longitud 10'0\"; canal receptor 3/4\"; textura mate; acabado bajo brillo. Empaque: 100' por caja; 10 piezas por caja.",
  },

  // J-Channel 3/4"
  "3/4\" J-Channel Standard color (2 per Sq of siding)": {
    en: "J-Channel 3/4\". 3/4\" receiving channel; 1\" face; 12'6\" length; matte texture; low-gloss finish. Packaging: 500' per carton; 40 pieces per carton.",
    es: "J-Channel 3/4\". Canal receptor 3/4\"; cara 1\"; longitud 12'6\"; textura mate; acabado bajo brillo. Empaque: 500' por caja; 40 piezas por caja.",
  },
  "3/4\" J-Channel Architectural color (2 per Sq of siding)": {
    en: "J-Channel 3/4\". 3/4\" receiving channel; 1\" face; 12'6\" length; matte texture; low-gloss finish. Packaging: 500' per carton; 40 pieces per carton.",
    es: "J-Channel 3/4\". Canal receptor 3/4\"; cara 1\"; longitud 12'6\"; textura mate; acabado bajo brillo. Empaque: 500' por caja; 40 piezas por caja.",
  },

  // J-Channel 1/2"
  "1/2\" J-Channel (2 per Sq of siding)": {
    en: "J-Channel 1/2\". 1/2\" receiving channel; 1\" face; 12'6\" length; matte texture; low-gloss finish. Packaging: 500' per carton; 40 pieces per carton.",
    es: "J-Channel 1/2\". Canal receptor 1/2\"; cara 1\"; longitud 12'6\"; textura mate; acabado bajo brillo. Empaque: 500' por caja; 40 piezas por caja.",
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
