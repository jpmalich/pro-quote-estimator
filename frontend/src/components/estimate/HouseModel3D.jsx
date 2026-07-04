// Iter 79j.22 — 3D House Model view for the AI Measure preview.
//
// Builds a parametric 3D house from the current AI-measure `preview`:
//   footprint W×D  ← approximated from front/back/left/right wall widths
//   eaveHeight     ← measurements._ai_avg_wall_height_ft (may be defaulted)
//   roof pitch     ← DEFAULTED (Claude doesn't extract pitch reliably)
//   openings       ← raw_ai.openings, auto-spaced across each wall
//
// SSOT rule (per Howard 2026-02-28):
//   The side panel's "Squares / J-channel / corner post / starter"
//   values are read DIRECTLY from `preview.lines` — never re-implemented
//   here. The whole-house totals section reflects the exact same numbers
//   the estimator ships. Per-facade sqft/openings come from
//   `preview.measurements._per_elevation_breakdown` (already computed
//   server-side).
//
// Editable overrides:
//   • roof pitch (dropdown)  • eave height (number)  • per-wall width
//   Overrides update the 3D drawing LIVE (visuals only) but do NOT
//   silently recompute line quantities. A prominent hint tells the
//   contractor to hit Re-run if they want the estimator to reflect the
//   override. This preserves single-source-of-truth.

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { AlertTriangle, Check } from "lucide-react";

const ROOF_PITCHES = [4, 6, 8, 10, 12];
const ROOF_TYPES = [
  { id: "gable", label: "Gable" },
  { id: "hip", label: "Hip" },
  { id: "gable-shed-dormer", label: "Gable + shed dormer" },
];
// Iter 79j.32 — Ridge axis is a first-class user-toggleable choice.
// Runs perpendicular to the gable-end walls: "x" = ridge runs
// left↔right (side-gable, gable ends on LEFT + RIGHT walls);
// "z" = ridge runs front↔back (front-gable, gable ends on FRONT +
// BACK walls). Flipping this re-derives gableEnd assignment,
// roof-plane orientation, and dormer slope face in one place.
const RIDGE_AXES = [
  { id: "x", label: "Side-gable (ridge L↔R)" },
  { id: "z", label: "Front-gable (ridge F↔B)" },
];
const DEFAULT_PITCH = 6;
const DEFAULT_EAVE_HEIGHT = 10;
const AMBER = "#F59E0B";
const ROOF_TYPE_CONFIDENCE_THRESHOLD = 0.8;

function pitchRise(widthFt, pitchOver12) {
  // rise across HALF the roof span, e.g. 6/12 on a 40 ft span = 20 × 6/12 = 10 ft.
  return (widthFt / 2) * (pitchOver12 / 12);
}

// Iter 79j.31 — Derive ridge axis from Claude's per-wall gable data.
// Rule: gable-end walls are those with gable_triangle_height_ft > 0,
// and the ridge runs PERPENDICULAR to them. front/back gables ⇒ ridge
// along Z (front-back); left/right gables ⇒ ridge along X (left-right).
// Returns null when ambiguous (both axes claim gables) or absent.
function deriveRidgeAxis(walls) {
  const gabled = (walls || []).filter((w) => Number(w?.gable_triangle_height_ft || 0) > 0);
  if (!gabled.length) return null;
  const labels = gabled.map((w) => (w.label || "").toLowerCase());
  const hasLR = labels.some((l) => l === "left" || l === "right");
  const hasFB = labels.some((l) => l === "front" || l === "back");
  if (hasLR && !hasFB) return "x";
  if (hasFB && !hasLR) return "z";
  return null;
}

// Iter 79j.23 — Derive roof pitch from any gable-end wall Claude found.
// Formula: rise = (width / 2) × (pitch / 12)  ⇒  pitch = rise × 24 / width.
// When the house has multiple gables we average the raw values before
// snapping to the nearest supported pitch (4/6/8/10/12). Returns null
// when no gable data is available — caller falls back to DEFAULT_PITCH.
function deriveRoofPitchFromWalls(walls) {
  const gables = (walls || []).filter(
    (w) => Number(w?.gable_triangle_height_ft || 0) > 0 && Number(w?.width_ft || 0) > 0,
  );
  if (!gables.length) return null;
  const raws = gables.map((w) => (Number(w.gable_triangle_height_ft) * 24) / Number(w.width_ft));
  const avg = raws.reduce((a, b) => a + b, 0) / raws.length;
  let best = ROOF_PITCHES[0];
  let bestDelta = Math.abs(avg - best);
  for (const p of ROOF_PITCHES) {
    const d = Math.abs(avg - p);
    if (d < bestDelta) {
      best = p;
      bestDelta = d;
    }
  }
  return { pitch: best, raw: Math.round(avg * 10) / 10, sampleCount: gables.length };
}

// Iter 79j.28 — Palette mapping for Howard's most-common Alside siding
// colors. When the estimate has a palette NAME selected (via the
// "Siding Color" dropdown on the JOB INFORMATION panel), we look up
// a representative hex here so the 3D render matches. Unknown names
// fall through to the AI-sampled hex. Kept short deliberately — this
// isn't a color-management system, just enough to bridge Howard's
// most common picks. Add more as they come up in real estimates.
const ALSIDE_COLOR_HEX = {
  "white": "#F2F0EA",
  "colonial white": "#EEE9DD",
  "cape cod grey": "#8F8B83",
  "cape cod gray": "#8F8B83",
  "sandalwood": "#C8B58F",
  "wicker": "#D6C5A0",
  "sable brown": "#5C4A3A",
  "harbor grey": "#767C7B",
  "harbor gray": "#767C7B",
  "misty shadow": "#B8B7B3",
  "flagstone": "#8B7F73",
  "pebblestone clay": "#B39F82",
  "desert tan": "#B79E7A",
  "sterling grey": "#9DA0A0",
  "sterling gray": "#9DA0A0",
  "autumn red": "#7C2E24",
  "cranberry": "#8A1E20",
  "hunter green": "#2F4F3E",
  "forest green": "#2E4632",
  "midnight blue": "#1F2B3D",
  "sage": "#8A9784",
};

function hexForPaletteName(name) {
  if (!name || typeof name !== "string") return null;
  return ALSIDE_COLOR_HEX[name.trim().toLowerCase()] || null;
}

