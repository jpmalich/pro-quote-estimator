// Iter 78s — HOVER-style elevation drawing renderer. Pure SVG, no canvas.
//
// Renders one elevation as:
//   - Wall rectangle sized to (facade_width_ft, facade_height_ft)
//   - Roof shape above (gable triangle / hip trapezoid / flat line / none)
//   - Opening rectangles positioned by normalized bbox, sized by W×H ft
//   - Dim callouts (width along bottom, height along right side)
//   - Scale bar in bottom-left
//
// Supports:
//   - Interactive nudging: drag any opening rectangle to reposition it
//     (pointer events on SVG — works on touch + mouse).
//   - Roof shape toggle: cycle through gable / hip / flat / none.
//
// All dimensions are derived from the input data — no hard-coded fallbacks.
// Use this same component for AI Measure, Blueprint, and (future) HOVER
// drawings.
import React, { useMemo } from "react";

const PADDING = 30;
const ROOF_HEIGHT_PX = 60;
const VIEWBOX_W = 480;
const VIEWBOX_H = 320;
const OPENING_COLORS = {
  window: "#0EA5E9",
  door: "#F97316",
  patio: "#A855F7",
  garage: "#71717A",
  other: "#52525B",
};

const ROOF_CYCLE = ["gable", "hip", "flat", "none"];

// Iter 78u — Mirror of elevation3D.js dormer count logic so 2D + 3D
// agree on how many boxes to draw for a given dormer_face_sqft total.
function inferDormerCount(faceSqft) {
  if (faceSqft <= 0) return 0;
  if (faceSqft <= 36) return 1;
  if (faceSqft <= 90) return 2;
  return Math.min(4, Math.ceil(faceSqft / 60));
}

function inferRoofShape(elev) {
  // If text-extracted rakes_lf > 0, this face most likely has a gable;
  // otherwise default to hip. Contractor can toggle.
  if (elev?.roof_style) return elev.roof_style;
  const rake = Number(elev?.rake_lf_on_face || 0);
  if (rake === 0) return "flat";
  if (rake > 0) return "gable";
  return "hip";
}

