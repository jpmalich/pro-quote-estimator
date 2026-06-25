// Iter 78u — True 3D elevation renderer using Three.js with an
// orthographic camera. Replaces the approximate 2D SVG drawings used
// in earlier iterations. Produces HOVER-grade visual quality at a
// fixed pixel size, suitable for both in-app preview and PNG export.
//
// Coordinate convention (world units = feet):
//   +X right · +Y up · -Z into screen
//   Wall sits on the XY plane with its bottom-left corner at (0, 0, 0)
//   Camera looks down -Z (orthographic, straight-on elevation view)
//
// The headless `renderElevationToPng()` helper builds the same scene
// off-DOM and returns a PNG data URL, used when generating the
// customer Quote PDF / email.
import * as THREE from "three";

// --- Materials (memoizable per scene) ---------------------------------
const COL = {
  sky: 0xF4F4F5,
  ground: 0xD4D4D8,
  wall: 0xFAFAFA,
  wallEdge: 0x18181B,
  roof: 0x52525B,
  roofEdge: 0x18181B,
  trim: 0xE4E4E7,
  windowGlass: 0x0EA5E9,
  windowFrame: 0xFFFFFF,
  windowMullion: 0xE4E4E7,
  door: 0xF97316,
  doorPanel: 0xFB923C,
  patio: 0xA855F7,
  garage: 0x71717A,
  garageStripe: 0x52525B,
};

const TYPE_TO_COLOR = {
  window: COL.windowGlass,
  door: COL.door,
  entry_door: COL.door,
  patio: COL.patio,
  patio_door: COL.patio,
  garage: COL.garage,
  garage_door: COL.garage,
  vent: COL.trim,
  other: COL.trim,
};

const WALL_DEPTH_FT = 0.5;
const OPENING_INSET_FT = 0.05;
const FRAME_THICK_FT = 0.25;

function makeLine(points, color) {
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geom, new THREE.LineBasicMaterial({ color }));
}

// Build a window mesh group: glass panel + white frame + mullions
function buildWindow(widthFt, heightFt, style = "") {
  const group = new THREE.Group();
  const frameGeom = new THREE.BoxGeometry(widthFt, heightFt, WALL_DEPTH_FT * 0.4);
  const frame = new THREE.Mesh(
    frameGeom,
    new THREE.MeshBasicMaterial({ color: COL.windowFrame })
  );
  group.add(frame);
  const glassW = widthFt - FRAME_THICK_FT * 2;
  const glassH = heightFt - FRAME_THICK_FT * 2;
  if (glassW > 0 && glassH > 0) {
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(glassW, glassH),
      new THREE.MeshBasicMaterial({ color: COL.windowGlass, opacity: 0.6, transparent: true })
    );
    glass.position.z = WALL_DEPTH_FT * 0.2 + 0.005;
    group.add(glass);
    // Mullion bar: horizontal (Double Hung / Single Hung) or center cross (Casement variants)
    const isDoubleHung = /Hung|Slider/i.test(style);
    const mullionMat = new THREE.MeshBasicMaterial({ color: COL.windowMullion });
    if (isDoubleHung || !style) {
      const mull = new THREE.Mesh(
        new THREE.BoxGeometry(glassW, 0.08, 0.02),
        mullionMat
      );
      mull.position.z = WALL_DEPTH_FT * 0.2 + 0.01;
      group.add(mull);
    }
    if (/Twin|Triple/i.test(style)) {
      const sections = /Triple/i.test(style) ? 3 : 2;
      for (let i = 1; i < sections; i += 1) {
        const mull = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, glassH, 0.02),
          mullionMat
        );
        mull.position.x = -glassW / 2 + (i * glassW) / sections;
        mull.position.z = WALL_DEPTH_FT * 0.2 + 0.01;
        group.add(mull);
      }
    }
  }
  // Edge outline
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(frameGeom),
    new THREE.LineBasicMaterial({ color: 0x09090B })
  );
  group.add(edges);
  return group;
}