// Build a house-JSON shape from the AI preview + user overrides.
function buildHouseJson(preview, overrides, estimate) {
  if (!preview) return null;
  // Iter 79j.34 — Which producer generated this preview? Set on the
  // measurements dict by the aggregator ("blueprint" from
  // ai_blueprint.py, "ai" default for ai_measure.py). Drives badge
  // wording throughout the panel — a value read from a printed
  // dimension is BLUEPRINT-verified, not AI-inferred.
  const sourceKind = preview.measurements?._source_kind === "blueprint" ? "blueprint" : "ai";
  const walls = preview.raw_ai?.walls || [];
  const openings = preview.raw_ai?.openings || [];
  const avgAiEave = preview.measurements?._ai_avg_wall_height_ft;
  // Iter 79j.23 — try to derive pitch from Claude's gable heights before
  // falling back to the 6/12 default.
  const aiPitch = deriveRoofPitchFromWalls(walls);
  const pitch = overrides.pitch ?? aiPitch?.pitch ?? DEFAULT_PITCH;
  const pitchSource = overrides.pitch != null
    ? "user"
    : aiPitch
    ? "ai"
    : "default";
  // Iter 79j.31 — ridge axis cascade. Rides alongside roof.type.
  // Gable-end walls, roof-plane orientation, dormer slope assignment,
  // and gable-area math ALL follow from this axis — see buildScene.
  const aiRidgeAxis = deriveRidgeAxis(walls);
  const ridgeAxis = overrides.ridgeAxis ?? aiRidgeAxis ?? "x";
  const ridgeAxisSource = overrides.ridgeAxis
    ? "user"
    : aiRidgeAxis
    ? "ai"
    : "default";
  // Match primary walls by label. If a label is missing, keep the wall
  // but flag "estimated" in the UI.
  const findWall = (lab) => walls.find((w) => (w.label || "").toLowerCase() === lab);
  const front = findWall("front");
  const back = findWall("back");
  const left = findWall("left");
  const right = findWall("right");
  const widthFront = overrides.widths?.front ?? front?.width_ft ?? 32;
  const widthBack = overrides.widths?.back ?? back?.width_ft ?? widthFront;
  const widthLeft = overrides.widths?.left ?? left?.width_ft ?? 24;
  const widthRight = overrides.widths?.right ?? right?.width_ft ?? widthLeft;
  const footprintW = Math.max(widthFront, widthBack);
  const footprintD = Math.max(widthLeft, widthRight);

  // Iter 79j.24 — Per-facade eave heights. Claude reports `height_ft` on
  // every walls[] entry; we prefer that over the whole-house average.
  // Sources cascade: user override > wall-specific AI > whole-house AI
  // average > 10ft default. Sources drive the badge color in the UI.
  const eaveOverrides = overrides.eaveHeights || {};
  const resolveEave = (id, wallData) => {
    if (eaveOverrides[id] != null) return { h: Number(eaveOverrides[id]), source: "user" };
    const wallH = Number(wallData?.height_ft || 0);
    if (wallH > 0) return { h: wallH, source: "ai" };
    const avgH = Number(avgAiEave || 0);
    if (avgH > 0) return { h: avgH, source: "ai-avg" };
    return { h: DEFAULT_EAVE_HEIGHT, source: "default" };
  };
  const eaves = {
    front: resolveEave("front", front),
    back: resolveEave("back", back),
    left: resolveEave("left", left),
    right: resolveEave("right", right),
  };
  const avgEave = (eaves.front.h + eaves.back.h + eaves.left.h + eaves.right.h) / 4;

  // Iter 79j.27 — Split openings into main-wall vs on-dormer BEFORE
  // grouping. Dormer openings drive dormer.width + drive the face-wall
  // window meshes; main-wall openings drive the regular wall renders.
  // A dormer classification only "sticks" when the roof type ends up
  // gable-shed-dormer (see below). Otherwise all openings flow to the
  // main walls unchanged.
  const mainOpenings = openings.filter((o) => !o.on_dormer);
  const dormerOpeningsRaw = openings.filter((o) => o.on_dormer);
  const openingsByWall = mainOpenings.reduce((acc, o) => {
    const k = (o.wall || "other").toLowerCase();
    (acc[k] = acc[k] || []).push(o);
    return acc;
  }, {});
  // True per-wall X-positioning using photo bbox (Iter 79j.27). If a
  // bbox is present, use its X center as a fraction of the wall width;
  // otherwise fall back to even auto-spacing so nothing regresses.
  const autoSpace = (list, wallWidth, wallHeight) => {
    if (!list?.length) return [];
    const n = list.length;
    return list.map((o, i) => {
      const w = (o.width_in || 36) / 12;
      const h = (o.height_in || 48) / 12;
      // Iter 79j.28 — true Y positioning from bbox. Photo Y origin is
      // top-left, so worldY (from ground) = wallHeight × (1 − photoY).
      // Doors that Claude bbox'd near the floor land at Y≈0 naturally.
      const bboxCx = o.bbox && Number.isFinite(o.bbox.x) && Number.isFinite(o.bbox.w)
        ? Math.min(1, Math.max(0, o.bbox.x + o.bbox.w / 2))
        : null;
      const bboxCy = o.bbox && Number.isFinite(o.bbox.y) && Number.isFinite(o.bbox.h)
        ? Math.min(1, Math.max(0, o.bbox.y + o.bbox.h / 2))
        : null;
      const isDoor = (o.type || "").toLowerCase().includes("door");
      // Fallback Y (no bbox): entry/patio/garage doors at floor, windows at 3.2ft.
      const fallbackY = isDoor ? 0 : 3.2;
      const worldYCenter = bboxCy != null
        ? Math.max(0, Math.min(wallHeight - h, wallHeight * (1 - bboxCy) - h / 2))
        : fallbackY;
      const slot = wallWidth / n;
      const cx = bboxCx != null ? bboxCx * wallWidth : slot * (i + 0.5);
      return {
        type: (o.type || "window").toLowerCase(),
        style: o.style,
        x: Math.max(0.5, Math.min(wallWidth - w - 0.5, cx - w / 2)),
        y: worldYCenter,
        w,
        h,
        confidence: o.style_confidence ?? o.confidence ?? null,
      };
    });
  };

  // Iter 79j.26 — Roof type cascade: user > AI (≥0.8 confidence) >
  // default 'gable'. Below-threshold AI values still surface in the
  // tooltip so contractors can double-check.
  const aiRoofType = preview.measurements?._ai_roof_type || null;
  const aiRoofTypeConfidence = Number(preview.measurements?._ai_roof_type_confidence ?? 0);
  const aiRoofTypeReasoning = preview.measurements?._ai_roof_type_reasoning || "";
  const aiRoofTypeConfident = aiRoofType && aiRoofTypeConfidence >= ROOF_TYPE_CONFIDENCE_THRESHOLD;
  const roofType = overrides.roofType
    ?? (aiRoofTypeConfident ? aiRoofType : "gable");
  const roofTypeSource = overrides.roofType
    ? "user"
    : aiRoofTypeConfident
    ? "ai"
    : aiRoofType
    ? "ai-low-conf"
    : "default";

  // Iter 79j.31 — Dormer face is slope-relative. Legacy "front"/"rear"
  // is auto-migrated based on ridge axis so persisted data stays valid:
  //   ridgeAxis="x": front→slope-front, rear/back→slope-back
  //   ridgeAxis="z": front→slope-left, rear/back→slope-right (arbitrary
  //                  but stable mapping; user can flip in the panel)
  const aiDormer = preview.measurements?._ai_dormer || null;
  const dormerOverride = overrides.dormer || {};
  const legacyFace = dormerOverride.face ?? aiDormer?.face ?? "front";
  const slopesForAxis = ridgeAxis === "x" ? ["slope-front", "slope-back"] : ["slope-left", "slope-right"];
  const migrateFace = (f) => {
    if (slopesForAxis.includes(f)) return f;   // already slope-relative
    if (ridgeAxis === "x") return f === "rear" || f === "back" ? "slope-back" : "slope-front";
    return f === "rear" || f === "back" ? "slope-right" : "slope-left";
  };
  const dormerFace = migrateFace(legacyFace);
  // Face wall width for the dormer facade: on a slope-facing dormer the
  // "face" wall runs parallel to the ridge, so its width equals the
  // ridge-parallel footprint dimension.
  const dormerFaceWallWidth = ridgeAxis === "x" ? footprintW : footprintD;
  // Position each dormer opening on its face using bbox.x when available.
  // Vertical position on the face is derived from bbox.y relative to the
  // dormer face's height range (mainRoofY at zFace ↔ faceTop).
  const dormerOpeningsPositioned = dormerOpeningsRaw.map((o) => {
    const w = (o.width_in || 30) / 12;
    const h = (o.height_in || 42) / 12;
    const bboxCenter = o.bbox && Number.isFinite(o.bbox.x) && Number.isFinite(o.bbox.w)
      ? Math.min(1, Math.max(0, o.bbox.x + o.bbox.w / 2))
      : 0.5;
    const bboxCy = o.bbox && Number.isFinite(o.bbox.y) && Number.isFinite(o.bbox.h)
      ? Math.min(1, Math.max(0, o.bbox.y + o.bbox.h / 2))
      : null;
    const cxOnWall = bboxCenter * dormerFaceWallWidth;
    return {
      w, h,
      cxOnWall,           // center X in wall-local coords, 0 = left edge of wall
      bboxCy,             // vertical fraction on the photo (null → default center)
      type: (o.type || "window").toLowerCase(),
      style: o.style,
      confidence: o.style_confidence ?? o.confidence ?? null,
    };
  });
  let derivedDormerWidth = null;
  let derivedDormerOffsetX = null;
  if (dormerOpeningsPositioned.length > 0) {
    const halves = dormerOpeningsPositioned.map((o) => ({
      left: o.cxOnWall - o.w / 2,
      right: o.cxOnWall + o.w / 2,
    }));
    const leftmost = Math.min(...halves.map((s) => s.left));
    const rightmost = Math.max(...halves.map((s) => s.right));
    // 1.5' margin per side
    const inferredLeft = Math.max(0, leftmost - 1.5);
    const inferredRight = Math.min(dormerFaceWallWidth, rightmost + 1.5);
    derivedDormerWidth = Math.max(6, inferredRight - inferredLeft);
    // Wall center is at dormerFaceWallWidth/2 in wall coords.
    // In world coords the wall runs from -dormerFaceWallWidth/2 to +dormerFaceWallWidth/2.
    // dormer's inferred center X in wall coords = (inferredLeft + inferredRight)/2
    // Convert to world X (offset from wall center):
    derivedDormerOffsetX = ((inferredLeft + inferredRight) / 2) - dormerFaceWallWidth / 2;
  }
  const dormerWidth = Number(
    dormerOverride.width
    ?? (derivedDormerWidth != null ? derivedDormerWidth : (aiDormer?.width_ft ?? Math.min(footprintW * 0.6, 16))),
  );
  const dormerKnee = Number(dormerOverride.kneeWallHeight ?? aiDormer?.knee_wall_height_ft ?? 4);
  const dormerOffsetX = Number(
    dormerOverride.offsetX
    ?? (derivedDormerOffsetX != null ? derivedDormerOffsetX : (aiDormer?.offset_x_ft ?? 0)),
  );
  const dormerWidthSource = dormerOverride.width != null
    ? "user"
    : derivedDormerWidth != null
    ? "ai-inferred"        // amber — derived from openings, not a direct AI measurement
    : aiDormer?.width_ft
    ? "ai"
    : "default";

  // Iter 79j.31 — gable-end assignment now follows ridge axis.
  // Every downstream consumer (wall polygons, per-wall takeoff,
  // dormer eligibility) reads facade.gableEnd instead of hard-coding
  // by label.
  const gableEndIds = ridgeAxis === "x" ? new Set(["left", "right"]) : new Set(["front", "back"]);
  const mkFacade = (id, label, widthOverride, wallData, eave) => ({
    id,
    label,
    width: widthOverride,
    eaveHeight: eave.h,
    eaveHeightSource: eave.source,
    gableEnd: gableEndIds.has(id),
    confidence: wallData?.confidence ?? null,
    estimated: !wallData,
    aiGableTriangleHeightFt: Number(wallData?.gable_triangle_height_ft || 0),
    openings: autoSpace(openingsByWall[id] || [], widthOverride, eave.h),
  });
  return {
    footprint: { width: footprintW, depth: footprintD, estimated: !front || !left },
    avgEaveHeight: avgEave,
    sourceKind,
    ridgeAxis,
    ridgeAxisSource,
    ridgeAxisAiRaw: aiRidgeAxis,
    roof: {
      type: roofType,
      typeSource: roofTypeSource,        // "user" | "ai" | "ai-low-conf" | "default"
      typeAiRaw: aiRoofType,
      typeAiConfidence: aiRoofTypeConfidence,
      typeAiReasoning: aiRoofTypeReasoning,
      pitch,
      ridgeAxis,
      overhang: 1.25,
      pitchSource,
      pitchAiRaw: aiPitch?.raw ?? null,
      pitchAiSamples: aiPitch?.sampleCount ?? 0,
      pitchEstimated: pitchSource === "default",
      dormer: roofType === "gable-shed-dormer"
        ? {
            face: dormerFace,
            width: dormerWidth,
            widthSource: dormerWidthSource,
            kneeWallHeight: dormerKnee,
            offsetX: dormerOffsetX,
            openings: dormerOpeningsPositioned,
            faceWallWidth: dormerFaceWallWidth,
          }
        : null,
    },
    // Iter 79j.28 — Colors. Priority chain (buildScene reads this):
    //   siding: estimate override (palette name → hex) > AI-sampled hex > default grey
    //   trim/roof/door: AI-sampled > default
    // `siding` is the only field the contractor can override today via
    // the JOB INFO → Siding Color dropdown; the others follow whatever
    // Claude sampled from the photos.
    colors: {
      siding: hexForPaletteName(estimate?.siding_color),
      siding_ai: preview.measurements?._ai_siding_color_hex || null,
      trim_ai: preview.measurements?._ai_trim_color_hex || null,
      roof_ai: preview.measurements?._ai_roof_color_hex || null,
      door_ai: preview.measurements?._ai_door_color_hex || null,
    },
    facades: [
      mkFacade("front", "Front elevation", widthFront, front, eaves.front),
      mkFacade("right", "Right gable end", widthRight, right, eaves.right),
      mkFacade("back", "Rear elevation", widthBack, back, eaves.back),
      mkFacade("left", "Left gable end", widthLeft, left, eaves.left),
    ],
  };
}

