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

  // Target house pin — green crosshair + ring + "TARGET HOUSE" label.
  // For aerial photos this OVERRIDES the auto-burned red crosshair the
  // satellite endpoint added from the geocoded lat/lon (which often
  // misses on rural addresses with multiple structures).
  if (annot?.targetPin) {
    const { x, y } = annot.targetPin;
    const ringR = Math.max(40, naturalW / 14);
    const lw = Math.max(4, naturalW / 240);
    const armLen = ringR * 2;
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#10B981";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(6, naturalW / 200), 0, Math.PI * 2);
    ctx.fill();
    // Crosshair arms broken at the ring so the house roof remains visible.
    const gap = ringR + lw * 2;
    ctx.beginPath();
    ctx.moveTo(x - armLen, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);    ctx.lineTo(x + armLen, y);
    ctx.moveTo(x, y - armLen); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);    ctx.lineTo(x, y + armLen);
    ctx.stroke();
    const fontPx = Math.max(22, naturalW / 55);
    ctx.font = `bold ${fontPx}px sans-serif`;
    const label = "TARGET HOUSE";
    const tw = ctx.measureText(label).width;
    const pad = fontPx * 0.4;
    const labelY = y - ringR - armLen / 2 - fontPx - pad;
    const ty = labelY < pad ? y + ringR + armLen / 2 + pad : labelY;
    ctx.fillStyle = "#10B981";
    ctx.fillRect(x - tw / 2 - pad, ty - pad, tw + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, x, ty);
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
      parts.push(`Green ring labeled "TARGET HOUSE" marks the contractor-confirmed target structure — measure ONLY this house, ignore any other buildings in frame (overrides any red auto-crosshair)`);
    }
    const zoneBits = (e.zones || []).map((z) => `${ZONE_NAMES[z.category] || z.category}`);
    if (zoneBits.length) {
      parts.push(`Red hatched areas marked NO SIDING are NOT siding (${zoneBits.join(", ")}) — exclude from siding_pct_this_wall`);
    }
    if (parts.length) {
      lines.push(`Photo ${i + 1}: ${parts.join(". ")}.`);
    }
  }
  return lines.join("\n");
}