function buildDoor(widthFt, heightFt, color = COL.door) {
  const group = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt, heightFt, WALL_DEPTH_FT * 0.4),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(slab);
  // Panel insets (2 stacked panels)
  const panelW = widthFt - 0.4;
  const panelH = (heightFt - 0.8) / 2;
  if (panelW > 0 && panelH > 0) {
    const panelMat = new THREE.MeshBasicMaterial({ color: COL.doorPanel });
    for (let i = 0; i < 2; i += 1) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(panelW, panelH),
        panelMat
      );
      panel.position.y = -heightFt / 2 + 0.3 + panelH / 2 + i * (panelH + 0.2);
      panel.position.z = WALL_DEPTH_FT * 0.2 + 0.005;
      group.add(panel);
    }
  }
  // Knob
  const knob = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 16),
    new THREE.MeshBasicMaterial({ color: 0x09090B })
  );
  knob.position.x = widthFt / 2 - 0.25;
  knob.position.y = 0;
  knob.position.z = WALL_DEPTH_FT * 0.2 + 0.01;
  group.add(knob);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: 0x09090B })
  );
  group.add(edges);
  return group;
}

function buildGarage(widthFt, heightFt) {
  const group = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt, heightFt, WALL_DEPTH_FT * 0.3),
    new THREE.MeshBasicMaterial({ color: COL.garage })
  );
  group.add(slab);
  // Horizontal stripes (door panels)
  const stripes = 4;
  const stripeH = heightFt / stripes;
  for (let i = 1; i < stripes; i += 1) {
    const ln = makeLine(
      [
        new THREE.Vector3(-widthFt / 2, -heightFt / 2 + i * stripeH, WALL_DEPTH_FT * 0.16),
        new THREE.Vector3(widthFt / 2, -heightFt / 2 + i * stripeH, WALL_DEPTH_FT * 0.16),
      ],
      COL.garageStripe
    );
    group.add(ln);
  }
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: 0x09090B })
  );
  group.add(edges);
  return group;
}

function buildOpening(op) {
  const w = Math.max(0.5, Number(op.width_ft) || 3);
  const h = Math.max(0.5, Number(op.height_ft) || 4);
  if (op.type === "garage" || op.type === "garage_door") return buildGarage(w, h);
  if (op.type === "door" || op.type === "entry_door") return buildDoor(w, h, COL.door);
  if (op.type === "patio" || op.type === "patio_door") return buildDoor(w, h, COL.patio);
  return buildWindow(w, h, op.style);
}

function buildRoof(widthFt, eaveHeightFt, gableHeightFt, shape, rakeLf) {
  const group = new THREE.Group();
  const overhang = 0.5; // 6" eave overhang
  const w = widthFt + overhang * 2;
  let peakHeight = gableHeightFt;
  if (!peakHeight || peakHeight <= 0) {
    // Estimate from rake_lf or fall back to a 6:12 pitch on full width.
    const rake = Number(rakeLf) || 0;
    if (rake > 0 && shape === "gable") {
      // rake² = (w/2)² + peakHeight² → peakHeight = √(rake² - (w/2)²)
      const half = widthFt / 2;
      peakHeight = Math.sqrt(Math.max(0.01, rake * rake - half * half));
    } else {
      peakHeight = widthFt * 0.25; // ~6:12 pitch default
    }
  }
  peakHeight = Math.max(1, Math.min(peakHeight, widthFt * 0.6));
  const baseY = eaveHeightFt;
  const roofMat = new THREE.MeshBasicMaterial({ color: COL.roof });
  const edgeMat = new THREE.LineBasicMaterial({ color: COL.roofEdge });

  if (shape === "flat" || shape === "none") {
    const flat = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.5, WALL_DEPTH_FT + 1),
      roofMat
    );
    flat.position.x = widthFt / 2;
    flat.position.y = baseY + 0.25;
    flat.position.z = 0;
    group.add(flat);
    return group;
  }
  if (shape === "hip") {
    const inset = widthFt * 0.22;
    const shape2d = new THREE.Shape();
    shape2d.moveTo(-overhang, 0);
    shape2d.lineTo(inset, peakHeight);
    shape2d.lineTo(widthFt - inset, peakHeight);
    shape2d.lineTo(widthFt + overhang, 0);
    shape2d.lineTo(-overhang, 0);
    const geom = new THREE.ExtrudeGeometry(shape2d, { depth: WALL_DEPTH_FT + 1, bevelEnabled: false });
    const roof = new THREE.Mesh(geom, roofMat);
    roof.position.y = baseY;
    roof.position.z = -(WALL_DEPTH_FT + 1) / 2;
    group.add(roof);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), edgeMat).translateY(baseY).translateZ(-(WALL_DEPTH_FT + 1) / 2));
    return group;
  }
  // Default: gable
  const shape2d = new THREE.Shape();
  shape2d.moveTo(-overhang, 0);
  shape2d.lineTo(widthFt / 2, peakHeight);
  shape2d.lineTo(widthFt + overhang, 0);
  shape2d.lineTo(-overhang, 0);
  const geom = new THREE.ExtrudeGeometry(shape2d, { depth: WALL_DEPTH_FT + 1, bevelEnabled: false });
  const roof = new THREE.Mesh(geom, roofMat);
  roof.position.y = baseY;
  roof.position.z = -(WALL_DEPTH_FT + 1) / 2;
  group.add(roof);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom), edgeMat).translateY(baseY).translateZ(-(WALL_DEPTH_FT + 1) / 2));
  // Gable triangle infill (siding face that closes the peak)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(0, 0);
  gableShape.lineTo(widthFt / 2, peakHeight);
  gableShape.lineTo(widthFt, 0);
  gableShape.lineTo(0, 0);
  const gableGeom = new THREE.ShapeGeometry(gableShape);
  const gable = new THREE.Mesh(gableGeom, new THREE.MeshBasicMaterial({ color: COL.wall }));
  gable.position.y = baseY;
  gable.position.z = 0.001;
  group.add(gable);
  group.add(
    makeLine(
      [
        new THREE.Vector3(0, baseY, 0.002),
        new THREE.Vector3(widthFt / 2, baseY + peakHeight, 0.002),
        new THREE.Vector3(widthFt, baseY, 0.002),
      ],
      COL.wallEdge
    )
  );
  return group;
}