// Iter 79j.33 — Shared roof frame. EVERY piece of roof-dependent
// geometry (gable planes, ridge line, dormer placement, hip planes,
// bbox envelope) reads from this ONE function so no downstream
// component ever hardcodes an axis. Returns everything needed to
// place vertices in world coords without further rotation.
//
//   ridgeAxis "x": ridge runs along world X, at z=0
//   ridgeAxis "z": ridge runs along world Z, at x=0
//
// `along` = axis parallel to the ridge (contributes ridge length)
// `across` = axis perpendicular to the ridge (contributes span, tilt)
function roofFrame(house, roofRise, avgGableEave) {
  const { footprint, roof } = house;
  const isXRidge = roof.ridgeAxis === "x";
  const halfW = footprint.width / 2;
  const halfD = footprint.depth / 2;
  const oh = roof.overhang;
  const alongHalf = isXRidge ? halfW : halfD;
  const acrossHalf = isXRidge ? halfD : halfW;
  const ridgeY = avgGableEave + roofRise;
  // Build a (along, across, y) → (world x, y, z) mapper.
  // isXRidge: along = world X, across = world Z
  // else:     along = world Z, across = world X
  const toWorld = (a, c, y) => (isXRidge ? [a, y, c] : [c, y, a]);
  return {
    isXRidge,
    alongHalf,
    acrossHalf,
    overhang: oh,
    ridgeY,
    eaveY: avgGableEave,
    toWorld,
  };
}

// Iter 79j.26 — Gable roof planes (2 sloped rectangles).
// Iter 79j.33 — rebuilt on explicit BufferGeometry using roofFrame().
// The prior PlaneGeometry+rotation approach produced a degenerate
// vertical plane for ridgeAxis="z" because Three.js applies Euler
// XYZ order Rx*Ry*Rz — Rz was applied first in local frame and did
// nothing useful for a 2D plane, then Ry(π/2) flattened it against
// the YZ plane. Explicit corner vertices bypass that ambiguity.
function buildGableRoofPlanes(scene, house, roofMat, roofRise, avgGableEave) {
  const F = roofFrame(house, roofRise, avgGableEave);
  const { alongHalf, acrossHalf, overhang: oh, ridgeY, eaveY, toWorld } = F;
  // Ridge runs along `a` at c=0, y=ridgeY.
  // Two eaves at c=±acrossHalf, y=eaveY.
  // Overhang extends the ridge in the along-axis and the eave in the across-axis.
  const addQuad = (v1, v2, v3, v4) => {
    const positions = [
      ...v1, ...v2, ...v3,
      ...v1, ...v3, ...v4,
    ];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    scene.add(new THREE.Mesh(geom, roofMat));
  };
  // "Positive-across" slope (front slope for X-ridge, right slope for Z-ridge)
  addQuad(
    toWorld(-alongHalf - oh, 0, ridgeY),
    toWorld(+alongHalf + oh, 0, ridgeY),
    toWorld(+alongHalf + oh, +acrossHalf + oh, eaveY),
    toWorld(-alongHalf - oh, +acrossHalf + oh, eaveY),
  );
  // "Negative-across" slope
  addQuad(
    toWorld(+alongHalf + oh, 0, ridgeY),
    toWorld(-alongHalf - oh, 0, ridgeY),
    toWorld(-alongHalf - oh, -acrossHalf - oh, eaveY),
    toWorld(+alongHalf + oh, -acrossHalf - oh, eaveY),
  );
}

