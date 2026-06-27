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
import { X, Check, Ruler, Square, Trash2, RotateCcw, ZoomIn, ZoomOut, Maximize, Tags } from "lucide-react";
import { toast } from "sonner";

const MODE_SCALE = "scale";
const MODE_SCALE_WINDOW = "scale_window";
const MODE_ZONE = "zone";
// Iter 56e: single-tap "pin the target house" — needed mostly for the
// satellite/aerial photo since Nominatim's geocoded lat/lon often lands
// on the parcel center or road, not the actual structure (especially on
// rural lots with multiple buildings).
const MODE_TARGET = "target";
// Iter 57e: tap-to-tag individual windows. Each tap drops a pin at the
// window centre and pops a picker (style + W×H). Claude then receives
// the tagged windows as GROUND TRUTH (rule #14b in the prompt) — beats
// its own photo-inference of style/size, which is the biggest source
// of wrong-window-on-quote errors.
const MODE_WINDOW = "window";

// Same vocabulary as AIMeasureButton's WINDOW_STYLES — duplicated here so
// the modal stays self-contained. Keep in sync.
const WIN_STYLES = [
  "Double Hung", "Single Hung",
  "Casement", "Twin Casement",
  "Awning", "Hopper",
  "2-Lite Slider", "3-Lite Slider",
  "Picture",
  "Twin Double Hung", "Twin Single Hung", "Triple Double Hung",
  "Bay Window", "Bow Window",
  "Half-Round", "Quarter-Round", "Arch", "Octagon", "Hexagon",
  "Garden Window", "Other Shape",
];
// Short codes used on the photo marker (kept tiny — 2-3 chars — so the
// badge doesn't cover the window itself). Order matches WIN_STYLES so a
// switch (vs map lookup) is unnecessary.
const STYLE_ABBR = {
  "Double Hung": "DH",
  "Single Hung": "SH",
  "Casement": "CA",
  "Twin Casement": "2CA",
  "Awning": "AW",
  "Hopper": "HP",
  "2-Lite Slider": "2SL",
  "3-Lite Slider": "3SL",
  "Picture": "PIC",
  "Twin Double Hung": "2DH",
  "Twin Single Hung": "2SH",
  "Triple Double Hung": "3DH",
  "Bay Window": "BAY",
  "Bow Window": "BOW",
  "Half-Round": "1/2",
  "Quarter-Round": "1/4",
  "Arch": "ARC",
  "Octagon": "OCT",
  "Hexagon": "HEX",
  "Garden Window": "GDN",
  "Other Shape": "OTH",
};

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

// Iter 57k — auto-snap a placed second point to horizontal / vertical
// when it's within `tolDeg` of either axis. Contractors held their
// phone slightly tilted while marking a wall edge, which produced
// sloped reference lines and pixel-stretched scale. Snap killed it.
// Returns the (possibly adjusted) p2 and a flag so the UI can show
// "snapped to horizontal" feedback.
function snapToOrtho(p1, p2, tolDeg = 5) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return { p2, snapped: null };
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI); // 0..180
  // Horizontal: angle ≈ 0 or ≈ 180
  if (angle <= tolDeg || angle >= 180 - tolDeg) {
    return { p2: { x: p2.x, y: p1.y }, snapped: "horizontal" };
  }
  // Vertical: angle ≈ 90
  if (angle >= 90 - tolDeg && angle <= 90 + tolDeg) {
    return { p2: { x: p1.x, y: p2.y }, snapped: "vertical" };
  }
  return { p2, snapped: null };
}

// Iter 57k — compute live angle off horizontal (deg) for the rubber-band
// preview so the contractor knows BEFORE committing whether they're
// straight. 0° = perfectly horizontal, 90° = perfectly vertical.
function lineAngleDeg(p1, p2) {
  const a = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  // Fold to 0..90 (we don't care left vs right or up vs down)
  let v = Math.abs(a);
  if (v > 90) v = 180 - v;
  return v;
}

