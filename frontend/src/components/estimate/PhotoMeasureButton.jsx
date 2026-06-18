// Photo Measure — interactive calibrate-then-measure tool.
//
// Ported from Howard's siding-takeoff HTML reference. The contractor:
//   1. Uploads a photo (or takes one with the phone camera).
//   2. Taps two points on a known reference (a door edge, a tape measure,
//      a garage door, etc.) and enters its real length → that calibrates
//      a `pxPerFt` scale for the photo.
//   3. Switches to "Measure" mode and taps two points across any wall
//      span — the tool prints the real-world LF on the photo.
//   4. Each measurement gets a label/role (wall width, wall height, gable
//      width, gable rise, eave run, rake) so the totals roll up the same
//      way HOVER's `siding_sqft / eaves_lf / rakes_lf` would.
//   5. Marks openings (window, entry door, patio door, garage door) by
//      tapping anywhere on the photo. Counts feed back into the HOVER-
//      shaped measurements dict the rest of the app already speaks.
//
// Output payload matches the AI Measure / HOVER shape so the calling
// page can reuse the same `onApply({ measurements, lines, ... })`
// callback contract.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ruler, Camera, X, Check, Trash2, Plus, RotateCcw, Images } from "lucide-react";
import { toast } from "sonner";

// Output unit for each measurement label. Drives how the role rolls up
// into siding_sqft / eaves_lf / rakes_lf etc.
const LABEL_OPTIONS = [
  { key: "wall_w",   name: "Wall width",        unit: "ft" },
  { key: "wall_h",   name: "Wall / eave height", unit: "ft" },
  { key: "gable_w",  name: "Gable width",       unit: "ft" },
  { key: "gable_h",  name: "Gable rise",        unit: "ft" },
  { key: "eave_lf",  name: "Eave run",          unit: "ft" },
  { key: "rake_lf",  name: "Rake (one side)",   unit: "ft" },
  { key: "win_w",    name: "Window width",      unit: "in" },
  { key: "win_h",    name: "Window height",     unit: "in" },
  { key: "other",    name: "Other",             unit: "ft" },
];

const OPENING_TYPES = [
  { key: "window",      name: "Window",      color: "#22D3EE" },
  { key: "entry_door",  name: "Entry door",  color: "#A78BFA" },
  { key: "patio_door",  name: "Patio door",  color: "#F472B6" },
  { key: "garage_door", name: "Garage door", color: "#FBBF24" },
];

// "No-siding" mask categories. Each zone is deducted from siding_sqft and
// surfaced on the line item so contractors can see exactly what came off.
const ZONE_CATEGORIES = [
  { key: "brick",       name: "Brick",       color: "#B45309" },
  { key: "stone",       name: "Stone",       color: "#57534E" },
  { key: "garage_door", name: "Garage door", color: "#FBBF24" },
  { key: "stucco",      name: "Stucco",      color: "#A8A29E" },
  { key: "other",       name: "Other",       color: "#DC2626" },
];

const MODE_CALIBRATE = "calibrate";
const MODE_MEASURE = "measure";
const MODE_OPENING = "opening";
const MODE_ZONE = "zone";