// Iter 79j.26 — Hip roof: 4 planes (2 trapezoids on the long sides,
// 2 triangles on the short ends) meeting at a shortened ridge that
// runs along whichever axis (X or Z) is longer. Equal pitch all
// around → ridge length = |longAxis − shortAxis|.
function buildHipRoof(scene, house, roofMat, ridgeY, avgGableEave) {
  const { footprint } = house;
  const W = footprint.width;    // X axis
  const D = footprint.depth;    // Z axis
  const halfW = W / 2;
  const halfD = D / 2;
  const ridgeAlongX = W >= D;   // ridge runs along the longer axis
  const shortHalf = Math.min(halfW, halfD);
  const ridgeHalfLen = Math.abs(halfW - halfD);

  // Ridge endpoints in world space
  const ridgeEnds = ridgeAlongX
    ? [[-ridgeHalfLen, ridgeY, 0], [+ridgeHalfLen, ridgeY, 0]]
    : [[0, ridgeY, -ridgeHalfLen], [0, ridgeY, +ridgeHalfLen]];

  // Eave corners (all at avgGableEave for hip — hip roofs sit on
  // rectangular walls at uniform eave)
  const corners = {
    fl: [-halfW, avgGableEave, +halfD],
    fr: [+halfW, avgGableEave, +halfD],
    bl: [-halfW, avgGableEave, -halfD],
    br: [+halfW, avgGableEave, -halfD],
  };

  // Helper to add a polygon face from a vertex list. Assumes convex.
  const addFace = (verts) => {
    const positions = [];
    // Fan triangulation from vert[0]
    for (let i = 1; i < verts.length - 1; i += 1) {
      positions.push(...verts[0], ...verts[i], ...verts[i + 1]);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    scene.add(new THREE.Mesh(geom, roofMat));
  };

  // 4 faces: 2 trapezoids + 2 triangles.
  if (ridgeAlongX) {
    // Front trapezoid: FL → FR → ridgeEnd_R (top-right) → ridgeEnd_L (top-left)
    addFace([corners.fl, corners.fr, ridgeEnds[1], ridgeEnds[0]]);
    // Back trapezoid: BR → BL → ridgeEnd_L → ridgeEnd_R
    addFace([corners.br, corners.bl, ridgeEnds[0], ridgeEnds[1]]);
    // Right triangle: FR → BR → ridgeEnd_R
    addFace([corners.fr, corners.br, ridgeEnds[1]]);
    // Left triangle: BL → FL → ridgeEnd_L
    addFace([corners.bl, corners.fl, ridgeEnds[0]]);
  } else {
    // Ridge runs along Z. Left+right are trapezoids; front+back are triangles.
    addFace([corners.fr, corners.br, ridgeEnds[0], ridgeEnds[1]]);   // Right trapezoid
    addFace([corners.bl, corners.fl, ridgeEnds[1], ridgeEnds[0]]);   // Left trapezoid
    addFace([corners.fl, corners.fr, ridgeEnds[1]]);                 // Front triangle
    addFace([corners.br, corners.bl, ridgeEnds[0]]);                 // Back triangle
  }
  // shortHalf reserved for future overhang math
  void shortHalf;
}

// Iter 79j.26 — Shed dormer on one slope of a gable roof.
// Iter 79j.31 — slope-relative + ridge-axis-aware. `d.face` is one of
// slope-front / slope-back (when ridgeAxis="x") OR
// slope-left  / slope-right (when ridgeAxis="z"). All geometry is
// computed in a (u, v) local frame where u = perpendicular-to-ridge
// (the slope direction) and v = parallel-to-ridge (the ridge extent);
// we then map (u, v) → (world X, Y, Z) based on ridgeAxis.
function buildShedDormer(scene, house, roofMat, wallMat, openingMats, roofRise, avgGableEave) {
  const { footprint, roof } = house;
  const d = roof.dormer;
  if (!d) return;
  const isXRidge = house.ridgeAxis === "x";
  const spanTotal = isXRidge ? footprint.depth : footprint.width;
  const halfSpan = spanTotal / 2;
  const uFrac = 0.5;
  const negFaces = new Set(["slope-back", "slope-left"]);
  const faceSign = negFaces.has(d.face) ? -1 : 1;
  const uFace = faceSign * halfSpan * uFrac;   // along-slope coord of face wall
  const mainRoofYAtFace = avgGableEave + roofRise * (1 - Math.abs(uFace) / halfSpan);
  const faceBottomY = mainRoofYAtFace;
  const faceTopY = faceBottomY + Number(d.kneeWallHeight);
  const halfWD = Number(d.width) / 2;
  const cv = Number(d.offsetX) || 0;   // offset along the ridge-parallel axis
  const ridgeY = avgGableEave + roofRise;

  // (u, v) → (worldX, worldZ) mapping. Y is always vertical.
  const toWorld = (u, v) => (isXRidge ? [v, u] : [u, v]);   // returns [x, z]

  // 1) Face wall — vertical plane in the u=uFace slice, extending in v.
  const faceShape = new THREE.Shape();
  faceShape.moveTo(cv - halfWD, faceBottomY);
  faceShape.lineTo(cv + halfWD, faceBottomY);
  faceShape.lineTo(cv + halfWD, faceTopY);
  faceShape.lineTo(cv - halfWD, faceTopY);
  faceShape.lineTo(cv - halfWD, faceBottomY);
  const faceGeom = new THREE.ShapeGeometry(faceShape);
  const faceMesh = new THREE.Mesh(faceGeom, wallMat.clone());
  const [fx, fz] = toWorld(uFace + faceSign * 0.05, 0);
  faceMesh.position.set(fx, 0, fz);
  // Rotate so the shape's plane (originally XY) aligns with the (v,Y)
  // plane at u=uFace. For X-ridge (face plane normal along Z), only
  // the flip for negFaces is needed. For Z-ridge (face plane normal
  // along X), rotate 90° around Y first.
  if (!isXRidge) faceMesh.rotation.y = Math.PI / 2;
  if (negFaces.has(d.face)) faceMesh.rotation.y += Math.PI;
  scene.add(faceMesh);

  // 2) Dormer openings on the face
  const dormerOpenings = d.openings || [];
  const worldXForOpening = (o) => (o.cxOnWall - (d.faceWallWidth || spanTotal) / 2);
  const faceHeightRange = faceTopY - faceBottomY;
  dormerOpenings.forEach((o) => {
    const wv = worldXForOpening(o);
    const wy = o.bboxCy != null
      ? Math.max(faceBottomY, Math.min(faceTopY - o.h, faceBottomY + faceHeightRange * (1 - o.bboxCy) - o.h / 2))
      : (faceBottomY + faceTopY) / 2 - o.h / 2;
    const g = buildOpeningMesh(o, openingMats);
    const [gx, gz] = toWorld(uFace + faceSign * 0.09, wv);
    g.position.set(gx, wy, gz);
    if (!isXRidge) g.rotation.y = Math.PI / 2;
    if (negFaces.has(d.face)) g.rotation.y = (g.rotation.y || 0) + Math.PI;
    scene.add(g);
  });

  // 3) Cheek walls — 2 triangles filling the gap between face top edge
  // and the main roof surface. Vertices at (u=uFace, v=cv±halfWD, Y=faceBottom),
  // (u=uFace, v=cv±halfWD, Y=faceTop), (u=0, v=cv±halfWD, Y=ridgeY).
  const addTri = (v1, v2, v3) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute([...v1, ...v2, ...v3], 3));
    geom.computeVertexNormals();
    scene.add(new THREE.Mesh(geom, wallMat.clone()));
  };
  [cv - halfWD, cv + halfWD].forEach((v) => {
    const [x1, z1] = toWorld(uFace, v);
    const [x2, z2] = toWorld(0, v);
    addTri(
      [x1, faceTopY, z1],
      [x1, faceBottomY, z1],
      [x2, ridgeY, z2],
    );
  });

  // 4) Shed roof plane — quad from face-top edge back to the ridge
  const quadVerts = [
    [uFace, cv - halfWD, faceTopY],
    [uFace, cv + halfWD, faceTopY],
    [0,     cv + halfWD, ridgeY],
    [uFace, cv - halfWD, faceTopY],
    [0,     cv + halfWD, ridgeY],
    [0,     cv - halfWD, ridgeY],
  ];
  const positions = [];
  quadVerts.forEach(([u, v, y]) => {
    const [x, z] = toWorld(u, v);
    positions.push(x, y, z);
  });
  const shedGeom = new THREE.BufferGeometry();
  shedGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  shedGeom.computeVertexNormals();
  scene.add(new THREE.Mesh(shedGeom, roofMat));
}

