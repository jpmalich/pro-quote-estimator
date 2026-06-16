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
import React, { useEffect, useRef, useState } from "react";
import { Ruler, Camera, X, Check, Trash2, Plus, RotateCcw } from "lucide-react";
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

const MODE_CALIBRATE = "calibrate";
const MODE_MEASURE = "measure";
const MODE_OPENING = "opening";

function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// Aggregate the marked measurements into HOVER-shape totals.
// Heuristic: pair wall_w with wall_h to compute siding area; eave_lf /
// rake_lf sums map straight across; openings count drives perimeters.
function buildMeasurements(measures, openings) {
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
  const sidingSqft = Math.round(wallArea + gableArea);

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
    opening_perimeter_lf: Math.round(openingPerim),
    opening_count: counts.window + counts.entry_door + counts.patio_door + counts.garage_door,
    window_count: counts.window,
    entry_door_count: counts.entry_door,
    patio_door_count: counts.patio_door,
    garage_door_count: counts.garage_door,
    _photo_avg_wall_height_ft: Math.round(avgHeight * 10) / 10,
  };
}

export default function PhotoMeasureButton({ onApply }) {
  const fileRef = useRef();
  const canvasRef = useRef();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState(null); // {url, width, height}
  const [mode, setMode] = useState(MODE_CALIBRATE);
  const [pxPerFt, setPxPerFt] = useState(0);
  // Pending click pair for calibration / measurement
  const [pending, setPending] = useState(null); // {x, y}
  const [measures, setMeasures] = useState([]); // [{p1, p2, feet, label}]
  const [openings, setOpenings] = useState([]); // [{x, y, type}]
  const [openingType, setOpeningType] = useState("window");
  const [busy, setBusy] = useState(false);

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
  };

  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setPhoto({ url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
  };

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
        { x: p.x, y: p.y, type: openingType, id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
      ]);
      return;
    }
    // Calibrate or Measure both need two clicks
    if (!pending) {
      setPending(p);
      return;
    }
    const px = dist(pending, p);
    if (mode === MODE_CALIBRATE) {
      const len = prompt("Real length of this reference (in INCHES):");
      const inches = parseFloat(len || "0");
      if (!inches || inches <= 0) {
        setPending(null);
        return;
      }
      const feet = inches / 12;
      const newPxPerFt = px / feet;
      setPxPerFt(newPxPerFt);
      setPending(null);
      setMode(MODE_MEASURE);
      toast.success(`Calibrated: ${newPxPerFt.toFixed(1)} px/ft. Now measure your walls.`);
      return;
    }
    if (mode === MODE_MEASURE) {
      if (!pxPerFt) {
        toast.error("Calibrate first");
        setPending(null);
        return;
      }
      const feet = px / pxPerFt;
      // Quick label menu via prompt — keeps UI tight
      const labelInput = prompt(
        `Length = ${feet.toFixed(1)} ft. Label this measurement?\n\n` +
          LABEL_OPTIONS.map((o, i) => `${i + 1}) ${o.name}`).join("\n") +
          "\n\nEnter 1-" + LABEL_OPTIONS.length,
        "1"
      );
      const idx = parseInt(labelInput || "0", 10) - 1;
      if (idx < 0 || idx >= LABEL_OPTIONS.length) {
        setPending(null);
        return;
      }
      const opt = LABEL_OPTIONS[idx];
      // Convert to ft for storage. If the option is inches (windows), keep
      // ft anyway since the contractor entered the reference as inches and
      // the conversion is consistent.
      setMeasures((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          p1: pending, p2: p, feet, label: opt.key, labelName: opt.name,
        },
      ]);
      setPending(null);
    }
  };

  const recalibrate = () => {
    setMode(MODE_CALIBRATE);
    setPxPerFt(0);
    setPending(null);
  };

  const removeMeasurement = (id) =>
    setMeasures((prev) => prev.filter((m) => m.id !== id));
  const removeOpening = (id) =>
    setOpenings((prev) => prev.filter((o) => o.id !== id));

  const apply = async () => {
    if (!measures.length && !openings.length) {
      toast.error("Mark at least one measurement or opening first");
      return;
    }
    setBusy(true);
    try {
      const measurements = buildMeasurements(measures, openings);
      // Hand back the same shape AI Measure produces so the page-level
      // onApply callback (in JobInfoPanel / ISSEstimateEditor) just works.
      await onApply({ measurements, lines: [], vero_openings: [], raw_photo: {
        measures, openings, pxPerFt,
      } });
      toast.success("Photo measurements applied");
      closeAll();
    } catch (e) {
      toast.error(e?.message || "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  // Render markup overlay
  const renderOverlay = () => {
    if (!photo) return null;
    return (
      <svg
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {measures.map((m) => {
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
        {openings.map((o) => {
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
        {pending && (
          <circle cx={pending.x} cy={pending.y} r={Math.max(6, photo.width / 300)}
                  fill="none" stroke="#F97316" strokeWidth={Math.max(3, photo.width / 600)} strokeDasharray="6 4" />
        )}
      </svg>
    );
  };

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (photo?.url) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  const totals = buildMeasurements(measures, openings);

  return (
    <div data-testid="photo-measure">
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

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={closeAll}
        >
          <div
            className="bg-white max-w-4xl w-full max-h-[95vh] flex flex-col"
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
                      : `Step 4 · Tap to mark ${OPENING_TYPES.find((t) => t.key === openingType)?.name}s`}
                  </div>
                </div>
              </div>
              <button type="button" onClick={closeAll} className="text-white/90 hover:text-white" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Photo canvas */}
              <div className="md:col-span-2">
                {!photo ? (
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
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${
                          mode === MODE_MEASURE ? "bg-[#0EA5E9] text-white border-[#0EA5E9]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                        }`}
                        onClick={() => { setMode(MODE_MEASURE); setPending(null); }}
                        disabled={!pxPerFt}
                        data-testid="photo-measure-mode-measure"
                      >Measure</button>
                      <button
                        type="button"
                        className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border ${
                          mode === MODE_OPENING ? "bg-[#0EA5E9] text-white border-[#0EA5E9]" : "bg-white text-[#52525B] border-[#E4E4E7] hover:bg-[#F4F4F5]"
                        }`}
                        onClick={() => { setMode(MODE_OPENING); setPending(null); }}
                        disabled={!pxPerFt}
                        data-testid="photo-measure-mode-opening"
                      >Mark openings</button>
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

                    <button
                      type="button"
                      className="text-[10px] text-[#0EA5E9] uppercase tracking-wider font-bold flex items-center gap-1 hover:underline"
                      onClick={recalibrate}
                      data-testid="photo-measure-recalibrate"
                    >
                      <RotateCcw className="w-3 h-3" /> Recalibrate
                    </button>

                    {/* Measurement list */}
                    <div className="border-t border-[#E4E4E7] pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">
                        Measurements ({measures.length})
                      </div>
                      <ul className="space-y-1 max-h-32 overflow-y-auto" data-testid="photo-measure-list">
                        {measures.map((m) => (
                          <li key={m.id} className="text-xs flex items-center justify-between gap-2">
                            <span>
                              <span className="font-mono-num font-bold">{m.feet.toFixed(1)} ft</span>{" "}
                              <span className="text-[#71717A]">{m.labelName}</span>
                            </span>
                            <button onClick={() => removeMeasurement(m.id)} className="text-[#A1A1AA] hover:text-[#DC2626]">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
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

                    {/* Live totals */}
                    <div className="border-t border-[#E4E4E7] pt-2 bg-[#FAFAFA] -mx-1 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-1">Live Totals</div>
                      <div className="grid grid-cols-2 gap-2 text-xs" data-testid="photo-measure-totals">
                        <div>Siding: <span className="font-mono-num font-bold">{totals.siding_sqft} ft²</span></div>
                        <div>Eaves: <span className="font-mono-num font-bold">{totals.eaves_lf} LF</span></div>
                        <div>Rakes: <span className="font-mono-num font-bold">{totals.rakes_lf} LF</span></div>
                        <div>Openings: <span className="font-mono-num font-bold">{totals.opening_count}</span></div>
                      </div>
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
                  disabled={busy || (!measures.length && !openings.length)}
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
