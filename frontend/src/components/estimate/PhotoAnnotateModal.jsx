// Pre-AI photo annotation modal.
//
// Lets the contractor mark up a photo BEFORE sending it to Claude:
//   1. Reference scale anchor — tap two points on a known span (door,
//      garage, wall), enter its real length in ft or inches. Claude
//      uses this to lock scale on that photo (±5% instead of ±20%).
//   2. No-siding zones — tap rectangles or polygons over brick / stone
//      / garage doors / stucco. Claude excludes those areas from
//      siding_pct_this_wall calculations.
//
// On Apply, the annotations are RENDERED INTO the photo (red line for
// the scale, red hatched overlay for zones, elevation label burned in
// the corner) so Claude sees them visually. The structured payload
// (elevation tag + reference inches + zone categories) is ALSO passed
// as text so Claude has both modalities.
//
// Modeled after PhotoMeasureButton's calibration + zone code so the
// patterns stay consistent, but stripped down: no measurement loop,
// no openings, no labels — annotations only.
import React, { useEffect, useRef, useState } from "react";
import { X, Check, Ruler, Square, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const MODE_SCALE = "scale";
const MODE_ZONE = "zone";
// Iter 56e: single-tap "pin the target house" — needed mostly for the
// satellite/aerial photo since Nominatim's geocoded lat/lon often lands
// on the parcel center or road, not the actual structure (especially on
// rural lots with multiple buildings).
const MODE_TARGET = "target";

const ZONE_CATEGORIES = [
  { key: "brick",       name: "Brick",       color: "#B45309" },
  { key: "stone",       name: "Stone",       color: "#57534E" },
  { key: "garage_door", name: "Garage door", color: "#FBBF24" },
  { key: "stucco",      name: "Stucco",      color: "#A8A29E" },
  { key: "other",       name: "Other",       color: "#DC2626" },
];

function distPx(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export default function PhotoAnnotateModal({
  open,
  onClose,
  photoUrl,
  elevation,
  reference,    // { p1, p2, inches } | null — saved in photo-pixel coords
  zones,        // array of saved zones (rect/poly)
  targetPin,    // { x, y } | null — single point marking the target house
  onSave,       // ({ reference, zones, targetPin }) => void
}) {
  const canvasRef = useRef();
  const [photo, setPhoto] = useState(null); // { width, height }
  const [mode, setMode] = useState(MODE_SCALE);
  const [pending, setPending] = useState(null); // first tap awaiting second
  const [polyPoints, setPolyPoints] = useState([]);
  const [zoneShape, setZoneShape] = useState("rect");
  const [zoneCategory, setZoneCategory] = useState("brick");
  // Pending scale entry — opens after the contractor taps two points.
  const [scalePending, setScalePending] = useState(null); // { p1, p2, pxDistance }
  const [scaleValue, setScaleValue] = useState("");
  const [scaleUnit, setScaleUnit] = useState(() => {
    try {
      const v = localStorage.getItem("photoAnnotateScaleUnit");
      return v === "in" || v === "ft" ? v : "ft";
    } catch {
      return "ft";
    }
  });
  // Local working copies so the modal can be canceled without committing.
  const [localRef, setLocalRef] = useState(reference || null);
  const [localZones, setLocalZones] = useState(zones || []);
  const [localTarget, setLocalTarget] = useState(targetPin || null);

  useEffect(() => {
    try { localStorage.setItem("photoAnnotateScaleUnit", scaleUnit); } catch { /* ignore */ }
  }, [scaleUnit]);

  // Reset working copies when modal (re)opens for a different photo.
  useEffect(() => {
    if (!open) return;
    setLocalRef(reference || null);
    setLocalZones(zones || []);
    setLocalTarget(targetPin || null);
    // For aerial photos, default to Target Pin mode since that's the
    // most common reason to annotate one (geocoder missed the house).
    setMode(elevation === "aerial" ? MODE_TARGET : MODE_SCALE);
    setPending(null);
    setPolyPoints([]);
    setScalePending(null);
    setScaleValue("");
    // Force-load the photo dimensions
    if (photoUrl) {
      const img = new Image();
      img.onload = () => setPhoto({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = photoUrl;
    }
  }, [open, photoUrl, reference, zones, targetPin, elevation]);

  if (!open) return null;

  const evtPoint = (e) => {
    if (!photo || !canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = photo.width / rect.width;
    const sy = photo.height / rect.height;
    const cx = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
    const cy = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
    return { x: cx * sx, y: cy * sy };
  };

  const onCanvasClick = (e) => {
    if (!photo) return;
    const p = evtPoint(e);
    if (mode === MODE_TARGET) {
      // Single tap drops / replaces the target-house pin.
      setLocalTarget(p);
      return;
    }
    if (mode === MODE_SCALE) {
      if (!pending) { setPending(p); return; }
      setScalePending({ p1: pending, p2: p, pxDistance: distPx(pending, p) });
      setScaleValue("");
      setPending(null);
      return;
    }
    // MODE_ZONE
    if (zoneShape === "rect") {
      if (!pending) { setPending(p); return; }
      const x1 = Math.min(pending.x, p.x);
      const y1 = Math.min(pending.y, p.y);
      const x2 = Math.max(pending.x, p.x);
      const y2 = Math.max(pending.y, p.y);
      if (x2 - x1 < 4 || y2 - y1 < 4) { setPending(null); return; }
      const points = [
        { x: x1, y: y1 }, { x: x2, y: y1 },
        { x: x2, y: y2 }, { x: x1, y: y2 },
      ];
      setLocalZones((prev) => [
        ...prev,
        { id: `z-${Date.now()}`, kind: "rect", category: zoneCategory, points },
      ]);
      setPending(null);
      return;
    }
    setPolyPoints((prev) => [...prev, p]);
  };

  const closePolygon = () => {
    if (polyPoints.length < 3) { toast.error("Polygon needs at least 3 points"); return; }
    setLocalZones((prev) => [
      ...prev,
      { id: `z-${Date.now()}`, kind: "poly", category: zoneCategory, points: polyPoints },
    ]);
    setPolyPoints([]);
  };

  const confirmScale = () => {
    if (!scalePending) return;
    const num = parseFloat(scaleValue);
    if (!num || num <= 0) { toast.error("Enter a positive number"); return; }
    const inches = scaleUnit === "ft" ? num * 12 : num;
    setLocalRef({ p1: scalePending.p1, p2: scalePending.p2, inches });
    setScalePending(null);
    setScaleValue("");
    toast.success(`Scale anchor set: ${num} ${scaleUnit} reference`);
  };
  const cancelScale = () => { setScalePending(null); setScaleValue(""); };

  const removeZone = (id) => setLocalZones((prev) => prev.filter((z) => z.id !== id));
  const removeReference = () => setLocalRef(null);
  const removeTarget = () => setLocalTarget(null);

  const save = () => {
    onSave({ reference: localRef, zones: localZones, targetPin: localTarget });
    onClose();
  };

  // Render overlay markup
  const renderOverlay = () => {
    if (!photo) return null;
    const hatchSize = Math.max(8, photo.width / 120);
    return (
      <svg viewBox={`0 0 ${photo.width} ${photo.height}`} className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          {ZONE_CATEGORIES.map((c) => (
            <pattern key={c.key} id={`annot-hatch-${c.key}`} patternUnits="userSpaceOnUse"
                     width={hatchSize} height={hatchSize} patternTransform="rotate(45)">
              <rect width={hatchSize} height={hatchSize} fill={c.color} fillOpacity={0.22} />
              <line x1="0" y1="0" x2="0" y2={hatchSize} stroke={c.color} strokeWidth={Math.max(2, hatchSize / 4)} />
            </pattern>
          ))}
        </defs>
        {localZones.map((z) => {
          const c = ZONE_CATEGORIES.find((x) => x.key === z.category) || ZONE_CATEGORIES[0];
          const d = z.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
          const xs = z.points.map((p) => p.x);
          const ys = z.points.map((p) => p.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          return (
            <g key={z.id}>
              <path d={d} fill={`url(#annot-hatch-${c.key})`} stroke={c.color} strokeWidth={Math.max(3, photo.width / 600)} />
              <rect x={cx - 90} y={cy - 18} width={180} height={28} fill="#09090B" rx={3} />
              <text x={cx} y={cy + 3} fill="#FFFFFF" fontSize={Math.max(13, photo.width / 75)} textAnchor="middle" fontWeight="bold">
                NO SIDING · {c.name}
              </text>
            </g>
          );
        })}
        {localRef && (
          <g>
            <line x1={localRef.p1.x} y1={localRef.p1.y} x2={localRef.p2.x} y2={localRef.p2.y}
                  stroke="#DC2626" strokeWidth={Math.max(4, photo.width / 500)} />
            <circle cx={localRef.p1.x} cy={localRef.p1.y} r={Math.max(6, photo.width / 300)} fill="#DC2626" />
            <circle cx={localRef.p2.x} cy={localRef.p2.y} r={Math.max(6, photo.width / 300)} fill="#DC2626" />
            <rect x={(localRef.p1.x + localRef.p2.x) / 2 - 80}
                  y={(localRef.p1.y + localRef.p2.y) / 2 - 20}
                  width={160} height={32} fill="#DC2626" rx={3} />
            <text x={(localRef.p1.x + localRef.p2.x) / 2}
                  y={(localRef.p1.y + localRef.p2.y) / 2 + 5}
                  fill="#FFFFFF" fontSize={Math.max(15, photo.width / 65)}
                  textAnchor="middle" fontWeight="bold">
              REF = {localRef.inches}"
            </text>
          </g>
        )}
        {localTarget && (() => {
          const ringR = Math.max(40, photo.width / 14);
          const lw = Math.max(4, photo.width / 240);
          return (
            <g>
              <circle cx={localTarget.x} cy={localTarget.y} r={ringR}
                      fill="none" stroke="#10B981" strokeWidth={lw} />
              <circle cx={localTarget.x} cy={localTarget.y} r={Math.max(6, photo.width / 200)} fill="#10B981" />
              <line x1={localTarget.x - ringR * 2} y1={localTarget.y}
                    x2={localTarget.x - ringR - lw} y2={localTarget.y}
                    stroke="#10B981" strokeWidth={lw} />
              <line x1={localTarget.x + ringR + lw} y1={localTarget.y}
                    x2={localTarget.x + ringR * 2} y2={localTarget.y}
                    stroke="#10B981" strokeWidth={lw} />
              <line x1={localTarget.x} y1={localTarget.y - ringR * 2}
                    x2={localTarget.x} y2={localTarget.y - ringR - lw}
                    stroke="#10B981" strokeWidth={lw} />
              <line x1={localTarget.x} y1={localTarget.y + ringR + lw}
                    x2={localTarget.x} y2={localTarget.y + ringR * 2}
                    stroke="#10B981" strokeWidth={lw} />
              <rect x={localTarget.x - 110} y={localTarget.y - ringR * 2 - 36}
                    width={220} height={32} fill="#10B981" rx={3} />
              <text x={localTarget.x} y={localTarget.y - ringR * 2 - 14}
                    fill="#FFFFFF" fontSize={Math.max(15, photo.width / 65)}
                    textAnchor="middle" fontWeight="bold">
                TARGET HOUSE
              </text>
            </g>
          );
        })()}
        {/* In-progress polygon preview */}
        {mode === MODE_ZONE && zoneShape === "poly" && polyPoints.length > 0 && (() => {
          const c = ZONE_CATEGORIES.find((x) => x.key === zoneCategory) || ZONE_CATEGORIES[0];
          const d = polyPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
          return (
            <g>
              <path d={d} fill="none" stroke={c.color} strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="8 4" />
              {polyPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={Math.max(5, photo.width / 350)} fill={c.color} />
              ))}
            </g>
          );
        })()}
        {pending && (
          <circle cx={pending.x} cy={pending.y} r={Math.max(6, photo.width / 300)}
                  fill="none" stroke="#DC2626" strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="6 4" />
        )}
      </svg>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="photo-annotate-modal"
    >
      <div
        className="bg-white max-w-5xl w-full max-h-[95vh] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#7C3AED] text-white px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-heading text-lg">Annotate Photo for AI</div>
            <div className="text-xs opacity-90 mt-0.5">
              {elevation && <>Elevation: <b>{elevation}</b> · </>}
              {mode === MODE_TARGET
                ? "Tap once on the actual house — overrides the auto-geocoded crosshair on aerial photos"
                : mode === MODE_SCALE
                ? "Tap two points on a known reference (door, garage), then enter its real length"
                : (zoneShape === "rect"
                    ? `Tap top-left then bottom-right to mark a ${ZONE_CATEGORIES.find((c) => c.key === zoneCategory)?.name} zone`
                    : `Tap polygon points, then Close to commit a ${ZONE_CATEGORIES.find((c) => c.key === zoneCategory)?.name} zone`)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-white/90 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scale-entry submodal (uses same Ft/In pattern as Iter 51) */}
        {scalePending && (() => {
          const num = parseFloat(scaleValue);
          const valid = !isNaN(num) && num > 0;
          const inches = valid ? (scaleUnit === "ft" ? num * 12 : num) : 0;
          return (
            <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-4" onClick={cancelScale}>
              <div className="bg-white max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="bg-[#DC2626] text-white px-4 py-2.5">
                  <div className="font-heading text-base">Reference Length</div>
                  <div className="text-[11px] opacity-90 mt-0.5">
                    How long is what you just marked?
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setScaleUnit("ft")}
                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider border ${scaleUnit === "ft" ? "bg-[#09090B] text-white border-[#09090B]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"}`}
                            data-testid="annotate-scale-unit-ft">Feet</button>
                    <button type="button" onClick={() => setScaleUnit("in")}
                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider border ${scaleUnit === "in" ? "bg-[#09090B] text-white border-[#09090B]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"}`}
                            data-testid="annotate-scale-unit-in">Inches</button>
                  </div>
                  <input type="number" step="any" min="0" inputMode="decimal" autoFocus
                         value={scaleValue} onChange={(e) => setScaleValue(e.target.value)}
                         onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmScale(); } if (e.key === "Escape") { e.preventDefault(); cancelScale(); } }}
                         placeholder={scaleUnit === "ft" ? "e.g. 7 (entry door)" : "e.g. 84"}
                         className="w-full px-3 py-2 border border-[#E4E4E7] rounded-sm text-base font-mono-num focus:outline-none focus:border-[#DC2626]"
                         data-testid="annotate-scale-input" />
                  {valid && (
                    <div className="text-[11px] text-[#71717A]">
                      = <b className="font-mono-num">{(inches / 12).toFixed(2)} ft</b> / <b className="font-mono-num">{inches.toFixed(1)} in</b>
                    </div>
                  )}
                  <div className="text-[10px] text-[#A1A1AA] leading-snug">
                    Entry door ≈ <b>7 ft</b>, single garage ≈ <b>7×9 ft</b>, double garage ≈ <b>7×16 ft</b>.
                  </div>
                </div>
                <div className="border-t border-[#E4E4E7] px-4 py-3 flex justify-end gap-2">
                  <button type="button" onClick={cancelScale}
                          className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider">Cancel</button>
                  <button type="button" onClick={confirmScale} disabled={!valid}
                          className="px-3 py-2 bg-[#DC2626] text-white hover:bg-[#B91C1C] text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                          data-testid="annotate-scale-confirm">Set Reference</button>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="overflow-y-auto flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Canvas */}
          <div className="md:col-span-2">
            {!photo ? (
              <div className="aspect-video bg-[#FAFAFA] flex items-center justify-center text-[#A1A1AA] text-sm">Loading photo…</div>
            ) : (
              <div className="relative border border-[#E4E4E7] rounded-sm overflow-hidden">
                <img ref={canvasRef} src={photoUrl} alt="annotate"
                     className="w-full h-auto block cursor-crosshair"
                     onClick={onCanvasClick} data-testid="annotate-canvas" />
                {renderOverlay()}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1">
              <button type="button"
                      onClick={() => { setMode(MODE_TARGET); setPending(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_TARGET ? "bg-[#10B981] text-white border-[#10B981]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-target"
                      title="Tap once on the actual target house — overrides the auto-geocoded crosshair on aerial photos">
                <Check className="w-3 h-3" /> Pin
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_SCALE); setPending(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_SCALE ? "bg-[#DC2626] text-white border-[#DC2626]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-scale">
                <Ruler className="w-3 h-3" /> Scale
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_ZONE); setPending(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_ZONE ? "bg-[#B45309] text-white border-[#B45309]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-zone">
                <Square className="w-3 h-3" /> Mask
              </button>
            </div>

            {mode === MODE_ZONE && (
              <div className="space-y-2">
                <div className="flex gap-1">
                  <button type="button"
                          onClick={() => { setZoneShape("rect"); setPending(null); setPolyPoints([]); }}
                          className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${zoneShape === "rect" ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"}`}>Rectangle</button>
                  <button type="button"
                          onClick={() => { setZoneShape("poly"); setPending(null); }}
                          className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${zoneShape === "poly" ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"}`}>Polygon</button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {ZONE_CATEGORIES.map((c) => (
                    <button key={c.key} type="button" onClick={() => setZoneCategory(c.key)}
                            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${zoneCategory === c.key ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"} flex items-center gap-1`}
                            data-testid={`annotate-zone-cat-${c.key}`}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>
                {zoneShape === "poly" && polyPoints.length > 0 && (
                  <div className="flex gap-1">
                    <button type="button" onClick={closePolygon} disabled={polyPoints.length < 3}
                            className="flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[#B45309] text-white border border-[#B45309] hover:bg-[#92400E] disabled:opacity-40">
                      Close ({polyPoints.length} pts)
                    </button>
                    <button type="button" onClick={() => setPolyPoints([])}
                            className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5]">Cancel</button>
                  </div>
                )}
              </div>
            )}

            {/* Existing annotations */}
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                Target house pin
              </div>
              {localTarget ? (
                <div className="text-xs flex items-center justify-between gap-2 bg-[#D1FAE5] px-2 py-1.5 border-l-2 border-[#10B981]">
                  <span className="font-mono-num text-[#065F46]">
                    Pinned at ({Math.round(localTarget.x)}, {Math.round(localTarget.y)})
                  </span>
                  <button onClick={removeTarget} className="text-[#A1A1AA] hover:text-[#DC2626]" data-testid="annotate-target-remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA] italic">
                  No pin set — tap on the actual house in Pin mode (overrides the auto-geocoded crosshair).
                </div>
              )}
            </div>
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                Scale anchor
              </div>
              {localRef ? (
                <div className="text-xs flex items-center justify-between gap-2 bg-[#FEE2E2] px-2 py-1.5 border-l-2 border-[#DC2626]">
                  <span>
                    <span className="font-mono-num font-bold">{localRef.inches}"</span> ({(localRef.inches / 12).toFixed(2)} ft)
                  </span>
                  <button onClick={removeReference} className="text-[#A1A1AA] hover:text-[#DC2626]" data-testid="annotate-ref-remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA] italic">No reference set — tap two points in Scale mode.</div>
              )}
            </div>
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                No-siding zones ({localZones.length})
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto" data-testid="annotate-zone-list">
                {localZones.map((z) => {
                  const c = ZONE_CATEGORIES.find((x) => x.key === z.category);
                  return (
                    <li key={z.id} className="text-xs flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c?.color }} />
                        {c?.name} ({z.kind})
                      </span>
                      <button onClick={() => removeZone(z.id)} className="text-[#A1A1AA] hover:text-[#DC2626]">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })}
                {!localZones.length && (
                  <li className="text-[11px] text-[#A1A1AA] italic">No zones yet — switch to Mask zone mode to draw.</li>
                )}
              </ul>
            </div>

            {(localRef || localZones.length > 0 || localTarget) && (
              <button type="button"
                      onClick={() => { setLocalRef(null); setLocalZones([]); setLocalTarget(null); setPending(null); setPolyPoints([]); }}
                      className="text-[10px] text-[#A1A1AA] uppercase tracking-wider font-bold flex items-center gap-1 hover:text-[#DC2626]"
                      data-testid="annotate-clear-all">
                <RotateCcw className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] px-5 py-3 flex justify-between items-center">
          <div className="text-[10px] text-[#A1A1AA]">
            Annotations are burned into the photo before Claude sees it.
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
                    className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider">Cancel</button>
            <button type="button" onClick={save}
                    className="px-3 py-2 bg-[#7C3AED] text-white hover:bg-[#6D28D9] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                    data-testid="annotate-save">
              <Check className="w-3.5 h-3.5" />
              Save Annotations
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