// Iter 79j.28 — Opening mesh factory. Returns a THREE.Group placed at
// (0,0,0) with its bottom at Y=0 and center at X=0, so callers can
// position it anywhere. Distinct visual per type — flat-colored, no
// textures, no course lines (deliberately out of scope). The point is
// that a contractor comparing 3D to photo can see "yes, that's my
// front door", "that's the sliding patio door", "that's the garage".
function buildOpeningMesh(o, materials) {
  const { frameMat, paneMat, doorMat, garageMat, sliderMat } = materials;
  const group = new THREE.Group();
  const t = (o.type || "window").toLowerCase();
  const w = o.w;
  const h = o.h;
  // All openings are anchored center-X, bottom-Y (we translate later).
  const cx = 0;
  const cy = h / 2;

  if (t.includes("garage")) {
    // Garage door: full-width solid slab, thin dark border, one thin
    // horizontal band across the top to hint at panels (out of scope
    // for real panels, but this one band reads as "garage").
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.22),
      garageMat,
    );
    body.position.set(cx, cy, 0.11);
    group.add(body);
    // Subtle top rail band
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.2, 0.35, 0.24),
      frameMat,
    );
    band.position.set(cx, h - 0.5, 0.12);
    group.add(band);
    return group;
  }

  if (t.includes("patio") || t.includes("slider") || t.includes("sliding")) {
    // Slider / patio door: two side-by-side glass panels in a dark frame.
    // Frame width = full opening, height = full opening.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.15), frameMat);
    frame.position.set(cx, cy, 0.08);
    group.add(frame);
    // Two glass panels split vertically at cx
    const paneW = w / 2 - 0.1;
    const paneMesh = (dx) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(paneW, h - 0.2, 0.2), sliderMat);
      p.position.set(cx + dx, cy, 0.11);
      return p;
    };
    group.add(paneMesh(-paneW / 2 - 0.05));
    group.add(paneMesh(+paneW / 2 + 0.05));
    return group;
  }

  if (t.includes("entry") || t === "door") {
    // Entry door: solid slab (no pane), taller-than-wide, dark accent
    // color so it reads as "front door" against the siding.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.15), frameMat);
    frame.position.set(cx, cy, 0.08);
    group.add(frame);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, h - 0.15, 0.22), doorMat);
    slab.position.set(cx, cy, 0.11);
    group.add(slab);
    // Small knob-height accent (out-of-scope for actual knob but adds a
    // door-shaped cue that the material isn't a window)
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.06), frameMat);
    knob.position.set(w / 2 - 0.5, cy - 0.2, 0.18);
    group.add(knob);
    return group;
  }

  // Window (default): frame + glass pane
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.15), frameMat);
  frame.position.set(cx, cy, 0.09);
  group.add(frame);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), paneMat);
  pane.position.set(cx, cy, 0.11);
  group.add(pane);
  return group;
}