// Build a horizontal siding line texture by stacking thin lines at lap
// intervals. Cheap, no texture loading required.
function addSidingStripes(parent, widthFt, heightFt, exposureInches = 7) {
  const exposureFt = exposureInches / 12;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xE4E4E7 });
  for (let y = exposureFt; y < heightFt; y += exposureFt) {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, 0.01),
      new THREE.Vector3(widthFt, y, 0.01),
    ]);
    parent.add(new THREE.Line(geom, lineMat));
  }
}

// Iter 78u — Dormer estimator. Claude gives us total face ft² per wall
// but no count. Use industry-typical sizing to split into N dormer
// boxes (16-72 ft² is the typical residential range).
//   ≤ 36 ft² → 1 dormer
//   ≤ 90 ft² → 2 dormers
//   >  90 ft² → ceil(area / 60), capped at 4
function inferDormerCount(faceSqft) {
  if (faceSqft <= 0) return 0;
  if (faceSqft <= 36) return 1;
  if (faceSqft <= 90) return 2;
  return Math.min(4, Math.ceil(faceSqft / 60));
}

// Build a single dormer (small gabled box with a centered window) at the
// given footprint width × face height. Returns a THREE.Group positioned
// at its base center (placement is done by the caller).
function buildDormer(widthFt, faceHeightFt) {
  const group = new THREE.Group();
  const depth = Math.max(2, widthFt * 0.6); // dormers are roughly square in plan
  const peakH = widthFt * 0.45;
  // Side walls (visible as a colored band behind the front face)
  const sideMat = new THREE.MeshBasicMaterial({ color: COL.wall });
  const sides = new THREE.Mesh(
    new THREE.BoxGeometry(widthFt, faceHeightFt, depth * 0.4),
    sideMat
  );
  sides.position.y = faceHeightFt / 2;
  group.add(sides);
  // Front face (siding)
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(widthFt, faceHeightFt),
    new THREE.MeshBasicMaterial({ color: COL.wall })
  );
  face.position.y = faceHeightFt / 2;
  face.position.z = depth * 0.2 + 0.001;
  group.add(face);
  // Front face outline
  group.add(
    makeLine(
      [
        new THREE.Vector3(-widthFt / 2, 0, depth * 0.2 + 0.002),
        new THREE.Vector3(-widthFt / 2, faceHeightFt, depth * 0.2 + 0.002),
        new THREE.Vector3(widthFt / 2, faceHeightFt, depth * 0.2 + 0.002),
        new THREE.Vector3(widthFt / 2, 0, depth * 0.2 + 0.002),
      ],
      COL.wallEdge
    )
  );
  // Gable peak above the face
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-widthFt / 2, 0);
  gableShape.lineTo(0, peakH);
  gableShape.lineTo(widthFt / 2, 0);
  gableShape.lineTo(-widthFt / 2, 0);
  const gableGeom = new THREE.ShapeGeometry(gableShape);
  const gable = new THREE.Mesh(
    gableGeom,
    new THREE.MeshBasicMaterial({ color: COL.wall })
  );
  gable.position.y = faceHeightFt;
  gable.position.z = depth * 0.2 + 0.002;
  group.add(gable);
  // Gable roof slopes (visible color band)
  const roofShape2d = new THREE.Shape();
  roofShape2d.moveTo(-widthFt / 2 - 0.3, 0);
  roofShape2d.lineTo(0, peakH + 0.2);
  roofShape2d.lineTo(widthFt / 2 + 0.3, 0);
  roofShape2d.lineTo(widthFt / 2, 0);
  roofShape2d.lineTo(0, peakH);
  roofShape2d.lineTo(-widthFt / 2, 0);
  roofShape2d.lineTo(-widthFt / 2 - 0.3, 0);
  const dormerRoofGeom = new THREE.ShapeGeometry(roofShape2d);
  const dormerRoof = new THREE.Mesh(
    dormerRoofGeom,
    new THREE.MeshBasicMaterial({ color: COL.roof })
  );
  dormerRoof.position.y = faceHeightFt;
  dormerRoof.position.z = depth * 0.2 + 0.003;
  group.add(dormerRoof);
  group.add(
    makeLine(
      [
        new THREE.Vector3(-widthFt / 2 - 0.3, faceHeightFt, depth * 0.2 + 0.004),
        new THREE.Vector3(0, faceHeightFt + peakH + 0.2, depth * 0.2 + 0.004),
        new THREE.Vector3(widthFt / 2 + 0.3, faceHeightFt, depth * 0.2 + 0.004),
      ],
      COL.roofEdge
    )
  );
  // A modest double-hung window centered on the dormer face
  const winW = Math.max(1.5, widthFt * 0.55);
  const winH = Math.max(2, faceHeightFt * 0.6);
  const win = buildWindow(winW, winH, "Double Hung");
  win.position.set(0, faceHeightFt / 2, depth * 0.2 + 0.02);
  group.add(win);
  return group;
}

