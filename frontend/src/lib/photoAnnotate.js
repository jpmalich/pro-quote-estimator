// Render pre-AI annotations into a photo via Canvas.
//
// Given an image URL + structured annotations (elevation tag, reference
// scale line, no-siding zones), returns a Blob containing a PNG with
// everything drawn ON TOP of the original photo, ready to send to Claude.
//
// Why burn the marks into the image instead of passing coordinates as
// text? Vision models are dramatically better at following visual cues
// they can see directly. A red line with "REF = 80 in" printed on the
// photo is unmistakable; a JSON note is much weaker.
//
// We also keep the structured payload around (returned via
// `describeAnnotations` below) so the prompt text describes what to
// look for too — belt and suspenders.

const ZONE_COLORS = {
  brick:       { fill: "rgba(180, 83, 9, 0.30)",   stroke: "#B45309" },
  stone:       { fill: "rgba(87, 83, 78, 0.30)",   stroke: "#57534E" },
  garage_door: { fill: "rgba(251, 191, 36, 0.30)", stroke: "#FBBF24" },
  stucco:      { fill: "rgba(168, 162, 158, 0.30)", stroke: "#A8A29E" },
  other:       { fill: "rgba(220, 38, 38, 0.30)",  stroke: "#DC2626" },
};
const ZONE_NAMES = {
  brick: "Brick",
  stone: "Stone",
  garage_door: "Garage door",
  stucco: "Stucco",
  other: "Other",
};

// Render annotations onto a copy of `photoUrl` and return a Blob.
//
// Iter 56b: cap output size + use JPEG (not PNG) to stay under the
// backend 8 MB ceiling. Modern iPhones shoot 12 MP photos that come out
// of Canvas as ~10–15 MB PNGs — those tripped the "Photo exceeds 8 MB
// limit" error on Howard's first real test. We downscale the longest
// side to 2400 px (Claude's vision quality plateaus around there) and
// re-encode as JPEG @ 0.85 quality. Typical output: 800 KB – 2 MB.
const MAX_LONG_SIDE_PX = 2400;
const JPEG_QUALITY = 0.85;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

/**
 * Render annotations onto a copy of `photoUrl` and return a JPEG Blob,
 * downscaled to keep payload size under control.
 *
 * @param {string} photoUrl
 * @param {{ elevation?: string, reference?: { p1, p2, inches } | null, zones?: Array }} annot
 * @returns {Promise<Blob>}
 */