// Iter 79j.28 — Safely parse a hex color to a THREE color number.
// Accepts "#RRGGBB", "RRGGBB", or 0xRRGGBB integers. Returns null for
// invalid input so the caller can fall back cleanly.
function parseHex(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

// Rebuild the Three.js scene from the house JSON. Returns walls by id
// (so the click handler can highlight the tapped facade).
function buildScene(scene, house) {
  const wallMeshes = {};
  // Iter 79j.28 — per-material colors. Priority chain:
  //   house.colors.<field>  (user/estimate override — highest)
  //   → house.colors.<field>_ai (AI-sampled from photos)
  //   → hardcoded default (lowest)
  const c = house.colors || {};
  const wallColor = parseHex(c.siding) ?? parseHex(c.siding_ai) ?? 0xd9dce2;
  const trimColor = parseHex(c.trim) ?? parseHex(c.trim_ai) ?? 0x333842;
  const roofColor = parseHex(c.roof) ?? parseHex(c.roof_ai) ?? 0x4a5058;
  const doorColor = parseHex(c.door) ?? parseHex(c.door_ai) ?? 0x2a3f5f;

  const wallMat = new THREE.MeshLambertMaterial({ color: wallColor, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshLambertMaterial({ color: trimColor });
  const paneMat = new THREE.MeshLambertMaterial({ color: 0x88a9c7, transparent: true, opacity: 0.75 });
  const sliderMat = new THREE.MeshLambertMaterial({ color: 0x9fb8d1, transparent: true, opacity: 0.7 });
  const roofMat = new THREE.MeshLambertMaterial({ color: roofColor, side: THREE.DoubleSide });
  const doorMat = new THREE.MeshLambertMaterial({ color: doorColor });
  const garageMat = new THREE.MeshLambertMaterial({ color: 0xe8e5df });
  const openingMats = { frameMat, paneMat, doorMat, garageMat, sliderMat };
  const { footprint, roof } = house;
  const halfW = footprint.width / 2;
  const halfD = footprint.depth / 2;

  house.facades.forEach((f) => {
    // Iter 79j.24 — per-wall eave heights.
    // Iter 79j.31 — ridge-axis-aware gable triangle rise. Roof span
    // is the horizontal distance perpendicular to the ridge; for
    // X-axis ridge that's the Z-extent (footprint.depth), for Z-axis
    // ridge that's the X-extent (footprint.width). Gable-end walls
    // (perpendicular to the ridge) get the triangle; other walls stay
    // rectangular. hip type never draws a gable peak.
    const H = f.eaveHeight;
    const roofSpan = roof.ridgeAxis === "x" ? footprint.depth : footprint.width;
    const hasGablePeak = f.gableEnd && (roof.type === "gable" || roof.type === "gable-shed-dormer");
    const rise = hasGablePeak ? pitchRise(roofSpan, roof.pitch) : 0;

    // Iter 79j.32 — Geometry consistency check. Every wall that Claude
    // reported gable_triangle_height_ft > 0 for MUST render as a
    // gable-end, and every wall we're rendering as a gable-end MUST
    // have gable_triangle_height_ft > 0 (i.e. Claude agreed with the
    // ridge-axis choice). Violations mean the ridgeAxis pick and the
    // AI takeoff disagree — surface it loudly in the console so the
    // contractor / dev knows to flip the toggle.
    const aiSaysGable = f.aiGableTriangleHeightFt > 0;
    if (aiSaysGable !== hasGablePeak && roof.type !== "hip") {
      console.error(
        "[HouseModel3D] gable-area consistency FAILED for wall",
        f.id,
        { aiGableHeight: f.aiGableTriangleHeightFt, renderingAsGableEnd: hasGablePeak, ridgeAxis: roof.ridgeAxis },
        "→ flip Ridge orientation in the panel, or the AI takeoff and 3D drawing disagree.",
      );
    }

    const shape = new THREE.Shape();
    shape.moveTo(-f.width / 2, 0);
    shape.lineTo(f.width / 2, 0);
    shape.lineTo(f.width / 2, H);
    if (hasGablePeak) {
      shape.lineTo(0, H + rise);
    }
    shape.lineTo(-f.width / 2, H);
    shape.lineTo(-f.width / 2, 0);
    const geom = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geom, wallMat.clone());
    // Position each wall around the footprint.
    switch (f.id) {
      case "front": mesh.position.set(0, 0, halfD); break;
      case "back":  mesh.position.set(0, 0, -halfD); mesh.rotation.y = Math.PI; break;
      case "right": mesh.position.set(halfW, 0, 0); mesh.rotation.y = Math.PI / 2; break;
      case "left":  mesh.position.set(-halfW, 0, 0); mesh.rotation.y = -Math.PI / 2; break;
      default: break;
    }
    mesh.userData.facadeId = f.id;
    wallMeshes[f.id] = mesh;
    scene.add(mesh);
    // Openings on this facade — dispatched through the type-aware
    // factory so a window doesn't look like a garage door.
    f.openings.forEach((o) => {
      const cx = -f.width / 2 + o.x + o.w / 2;
      const g = buildOpeningMesh(o, openingMats);
      g.position.set(cx, o.y, 0.09);
      mesh.add(g);
    });
  });

  // Iter 79j.26 + 79j.31 — Roof geometry routes on roof.type AND ridge
  // axis. All 3 types share the same ridge-height math (avgGableEave +
  // rise) so the sanity check below applies uniformly; the axis
  // decides which footprint dimension is the ROOF SPAN.
  const gableEndFacades = house.facades.filter((f) => f.gableEnd);
  const avgGableEave = gableEndFacades.length
    ? gableEndFacades.reduce((s, f) => s + f.eaveHeight, 0) / gableEndFacades.length
    : house.avgEaveHeight;
  const roofSpan = house.ridgeAxis === "x" ? footprint.depth : footprint.width;
  const roofRise = pitchRise(roofSpan, roof.pitch);
  const ridgeY = avgGableEave + roofRise;

  if (roof.type === "hip") {
    buildHipRoof(scene, house, roofMat, ridgeY, avgGableEave);
  } else {
    buildGableRoofPlanes(scene, house, roofMat, roofRise, avgGableEave);
    if (roof.type === "gable-shed-dormer" && roof.dormer) {
      buildShedDormer(scene, house, roofMat, wallMat, openingMats, roofRise, avgGableEave);
    }
  }

  // Iter 79j.25 + .26 + .33 — Geometry sanity checks. Warnings surface
  // in the UI via the amber banner in the side panel; console.error is
  // kept for dev debugging. `warnings` is returned to the React layer.
  const warnings = [];
  const maxEave = Math.max(...house.facades.map((f) => f.eaveHeight));
  if (ridgeY <= maxEave) {
    console.error(
      "[HouseModel3D] sanity FAILED — ridge not above eave",
      { roofType: roof.type, ridgeY, maxEave, avgGableEave, roofRise, pitch: roof.pitch },
    );
    warnings.push("Ridge height sits at or below the eave — check pitch or eave height.");
  }
  if (roof.type === "gable-shed-dormer" && roof.dormer) {
    const zd = footprint.depth * 0.25;
    const mainRoofY = avgGableEave + roofRise * (1 - zd / (footprint.depth / 2));
    const dormerFaceTop = mainRoofY + Number(roof.dormer.kneeWallHeight || 0);
    if (dormerFaceTop >= ridgeY) {
      console.error(
        "[HouseModel3D] dormer sanity FAILED — dormer face top ≥ main ridge",
        { dormerFaceTop, ridgeY, kneeWallHeight: roof.dormer.kneeWallHeight },
      );
      warnings.push("Dormer face top is above the main ridge — shrink knee-wall height.");
    }
  }

  // Ground shadow disc for visual grounding. Added BEFORE the bbox
  // check so we can exclude it explicitly (it extends 1.2× beyond
  // footprint by design and would trigger false positives).
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(footprint.width, footprint.depth) * 1.2, 40),
    new THREE.MeshLambertMaterial({ color: 0xeceff4 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // Iter 79j.33 — Bounding-box envelope check. After every roof mesh
  // is placed, the union of all non-ground mesh bboxes must fit
  // inside the expected roof-envelope box:
  //   X: [-halfW - oh - eps, +halfW + oh + eps]
  //   Y: [-eps, ridgeY + knee + eps]
  //   Z: [-halfD - oh - eps, +halfD + oh + eps]
  // Anything sticking out ≥ TOL feet is either a rotated-90° roof
  // plane or a dormer poking through the wrong slope. Both were the
  // exact symptoms Howard flagged on the front-gable render (Iter 79j.33).
  const halfWEnv = footprint.width / 2;
  const halfDEnv = footprint.depth / 2;
  const oh = roof.overhang;
  const knee = roof.dormer ? Number(roof.dormer.kneeWallHeight || 0) : 0;
  const TOL = 0.5;   // feet — allow tiny float slop before crying wolf
  const envMin = new THREE.Vector3(-halfWEnv - oh - TOL, -TOL, -halfDEnv - oh - TOL);
  const envMax = new THREE.Vector3(+halfWEnv + oh + TOL, ridgeY + knee + TOL, +halfDEnv + oh + TOL);
  const meshBox = new THREE.Box3();
  const piercing = [];
  scene.children.forEach((child) => {
    if (!child.isMesh) return;
    if (child === ground) return;              // ground disc extends by design
    meshBox.setFromObject(child);
    if (meshBox.isEmpty()) return;
    const outX = Math.max(0, envMin.x - meshBox.min.x, meshBox.max.x - envMax.x);
    const outY = Math.max(0, envMin.y - meshBox.min.y, meshBox.max.y - envMax.y);
    const outZ = Math.max(0, envMin.z - meshBox.min.z, meshBox.max.z - envMax.z);
    const outWorst = Math.max(outX, outY, outZ);
    if (outWorst > TOL) {
      piercing.push({ outFt: outWorst });
    }
  });
  if (piercing.length > 0) {
    const worst = Math.max(...piercing.map((p) => p.outFt));
    console.error(
      "[HouseModel3D] envelope FAILED — mesh(es) extend beyond roof envelope",
      { pierceCount: piercing.length, worstOverhangFt: worst.toFixed(2), envMin, envMax },
    );
    warnings.push(
      `Roof/dormer geometry extends ${worst.toFixed(1)} ft outside the house envelope — try flipping Ridge orientation.`,
    );
  }

  return { wallMeshes, warnings };
}

export default function HouseModel3D({ preview, estimate }) {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const [selectedFacade, setSelectedFacade] = useState("front");
  const [overrides, setOverrides] = useState({ pitch: null, eaveHeights: {}, widths: {} });
  // Iter 79j.33 — Geometry warnings from the last buildScene pass.
  // Populated after every rebuild; surfaced in the amber banner in
  // the side panel so the contractor sees the message where they can
  // act on it (right above the Ridge orientation flip control).
  const [geometryWarnings, setGeometryWarnings] = useState([]);
  const house = useMemo(() => buildHouseJson(preview, overrides, estimate), [preview, overrides, estimate]);

  // Mount scene once
  useEffect(() => {
    if (!mountRef.current || !house) return;
    const el = mountRef.current;
    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f8fb);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    camera.position.set(house.footprint.width * 1.2, house.avgEaveHeight * 1.5, house.footprint.depth * 1.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xbcd0e8, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2e0, 0.85);
    sun.position.set(60, 90, 45);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6fa0d8, 0.3);
    fill.position.set(-50, 40, -60);
    scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, house.avgEaveHeight * 0.55, 0);
    controls.enableDamping = true;

    let raf;
    const animate = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(animate); };
    animate();

    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    // Click → facade select
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(Object.values(sceneRef.current.wallMeshes || {}));
      if (hits.length) {
        const id = hits[0].object.userData.facadeId;
        if (id) setSelectedFacade(id);
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    sceneRef.current = { scene, camera, renderer, controls, wallMeshes: {} };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild geometry when house changes
  useEffect(() => {
    const s = sceneRef.current;
    if (!s.scene || !house) return;
    // Iter 79j.28 — wipe non-light objects AND release GPU resources.
    // Prior versions just called `scene.remove(child)` — GPU-side
    // buffers survived, so cycling through the roof-type dropdown
    // leaked ~2 MB per click. Walk each removed object's descendants,
    // dispose their geometry + material(s), then remove.
    const disposeDeep = (obj) => {
      obj.traverse?.((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) {
          if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
          else n.material.dispose();
        }
      });
    };
    [...s.scene.children].forEach((child) => {
      if (child.isMesh || child.isGroup) {
        disposeDeep(child);
        s.scene.remove(child);
      }
    });
    s.wallMeshes = {};
    const built = buildScene(s.scene, house);
    s.wallMeshes = built.wallMeshes;
    setGeometryWarnings(built.warnings || []);
  }, [house]);

  // Highlight selected facade
  useEffect(() => {
    const wm = sceneRef.current.wallMeshes || {};
    Object.entries(wm).forEach(([id, m]) => {
      m.material.emissive = new THREE.Color(id === selectedFacade ? 0x2b6bd5 : 0x000000);
      m.material.emissiveIntensity = id === selectedFacade ? 0.35 : 0;
    });
  }, [selectedFacade, house]);

  if (!house) {
    return <div className="p-6 text-sm text-[var(--muted)]">Run AI Measure first — the 3D model builds from the preview.</div>;
  }

  const facade = house.facades.find((f) => f.id === selectedFacade) || house.facades[0];
  const peb = (preview.measurements?._per_elevation_breakdown || []).find(
    (r) => (r.label || "").toLowerCase() === selectedFacade
  ) || {};
  const totalSqft = (peb.wall_body_sqft || 0) + (peb.gable_sqft || 0) + (peb.dormer_sqft || 0);
  // Iter 79j.32 — Ridge/gable consistency check surfaced in the UI.
  // Walk every facade and flag any wall where Claude reported a gable
  // triangle but the current ridgeAxis doesn't render it as a gable-
  // end (or vice-versa). If we find any, the amber banner below
  // recommends flipping the Ridge orientation dropdown. Skipped for
  // hip roofs (no gable ends by design) and for facades Claude never
  // returned (facade.estimated=true — nothing to compare against).
  const ridgeMismatchWalls = house.roof.type === "hip"
    ? []
    : house.facades.filter((f) => {
        if (f.estimated) return false;
        const aiSaysGable = f.aiGableTriangleHeightFt > 0;
        const rendersGable = f.gableEnd;
        return aiSaysGable !== rendersGable;
      });
  const hasRidgeMismatch = ridgeMismatchWalls.length > 0;
  // Iter 79j.33 — Combine ridge-mismatch (data-driven) + geometry
  // warnings (bbox-driven) into ONE banner. Both point at the same
  // fix (flip Ridge orientation), so we merge messages instead of
  // stacking two banners.
  const bannerMessages = [];
  if (hasRidgeMismatch) {
    const walls = ridgeMismatchWalls.length === 1
      ? `the ${ridgeMismatchWalls[0].id} wall`
      : `${ridgeMismatchWalls.map((w) => w.id).join(", ")} walls`;
    const dir = ridgeMismatchWalls.some((w) => w.aiGableTriangleHeightFt > 0)
      ? `${walls} report a gable triangle in the AI takeoff but aren't rendering as a gable end.`
      : `${walls} are rendering as gable ends but the AI didn't detect a gable there.`;
    bannerMessages.push(dir);
  }
  geometryWarnings.forEach((w) => bannerMessages.push(w));
  const showBanner = bannerMessages.length > 0;
  // Whole-house material lines from the estimator (SSOT). Filter to
  // siding-adjacent categories so the "Materials" section shows the
  // squares / j-channel / starter / corner post the estimate will use.
  const sidingLines = (preview.lines || []).filter((l) => {
    const s = (l.section || "").toLowerCase();
    return ["siding", "trim", "corners", "j-channel", "starter"].some((k) => s.includes(k));
  }).slice(0, 10);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="ai-measure-3d-view">
      <div className="md:col-span-2 h-[560px] md:h-[640px] border border-[var(--border)] bg-[#F7F8FB] relative" ref={mountRef}>
        <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wider font-bold text-[var(--ai)] bg-white/80 px-2 py-1 border border-[var(--ai)]" data-testid="ai-measure-3d-hint">
          Tap a wall to see its takeoff · drag to orbit · scroll to zoom
        </div>
      </div>
      <div className="h-[560px] md:h-[640px] flex flex-col gap-2 min-h-0">
        <div className="flex gap-1">
          {house.facades.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFacade(f.id)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${selectedFacade === f.id ? "bg-[var(--ai)] text-white border-[var(--ai)]" : "bg-[var(--surface)] text-[var(--ink-2)] border-[var(--border)]"}`}
              data-testid={`ai-measure-3d-tab-${f.id}`}
            >
              {f.id}
            </button>
          ))}
        </div>
        <div className="p-3 bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold">Geometry — this wall</div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--muted)] w-24">Width (ft)</span>
            <input
              type="number" step="0.5" min="1"
              value={facade.width}
              onChange={(e) => setOverrides((o) => ({ ...o, widths: { ...o.widths, [facade.id]: parseFloat(e.target.value) || facade.width } }))}
              className="w-20 px-2 py-1 border border-[var(--border)] font-mono-num text-right"
              data-testid={`ai-measure-3d-width-${facade.id}`}
            />
            {facade.estimated && <Amber />}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--muted)] w-24">Eave height</span>
            <input
              type="number" step="0.5" min="6"
              value={facade.eaveHeight}
              onChange={(e) => setOverrides((o) => ({ ...o, eaveHeights: { ...o.eaveHeights, [facade.id]: parseFloat(e.target.value) || facade.eaveHeight } }))}
              className="w-20 px-2 py-1 border border-[var(--border)] font-mono-num text-right"
              data-testid={`ai-measure-3d-eave-${facade.id}`}
            />
            {facade.eaveHeightSource === "default" && <Amber />}
            {facade.eaveHeightSource === "ai" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#DCFCE7] text-[#166534] border border-[var(--success)]"
                title={house.sourceKind === "blueprint"
                  ? "Read straight from the elevation drawing's printed dimension"
                  : "Read straight from Claude's per-wall height_ft for this elevation"}
                data-testid={`ai-measure-3d-eave-derived-${facade.id}`}
              >
                <Check className="w-2.5 h-2.5" /> {house.sourceKind === "blueprint" ? "Blueprint" : "AI per-wall"}
              </span>
            )}
            {facade.eaveHeightSource === "ai-avg" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#FEF3C7] text-[var(--warning-text)] border border-[#F59E0B]"
                title="Claude didn't return a per-wall height for this elevation — using the whole-house average. Verify in the field."
                data-testid={`ai-measure-3d-eave-avg-${facade.id}`}
              >
                <AlertTriangle className="w-2.5 h-2.5" style={{ color: AMBER }} /> AI avg
              </span>
            )}
            {facade.eaveHeightSource === "user" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[var(--ai-soft)] text-[#5B21B6] border border-[var(--ai)]"
                title="You overrode this wall's eave — hit Re-run to feed this back to the estimator"
                data-testid={`ai-measure-3d-eave-user-${facade.id}`}
              >
                edited
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--muted)] w-24">Roof pitch</span>
            <select
              value={house.roof.pitch}
              onChange={(e) => setOverrides((o) => ({ ...o, pitch: parseInt(e.target.value, 10) }))}
              className="w-20 px-2 py-1 border border-[var(--border)] text-right"
              data-testid="ai-measure-3d-pitch"
            >
              {ROOF_PITCHES.map((p) => (
                <option key={p} value={p}>{`${p}/12`}</option>
              ))}
            </select>
            {house.roof.pitchSource === "default" && <Amber />}
            {house.roof.pitchSource === "ai" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#DCFCE7] text-[#166534] border border-[var(--success)]"
                title={house.sourceKind === "blueprint"
                  ? `Read from the elevation's gable height (${house.roof.pitchAiRaw}/12, snapped to ${house.roof.pitch}/12)`
                  : `Derived from Claude's gable height (raw ${house.roof.pitchAiRaw}/12 across ${house.roof.pitchAiSamples} gable-end wall${house.roof.pitchAiSamples > 1 ? "s" : ""}, snapped to ${house.roof.pitch}/12)`}
                data-testid="ai-measure-3d-pitch-derived"
              >
                <Check className="w-2.5 h-2.5" /> {house.sourceKind === "blueprint" ? "Blueprint" : "AI-derived"}
              </span>
            )}
            {house.roof.pitchSource === "user" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[var(--ai-soft)] text-[#5B21B6] border border-[var(--ai)]"
                title="You overrode the pitch — hit Re-run to feed this back to the estimator"
                data-testid="ai-measure-3d-pitch-user"
              >
                edited
              </span>
            )}
          </div>
          {/* Iter 79j.26 — Roof type dropdown */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[var(--muted)] w-24">Roof type</span>
            <select
              value={house.roof.type}
              onChange={(e) => setOverrides((o) => ({ ...o, roofType: e.target.value }))}
              className="px-2 py-1 border border-[var(--border)] text-left flex-1 min-w-0"
              data-testid="ai-measure-3d-roof-type"
            >
              {ROOF_TYPES.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.label}</option>
              ))}
            </select>
            {house.roof.typeSource === "default" && <Amber />}
            {house.roof.typeSource === "ai-low-conf" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#FEF3C7] text-[var(--warning-text)] border border-[#F59E0B]"
                title={`Claude guessed "${house.roof.typeAiRaw}" with only ${Math.round((house.roof.typeAiConfidence || 0) * 100)}% confidence — defaulting to gable. Verify from the photos.`}
                data-testid="ai-measure-3d-roof-type-lowconf"
              >
                <AlertTriangle className="w-2.5 h-2.5" style={{ color: AMBER }} /> estimated
              </span>
            )}
            {house.roof.typeSource === "ai" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#DCFCE7] text-[#166534] border border-[var(--success)]"
                title={house.sourceKind === "blueprint"
                  ? `Determined from printed gable heights across the elevations. ${house.roof.typeAiReasoning || ""}`
                  : `Classified by Claude with ${Math.round((house.roof.typeAiConfidence || 0) * 100)}% confidence. ${house.roof.typeAiReasoning || ""}`}
                data-testid="ai-measure-3d-roof-type-ai"
              >
                <Check className="w-2.5 h-2.5" /> {house.sourceKind === "blueprint" ? "Blueprint" : "AI-classified"}
              </span>
            )}
            {house.roof.typeSource === "user" && (
              <span
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[var(--ai-soft)] text-[#5B21B6] border border-[var(--ai)]"
                title="You changed the roof type — hit Re-run to feed this back to the estimator"
                data-testid="ai-measure-3d-roof-type-user"
              >
                edited
              </span>
            )}
          </div>
          {/* Iter 79j.32 + 79j.33 — Geometry warning banner. Combines
              the ridge-mismatch check (AI gable triangles vs current
              ridgeAxis) with the bbox-envelope check (any mesh
              extending beyond the house envelope). Both point at the
              same fix — flip Ridge orientation right below. */}
          {showBanner && (
            <div
              className="flex items-start gap-2 px-2 py-1.5 bg-[#FEF3C7] border border-[#F59E0B] text-[10px] leading-tight"
              data-testid="ai-measure-3d-ridge-mismatch-banner"
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: AMBER }} />
              <div className="text-[var(--warning-text)]">
                <strong className="uppercase tracking-wider text-[9px]">Roof orientation may be wrong</strong>
                <div className="mt-0.5 space-y-0.5">
                  {bannerMessages.map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                  <div className="pt-0.5">Try flipping <strong>Ridge orientation</strong> below.</div>
                </div>
              </div>
            </div>
          )}
          {/* Iter 79j.32 — Ridge orientation toggle. Flipping the axis
              re-derives gableEnd assignment, roof-plane orientation,
              and dormer slope face in one place (see buildHouseJson).
              Hidden for hip roofs — no gable ends, no orientation. */}
          {house.roof.type !== "hip" && (
            <div className="flex items-center gap-2 text-[11px]" data-testid="ai-measure-3d-ridge-row">
              <span className="text-[var(--muted)] w-24">Ridge orientation</span>
              <select
                value={house.ridgeAxis}
                onChange={(e) => setOverrides((o) => ({ ...o, ridgeAxis: e.target.value, dormer: { ...(o.dormer || {}), face: undefined } }))}
                className="px-2 py-1 border border-[var(--border)] text-left flex-1 min-w-0"
                data-testid="ai-measure-3d-ridge-axis"
              >
                {RIDGE_AXES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              {house.ridgeAxisSource === "default" && <Amber />}
              {house.ridgeAxisSource === "ai" && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#DCFCE7] text-[#166534] border border-[var(--success)]"
                  title={house.sourceKind === "blueprint"
                    ? `Read from the elevations' gable-end walls (${house.ridgeAxisAiRaw === "x" ? "gables on left/right → side-gable" : "gables on front/back → front-gable"})`
                    : `Derived from Claude's gable-end walls (${house.ridgeAxisAiRaw === "x" ? "left/right gables → side-gable" : "front/back gables → front-gable"})`}
                  data-testid="ai-measure-3d-ridge-derived"
                >
                  <Check className="w-2.5 h-2.5" /> {house.sourceKind === "blueprint" ? "Blueprint" : "AI-derived"}
                </span>
              )}
              {house.ridgeAxisSource === "user" && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[var(--ai-soft)] text-[#5B21B6] border border-[var(--ai)]"
                  title="You changed the ridge orientation — hit Re-run to feed this back to the estimator"
                  data-testid="ai-measure-3d-ridge-user"
                >
                  edited
                </span>
              )}
            </div>
          )}
          {/* Iter 79j.27 — Dormer width row (only when roof is gable-shed-dormer).
              width + offsetX are inferred from the horizontal spread of any
              on_dormer openings + 1.5' margin per side. Amber-flagged as
              inferred until user overrides. */}
          {house.roof.type === "gable-shed-dormer" && house.roof.dormer && (
            <div className="flex items-center gap-2 text-[11px]" data-testid="ai-measure-3d-dormer-row">
              <span className="text-[var(--muted)] w-24">Dormer W (ft)</span>
              <input
                type="number" step="0.5" min="4"
                value={Math.round(house.roof.dormer.width * 10) / 10}
                onChange={(e) => setOverrides((o) => ({ ...o, dormer: { ...(o.dormer || {}), width: parseFloat(e.target.value) || house.roof.dormer.width } }))}
                className="w-20 px-2 py-1 border border-[var(--border)] font-mono-num text-right"
                data-testid="ai-measure-3d-dormer-width"
              />
              {house.roof.dormer.widthSource === "ai-inferred" && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#FEF3C7] text-[var(--warning-text)] border border-[#F59E0B]"
                  title={`Inferred from ${house.roof.dormer.openings?.length ?? 0} on-dormer window(s) + 1.5' margin — verify before ordering`}
                  data-testid="ai-measure-3d-dormer-width-inferred"
                >
                  <AlertTriangle className="w-2.5 h-2.5" style={{ color: AMBER }} /> estimated
                </span>
              )}
              {house.roof.dormer.widthSource === "user" && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[var(--ai-soft)] text-[#5B21B6] border border-[var(--ai)]"
                  title="You overrode the dormer width — hit Re-run to feed this back to the estimator"
                  data-testid="ai-measure-3d-dormer-width-user"
                >
                  edited
                </span>
              )}
              {house.roof.dormer.widthSource === "default" && <Amber />}
            </div>
          )}
          {(facade.estimated || facade.eaveHeightSource === "default" || facade.eaveHeightSource === "ai-avg" || house.roof.pitchSource === "default" || house.roof.typeSource === "default" || house.roof.typeSource === "ai-low-conf" || house.ridgeAxisSource === "default" || house.roof.dormer?.widthSource === "ai-inferred" || house.roof.dormer?.widthSource === "default") && (
            <div className="text-[9px] italic text-[var(--warning-text)] leading-tight pt-1 border-t border-[#F59E0B]">
              Edits update the 3D drawing only. To make the estimator match, hit <strong>Re-run</strong> in the footer.
            </div>
          )}
        </div>
        <div className="p-3 bg-[var(--surface)] border border-[var(--border)] space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold flex items-center justify-between">
            <span>This wall — AI takeoff</span>
            {facade.confidence != null && (
              <span className="text-[9px] font-bold" style={{ color: facade.confidence >= 80 ? "#16A34A" : AMBER }}>
                {facade.confidence}% conf
              </span>
            )}
          </div>
          <Row k="Wall body" v={`${(peb.wall_body_sqft || 0).toFixed(0)} sf`} />
          {(peb.gable_sqft || 0) > 0 && <Row k="Gable area" v={`${peb.gable_sqft.toFixed(0)} sf`} />}
          {(peb.dormer_sqft || 0) > 0 && <Row k="Dormer face" v={`${peb.dormer_sqft.toFixed(0)} sf`} />}
          {(peb.stone_sqft || 0) > 0 && <Row k="Stone / masked" v={`${peb.stone_sqft.toFixed(0)} sf`} />}
          <Row k="Total (this wall)" v={`${totalSqft.toFixed(0)} sf`} bold />
          <Row k="Openings" v={facade.openings.length} />
        </div>
        <div className="p-3 bg-[var(--surface)] border border-[var(--border)] space-y-1 flex-1 min-h-0 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold sticky top-0 bg-[var(--surface)] pb-1" data-testid="ai-measure-3d-materials-heading">
            Whole-house materials <span className="text-[9px] italic text-[var(--muted)] font-normal">· from estimator</span>
          </div>
          {sidingLines.length === 0 ? (
            <div className="text-[11px] italic text-[var(--muted)]">No siding lines in this preview.</div>
          ) : (
            sidingLines.map((ln, i) => (
              <Row key={i} k={ln.name} v={`${ln.qty} ${ln.unit || ""}`} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v, bold }) => (
  <div className={`flex justify-between items-baseline text-[11px] ${bold ? "font-bold text-[var(--ink)]" : "text-[var(--ink-2)]"}`}>
    <span className="text-[var(--muted)]">{k}</span>
    <span className="font-mono-num tabular-nums">{v}</span>
  </div>
);

const Amber = () => (
  <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-[#FEF3C7] text-[var(--warning-text)] border border-[#F59E0B]" title="Approximated / low-confidence — verify before you quote" data-testid="ai-measure-3d-amber">
    <AlertTriangle className="w-2.5 h-2.5" style={{ color: AMBER }} /> estimated
  </span>
);