// Place dormer groups along the roof at evenly distributed x positions.
// Dormers sit on the eave line (eaveHeightFt) and protrude forward (+Z)
// so they read clearly from the orthographic front view.
function addDormersToScene(scene, widthFt, eaveHeightFt, dormerFaceSqft) {
  const count = inferDormerCount(dormerFaceSqft);
  if (count <= 0) return;
  const perDormerSqft = dormerFaceSqft / count;
  // Pick a plausible face dimension: ~5 ft wide × derive height from area.
  // Caps keep things visually sane (4-12 ft wide, 4-8 ft tall).
  let dormerWidth = Math.max(4, Math.min(12, Math.sqrt(perDormerSqft * 1.2)));
  let dormerHeight = perDormerSqft / dormerWidth;
  dormerHeight = Math.max(3, Math.min(8, dormerHeight));
  // Recompute width so area matches Claude's total once dormerHeight was clamped.
  dormerWidth = Math.max(3, Math.min(widthFt * 0.4, perDormerSqft / dormerHeight));
  const xPcts = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  for (const xPct of xPcts) {
    const dormer = buildDormer(dormerWidth, dormerHeight);
    dormer.position.set(xPct * widthFt, eaveHeightFt + 0.5, 0.05);
    scene.add(dormer);
  }
}