export async function renderAnnotated(photoUrl, annot) {
  const img = await loadImage(photoUrl);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  // Compute downscale factor — preserves annotation coordinates (which
  // are in natural-pixel space) by scaling them along with the image.
  const longest = Math.max(naturalW, naturalH);
  const scale = longest > MAX_LONG_SIDE_PX ? MAX_LONG_SIDE_PX / longest : 1;
  const w = Math.round(naturalW * scale);
  const h = Math.round(naturalH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  ctx.scale(scale, scale);  // draw annotations in natural-pixel coords

  // Zones — hatched fill + outlined polygon + label.
  for (const z of annot?.zones || []) {
    const c = ZONE_COLORS[z.category] || ZONE_COLORS.other;
    ctx.beginPath();
    z.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = Math.max(3, naturalW / 600);
    ctx.stroke();
    // Label
    const xs = z.points.map((p) => p.x);
    const ys = z.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const fontPx = Math.max(20, naturalW / 60);
    ctx.font = `bold ${fontPx}px sans-serif`;
    const label = `NO SIDING · ${ZONE_NAMES[z.category] || z.category}`;
    const tw = ctx.measureText(label).width;
    const pad = fontPx * 0.4;
    ctx.fillStyle = "#09090B";
    ctx.fillRect(cx - tw / 2 - pad, cy - fontPx / 2 - pad, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
  }

  // Reference scale line — red with endpoints + label.
  if (annot?.reference) {
    const { p1, p2, inches } = annot.reference;
    ctx.strokeStyle = "#DC2626";
    ctx.lineWidth = Math.max(5, naturalW / 400);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    const r = Math.max(7, naturalW / 250);
    ctx.fillStyle = "#DC2626";
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const fontPx = Math.max(22, naturalW / 55);
    ctx.font = `bold ${fontPx}px sans-serif`;
    const label = `REF = ${inches}"`;
    const tw = ctx.measureText(label).width;
    const pad = fontPx * 0.4;
    ctx.fillStyle = "#DC2626";
    ctx.fillRect(mx - tw / 2 - pad, my - fontPx / 2 - pad, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx, my);
  }

  // Target house pin — green rectangle around the target structure +
  // "TARGET HOUSE" label. For aerial photos this OVERRIDES the auto-
  // burned red crosshair the satellite endpoint added from the
  // geocoded lat/lon (which often misses on rural addresses with
  // multiple structures). New format: {x1,y1,x2,y2} two-corner box —
  // tight enough to isolate a garage from a house 2 ft away. Legacy:
  // {x,y} single-tap pin renders a small ring (back-compat).
  if (annot?.targetPin) {
    const lw = Math.max(4, naturalW / 240);
    const tp = annot.targetPin;
    if ("x1" in tp) {
      const { x1, y1, x2, y2 } = tp;
      const w = x2 - x1;
      const h = y2 - y1;
      ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
      ctx.fillRect(x1, y1, w, h);
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = lw;
      ctx.strokeRect(x1, y1, w, h);
      const cx = (x1 + x2) / 2;
      const fontPx = Math.max(22, naturalW / 55);
      ctx.font = `bold ${fontPx}px sans-serif`;
      const label = "TARGET HOUSE";
      const tw = ctx.measureText(label).width;
      const pad = fontPx * 0.4;
      const labelY = y1 - fontPx - pad * 2;
      const ty = labelY < pad ? y2 + pad : labelY;
      ctx.fillStyle = "#10B981";
      ctx.fillRect(cx - tw / 2 - pad, ty, tw + pad * 2, fontPx + pad * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, cx, ty + pad);
    } else {
      // Legacy ring fallback for old saved sessions.
      const { x, y } = tp;
      const ringR = Math.max(20, naturalW / 50);
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#10B981";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, naturalW / 350), 0, Math.PI * 2);
      ctx.fill();
      const fontPx = Math.max(22, naturalW / 55);
      ctx.font = `bold ${fontPx}px sans-serif`;
      const label = "TARGET HOUSE";
      const tw = ctx.measureText(label).width;
      const pad = fontPx * 0.4;
      const ty = y - ringR - fontPx - pad * 2;
      const tyFinal = ty < pad ? y + ringR + pad : ty;
      ctx.fillStyle = "#10B981";
      ctx.fillRect(x - tw / 2 - pad, tyFinal, tw + pad * 2, fontPx + pad * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, x, tyFinal + pad);
    }
  }

  // Iter 57e — Tagged windows: yellow circle + STYLE / W×H badge, drawn
  // on top of zones so the contractor-confirmed window markers always
  // win the visual fight against a brick mask that overlaps a window.
  // STYLE_ABBR matches the PhotoAnnotateModal map exactly.
  const STYLE_ABBR = {
    "Double Hung": "DH", "Single Hung": "SH",
    "Casement": "CA", "Twin Casement": "2CA",
    "Awning": "AW", "Hopper": "HP",
    "2-Lite Slider": "2SL", "3-Lite Slider": "3SL",
    "Picture": "PIC",
    "Twin Double Hung": "2DH", "Twin Single Hung": "2SH", "Triple Double Hung": "3DH",
    "Bay Window": "BAY", "Bow Window": "BOW",
    "Half-Round": "1/2", "Quarter-Round": "1/4",
    "Arch": "ARC", "Octagon": "OCT", "Hexagon": "HEX",
    "Garden Window": "GDN", "Other Shape": "OTH",
  };
  for (const win of annot?.windows || []) {
    const r = Math.max(12, naturalW / 200);
    ctx.fillStyle = "#FBBF24";
    ctx.strokeStyle = "#92400E";
    ctx.lineWidth = Math.max(2, naturalW / 700);
    ctx.beginPath();
    ctx.arc(win.x, win.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Badge to the right of the pin: STYLE abbreviation on top,
    // W×H below in monospace.
    const abbr = STYLE_ABBR[win.style] || "?";
    const sizeLabel = `${Math.round(win.width_in)}×${Math.round(win.height_in)}`;
    const fontPx = Math.max(20, naturalW / 60);
    ctx.font = `bold ${fontPx}px sans-serif`;
    const wMax = Math.max(
      ctx.measureText(abbr).width,
      ctx.measureText(sizeLabel).width,
    );
    const pad = fontPx * 0.35;
    const bx = win.x + r + pad;
    const by = win.y - fontPx;
    const bw = wMax + pad * 2;
    const bh = fontPx * 2 + pad * 3;
    ctx.fillStyle = "#92400E";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(abbr, bx + pad, by + pad);
    ctx.font = `${fontPx}px monospace`;
    ctx.fillText(sizeLabel, bx + pad, by + fontPx + pad * 1.5);
  }

  // Elevation badge — top-left corner.
  if (annot?.elevation && annot.elevation !== "detail") {
    const fontPx = Math.max(28, naturalW / 45);
    const label = annot.elevation.toUpperCase() + " ELEVATION";
    ctx.font = `bold ${fontPx}px sans-serif`;
    const tw = ctx.measureText(label).width;
    const pad = fontPx * 0.5;
    ctx.fillStyle = "#7C3AED";
    ctx.fillRect(0, 0, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, pad, pad);
  }

  return await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
}

/**
 * Build a human-readable text description of all annotations to send
 * alongside the rendered images, so Claude has both visual + structured
 * cues.
 *
 * @param {Array<{ photoName, elevation, reference, zones }>} entries
 * @returns {string}
 */
export function describeAnnotations(entries) {
  const lines = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const parts = [];
    if (e.elevation && e.elevation !== "detail") {
      parts.push(`${e.elevation.toUpperCase()} ELEVATION`);
    }
    if (e.reference) {
      parts.push(`Red line marked "REF = ${e.reference.inches}\"" is a known ${e.reference.inches}-inch span — anchor scale to this`);
    }
    if (e.targetPin) {
      parts.push(`Green rectangle labeled "TARGET HOUSE" outlines the contractor-confirmed target structure — measure ONLY what's inside the green box, ignore any other buildings even if they're a few feet away (overrides any red auto-crosshair)`);
    }
    const zoneBits = (e.zones || []).map((z) => `${ZONE_NAMES[z.category] || z.category}`);
    if (zoneBits.length) {
      parts.push(`Red hatched areas marked NO SIDING are NOT siding (${zoneBits.join(", ")}) — exclude from siding_pct_this_wall`);
    }
    if (e.windows && e.windows.length) {
      // Iter 57e — pre-AI window tags are AUTHORITATIVE.
      const winBits = e.windows.map((w) => `${w.style} ${Math.round(w.width_in)}"×${Math.round(w.height_in)}"`);
      parts.push(
        `YELLOW PINS with brown badges mark CONTRACTOR-TAGGED WINDOWS — ` +
        `treat each as GROUND TRUTH for that exact window's style + size, ` +
        `overriding whatever your photo-inference would have guessed. ` +
        `Tagged: ${winBits.join("; ")}. ` +
        `Each yellow pin = one window — include in your openings list ` +
        `with the contractor's exact style + width_in + height_in, ` +
        `style_confidence=100 (contractor-verified).`
      );
    }
    if (parts.length) {
      lines.push(`Photo ${i + 1}: ${parts.join(". ")}.`);
    }
  }
  return lines.join("\n");
}