// Shoelace formula for polygon area in pixel-squared units.
function polygonAreaPx2(pts) {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// Aggregate the marked measurements into HOVER-shape totals.
// Heuristic: pair wall_w with wall_h to compute siding area; eave_lf /
// rake_lf sums map straight across; openings count drives perimeters.
// `zones` is a list of masked-out regions (brick / stone / garage etc.)
// whose ft² is deducted from the final siding figure.
function buildMeasurements(measures, openings, zones = []) {
  const sum = (key) =>
    measures.filter((m) => m.label === key).reduce((a, m) => a + m.feet, 0);
  const widths = measures.filter((m) => m.label === "wall_w").map((m) => m.feet);
  const heights = measures.filter((m) => m.label === "wall_h").map((m) => m.feet);
  const avgHeight = heights.length
    ? heights.reduce((a, b) => a + b, 0) / heights.length
    : 9;
  // Wall area = Σ width × avg height (the contractor usually measures
  // each visible wall but only 1–2 heights; reuse the avg).
  const wallArea = widths.reduce((a, w) => a + w * avgHeight, 0);
  // Gable triangles use the HTML's 0.7 factor for the gable wall + the
  // triangle (gw × gh × 0.7 already covers half-tri + bonus for siding
  // up to the peak).
  const gableWidths = measures.filter((m) => m.label === "gable_w").map((m) => m.feet);
  const gableHeights = measures.filter((m) => m.label === "gable_h").map((m) => m.feet);
  let gableArea = 0;
  for (let i = 0; i < gableWidths.length; i++) {
    gableArea += gableWidths[i] * (gableHeights[i] || gableHeights[0] || 0) * 0.7;
  }
  const grossSqft = wallArea + gableArea;

  // Roll up zone deductions. Zones already store their area in ft² at
  // creation time (so the value survives a photo swap).
  const zonesDeducted = zones.reduce((a, z) => a + (z.area_sqft || 0), 0);
  const zonesByCat = {};
  for (const z of zones) {
    zonesByCat[z.category] = (zonesByCat[z.category] || 0) + (z.area_sqft || 0);
  }
  const zonesSummary = Object.entries(zonesByCat)
    .map(([k, v]) => `${ZONE_CATEGORIES.find((c) => c.key === k)?.name || k}: ${Math.round(v)} ft²`)
    .join("; ");

  const sidingSqft = Math.max(0, Math.round(grossSqft - zonesDeducted));

  // Rakes: 2 × √((gw/2)² + gh²) per gable when widths/heights known,
  // otherwise use any explicit rake measurements the contractor marked.
  let rakesLf = sum("rake_lf");
  if (rakesLf === 0 && gableWidths.length) {
    for (let i = 0; i < gableWidths.length; i++) {
      const gw = gableWidths[i];
      const gh = gableHeights[i] || gableHeights[0] || 0;
      rakesLf += 2 * Math.sqrt((gw / 2) ** 2 + gh ** 2);
    }
    rakesLf = Math.round(rakesLf);
  }

  const counts = { window: 0, entry_door: 0, patio_door: 0, garage_door: 0 };
  let openingPerim = 0;
  for (const o of openings) {
    if (counts[o.type] != null) counts[o.type]++;
    const w_in = o.w_in || (o.type === "garage_door" ? 108 : o.type === "patio_door" ? 72 : 36);
    const h_in = o.h_in || (o.type === "garage_door" ? 84 : o.type === "patio_door" ? 80 : 48);
    openingPerim += (2 * (w_in + h_in)) / 12;
  }

  return {
    siding_sqft: sidingSqft,
    siding_with_openings_sqft: sidingSqft,
    eaves_lf: Math.round(sum("eave_lf")),
    rakes_lf: Math.round(rakesLf),
    // Starter strip mirrors the eave perimeter on a basic house — same
    // assumption the AI aggregator uses so `_build_lines` populates the
    // Vinyl Accessories → Starter row when measurements flow through.
    starter_lf: Math.round(sum("eave_lf")),
    opening_perimeter_lf: Math.round(openingPerim),
    opening_count: counts.window + counts.entry_door + counts.patio_door + counts.garage_door,
    window_count: counts.window,
    entry_door_count: counts.entry_door,
    patio_door_count: counts.patio_door,
    garage_door_count: counts.garage_door,
    _photo_avg_wall_height_ft: Math.round(avgHeight * 10) / 10,
    _photo_gross_wall_sqft: Math.round(grossSqft),
    _photo_zones_deducted_sqft: Math.round(zonesDeducted),
    _photo_zones_summary: zonesSummary,
  };
}

export default function PhotoMeasureButton({ onApply, externalOpen, onExternalClose, hideTrigger, prefillFiles, prefillUrls }) {
  const fileRef = useRef();
  const canvasRef = useRef();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = hideTrigger ? !!externalOpen : internalOpen;
  const setOpen = (v) => {
    if (hideTrigger) {
      if (!v && onExternalClose) onExternalClose();
    } else {
      setInternalOpen(v);
    }
  };
  // Pre-built thumbnails for AI photos handed down from the parent so the
  // contractor can pick one to refine without re-uploading. Two sources:
  //   • `prefillFiles`: local File objects (legacy / desktop drag-drop).
  //   • `prefillUrls`:  server-side URLs from /api/uploads (the session-
  //     persistent path). When the AI Measure modal uploads photos to
  //     disk on selection, it hands the URLs down here so Refine on
  //     Photo doesn't ask the contractor to re-pick. No blob URLs are
  //     created in this case — the <img> can hit /api/uploads/<name>
  //     directly.
  const prefillThumbs = useMemo(() => {
    if (prefillUrls?.length) {
      return prefillUrls.map((name) => ({ file: null, url: `/api/uploads/${name}` }));
    }
    if (!prefillFiles?.length) return [];
    return prefillFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
  }, [prefillFiles, prefillUrls]);
  useEffect(() => {
    return () => {
      // Only revoke blob URLs — server URLs from /api/uploads must stay
      // live for the rest of the session.
      prefillThumbs.forEach((t) => {
        if (t.url.startsWith("blob:")) URL.revokeObjectURL(t.url);
      });
    };
  }, [prefillThumbs]);

  const [photo, setPhoto] = useState(null); // {url, width, height}
  const [mode, setMode] = useState(MODE_CALIBRATE);
  const [pxPerFt, setPxPerFt] = useState(0);
  // Pending click pair for calibration / measurement
  const [pending, setPending] = useState(null); // {x, y}
  // Pending calibration awaiting reference length input.
  // shape: { pxDistance, p1, p2 } — non-null while the calibration modal is open.
  // Replaces the bare window.prompt("…INCHES…") that historically caused
  // contractors to enter feet by mistake and shrink everything 12×.
  const [calibPending, setCalibPending] = useState(null);
  // Last-used calibration unit, persisted across sessions so contractors
  // who consistently use feet (garage door height, etc.) don't have to
  // re-toggle every photo.
  const [calibUnit, setCalibUnit] = useState(() => {
    try {
      const saved = localStorage.getItem("photoMeasureCalibUnit");
      return saved === "in" || saved === "ft" ? saved : "ft";
    } catch {
      return "ft";
    }
  });
  const [calibValue, setCalibValue] = useState("");
  // Pending measurement awaiting a label tap. Replaces the legacy
  // window.prompt("1-9") that was painful on an iPad.
  // shape: { feet, p1, p2, photoUrl }
  const [labelPending, setLabelPending] = useState(null);
  useEffect(() => {
    try { localStorage.setItem("photoMeasureCalibUnit", calibUnit); } catch { /* ignore */ }
  }, [calibUnit]);
  const [measures, setMeasures] = useState([]); // [{p1, p2, feet, label}]
  const [openings, setOpenings] = useState([]); // [{x, y, type}]
  const [openingType, setOpeningType] = useState("window");
  // Zones (masked-out / no-siding regions). Stored once finalized so the
  // computed area survives photo swaps and zoom/pan.
  // shape: { id, photoUrl, category, kind: "rect"|"poly", points: [{x,y}], area_sqft }
  const [zones, setZones] = useState([]);
  const [zoneCategory, setZoneCategory] = useState("brick");
  const [zoneShape, setZoneShape] = useState("rect"); // "rect" | "poly"
  const [polyPoints, setPolyPoints] = useState([]);   // in-progress polygon vertices
  const [busy, setBusy] = useState(false);
  // Tracks any photo the user has explicitly navigated away from, so the
  // single-photo auto-load effect doesn't immediately reload it.
  const [skipAutoLoad, setSkipAutoLoad] = useState(false);

  // Reset when the modal closes
  const closeAll = () => {
    if (busy) return;
    setOpen(false);
    setPhoto(null);
    setMode(MODE_CALIBRATE);
    setPxPerFt(0);
    setPending(null);
    setMeasures([]);
    setOpenings([]);
    setZones([]);
    setPolyPoints([]);
    setCalibPending(null);
    setCalibValue("");
    setLabelPending(null);
  };

  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    loadPhotoFromUrl(url);
  };

  // Shared loader so both manual uploads and prefilled AI thumbnails feed
  // through the same code path.
  const loadPhotoFromUrl = (url) => {
    const img = new Image();
    img.onload = () => {
      setPhoto({ url, width: img.naturalWidth, height: img.naturalHeight });
      setSkipAutoLoad(false);
    };
    img.src = url;
  };

  // Auto-load the only AI photo if there's exactly one; otherwise the user
  // picks from a thumbnail grid (rendered below). Skipped right after the
  // user explicitly switches photos via the "Change Photo" button so the
  // single-photo case doesn't re-load itself instantly.
  useEffect(() => {
    if (!open) return;
    if (photo) return;
    if (skipAutoLoad) return;
    if (prefillThumbs.length === 1) {
      loadPhotoFromUrl(prefillThumbs[0].url);
    }
  }, [open, prefillThumbs, photo, skipAutoLoad]);

  // Convert event coords → photo-space coords
  const evtPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = photo.width / rect.width;
    const scaleY = photo.height / rect.height;
    const cx = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
    const cy = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
    return { x: cx * scaleX, y: cy * scaleY };
  };

  const onCanvasClick = (e) => {
    if (!photo) return;
    const p = evtPoint(e);
    if (mode === MODE_OPENING) {
      setOpenings((prev) => [
        ...prev,
        { x: p.x, y: p.y, type: openingType, photoUrl: photo.url, id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
      ]);
      return;
    }
    if (mode === MODE_ZONE) {
      if (!pxPerFt) {
        toast.error("Calibrate first — zones use the px/ft scale to compute ft²");
        return;
      }
      if (zoneShape === "rect") {
        // Two-click rectangle: first click drops `pending` (top-left
        // corner), second click closes the box and finalizes the zone.
        if (!pending) {
          setPending(p);
          return;
        }
        const x1 = Math.min(pending.x, p.x);
        const y1 = Math.min(pending.y, p.y);
        const x2 = Math.max(pending.x, p.x);
        const y2 = Math.max(pending.y, p.y);
        const w_px = x2 - x1;
        const h_px = y2 - y1;
        const area_sqft = (w_px / pxPerFt) * (h_px / pxPerFt);
        if (area_sqft <= 0) {
          setPending(null);
          return;
        }
        const points = [
          { x: x1, y: y1 }, { x: x2, y: y1 },
          { x: x2, y: y2 }, { x: x1, y: y2 },
        ];
        setZones((prev) => [
          ...prev,
          {
            id: `z-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            photoUrl: photo.url, category: zoneCategory, kind: "rect",
            points, area_sqft,
          },
        ]);
        setPending(null);
        return;
      }
      // Polygon: accumulate points; user clicks "Close polygon" to commit.
      setPolyPoints((prev) => [...prev, p]);
      return;
    }
    // Calibrate or Measure both need two clicks
    if (!pending) {
      setPending(p);
      return;
    }
    const px = dist(pending, p);
    if (mode === MODE_CALIBRATE) {
      // Open the calibration modal instead of using window.prompt(). The
      // legacy prompt asked for "INCHES" which contractors routinely
      // misread, entering feet (e.g. 7 instead of 84 for a door) and
      // shrinking every downstream measurement 12×.
      setCalibPending({ pxDistance: px, p1: pending, p2: p });
      setCalibValue("");
      setPending(null);
      return;
    }
    if (mode === MODE_MEASURE) {
      if (!pxPerFt) {
        toast.error("Calibrate first");
        setPending(null);
        return;
      }
      const feet = px / pxPerFt;
      // Open a tap-friendly label picker instead of window.prompt(). The
      // legacy prompt with numbered 1-9 options was painful on an iPad —
      // contractors had to type a digit from a keyboard popover. The
      // modal below renders each option as a big tap target.
      setLabelPending({ feet, p1: pending, p2: p, photoUrl: photo.url });
      setPending(null);
    }
  };

  const recalibrate = () => {
    setMode(MODE_CALIBRATE);
    setPxPerFt(0);
    setPending(null);
    setCalibPending(null);
    setCalibValue("");
  };

  // Finalize calibration from the modal: convert value+unit → inches → feet → px/ft.
  const confirmCalibration = () => {
    if (!calibPending) return;
    const num = parseFloat(calibValue);
    if (!num || num <= 0) {
      toast.error("Enter a positive number");
      return;
    }
    const inches = calibUnit === "ft" ? num * 12 : num;
    const feet = inches / 12;
    const newPxPerFt = calibPending.pxDistance / feet;
    setPxPerFt(newPxPerFt);
    setCalibPending(null);
    setCalibValue("");
    setMode(MODE_MEASURE);
    toast.success(`Calibrated: ${num} ${calibUnit} reference → ${newPxPerFt.toFixed(1)} px/ft. Now measure your walls.`);
  };
  const cancelCalibration = () => {
    setCalibPending(null);
    setCalibValue("");
  };

  // Commit the pending tap measurement under the chosen label.
  const pickMeasureLabel = (opt) => {
    if (!labelPending) return;
    setMeasures((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        p1: labelPending.p1, p2: labelPending.p2, feet: labelPending.feet,
        label: opt.key, labelName: opt.name,
        photoUrl: labelPending.photoUrl,
      },
    ]);
    setLabelPending(null);
  };
  const cancelLabelPick = () => setLabelPending(null);

  // Switch to a different photo without wiping the contractor's tap
  // measurements. Each measurement/opening is tagged with its source
  // photoUrl so the overlay only renders markers for the active photo
  // (different photos have different pixel spaces). Calibration is
  // photo-specific too, so reset pxPerFt and force a fresh calibrate.
  const changePhoto = () => {
    if (busy) return;
    setSkipAutoLoad(true);
    setPhoto(null);
    setMode(MODE_CALIBRATE);
    setPxPerFt(0);
    setPending(null);
    setPolyPoints([]);
  };

  const removeMeasurement = (id) =>
    setMeasures((prev) => prev.filter((m) => m.id !== id));
  const removeOpening = (id) =>
    setOpenings((prev) => prev.filter((o) => o.id !== id));
  const removeZone = (id) =>
    setZones((prev) => prev.filter((z) => z.id !== id));

  // Commit the polygon currently being drawn into a zone.
  const closePolygon = () => {
    if (polyPoints.length < 3) {
      toast.error("Polygon needs at least 3 points");
      return;
    }
    if (!pxPerFt) {
      toast.error("Calibrate first");
      return;
    }
    const area_px2 = polygonAreaPx2(polyPoints);
    const area_sqft = area_px2 / (pxPerFt * pxPerFt);
    setZones((prev) => [
      ...prev,
      {
        id: `z-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        photoUrl: photo.url, category: zoneCategory, kind: "poly",
        points: polyPoints, area_sqft,
      },
    ]);
    setPolyPoints([]);
  };
  const cancelPolygon = () => setPolyPoints([]);

  const apply = async () => {
    if (!measures.length && !openings.length && !zones.length) {
      toast.error("Mark at least one measurement, opening, or zone first");
      return;
    }
    setBusy(true);
    try {
      const measurements = buildMeasurements(measures, openings, zones);
      // Hand back the same shape AI Measure produces so the page-level
      // onApply callback (in JobInfoPanel / ISSEstimateEditor) just works.
      await onApply({ measurements, lines: [], vero_openings: [], raw_photo: {
        measures, openings, zones, pxPerFt,
      } });
      toast.success("Photo measurements applied");
      closeAll();
    } catch (e) {
      toast.error(e?.message || "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  // Render markup overlay — only show markers tagged to the CURRENT photo,
  // since each photo has its own pixel space. Markers placed on other
  // photos still contribute to the totals on the right; they just don't
  // render here.
  const renderOverlay = () => {
    if (!photo) return null;
    const visibleMeasures = measures.filter((m) => !m.photoUrl || m.photoUrl === photo.url);
    const visibleOpenings = openings.filter((o) => !o.photoUrl || o.photoUrl === photo.url);
    const visibleZones = zones.filter((z) => !z.photoUrl || z.photoUrl === photo.url);
    const hatchSize = Math.max(8, photo.width / 120);
    return (
      <svg
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <defs>
          {ZONE_CATEGORIES.map((c) => (
            <pattern
              key={c.key}
              id={`zone-hatch-${c.key}`}
              patternUnits="userSpaceOnUse"
              width={hatchSize}
              height={hatchSize}
              patternTransform="rotate(45)"
            >
              <rect width={hatchSize} height={hatchSize} fill={c.color} fillOpacity={0.22} />
              <line x1="0" y1="0" x2="0" y2={hatchSize} stroke={c.color} strokeWidth={Math.max(2, hatchSize / 4)} />
            </pattern>
          ))}
        </defs>
        {visibleZones.map((z) => {
          const c = ZONE_CATEGORIES.find((x) => x.key === z.category) || ZONE_CATEGORIES[0];
          const pathD = z.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
            .join(" ") + " Z";
          const xs = z.points.map((p) => p.x);
          const ys = z.points.map((p) => p.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          return (
            <g key={z.id}>
              <path d={pathD} fill={`url(#zone-hatch-${c.key})`} stroke={c.color} strokeWidth={Math.max(3, photo.width / 600)} />
              <rect x={cx - 70} y={cy - 18} width={140} height={28} fill="#09090B" rx={3} />
              <text x={cx} y={cy + 3} fill="#FFFFFF" fontSize={Math.max(13, photo.width / 75)} textAnchor="middle" fontWeight="bold">
                -{Math.round(z.area_sqft)} ft² {c.name}
              </text>
            </g>
          );
        })}
        {visibleMeasures.map((m) => {
          const mx = (m.p1.x + m.p2.x) / 2;
          const my = (m.p1.y + m.p2.y) / 2;
          return (
            <g key={m.id}>
              <line x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y}
                stroke="#F97316" strokeWidth={Math.max(3, photo.width / 600)} />
              <circle cx={m.p1.x} cy={m.p1.y} r={Math.max(5, photo.width / 350)} fill="#F97316" />
              <circle cx={m.p2.x} cy={m.p2.y} r={Math.max(5, photo.width / 350)} fill="#F97316" />
              <rect x={mx - 60} y={my - 18} width={120} height={28} fill="#09090B" rx={3} />
              <text x={mx} y={my + 3} fill="#FFFFFF" fontSize={Math.max(14, photo.width / 70)} textAnchor="middle" fontWeight="bold">
                {m.feet.toFixed(1)} ft
              </text>
            </g>
          );
        })}
        {visibleOpenings.map((o) => {
          const c = OPENING_TYPES.find((t) => t.key === o.type) || OPENING_TYPES[0];
          const r = Math.max(14, photo.width / 90);
          return (
            <g key={o.id}>
              <circle cx={o.x} cy={o.y} r={r} fill={c.color} fillOpacity={0.5} stroke={c.color} strokeWidth={3} />
              <text x={o.x} y={o.y + 4} fill="#09090B" fontSize={Math.max(11, photo.width / 95)} textAnchor="middle" fontWeight="bold">
                {c.name[0]}
              </text>
            </g>
          );
        })}
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
        {/* Rectangle first-corner preview */}
        {mode === MODE_ZONE && zoneShape === "rect" && pending && (() => {
          const c = ZONE_CATEGORIES.find((x) => x.key === zoneCategory) || ZONE_CATEGORIES[0];
          return (
            <circle cx={pending.x} cy={pending.y} r={Math.max(6, photo.width / 300)}
                    fill="none" stroke={c.color} strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="6 4" />
          );
        })()}
        {pending && mode !== MODE_ZONE && (
          <circle cx={pending.x} cy={pending.y} r={Math.max(6, photo.width / 300)}
                  fill="none" stroke="#F97316" strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="6 4" />
        )}
      </svg>
    );
  };

  // Cleanup blob URL — but skip URLs we borrowed from prefillThumbs, since
  // those are owned (and revoked) by the prefillThumbs effect above.
  useEffect(() => {
    return () => {
      if (!photo?.url) return;
      const borrowed = prefillThumbs.some((t) => t.url === photo.url);
      if (!borrowed) URL.revokeObjectURL(photo.url);
    };
  }, [photo, prefillThumbs]);

  const totals = buildMeasurements(measures, openings, zones);

  return (
    <div data-testid="photo-measure">
      {!hideTrigger && (
        <button
          type="button"
          className="px-3 py-1.5 bg-white text-[#0EA5E9] border border-[#0EA5E9] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
          onClick={() => setOpen(true)}
          data-testid="photo-measure-btn"
          title="Tap-on-photo measurement — calibrate then tap walls and openings"
        >
          <Ruler className="w-3.5 h-3.5" />
          Measure on Photo
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={closeAll}
        >
          <div
            className="bg-white max-w-4xl w-full max-h-[95vh] flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
            data-testid="photo-measure-modal"
          >
            <div className="bg-[#0EA5E9] text-white px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Ruler className="w-5 h-5" />
                <div>
                  <div className="font-heading text-lg">Measure on Photo</div>
                  <div className="text-xs opacity-90 mt-0.5">
                    {!photo
                      ? "Step 1 · Upload a photo"
                      : mode === MODE_CALIBRATE
                      ? "Step 2 · Tap two points on a known reference, then enter its real length"
                      : mode === MODE_MEASURE
                      ? `Step 3 · ${pxPerFt.toFixed(1)} px/ft · Tap two points to measure`
                      : mode === MODE_ZONE
                      ? (zoneShape === "rect"
                          ? `Step 4 · Tap top-left then bottom-right to mask ${ZONE_CATEGORIES.find((c) => c.key === zoneCategory)?.name}`
                          : `Step 4 · Tap polygon points then "Close" to mask ${ZONE_CATEGORIES.find((c) => c.key === zoneCategory)?.name}`)
                      : `Step 4 · Tap to mark ${OPENING_TYPES.find((t) => t.key === openingType)?.name}s`}
                  </div>
                </div>
              </div>
              <button type="button" onClick={closeAll} className="text-white/90 hover:text-white" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Calibration modal — replaces the legacy window.prompt() that
                ambiguously asked for "INCHES" and led contractors to enter
                feet by mistake. Now: explicit Ft/In toggle, live conversion
                preview, and a sanity warning when the value looks wrong
                for the chosen unit. */}
            {calibPending && (() => {
              const num = parseFloat(calibValue);
              const valid = !isNaN(num) && num > 0;
              const inches = valid ? (calibUnit === "ft" ? num * 12 : num) : 0;
              const feetEq = inches / 12;
              // Sanity heuristic: typical references are 3–20 ft (door, garage,
              // tape stretch). Warn if value looks like it was entered in the
              // wrong unit.
              let warning = null;
              if (valid) {
                if (calibUnit === "in" && num < 12) {
                  warning = `That's less than 1 ft — did you mean ${num} feet?`;
                } else if (calibUnit === "in" && num > 240) {
                  warning = `That's over 20 ft of reference — double-check.`;
                } else if (calibUnit === "ft" && num > 30) {
                  warning = `That's a very long reference — make sure it's feet, not inches.`;
                } else if (calibUnit === "ft" && num < 1) {
                  warning = `Less than 1 ft — did you mean ${num} inches?`;
                }
              }
              return (
                <div
                  className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-4"
                  onClick={cancelCalibration}
                  data-testid="photo-measure-calib-modal"
                >
                  <div
                    className="bg-white max-w-sm w-full shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="bg-[#F97316] text-white px-4 py-2.5">
                      <div className="font-heading text-base">Reference Length</div>
                      <div className="text-[11px] opacity-90 mt-0.5">
                        How long is the object you just tapped in real life?
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                          Unit
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setCalibUnit("ft")}
                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider border ${
                              calibUnit === "ft"
                                ? "bg-[#09090B] text-white border-[#09090B]"
                                : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                            }`}
                            data-testid="photo-measure-calib-unit-ft"
                          >
                            Feet (ft)
                          </button>
                          <button
                            type="button"
                            onClick={() => setCalibUnit("in")}
                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider border ${
                              calibUnit === "in"
                                ? "bg-[#09090B] text-white border-[#09090B]"
                                : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                            }`}
                            data-testid="photo-measure-calib-unit-in"
                          >
                            Inches (in)
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1.5">
                          Real length in {calibUnit === "ft" ? "feet" : "inches"}
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          autoFocus
                          value={calibValue}
                          onChange={(e) => setCalibValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); confirmCalibration(); }
                            if (e.key === "Escape") { e.preventDefault(); cancelCalibration(); }
                          }}
                          placeholder={calibUnit === "ft" ? "e.g. 7 (entry door)" : "e.g. 84"}
                          className="w-full px-3 py-2 border border-[#E4E4E7] rounded-sm text-base font-mono-num focus:outline-none focus:border-[#0EA5E9]"
                          data-testid="photo-measure-calib-input"
                        />
                        {valid && (
                          <div className="text-[11px] text-[#71717A] mt-1.5" data-testid="photo-measure-calib-preview">
                            = <span className="font-mono-num font-bold">{feetEq.toFixed(2)} ft</span>
                            {" "}/{" "}
                            <span className="font-mono-num font-bold">{inches.toFixed(1)} in</span>
                          </div>
                        )}
                        {warning && (
                          <div className="mt-2 px-2 py-1.5 bg-[#FEF3C7] border-l-2 border-[#F59E0B] text-[11px] text-[#92400E]" data-testid="photo-measure-calib-warning">
                            ⚠ {warning}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-[#A1A1AA] leading-snug">
                        Tip: use something with a known size — a standard entry door is ~<b>7 ft</b>, a single garage door is ~<b>7 ft</b> tall × <b>9 ft</b> wide, a double garage door is ~<b>7 × 16 ft</b>.
                      </div>
                    </div>
                    <div className="border-t border-[#E4E4E7] px-4 py-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelCalibration}
                        className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider"
                        data-testid="photo-measure-calib-cancel"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmCalibration}
                        disabled={!valid}
                        className="px-3 py-2 bg-[#F97316] text-white hover:bg-[#EA580C] text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                        data-testid="photo-measure-calib-confirm"
                      >
                        Calibrate
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Measurement label tap-picker — replaces the legacy
                window.prompt("1-9") with a grid of big tap targets so
                iPad contractors can label each measurement with one
                finger tap instead of typing a digit on a keyboard
                popover. */}
            {labelPending && (
              <div
                className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center p-4"
                onClick={cancelLabelPick}
                data-testid="photo-measure-label-modal"
              >
                <div
                  className="bg-white max-w-md w-full shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="bg-[#F97316] text-white px-4 py-2.5">
                    <div className="font-heading text-base">
                      Label this measurement
                    </div>
                    <div className="text-[11px] opacity-90 mt-0.5">
                      Length = <span className="font-mono-num font-bold">{labelPending.feet.toFixed(1)} ft</span>{" "}
                      · tap what you just measured
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="grid grid-cols-2 gap-2" data-testid="photo-measure-label-grid">
                      {LABEL_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => pickMeasureLabel(opt)}
                          className="px-3 py-3 text-xs font-bold uppercase tracking-wider bg-white text-[#09090B] border border-[#E4E4E7] hover:bg-[#FAFAFA] hover:border-[#F97316] active:bg-[#FEF3C7] text-left leading-tight"
                          data-testid={`photo-measure-label-${opt.key}`}
                        >
                          {opt.name}
                          <div className="text-[10px] text-[#A1A1AA] font-normal mt-0.5">
                            {opt.unit === "in" ? "(window size · in)" : "(ft)"}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-[#E4E4E7] px-4 py-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={cancelLabelPick}
                      className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider"
                      data-testid="photo-measure-label-cancel"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-y-auto flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Photo canvas */}
              <div className="md:col-span-2">
                {!photo ? (
                  <div>
                    {prefillThumbs.length > 1 && (
                      <div className="mb-3" data-testid="photo-measure-prefill-grid">
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-2">
                          Pick one of your AI photos to refine
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {prefillThumbs.map((t, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => loadPhotoFromUrl(t.url)}
                              className="border border-[#E4E4E7] hover:border-[#0EA5E9] focus:border-[#0EA5E9] focus:outline-none aspect-square overflow-hidden bg-[#FAFAFA]"
                              data-testid={`photo-measure-prefill-thumb-${i}`}
                              title={t.file?.name || `Photo ${i + 1}`}
                            >
                              <img
                                src={t.url}
                                alt={`AI photo ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                        <div className="text-[10px] text-[#A1A1AA] text-center mt-3 uppercase tracking-wider">
                          — or upload a different photo —
                        </div>
                      </div>
                    )}
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-[#E4E4E7] rounded-sm aspect-video flex flex-col items-center justify-center cursor-pointer hover:border-[#0EA5E9]"
                    >
                      <Camera className="w-12 h-12 mb-2 text-[#0EA5E9]" />
                      <div className="text-sm font-bold text-[#0EA5E9] uppercase tracking-wider">Choose / Take Photo</div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={pickPhoto}
                        data-testid="photo-measure-file-input"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="relative border border-[#E4E4E7] rounded-sm overflow-hidden">
                    <img
                      src={photo.url}
                      alt="house"
                      className="w-full h-auto block cursor-crosshair"
                      onClick={onCanvasClick}
                      ref={canvasRef}
                      data-testid="photo-measure-canvas"
                    />
                    {renderOverlay()}
                  </div>
                )}
              </div>

              {/* Controls + lists */}
              <div className="space-y-3">
                {photo && (
                  <>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${
                          mode === MODE_MEASURE ? "bg-[#0EA5E9] text-white border-[#0EA5E9]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                        }`}
                        onClick={() => { setMode(MODE_MEASURE); setPending(null); setPolyPoints([]); }}
                        disabled={!pxPerFt}
                        data-testid="photo-measure-mode-measure"
                      >Measure</button>
                      <button
                        type="button"
                        className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${
                          mode === MODE_OPENING ? "bg-[#0EA5E9] text-white border-[#0EA5E9]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                        }`}
                        onClick={() => { setMode(MODE_OPENING); setPending(null); setPolyPoints([]); }}
                        disabled={!pxPerFt}
                        data-testid="photo-measure-mode-opening"
                      >Openings</button>
                      <button
                        type="button"
                        className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${
                          mode === MODE_ZONE ? "bg-[#DC2626] text-white border-[#DC2626]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                        }`}
                        onClick={() => { setMode(MODE_ZONE); setPending(null); setPolyPoints([]); }}
                        disabled={!pxPerFt}
                        data-testid="photo-measure-mode-zone"
                        title="Mask out brick / stone / garage / stucco — area gets deducted from siding sqft"
                      >Mask zone</button>
                    </div>

                    {mode === MODE_OPENING && (
                      <div className="grid grid-cols-2 gap-1">
                        {OPENING_TYPES.map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => setOpeningType(t.key)}
                            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                              openingType === t.key ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"
                            } flex items-center gap-1`}
                            data-testid={`photo-measure-opening-${t.key}`}
                          >
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {mode === MODE_ZONE && (
                      <div className="space-y-2" data-testid="photo-measure-zone-controls">
                        {/* Shape toggle */}
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => { setZoneShape("rect"); setPending(null); setPolyPoints([]); }}
                            className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                              zoneShape === "rect" ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"
                            }`}
                            data-testid="photo-measure-zone-shape-rect"
                          >Rectangle</button>
                          <button
                            type="button"
                            onClick={() => { setZoneShape("poly"); setPending(null); }}
                            className={`flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                              zoneShape === "poly" ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"
                            }`}
                            data-testid="photo-measure-zone-shape-poly"
                          >Polygon</button>
                        </div>
                        {/* Category picker */}
                        <div className="grid grid-cols-2 gap-1">
                          {ZONE_CATEGORIES.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              onClick={() => setZoneCategory(c.key)}
                              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider border ${
                                zoneCategory === c.key ? "border-[#09090B] bg-[#FAFAFA]" : "border-[#E4E4E7]"
                              } flex items-center gap-1`}
                              data-testid={`photo-measure-zone-cat-${c.key}`}
                            >
                              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
                              {c.name}
                            </button>
                          ))}
                        </div>
                        {/* Polygon close / cancel */}
                        {zoneShape === "poly" && polyPoints.length > 0 && (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={closePolygon}
                              disabled={polyPoints.length < 3}
                              className="flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-40"
                              data-testid="photo-measure-zone-close"
                            >
                              Close ({polyPoints.length} pts)
                            </button>
                            <button
                              type="button"
                              onClick={cancelPolygon}
                              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5]"
                              data-testid="photo-measure-zone-cancel"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        className="text-[10px] text-[#0EA5E9] uppercase tracking-wider font-bold flex items-center gap-1 hover:underline"
                        onClick={recalibrate}
                        data-testid="photo-measure-recalibrate"
                      >
                        <RotateCcw className="w-3 h-3" /> Recalibrate
                      </button>
                      {(prefillThumbs.length > 1 || !prefillThumbs.length) && (
                        <button
                          type="button"
                          className="text-[10px] text-[#0EA5E9] uppercase tracking-wider font-bold flex items-center gap-1 hover:underline"
                          onClick={changePhoto}
                          data-testid="photo-measure-change-photo"
                          title="Switch to a different photo. Your existing tap measurements stay in the list — you'll just need to recalibrate the new photo."
                        >
                          <Images className="w-3 h-3" /> Change Photo
                        </button>
                      )}
                    </div>

                    {/* Measurement list */}
                    <div className="border-t border-[#E4E4E7] pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        Measurements ({measures.length})
                      </div>
                      <ul className="space-y-1 max-h-32 overflow-y-auto" data-testid="photo-measure-list">
                        {measures.map((m) => {
                          const offPhoto = m.photoUrl && photo && m.photoUrl !== photo.url;
                          return (
                            <li key={m.id} className="text-xs flex items-center justify-between gap-2">
                              <span>
                                <span className="font-mono-num font-bold">{m.feet.toFixed(1)} ft</span>{" "}
                                <span className="text-[#71717A]">{m.labelName}</span>
                                {offPhoto && (
                                  <span className="ml-1 text-[9px] uppercase tracking-wider text-[#A1A1AA] border border-[#E4E4E7] px-1 py-px rounded-sm" title="Placed on a different photo — still counted in totals">
                                    other photo
                                  </span>
                                )}
                              </span>
                              <button onClick={() => removeMeasurement(m.id)} className="text-[#A1A1AA] hover:text-[#DC2626]">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="border-t border-[#E4E4E7] pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        Openings ({openings.length})
                      </div>
                      <ul className="space-y-1 max-h-24 overflow-y-auto">
                        {openings.map((o) => {
                          const t = OPENING_TYPES.find((x) => x.key === o.type);
                          return (
                            <li key={o.id} className="text-xs flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: t?.color }} />
                                {t?.name}
                              </span>
                              <button onClick={() => removeOpening(o.id)} className="text-[#A1A1AA] hover:text-[#DC2626]">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {/* Zone list (deductions) */}
                    <div className="border-t border-[#E4E4E7] pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        No-siding zones ({zones.length})
                      </div>
                      <ul className="space-y-1 max-h-24 overflow-y-auto" data-testid="photo-measure-zone-list">
                        {zones.map((z) => {
                          const c = ZONE_CATEGORIES.find((x) => x.key === z.category);
                          const offPhoto = z.photoUrl && photo && z.photoUrl !== photo.url;
                          return (
                            <li key={z.id} className="text-xs flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c?.color }} />
                                <span className="font-mono-num font-bold">-{Math.round(z.area_sqft)} ft²</span>{" "}
                                <span className="text-[#71717A]">{c?.name}</span>
                                {offPhoto && (
                                  <span className="ml-1 text-[9px] uppercase tracking-wider text-[#A1A1AA] border border-[#E4E4E7] px-1 py-px rounded-sm" title="Placed on a different photo">
                                    other photo
                                  </span>
                                )}
                              </span>
                              <button onClick={() => removeZone(z.id)} className="text-[#A1A1AA] hover:text-[#DC2626]">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </li>
                          );
                        })}
                        {!zones.length && (
                          <li className="text-[11px] text-[#A1A1AA] italic">No zones yet — switch to &quot;Mask zone&quot; to draw brick/stone/garage/etc.</li>
                        )}
                      </ul>
                    </div>

                    {/* Live totals */}
                    <div className="border-t border-[#E4E4E7] pt-2 bg-[#FAFAFA] -mx-1 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">Live Totals</div>
                      <div className="grid grid-cols-2 gap-2 text-xs" data-testid="photo-measure-totals">
                        <div>Siding: <span className="font-mono-num font-bold">{totals.siding_sqft} ft²</span></div>
                        <div>Eaves: <span className="font-mono-num font-bold">{totals.eaves_lf} LF</span></div>
                        <div>Rakes: <span className="font-mono-num font-bold">{totals.rakes_lf} LF</span></div>
                        <div>Openings: <span className="font-mono-num font-bold">{totals.opening_count}</span></div>
                      </div>
                      {totals._photo_zones_deducted_sqft > 0 && (
                        <div className="text-[11px] text-[#71717A] mt-1.5 pt-1.5 border-t border-[#E4E4E7]" data-testid="photo-measure-deductions">
                          <span className="font-bold text-[#DC2626]">
                            -{totals._photo_zones_deducted_sqft} ft²
                          </span>{" "}
                          deducted from {totals._photo_gross_wall_sqft} ft² gross
                          {totals._photo_zones_summary && ` (${totals._photo_zones_summary})`}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-[#E4E4E7] px-5 py-3 flex justify-between items-center">
              <div className="text-[10px] text-[#A1A1AA]">
                Calibrate once with a reference object, then tap walls + openings
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider"
                  onClick={closeAll}
                  disabled={busy}
                >Cancel</button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={busy || (!measures.length && !openings.length && !zones.length)}
                  className="px-3 py-2 bg-[#F97316] text-white hover:bg-[#EA580C] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="photo-measure-apply-btn"
                >
                  {busy ? <Plus className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {busy ? "Saving…" : "Apply Measurements"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
