// Iter 78s — Build ElevationDrawing-ready props from AI Measure / Phase 2
// HOVER vision / Blueprint outputs. Single source of truth so the renderer
// stays decoupled from data shape.
//
// Iter 78u — Position fallback rewrite. Claude's `bbox` is normalized to
// the PHOTO (which includes sky + lawn + neighboring walls), not the wall
// facade. Mapping bbox.x → x_pct directly produced "random-looking"
// placement. Until the Vision pass returns true wall-relative coordinates,
// we evenly distribute openings horizontally and use industry-standard
// sill heights vertically. Contractor can still drag-nudge.
//
// Input shapes supported:
//   1. AI Measure: { walls: [{name, width_ft, height_ft, ...}], openings: [{wall, width_in, height_in, bbox, label, type, id}] }
//   2. HOVER Phase 2 vision: { per_elevation_siding_from_drawing: { Front: {facade_width_ft, facade_height_ft, window_dims, ...} } }
//
// Returns: [ { label, facade_width_ft, facade_height_ft, openings: [{id, label, x_pct, y_pct, width_ft, height_ft, type, sill_height_ft}], rake_lf_on_face, roof_style? } ]

const WALL_LABELS = ["front", "back", "left", "right"];

// Industry-standard sill heights from finished floor. Used when AI doesn't
// give us a wall-relative vertical position.
const DEFAULT_SILL_FT = {
  window: 3.0,        // ~36" sill (counter-height egress windows are 36-44")
  entry_door: 0,
  patio_door: 0,
  patio: 0,
  garage_door: 0,
  garage: 0,
  door: 0,
  vent: 6.5,          // gable vents are near the peak
  other: 3.0,
};

// Evenly distribute N openings across a wall, leaving symmetric padding.
// 1 opening  → [0.5]
// 2 openings → [0.33, 0.67]
// 3 openings → [0.25, 0.5, 0.75]
// N openings → [(i+1)/(N+1) for i in 0..N-1]
function evenXPcts(n) {
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
}

// Convert sill_height_ft + opening height to y_pct (center) on a facade
// where SVG origin is top-left and y_pct=0 is the eave.
function sillToYPct(sillFt, opHeightFt, facadeHeightFt) {
  if (!facadeHeightFt || facadeHeightFt <= 0) return 0.5;
  const centerFromFloorFt = sillFt + opHeightFt / 2;
  const centerFromTopFt = facadeHeightFt - centerFromFloorFt;
  // clamp 0.05..0.95 so openings never touch the eave or ground line
  return Math.max(0.05, Math.min(0.95, centerFromTopFt / facadeHeightFt));
}

export function buildElevationsFromAIMeasure(measurements) {
  const walls = Array.isArray(measurements?.walls) ? measurements.walls : [];
  const openings = Array.isArray(measurements?.openings) ? measurements.openings : [];
  return walls.map((w) => {
    const name = (w.name || w.wall || w.label || "").toLowerCase();
    const facadeH = Number(w.height_ft) || Number(measurements?.avg_wall_height_ft) || 0;
    // Group openings on this wall in source order so the order Claude
    // reported (typically left-to-right) is preserved for even spacing.
    const wallOpenings = openings.filter((op) => (op.wall || "").toLowerCase() === name);
    const xPcts = evenXPcts(wallOpenings.length);
    const ownOpenings = wallOpenings.map((op, idx) => {
      const opType = op.type || "window";
      const widthFt = (Number(op.width_in) || 36) / 12;
      const heightFt = (Number(op.height_in) || 48) / 12;
      const sillFt = Number(op.sill_height_in)
        ? Number(op.sill_height_in) / 12
        : (DEFAULT_SILL_FT[opType] ?? 3.0);
      return {
        id: op.id || `${name}-${opType}-${idx}`,
        label: op.label
          || (opType.includes("door") || opType === "patio" || opType === "garage" ? "D" : "W") + (idx + 1),
        x_pct: xPcts[idx],
        y_pct: sillToYPct(sillFt, heightFt, facadeH),
        width_ft: widthFt,
        height_ft: heightFt,
        sill_height_ft: sillFt,
        type: opType,
        style: op.style || "",
      };
    });
    return {
      label: name.charAt(0).toUpperCase() + name.slice(1),
      facade_width_ft: Number(w.width_ft) || 0,
      facade_height_ft: facadeH,
      gable_triangle_height_ft: Number(w.gable_triangle_height_ft) || 0,
      // Iter 78u — dormer face area on this elevation. Renderers split
      // the ft² into one or more roof-mounted dormer boxes.
      dormer_face_sqft: Number(w.dormer_face_sqft) || 0,
      openings: ownOpenings,
      rake_lf_on_face: Number(w.gable_triangle_height_ft) > 0 ? Number(w.width_ft) : 0,
      // Roof style auto-inference: gable if Claude flagged a gable_triangle, else null (component decides)
      roof_style: Number(w.gable_triangle_height_ft) > 0 ? "gable" : null,
    };
  }).filter((e) => WALL_LABELS.includes(e.label.toLowerCase()) && e.facade_width_ft > 0);
}

export function buildElevationsFromHoverVision(measurements) {
  const src = measurements?.per_elevation_siding_from_drawing || {};
  return Object.entries(src).map(([label, data]) => {
    const facadeH = Number(data.facade_height_ft) || 0;
    const winDims = Array.isArray(data.window_dims) ? data.window_dims : [];
    const xPcts = evenXPcts(winDims.length);
    const wins = winDims.map((w, idx) => {
      const widthFt = Number(w.width_ft) || 3;
      const heightFt = Number(w.height_ft) || 4;
      const sillFt = Number(w.sill_height_ft) || DEFAULT_SILL_FT.window;
      return {
        id: `hover-${label.toLowerCase()}-${idx}`,
        label: w.label || `W${idx + 1}`,
        x_pct: xPcts[idx],
        y_pct: sillToYPct(sillFt, heightFt, facadeH),
        width_ft: widthFt,
        height_ft: heightFt,
        sill_height_ft: sillFt,
        type: "window",
      };
    });
    return {
      label,
      facade_width_ft: Number(data.facade_width_ft) || 0,
      facade_height_ft: facadeH,
      openings: wins,
      rake_lf_on_face: Number(data.rake_lf_on_face) || 0,
    };
  }).filter((e) => e.facade_width_ft > 0);
}