// Build the entire elevation scene. Returns the THREE.Scene + a suggested
// camera viewBox (so callers can frame the orthographic camera correctly).
export function buildElevationScene(elev) {
  const widthFt = Number(elev?.facade_width_ft) || 0;
  const heightFt = Number(elev?.facade_height_ft) || 0;
  if (widthFt <= 0 || heightFt <= 0) return null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.sky);

  // Wall
  const wallGeom = new THREE.BoxGeometry(widthFt, heightFt, WALL_DEPTH_FT);
  const wall = new THREE.Mesh(wallGeom, new THREE.MeshBasicMaterial({ color: COL.wall }));
  wall.position.set(widthFt / 2, heightFt / 2, -WALL_DEPTH_FT / 2);
  scene.add(wall);
  // Wall edge outline
  scene.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeom),
      new THREE.LineBasicMaterial({ color: COL.wallEdge })
    ).translateX(widthFt / 2).translateY(heightFt / 2).translateZ(-WALL_DEPTH_FT / 2)
  );

  // Siding texture — only the visible front face
  const sidingGroup = new THREE.Group();
  sidingGroup.position.z = 0.001;
  addSidingStripes(sidingGroup, widthFt, heightFt, 7);
  scene.add(sidingGroup);

  // Roof
  const gableHeightFt = Number(elev?.gable_triangle_height_ft) || 0;
  const shape = elev?.roof_style || (Number(elev?.rake_lf_on_face) > 0 ? "gable" : "hip");
  scene.add(buildRoof(widthFt, heightFt, gableHeightFt, shape, elev?.rake_lf_on_face));

  // Iter 78u — Dormers. When Claude returns dormer_face_sqft > 0 on this
  // wall we split the ft² into N visible dormer boxes mounted on the
  // roof slope. Drawn AFTER the roof so they sit on top of the
  // slope geometry.
  const dormerSqft = Number(elev?.dormer_face_sqft) || 0;
  if (dormerSqft > 0) {
    addDormersToScene(scene, widthFt, heightFt, dormerSqft);
  }

  // Openings
  for (const op of elev?.openings || []) {
    const opW = Number(op.width_ft) || 3;
    const opH = Number(op.height_ft) || 4;
    const xPct = Number(op.x_pct ?? 0.5);
    const yPct = Number(op.y_pct ?? 0.5);
    const cx = xPct * widthFt;
    // yPct=0 is the top of the wall (SVG convention); convert to world Y
    const cyFromTop = yPct * heightFt;
    const cy = heightFt - cyFromTop;
    const xClamped = Math.max(opW / 2 + OPENING_INSET_FT, Math.min(widthFt - opW / 2 - OPENING_INSET_FT, cx));
    const yClamped = Math.max(opH / 2 + OPENING_INSET_FT, Math.min(heightFt - opH / 2 - OPENING_INSET_FT, cy));
    const mesh = buildOpening(op);
    mesh.position.set(xClamped, yClamped, WALL_DEPTH_FT / 2 + 0.01);
    scene.add(mesh);
  }

  // Ground line
  scene.add(
    makeLine(
      [new THREE.Vector3(-1, 0, 0.01), new THREE.Vector3(widthFt + 1, 0, 0.01)],
      COL.wallEdge
    )
  );

  // Margins for the camera (extra headroom when dormers protrude above the roof)
  const headroom = Math.max(widthFt * 0.35, 8);
  return {
    scene,
    bounds: {
      minX: -2,
      maxX: widthFt + 2,
      minY: -1,
      maxY: heightFt + headroom,
    },
  };
}

// Render the elevation off-DOM and return a PNG data URL. Used by the
// customer Quote PDF / email generator.
//
// @param elev   The same shape ElevationDrawing/buildElevationScene expects.
// @param opts   { pxWidth, pxHeight }
// @returns      "data:image/png;base64,..."
export function renderElevationToPng(elev, { pxWidth = 760, pxHeight = 480 } = {}) {
  const built = buildElevationScene(elev);
  if (!built) return "";
  const { scene, bounds } = built;
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  // Choose orthographic frustum so the whole wall fits inside pxWidth × pxHeight
  // while preserving aspect ratio (letterbox if needed).
  const targetAspect = pxWidth / pxHeight;
  const worldAspect = worldW / worldH;
  let frustumW;
  let frustumH;
  if (worldAspect > targetAspect) {
    frustumW = worldW;
    frustumH = worldW / targetAspect;
  } else {
    frustumH = worldH;
    frustumW = worldH * targetAspect;
  }
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const camera = new THREE.OrthographicCamera(
    cx - frustumW / 2, cx + frustumW / 2,
    cy + frustumH / 2, cy - frustumH / 2,
    -100, 100
  );
  camera.position.set(cx, cy, 50);
  camera.lookAt(cx, cy, 0);

  const canvas = document.createElement("canvas");
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(2);
  renderer.setSize(pxWidth, pxHeight, false);
  renderer.render(scene, camera);
  const url = canvas.toDataURL("image/png");
  // Free GPU resources — iOS Safari can run out quickly with multiple renders.
  renderer.dispose();
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material.dispose?.();
    }
  });
  return url;
}