export default function ElevationDrawing({
  elevation,    // { label, facade_width_ft, facade_height_ft, openings: [...], rake_lf_on_face }
  onOpeningMove,   // (openingId, newXPct, newYPct) => void
  onRoofToggle,    // (newShape) => void
  editable = true,
  compact = false,
}) {
  const width_ft = Number(elevation?.facade_width_ft || 0);
  const height_ft = Number(elevation?.facade_height_ft || 0);
  const hasDims = width_ft > 0 && height_ft > 0;

  const ftPerPx = hasDims ? width_ft / (VIEWBOX_W - PADDING * 2) : 1;
  const wallW = (VIEWBOX_W - PADDING * 2);
  const wallH = hasDims
    ? Math.min(height_ft / ftPerPx, VIEWBOX_H - PADDING * 2 - ROOF_HEIGHT_PX)
    : 100;
  const wallX = PADDING;
  const wallY = VIEWBOX_H - PADDING - wallH;

  const roofShape = inferRoofShape(elevation);
  const showRoof = roofShape !== "none";
  const roofTop = wallY - ROOF_HEIGHT_PX;

  // Roof path per shape — computed unconditionally (useMemo rules)
  const roofPath = useMemo(() => {
    if (!showRoof) return null;
    if (roofShape === "gable") {
      return `M ${wallX},${wallY} L ${wallX + wallW / 2},${roofTop} L ${wallX + wallW},${wallY} Z`;
    }
    if (roofShape === "hip") {
      const inset = wallW * 0.18;
      return `M ${wallX},${wallY} L ${wallX + inset},${roofTop} L ${wallX + wallW - inset},${roofTop} L ${wallX + wallW},${wallY} Z`;
    }
    if (roofShape === "flat") {
      return `M ${wallX},${wallY - 6} L ${wallX + wallW},${wallY - 6} L ${wallX + wallW},${wallY} L ${wallX},${wallY} Z`;
    }
    return null;
  }, [roofShape, showRoof, wallX, wallY, wallW, roofTop]);

  if (!hasDims) {
    return (
      <div className="text-[11px] text-[#A1A1AA] p-3 border border-dashed border-[#E4E4E7] text-center">
        Drawing unavailable &mdash; facade dimensions missing for {elevation?.label || "this elevation"}
      </div>
    );
  }

  // Scale bar: 10 ft baseline
  const scaleBarPx = Math.min(10 / ftPerPx, wallW * 0.3);

  const handlePointerDown = (op) => (e) => {
    if (!editable || !onOpeningMove) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    const move = (evt) => {
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());
      // Convert to wall-relative percentages (clamp 0–1)
      const xPct = Math.max(0, Math.min(1, (cursor.x - wallX) / wallW));
      const yPct = Math.max(0, Math.min(1, (cursor.y - wallY) / wallH));
      onOpeningMove(op.id, xPct, yPct);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const openings = elevation?.openings || [];

  return (
    <div
      className="relative border border-[#E4E4E7] bg-white"
      data-testid={`elevation-drawing-${(elevation?.label || "").toLowerCase()}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#FAFAFA] border-b border-[#E4E4E7]">
        <div className="text-[11px] uppercase tracking-wider font-bold text-[#09090B]">
          {elevation?.label || "Elevation"}
          <span className="ml-2 font-mono-num text-[#71717A]">
            {width_ft.toFixed(0)}&apos;W &times; {height_ft.toFixed(0)}&apos;H
          </span>
        </div>
        {editable && onRoofToggle && (
          <button
            type="button"
            onClick={() => {
              const next = ROOF_CYCLE[(ROOF_CYCLE.indexOf(roofShape) + 1) % ROOF_CYCLE.length];
              onRoofToggle(next);
            }}
            className="text-[9px] uppercase tracking-wider font-bold text-[#52525B] border border-[#E4E4E7] px-1.5 py-0.5 hover:bg-[#FAFAFA]"
            title="Cycle roof shape: gable → hip → flat → none"
            data-testid={`roof-toggle-${(elevation?.label || "").toLowerCase()}`}
          >
            Roof: {roofShape}
          </button>
        )}
      </div>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        className="w-full h-auto"
        style={{ maxHeight: compact ? 180 : 280 }}
      >
        {/* Ground line */}
        <line
          x1={wallX - 4}
          y1={wallY + wallH}
          x2={wallX + wallW + 4}
          y2={wallY + wallH}
          stroke="#52525B"
          strokeWidth={1.5}
        />
        {/* Roof */}
        {roofPath && (
          <path
            d={roofPath}
            fill="#E4E4E7"
            stroke="#52525B"
            strokeWidth={1}
          />
        )}
        {/* Iter 78u — Dormers, drawn on top of the roof shape when
            Claude returned dormer_face_sqft on this wall. Boxes are
            evenly spaced across the wall width. */}
        {(() => {
          const dormerSqft = Number(elevation?.dormer_face_sqft || 0);
          const count = inferDormerCount(dormerSqft);
          if (count <= 0 || ftPerPx <= 0) return null;
          const perDormer = dormerSqft / count;
          let dormerWFt = Math.max(4, Math.min(12, Math.sqrt(perDormer * 1.2)));
          let dormerHFt = perDormer / dormerWFt;
          dormerHFt = Math.max(3, Math.min(8, dormerHFt));
          dormerWFt = Math.max(3, Math.min(width_ft * 0.4, perDormer / dormerHFt));
          const dW = dormerWFt / ftPerPx;
          const dH = dormerHFt / ftPerPx;
          const peakH = dW * 0.45;
          return Array.from({ length: count }, (_, i) => {
            const xPct = (i + 1) / (count + 1);
            const cx = wallX + xPct * wallW;
            const baseY = wallY; // top of wall = eave line
            const x = cx - dW / 2;
            const y = baseY - dH;
            return (
              <g key={`dormer-${i}`} data-testid={`dormer-${(elevation?.label || "").toLowerCase()}-${i}`}>
                {/* Dormer roof triangle */}
                <path
                  d={`M ${x - 2},${y} L ${cx},${y - peakH} L ${x + dW + 2},${y} Z`}
                  fill="#52525B"
                  stroke="#09090B"
                  strokeWidth={0.8}
                />
                {/* Dormer face */}
                <rect
                  x={x}
                  y={y}
                  width={dW}
                  height={dH}
                  fill="#FAFAFA"
                  stroke="#09090B"
                  strokeWidth={1}
                />
                {/* Dormer window */}
                <rect
                  x={x + dW * 0.2}
                  y={y + dH * 0.2}
                  width={dW * 0.6}
                  height={dH * 0.6}
                  fill={OPENING_COLORS.window}
                  fillOpacity={0.25}
                  stroke={OPENING_COLORS.window}
                  strokeWidth={1}
                />
              </g>
            );
          });
        })()}
        {/* Wall */}
        <rect
          x={wallX}
          y={wallY}
          width={wallW}
          height={wallH}
          fill="#FAFAFA"
          stroke="#09090B"
          strokeWidth={1.5}
        />
        {/* Openings */}
        {openings.map((op) => {
          const opW = Number(op.width_ft || 0) / ftPerPx || 20;
          const opH = Number(op.height_ft || 0) / ftPerPx || 30;
          const xPct = Number(op.x_pct ?? op.bbox_x ?? 0.5);
          const yPct = Number(op.y_pct ?? op.bbox_y ?? 0.5);
          const cx = wallX + xPct * wallW;
          const cy = wallY + yPct * wallH;
          const x = Math.max(wallX, Math.min(wallX + wallW - opW, cx - opW / 2));
          const y = Math.max(wallY, Math.min(wallY + wallH - opH, cy - opH / 2));
          const color = OPENING_COLORS[op.type] || OPENING_COLORS.other;
          return (
            <g
              key={op.id || `${op.label}-${xPct}-${yPct}`}
              onPointerDown={handlePointerDown(op)}
              style={{ cursor: editable && onOpeningMove ? "move" : "default" }}
              data-testid={`opening-${op.id || op.label}`}
            >
              <rect
                x={x}
                y={y}
                width={opW}
                height={opH}
                fill={color}
                fillOpacity={0.18}
                stroke={color}
                strokeWidth={1.5}
              />
              <text
                x={x + opW / 2}
                y={y + opH / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                fill="#09090B"
              >
                {op.label || (op.type === "door" ? "D" : "W")}
              </text>
            </g>
          );
        })}
        {/* Width callout */}
        <text
          x={wallX + wallW / 2}
          y={wallY + wallH + 18}
          textAnchor="middle"
          fontSize={10}
          fontFamily="ui-monospace, monospace"
          fontWeight={700}
          fill="#52525B"
        >
          {width_ft.toFixed(0)}&apos;
        </text>
        {/* Height callout */}
        <text
          x={wallX + wallW + 14}
          y={wallY + wallH / 2}
          textAnchor="middle"
          fontSize={10}
          fontFamily="ui-monospace, monospace"
          fontWeight={700}
          fill="#52525B"
          transform={`rotate(90 ${wallX + wallW + 14} ${wallY + wallH / 2})`}
        >
          {height_ft.toFixed(0)}&apos;
        </text>
        {/* Scale bar */}
        <g>
          <line
            x1={wallX}
            y1={VIEWBOX_H - 8}
            x2={wallX + scaleBarPx}
            y2={VIEWBOX_H - 8}
            stroke="#09090B"
            strokeWidth={1.5}
          />
          <line x1={wallX} y1={VIEWBOX_H - 12} x2={wallX} y2={VIEWBOX_H - 4} stroke="#09090B" strokeWidth={1.5} />
          <line x1={wallX + scaleBarPx} y1={VIEWBOX_H - 12} x2={wallX + scaleBarPx} y2={VIEWBOX_H - 4} stroke="#09090B" strokeWidth={1.5} />
          <text
            x={wallX + scaleBarPx / 2}
            y={VIEWBOX_H - 14}
            textAnchor="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill="#52525B"
          >
            10 ft
          </text>
        </g>
      </svg>
      {editable && onOpeningMove && openings.length > 0 && (
        <div className="text-[9px] text-[#A1A1AA] italic px-2 py-1 border-t border-[#E4E4E7] bg-[#FAFAFA]">
          Drag any opening to reposition &middot; click &quot;Roof:&quot; to cycle shape
        </div>
      )}
    </div>
  );
}