export default function PhotoAnnotateModal({
  open,
  onClose,
  photoUrl,
  elevation,
  reference,        // { p1, p2, inches } | null — saved in photo-pixel coords (WALL anchor — legacy field name preserved)
  windowReference,  // { p1, p2, inches } | null — Iter 57k: separate WINDOW anchor
  zones,        // array of saved zones (rect/poly)
  targetPin,    // { x, y } | null — single point marking the target house
  windows,      // Iter 57e — array of {x,y,style,width_in,height_in,id}
  onSave,       // ({ reference, windowReference, zones, targetPin, windows }) => void
  onOpenProfileAnnotator, // Iter 78z+++ — opens the cross-photo Tag Profiles tool (LAP / SHAKE / B&B / dormer / etc.)
}) {
  const canvasRef = useRef();
  const [photo, setPhoto] = useState(null); // { width, height }
  const [mode, setMode] = useState(MODE_SCALE);
  const [pending, setPending] = useState(null); // first tap awaiting second
  const [polyPoints, setPolyPoints] = useState([]);
  const [zoneShape, setZoneShape] = useState("rect");
  const [zoneCategory, setZoneCategory] = useState("brick");
  // Pending scale entry — opens after the contractor taps two points.
  // Iter 57k: `kind` distinguishes wall vs window scale so the confirm
  // step routes the value to the right local ref.
  const [scalePending, setScalePending] = useState(null); // { p1, p2, pxDistance, kind, snapped }
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
  const [localWindowRef, setLocalWindowRef] = useState(windowReference || null);
  const [localZones, setLocalZones] = useState(zones || []);
  const [localTarget, setLocalTarget] = useState(targetPin || null);
  const [localWindows, setLocalWindows] = useState(windows || []);
  // Pending window-tag entry: after the contractor taps a window pixel,
  // we open a small picker (style + W×H). Saved with `confirmWindow`.
  const [windowPending, setWindowPending] = useState(null); // { x, y }
  const [windowStyle, setWindowStyle] = useState("Double Hung");
  // Iter 57k — rubber-band preview point. Tracks the cursor between the
  // first scale tap and the second tap so the contractor SEES the line
  // they're about to commit (and the angle off horizontal) instead of
  // guessing.
  const [hoverPoint, setHoverPoint] = useState(null);

  // Iter 57l — pinch-zoom + pan. Critical on iPad/phones where small
  // window edges need pixel-precise tapping. Two-finger pinch zooms (1×
  // → 6×), single-finger drag pans while zoomed-in, mouse wheel zooms
  // toward the cursor on desktop. We distinguish a "tap" (no significant
  // movement) from a "drag" so panning never accidentally places a point.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef(null);
  // Mutable gesture state, kept in a ref to avoid re-renders during a
  // pointer-move stream (which fires 60× per second on iPad).
  const gestureRef = useRef({
    pointers: new Map(),   // pointerId → { clientX, clientY, startX, startY, moved }
    pinch: null,           // { d0, m0, z0, pan0 } captured when 2 pointers go down
    panActive: false,      // gets set true the moment any pointer moves > TAP_THRESH
  });
  const TAP_THRESH = 6;    // CSS px — anything more counts as drag, not tap
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 6;

  useEffect(() => {
    try { localStorage.setItem("photoAnnotateScaleUnit", scaleUnit); } catch { /* ignore */ }
  }, [scaleUnit]);

  // Reset working copies when modal (re)opens for a different photo.
  useEffect(() => {
    if (!open) return;
    setLocalRef(reference || null);
    setLocalWindowRef(windowReference || null);
    setLocalZones(zones || []);
    setLocalTarget(targetPin || null);
    setLocalWindows(windows || []);
    setWindowPending(null);
    // For aerial photos, default to Target Pin mode since that's the
    // most common reason to annotate one (geocoder missed the house).
    setMode(elevation === "aerial" ? MODE_TARGET : MODE_SCALE);
    setPending(null);
    setHoverPoint(null);
    setPolyPoints([]);
    setScalePending(null);
    setScaleValue("");
    // Iter 57l — reset zoom/pan when modal opens for a new photo
    setZoom(1);
    setPan({ x: 0, y: 0 });
    gestureRef.current.pointers.clear();
    gestureRef.current.pinch = null;
    gestureRef.current.panActive = false;
    // Force-load the photo dimensions
    if (photoUrl) {
      const img = new Image();
      img.onload = () => setPhoto({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = photoUrl;
    }
  }, [open, photoUrl, reference, windowReference, zones, targetPin, windows, elevation]);

  // Iter 57l — attach a NON-passive wheel listener so e.preventDefault()
  // actually stops the page from scrolling while zooming with the wheel.
  // (React's synthetic onWheel is passive — preventDefault is a no-op.)
  // MUST be declared before the early-return below to satisfy the
  // rules-of-hooks invariant.
  useEffect(() => {
    if (!open) return;
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!photo || !viewportRef.current) return;
      e.preventDefault();
      const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(-e.deltaY * 0.0015)));
      if (z1 === zoom) return;
      const rect = viewportRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = z1 / zoom;
      setZoom(z1);
      setPan({
        x: mx - (mx - pan.x) * ratio,
        y: my - (my - pan.y) * ratio,
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [open, zoom, pan.x, pan.y, photo]);

  if (!open) return null;

  // Iter 57l — `evtPoint` (event → photo-pixel) was replaced by
  // `evtPointFromClient` so the unified pointer pipeline can call it
  // with raw clientX/Y. We keep it as a thin shim for any remaining
  // synthetic-event callsites (currently none) — defined here so it
  // isn't a hoisting hazard.

  // Iter 57l — pinch-zoom math: keep the midpoint between two fingers
  // anchored to the same image pixel as the zoom changes. Standard
  // "zoom toward a point" formula:
  //   new_pan = midpoint_local - (midpoint_local - old_pan) * (new_zoom / old_zoom)
  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const applyZoomAt = (newZoom, clientX, clientY) => {
    if (!viewportRef.current) return;
    const z1 = clampZoom(newZoom);
    if (z1 === zoom) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const ratio = z1 / zoom;
    const newPan = {
      x: mx - (mx - pan.x) * ratio,
      y: my - (my - pan.y) * ratio,
    };
    setZoom(z1);
    setPan(newPan);
  };
  const zoomIn = () => {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    applyZoomAt(zoom * 1.6, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const zoomOut = () => {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    applyZoomAt(zoom / 1.6, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Iter 57l — unified pointer pipeline. Replaces onClick / onMouseMove
  // / onTouchMove with a single set of handlers on the viewport div so
  // pinch + pan + tap all coexist.
  const onPointerDown = (e) => {
    if (!photo) return;
    if (e.pointerType !== "touch") {
      // Mouse / pen: only act on primary button
      if (e.button !== 0) return;
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const g = gestureRef.current;
    g.pointers.set(e.pointerId, {
      clientX: e.clientX, clientY: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false,
    });
    if (g.pointers.size === 2) {
      const pts = Array.from(g.pointers.values());
      const d0 = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      const m0 = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
      g.pinch = { d0, m0, z0: zoom, pan0: { ...pan } };
      g.panActive = true;     // pinch implies no tap
    }
  };
  const onPointerMove = (e) => {
    if (!photo) return;
    const g = gestureRef.current;
    const p = g.pointers.get(e.pointerId);
    // Capture deltas BEFORE we overwrite the pointer's previous position
    // (needed for 1-finger pan increments).
    let dxFromLast = 0;
    let dyFromLast = 0;
    if (p) {
      dxFromLast = e.clientX - p.clientX;
      dyFromLast = e.clientY - p.clientY;
      p.clientX = e.clientX;
      p.clientY = e.clientY;
      if (!p.moved && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_THRESH) {
        p.moved = true;
        g.panActive = true;
      }
    }
    // 2-finger pinch
    if (g.pointers.size >= 2 && g.pinch) {
      const pts = Array.from(g.pointers.values()).slice(0, 2);
      const d1 = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      const m1 = {
        x: (pts[0].clientX + pts[1].clientX) / 2,
        y: (pts[0].clientY + pts[1].clientY) / 2,
      };
      if (g.pinch.d0 > 0 && viewportRef.current) {
        const newZoom = clampZoom(g.pinch.z0 * (d1 / g.pinch.d0));
        const rect = viewportRef.current.getBoundingClientRect();
        const m0Local = { x: g.pinch.m0.x - rect.left, y: g.pinch.m0.y - rect.top };
        const m1Local = { x: m1.x - rect.left, y: m1.y - rect.top };
        const ratio = newZoom / g.pinch.z0;
        // pan that keeps the original midpoint image-coord under the new midpoint screen-coord:
        const newPan = {
          x: m1Local.x - (m0Local.x - g.pinch.pan0.x) * ratio,
          y: m1Local.y - (m0Local.y - g.pinch.pan0.y) * ratio,
        };
        setZoom(newZoom);
        setPan(newPan);
      }
      return;
    }
    // 1-pointer drag-pan when zoomed-in: incremental delta-since-last
    if (g.pointers.size === 1 && p && p.moved && zoom > 1) {
      setPan((prev) => ({ x: prev.x + dxFromLast, y: prev.y + dyFromLast }));
      return;
    }
    // Rubber-band hover preview (mouse) — only when NOT panning and in
    // scale mode with a first point placed.
    if (!g.panActive && (mode === MODE_SCALE || mode === MODE_SCALE_WINDOW) && pending && e.pointerType !== "touch") {
      setHoverPoint(evtPointFromClient(e.clientX, e.clientY));
    }
  };
  const onPointerUp = (e) => {
    const g = gestureRef.current;
    const p = g.pointers.get(e.pointerId);
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinch = null;
    if (g.pointers.size === 0) {
      // Last finger up. If it was a clean tap (no drag), invoke the
      // click logic. Otherwise reset panActive for the next gesture.
      const wasTap = p && !p.moved && !g.panActive;
      g.panActive = false;
      if (wasTap && photo) {
        const photoP = evtPointFromClient(e.clientX, e.clientY);
        handleTap(photoP);
      }
    }
  };
  // Wheel zoom is handled via a non-passive native listener attached
  // in a useEffect above the early return (so preventDefault works).

  // Convert a CLIENT (screen) coordinate to PHOTO-PIXEL coordinates,
  // independent of zoom/pan because the img's getBoundingClientRect()
  // already reflects the current transform.
  const evtPointFromClient = (clientX, clientY) => {
    if (!photo || !canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const sx = photo.width / rect.width;
    const sy = photo.height / rect.height;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return { x: cx * sx, y: cy * sy };
  };

  // Iter 57l — pan via single-finger drag uses an incremental delta
  // computed from the pointer's last position to current (see
  // onPointerMove which reads p.clientX/Y before overwriting them).

  // Iter 57l — tap → place point. Extracted from the old onCanvasClick
  // so the unified pointer pipeline can invoke it on tap-up.
  const handleTap = (p) => {
    if (mode === MODE_WINDOW) {
      setWindowPending({ x: p.x, y: p.y });
      return;
    }
    if (mode === MODE_TARGET) {
      if (!pending) { setPending(p); return; }
      const x1 = Math.min(pending.x, p.x);
      const y1 = Math.min(pending.y, p.y);
      const x2 = Math.max(pending.x, p.x);
      const y2 = Math.max(pending.y, p.y);
      if (x2 - x1 < 4 || y2 - y1 < 4) {
        setPending(null);
        return;
      }
      setLocalTarget({ x1, y1, x2, y2 });
      setPending(null);
      return;
    }
    if (mode === MODE_SCALE || mode === MODE_SCALE_WINDOW) {
      if (!pending) { setPending(p); setHoverPoint(p); return; }
      // Iter 57k — auto-snap the second tap to horizontal or vertical
      // when the line is within ±5° of either axis. Kills the "I tilted
      // my finger" sloped-reference problem.
      const { p2: snappedP2, snapped } = snapToOrtho(pending, p);
      setScalePending({
        p1: pending,
        p2: snappedP2,
        pxDistance: distPx(pending, snappedP2),
        kind: mode === MODE_SCALE_WINDOW ? "window" : "wall",
        snapped,
      });
      setScaleValue("");
      setPending(null);
      setHoverPoint(null);
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
    const ref = { p1: scalePending.p1, p2: scalePending.p2, inches };
    if (scalePending.kind === "window") {
      setLocalWindowRef(ref);
      toast.success(`Window scale set: ${num} ${scaleUnit}${scalePending.snapped ? ` (snapped ${scalePending.snapped})` : ""}`);
    } else {
      setLocalRef(ref);
      toast.success(`Wall scale set: ${num} ${scaleUnit}${scalePending.snapped ? ` (snapped ${scalePending.snapped})` : ""}`);
    }
    setScalePending(null);
    setScaleValue("");
  };
  const cancelScale = () => { setScalePending(null); setScaleValue(""); };

  const removeZone = (id) => setLocalZones((prev) => prev.filter((z) => z.id !== id));
  const removeReference = () => setLocalRef(null);
  const removeWindowReference = () => setLocalWindowRef(null);
  const removeTarget = () => setLocalTarget(null);
  const removeWindow = (id) =>
    setLocalWindows((prev) => prev.filter((w) => w.id !== id));

  const confirmWindow = () => {
    if (!windowPending) return;
    if (!windowStyle) {
      toast.error("Pick a window style");
      return;
    }
    setLocalWindows((prev) => [
      ...prev,
      {
        id: `w-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        x: windowPending.x,
        y: windowPending.y,
        style: windowStyle,
        // Iter 57f — size dropped from the picker; Claude sizes it from
        // the photo. We keep the field on the schema (=0) so older
        // saved sessions that have a size still round-trip cleanly.
        width_in: 0,
        height_in: 0,
      },
    ]);
    setWindowPending(null);
    toast.success(`Tagged: ${windowStyle} (Claude will size it)`);
  };
  const cancelWindow = () => setWindowPending(null);

  const save = () => {
    onSave({
      reference: localRef,
      windowReference: localWindowRef,
      zones: localZones,
      targetPin: localTarget,
      windows: localWindows,
    });
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
            <rect x={(localRef.p1.x + localRef.p2.x) / 2 - 90}
                  y={(localRef.p1.y + localRef.p2.y) / 2 - 20}
                  width={180} height={32} fill="#DC2626" rx={3} />
            <text x={(localRef.p1.x + localRef.p2.x) / 2}
                  y={(localRef.p1.y + localRef.p2.y) / 2 + 5}
                  fill="#FFFFFF" fontSize={Math.max(15, photo.width / 65)}
                  textAnchor="middle" fontWeight="bold">
              WALL REF = {localRef.inches}&quot;
            </text>
          </g>
        )}
        {localWindowRef && (
          <g>
            <line x1={localWindowRef.p1.x} y1={localWindowRef.p1.y} x2={localWindowRef.p2.x} y2={localWindowRef.p2.y}
                  stroke="#2563EB" strokeWidth={Math.max(4, photo.width / 500)} />
            <circle cx={localWindowRef.p1.x} cy={localWindowRef.p1.y} r={Math.max(6, photo.width / 300)} fill="#2563EB" />
            <circle cx={localWindowRef.p2.x} cy={localWindowRef.p2.y} r={Math.max(6, photo.width / 300)} fill="#2563EB" />
            <rect x={(localWindowRef.p1.x + localWindowRef.p2.x) / 2 - 100}
                  y={(localWindowRef.p1.y + localWindowRef.p2.y) / 2 - 20}
                  width={200} height={32} fill="#2563EB" rx={3} />
            <text x={(localWindowRef.p1.x + localWindowRef.p2.x) / 2}
                  y={(localWindowRef.p1.y + localWindowRef.p2.y) / 2 + 5}
                  fill="#FFFFFF" fontSize={Math.max(15, photo.width / 65)}
                  textAnchor="middle" fontWeight="bold">
              WIN REF = {localWindowRef.inches}&quot;
            </text>
          </g>
        )}
        {/* Iter 57k — Rubber-band preview line + live angle readout
            while the contractor is placing the second tap. Color-coded
            to the mode (red=wall, blue=window). Shows angle off the
            nearest axis + a "🔒 SNAP" badge when within the ±5° tolerance. */}
        {(mode === MODE_SCALE || mode === MODE_SCALE_WINDOW) && pending && hoverPoint && (() => {
          const color = mode === MODE_SCALE_WINDOW ? "#2563EB" : "#DC2626";
          const angle = lineAngleDeg(pending, hoverPoint);
          // Inside the snap tolerance band (±5°) — preview the SNAPPED
          // line so contractor sees exactly what they'll commit on tap.
          const snapTol = 5;
          let drawP2 = hoverPoint;
          let snapTag = null;
          if (angle <= snapTol) { drawP2 = { x: hoverPoint.x, y: pending.y }; snapTag = "HORIZONTAL"; }
          else if (angle >= 90 - snapTol) { drawP2 = { x: pending.x, y: hoverPoint.y }; snapTag = "VERTICAL"; }
          const mx = (pending.x + drawP2.x) / 2;
          const my = (pending.y + drawP2.y) / 2;
          const fontPx = Math.max(13, photo.width / 80);
          const label = snapTag
            ? `🔒 SNAP ${snapTag}`
            : `${angle.toFixed(1)}° off ${angle < 45 ? "H" : "V"}`;
          const labelLen = Math.max(110, label.length * fontPx * 0.55);
          return (
            <g>
              <line x1={pending.x} y1={pending.y} x2={drawP2.x} y2={drawP2.y}
                    stroke={color} strokeWidth={Math.max(3, photo.width / 700)}
                    strokeDasharray="10 6" opacity={0.85} />
              <circle cx={drawP2.x} cy={drawP2.y} r={Math.max(5, photo.width / 350)}
                      fill="none" stroke={color} strokeWidth={Math.max(2, photo.width / 800)} />
              <rect x={mx - labelLen / 2} y={my - fontPx - 12}
                    width={labelLen} height={fontPx + 8}
                    fill={snapTag ? "#10B981" : "#09090B"} opacity={0.92} rx={3} />
              <text x={mx} y={my - 6}
                    fill="#FFFFFF" fontSize={fontPx}
                    textAnchor="middle" fontWeight="bold">
                {label}
              </text>
            </g>
          );
        })()}
        {localTarget && (() => {
          // New format: rectangle {x1,y1,x2,y2} from two taps. Legacy:
          // single point {x,y} from the old single-tap pin — keep
          // rendering a small ring so old saved sessions still display.
          const lw = Math.max(4, photo.width / 240);
          if ("x1" in localTarget) {
            const { x1, y1, x2, y2 } = localTarget;
            const w = x2 - x1;
            const h = y2 - y1;
            const cx = (x1 + x2) / 2;
            const fontPx = Math.max(15, photo.width / 65);
            return (
              <g>
                <rect x={x1} y={y1} width={w} height={h}
                      fill="rgba(16, 185, 129, 0.18)"
                      stroke="#10B981" strokeWidth={lw} />
                <rect x={cx - 110} y={y1 - fontPx - 8}
                      width={220} height={32} fill="#10B981" rx={3} />
                <text x={cx} y={y1 - 12}
                      fill="#FFFFFF" fontSize={fontPx}
                      textAnchor="middle" fontWeight="bold">
                  TARGET HOUSE
                </text>
              </g>
            );
          }
          // Legacy small-ring fallback for any sessions saved pre-fix.
          const ringR = Math.max(20, photo.width / 50);
          return (
            <g>
              <circle cx={localTarget.x} cy={localTarget.y} r={ringR}
                      fill="none" stroke="#10B981" strokeWidth={lw} />
              <circle cx={localTarget.x} cy={localTarget.y} r={Math.max(4, photo.width / 350)} fill="#10B981" />
              <rect x={localTarget.x - 110} y={localTarget.y - ringR - 36}
                    width={220} height={32} fill="#10B981" rx={3} />
              <text x={localTarget.x} y={localTarget.y - ringR - 14}
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
        {/* Iter 57e — tagged windows: yellow pin + style abbreviation
            badge + W×H label. Drawn on top of zones so contractors can
            see windows that overlap a brick mask. */}
        {localWindows.map((w) => {
          const r = Math.max(8, photo.width / 200);
          const fontPx = Math.max(11, photo.width / 95);
          const abbr = STYLE_ABBR[w.style] || "?";
          return (
            <g key={w.id}>
              <circle cx={w.x} cy={w.y} r={r} fill="#FBBF24" stroke="#92400E" strokeWidth={Math.max(2, photo.width / 700)} />
              <rect x={w.x + r + 4} y={w.y - fontPx / 2 - 4} width={Math.max(40, fontPx * 3)} height={fontPx + 8} fill="#92400E" rx={2} />
              <text x={w.x + r + 8} y={w.y + fontPx / 2 - 2} fill="#FFFFFF" fontSize={fontPx} fontWeight="bold">
                {abbr}
              </text>
            </g>
          );
        })}
        {/* In-progress window pin (before picker confirm) */}
        {mode === MODE_WINDOW && windowPending && (
          <circle cx={windowPending.x} cy={windowPending.y}
                  r={Math.max(10, photo.width / 180)}
                  fill="none" stroke="#FBBF24" strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="6 4" />
        )}
        {pending && (
          <circle cx={pending.x} cy={pending.y} r={Math.max(6, photo.width / 300)}
                  fill={mode === MODE_SCALE_WINDOW ? "#2563EB" : "#DC2626"}
                  stroke="#FFFFFF" strokeWidth={Math.max(2, photo.width / 700)} />
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
                ? "Tap two corners around the target structure (works to isolate a garage, shed, or close neighbor)"
                : mode === MODE_SCALE
                ? "WALL SCALE — tap two points on a known span (entry door = 7 ft, garage = 7 ft tall, eave-to-ground, etc.), then enter its real length. Lines auto-snap to horizontal/vertical when within ±5°."
                : mode === MODE_SCALE_WINDOW
                ? "WINDOW SCALE — tap two points on a known window edge (a window you know the size of, e.g. 36\" wide), then enter it. Gives Claude per-window precision (±5%). Auto-snaps to H/V."
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
          const isWindow = scalePending.kind === "window";
          const accentBg = isWindow ? "#2563EB" : "#DC2626";
          const accentBgDark = isWindow ? "#1D4ED8" : "#B91C1C";
          const heading = isWindow ? "Window Reference Length" : "Wall Reference Length";
          const sub = isWindow
            ? "How wide/tall is the window edge you just marked?"
            : "How long is what you just marked?";
          const placeholderText = isWindow
            ? (scaleUnit === "ft" ? "e.g. 3 (3-ft DH width)" : "e.g. 36")
            : (scaleUnit === "ft" ? "e.g. 7 (entry door)" : "e.g. 84");
          return (
            <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-4" onClick={cancelScale}>
              <div className="bg-white max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="text-white px-4 py-2.5" style={{ background: accentBg }}>
                  <div className="font-heading text-base">{heading}</div>
                  <div className="text-[11px] opacity-90 mt-0.5">
                    {sub}
                    {scalePending.snapped && (
                      <span className="ml-1 inline-block px-1.5 py-0.5 bg-[#10B981] rounded-sm text-[9px] uppercase tracking-wider font-bold">
                        🔒 Auto-snapped {scalePending.snapped}
                      </span>
                    )}
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
                         placeholder={placeholderText}
                         className="w-full px-3 py-2 border border-[#E4E4E7] rounded-sm text-base font-mono-num focus:outline-none"
                         style={{ borderColor: valid ? accentBg : undefined }}
                         data-testid="annotate-scale-input" />
                  {valid && (
                    <div className="text-[11px] text-[#71717A]">
                      = <b className="font-mono-num">{(inches / 12).toFixed(2)} ft</b> / <b className="font-mono-num">{inches.toFixed(1)} in</b>
                    </div>
                  )}
                  <div className="text-[10px] text-[#A1A1AA] leading-snug">
                    {isWindow
                      ? <>Std window widths: <b>24, 28, 30, 32, 36, 40, 44, 48, 54, 60, 72&nbsp;in</b>. Std heights: <b>36, 42, 48, 54, 60, 72&nbsp;in</b>.</>
                      : <>Entry door ≈ <b>7 ft</b>, single garage ≈ <b>7×9 ft</b>, double garage ≈ <b>7×16 ft</b>.</>}
                  </div>
                </div>
                <div className="border-t border-[#E4E4E7] px-4 py-3 flex justify-end gap-2">
                  <button type="button" onClick={cancelScale}
                          className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider">Cancel</button>
                  <button type="button" onClick={confirmScale} disabled={!valid}
                          className="px-3 py-2 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                          style={{ background: valid ? accentBg : accentBgDark }}
                          onMouseOver={(e) => { if (valid) e.currentTarget.style.background = accentBgDark; }}
                          onMouseOut={(e) => { if (valid) e.currentTarget.style.background = accentBg; }}
                          data-testid="annotate-scale-confirm">Set {isWindow ? "Window" : "Wall"} Reference</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Iter 57e — Window-tag picker submodal. After tap on a window
            pixel, pick style + W×H so Claude treats it as ground truth. */}
        {windowPending && (
          <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-4" onClick={cancelWindow}>
            <div className="bg-white max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-[#92400E] text-white px-4 py-2.5">
                <div className="font-heading text-base">Tag this window&apos;s style</div>
                <div className="text-[11px] opacity-90 mt-0.5">
                  Claude treats your style as GROUND TRUTH — it will size the window from the photo.
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">Style</div>
                  <select
                    value={windowStyle}
                    onChange={(e) => setWindowStyle(e.target.value)}
                    className="w-full px-3 py-2 border border-[#E4E4E7] rounded-sm text-sm focus:outline-none focus:border-[#92400E]"
                    data-testid="annotate-window-style"
                    autoFocus
                  >
                    {WIN_STYLES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="text-[10px] text-[#A1A1AA] leading-snug">
                  Tip — your tag locks the STYLE only. Claude still measures width &amp; height from the photo using its scale reference. If you also need a specific size, edit it in the openings schedule after Claude runs.
                </div>
              </div>
              <div className="border-t border-[#E4E4E7] px-4 py-3 flex justify-end gap-2">
                <button type="button" onClick={cancelWindow}
                        className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider">Cancel</button>
                <button type="button" onClick={confirmWindow}
                        className="px-3 py-2 bg-[#92400E] text-white hover:bg-[#78350F] text-xs font-bold uppercase tracking-wider"
                        data-testid="annotate-window-confirm">Tag Window</button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Canvas */}
          <div className="md:col-span-2">
            {!photo ? (
              <div className="aspect-video bg-[#FAFAFA] flex items-center justify-center text-[#A1A1AA] text-sm">Loading photo…</div>
            ) : (
              <div
                ref={viewportRef}
                className="relative border border-[#E4E4E7] rounded-sm overflow-hidden bg-[#0A0A0A] select-none"
                style={{ touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={(e) => { if (pending) setHoverPoint(null); onPointerUp(e); }}
                data-testid="annotate-viewport"
              >
                <div
                  className="relative"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                    willChange: "transform",
                  }}
                >
                  <img ref={canvasRef} src={photoUrl} alt="annotate"
                       className="w-full h-auto block cursor-crosshair pointer-events-none"
                       draggable={false}
                       data-testid="annotate-canvas" />
                  {renderOverlay()}
                </div>
                {/* Iter 57l — Zoom toolbar (works on touch + mouse).
                    stopPropagation on pointer events so the toolbar
                    buttons don't ALSO register as taps on the canvas. */}
                <div
                  className="absolute top-2 right-2 flex flex-col gap-1"
                  data-testid="annotate-zoom-toolbar"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                >
                  <button type="button" onClick={zoomIn}
                          disabled={zoom >= ZOOM_MAX - 0.001}
                          className="w-9 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center disabled:opacity-40 shadow-sm"
                          data-testid="annotate-zoom-in"
                          title="Zoom in (or pinch out on touch)">
                    <ZoomIn className="w-4 h-4 text-[#09090B]" />
                  </button>
                  <button type="button" onClick={resetZoom}
                          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                          className="px-1.5 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center text-[10px] font-bold tabular-nums disabled:opacity-40 shadow-sm min-w-[36px]"
                          data-testid="annotate-zoom-reset"
                          title="Reset zoom & pan to 100%">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button type="button" onClick={zoomOut}
                          disabled={zoom <= ZOOM_MIN + 0.001}
                          className="w-9 h-9 bg-white/95 hover:bg-white border border-[#27272A] flex items-center justify-center disabled:opacity-40 shadow-sm"
                          data-testid="annotate-zoom-out"
                          title="Zoom out (or pinch in on touch)">
                    <ZoomOut className="w-4 h-4 text-[#09090B]" />
                  </button>
                </div>
                {/* Pinch hint — only show on touch devices, fades after first interaction. */}
                {zoom === 1 && (
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-sm pointer-events-none hidden sm:flex items-center gap-1.5" data-testid="annotate-pinch-hint">
                    <Maximize className="w-3 h-3" />
                    <span>Pinch to zoom · drag to pan when zoomed · scroll wheel to zoom</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <div className="grid grid-cols-6 gap-1">
              <button type="button"
                      onClick={() => { setMode(MODE_TARGET); setPending(null); setHoverPoint(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_TARGET ? "bg-[#10B981] text-white border-[#10B981]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-target"
                      title="Tap once on the actual target house — overrides the auto-geocoded crosshair on aerial photos">
                <Check className="w-3 h-3" /> Pin
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_SCALE); setPending(null); setHoverPoint(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_SCALE ? "bg-[#DC2626] text-white border-[#DC2626]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-scale"
                      title="WALL SCALE: 2-tap red line on a known span (entry door = 7 ft, garage door = 7 ft, eave-to-ground, etc.). Anchors the WHOLE-WALL geometry.">
                <Ruler className="w-3 h-3" /> Wall
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_SCALE_WINDOW); setPending(null); setHoverPoint(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_SCALE_WINDOW ? "bg-[#2563EB] text-white border-[#2563EB]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-scale-window"
                      title="WINDOW SCALE: 2-tap blue line across a window edge you know (e.g. 36 in wide). Gives Claude PER-WINDOW precision — ±5% sizing instead of ±15%.">
                <Ruler className="w-3 h-3" /> Window
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_ZONE); setPending(null); setHoverPoint(null); setPolyPoints([]); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_ZONE ? "bg-[#B45309] text-white border-[#B45309]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-zone">
                <Square className="w-3 h-3" /> Mask
              </button>
              <button type="button"
                      onClick={() => { setMode(MODE_WINDOW); setPending(null); setHoverPoint(null); setPolyPoints([]); setWindowPending(null); }}
                      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider border flex items-center justify-center gap-1 ${
                        mode === MODE_WINDOW ? "bg-[#FBBF24] text-[#09090B] border-[#92400E]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                      }`}
                      data-testid="annotate-mode-window"
                      title="Tap a window in the photo to tag its style. Claude treats your tags as GROUND TRUTH (overrides its photo-inference).">
                <Square className="w-3 h-3" /> Style
              </button>
              {/* Iter 78z+++ — Profiles button. Opens the Tag Profiles
                  cross-photo tool (LAP / SHAKE / B&B / VERTICAL /
                  NICKEL GAP / STONE / BRICK / STUCCO) with dormer +
                  callout-location dropdowns per box. Closes this
                  modal so the parent can take over the workflow. */}
              {onOpenProfileAnnotator && (
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenProfileAnnotator(); }}
                  className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider border bg-white text-[#7C3AED] border-[#7C3AED] hover:bg-[#FAF5FF] flex items-center justify-center gap-1"
                  data-testid="annotate-mode-profile"
                  title="Tag Shake / B&B / Dormer / Stone / Brick zones. Opens the cross-photo profile tagger — annotations land as authoritative accents in the materials list."
                >
                  <Tags className="w-3 h-3" /> Profile
                </button>
              )}
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
                    {"x1" in localTarget
                      ? `Box ${Math.round(localTarget.x2 - localTarget.x1)}×${Math.round(localTarget.y2 - localTarget.y1)} px`
                      : `Pinned at (${Math.round(localTarget.x)}, ${Math.round(localTarget.y)})`}
                  </span>
                  <button onClick={removeTarget} className="text-[#A1A1AA] hover:text-[#DC2626]" data-testid="annotate-target-remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA] italic">
                  No box drawn — tap two corners around the target structure (e.g. just the garage).
                </div>
              )}
            </div>
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#DC2626]"></span>
                Wall scale anchor
              </div>
              {localRef ? (
                <div className="text-xs flex items-center justify-between gap-2 bg-[#FEE2E2] px-2 py-1.5 border-l-2 border-[#DC2626]">
                  <span>
                    <span className="font-mono-num font-bold">{localRef.inches}&quot;</span> ({(localRef.inches / 12).toFixed(2)} ft)
                  </span>
                  <button onClick={removeReference} className="text-[#A1A1AA] hover:text-[#DC2626]" data-testid="annotate-ref-remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA] italic">No wall anchor — Wall mode + tap 2 points across a known span (door, garage, eave-to-ground).</div>
              )}
            </div>
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#2563EB]"></span>
                Window scale anchor
              </div>
              {localWindowRef ? (
                <div className="text-xs flex items-center justify-between gap-2 bg-[#DBEAFE] px-2 py-1.5 border-l-2 border-[#2563EB]">
                  <span>
                    <span className="font-mono-num font-bold">{localWindowRef.inches}&quot;</span> ({(localWindowRef.inches / 12).toFixed(2)} ft)
                  </span>
                  <button onClick={removeWindowReference} className="text-[#A1A1AA] hover:text-[#2563EB]" data-testid="annotate-winref-remove">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A1AA] italic">No window anchor — Window mode + tap 2 points across a window edge you know (e.g. 36&quot; wide).</div>
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

            {/* Iter 57e — tagged windows list */}
            <div className="border-t border-[#E4E4E7] pt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#FBBF24] border border-[#92400E]"></span>
                Tagged windows ({localWindows.length})
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto" data-testid="annotate-window-list">
                {localWindows.map((w) => (
                  <li key={w.id} className="text-xs flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      <span className="font-bold text-[#92400E]">{STYLE_ABBR[w.style] || "?"}</span>
                      <span>{w.style}</span>
                      <span className="text-[10px] text-[#A1A1AA]">(Claude sizes)</span>
                    </span>
                    <button onClick={() => removeWindow(w.id)} className="text-[#A1A1AA] hover:text-[#DC2626]" data-testid={`annotate-window-remove-${w.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
                {!localWindows.length && (
                  <li className="text-[11px] text-[#A1A1AA] italic">No windows tagged — switch to Window mode and tap each window.</li>
                )}
              </ul>
            </div>

            {(localRef || localWindowRef || localZones.length > 0 || localTarget || localWindows.length > 0) && (
              <button type="button"
                      onClick={() => { setLocalRef(null); setLocalWindowRef(null); setLocalZones([]); setLocalTarget(null); setLocalWindows([]); setPending(null); setHoverPoint(null); setPolyPoints([]); }}
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
