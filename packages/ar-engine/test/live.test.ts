import { describe, expect, it } from 'vitest';
import {
  AR_ENGINE_VERSION,
  anchorFromPixel,
  anchorToPixel,
  CallBudget,
  cameraAxes,
  cameraPosition,
  cameraRotation,
  cameraRotationFromQuat,
  ceilingPlane,
  createTracker,
  DEFAULT_CAMERA_HEIGHT_M,
  DEFAULT_FOV_LONG_DEG,
  detectTier,
  deviceClassFor,
  ema,
  eulerFromCameraRotation,
  fitVerdict,
  floorPlane,
  footprintCorners,
  type GateResult,
  gate,
  initialGateState,
  initialTrackingState,
  intersectPlane,
  intrinsicsFor,
  LK_HEIGHT,
  LK_WIDTH,
  lkTranslation,
  mat3FromQuat,
  pitchFromHorizon,
  projectFootprint,
  projectToPixel,
  QUAT_IDENTITY,
  quatFromDeviceOrientation,
  rayFromPixel,
  rotationAngleDeg,
  ruleFor,
  type SceneAnalysis,
  type SceneType,
  type SurfaceDetection,
  scaleIntrinsics,
  screenAnchor,
  smoothScene,
  solveCameraHeight,
  stepGate,
  stepTracking,
  TRACKING_THRESHOLDS,
  tierOverrideFrom,
  visibleSurfaceAreaM2,
  wallDistanceFromReference,
  wallNormalFacing,
  wallPlane,
  wavering,
} from '../src';

/**
 * Live-camera tier C maths. Conventions under test: video pixels with the origin top-left
 * (u right, v down); a metric world with Y up, the floor at y = 0 and the camera at (0, h, 0);
 * the pinhole camera frame X right / Y down / Z forward; R = camera-to-world rotation.
 */
const K = intrinsicsFor(1280, 720, 'phone'); // landscape 16:9
const KP = intrinsicsFor(720, 1280, 'phone'); // portrait 9:16
const LEVEL = cameraRotation({});
const C14 = cameraPosition(1.4);

const S = (type: SurfaceDetection['type'], confidence = 0.85): SurfaceDetection => ({ type, confidence, bbox: [0, 0, 1, 1] });
const scene = (sceneType: SceneType, surfaces: SurfaceDetection[], extra: Partial<SceneAnalysis> = {}): SceneAnalysis => ({
  sceneType,
  sceneConfidence: 0.7,
  surfaces,
  references: [],
  freeArea: 0.6,
  horizonY: 0.45,
  lighting: { direction: 'left', warm: true, brightness: 0.5 },
  provider: 'gemini',
  ...extra,
});

describe('camera-math — intrinsics', () => {
  it('16:9 at 66° across the long side → fovY ≈ 40.13° (the plan\'s "≈ 40.3°"), fx = fy, centred principal point', () => {
    expect(K.fovXDeg).toBe(66);
    expect(K.fovYDeg).toBeCloseTo(40.13, 1);
    expect(Math.abs(K.fovYDeg - 40.3)).toBeLessThan(0.3);
    expect(K.fx).toBe(K.fy);
    expect(K.fy).toBeCloseTo(360 / Math.tan((K.fovYDeg / 2) * (Math.PI / 180)), 6);
    expect(K.cx).toBe(640);
    expect(K.cy).toBe(360);
    expect(K.source).toBe('default');
  });
  it('portrait keeps the long-side FOV vertical; laptops default to 70°; the lens override is reported; scaling follows a resample', () => {
    expect(KP.fovYDeg).toBe(66);
    expect(KP.fovXDeg).toBeCloseTo(40.13, 1);
    expect(KP.fy).toBeCloseTo(K.fy, 6); // the same lens, rotated
    expect(intrinsicsFor(1280, 720, 'laptop').fovXDeg).toBe(DEFAULT_FOV_LONG_DEG.laptop);
    const o = intrinsicsFor(1280, 720, 'phone', { fovLongDeg: 55 });
    expect(o.fovXDeg).toBe(55);
    expect(o.source).toBe('override');
    const s = scaleIntrinsics(K, 640, 360);
    expect(s.fx).toBeCloseTo(K.fx / 2, 9);
    expect(s.cx).toBe(320);
  });
});

describe('pose — device orientation quaternion', () => {
  it('beta 90 (an upright phone) looks at the horizon along −Z', () => {
    const R = cameraRotationFromQuat(quatFromDeviceOrientation(0, 90, 0, 0));
    const { forward } = cameraAxes(R);
    expect(forward.x).toBeCloseTo(0, 9);
    expect(forward.y).toBeCloseTo(0, 9);
    expect(forward.z).toBeCloseTo(-1, 9);
    expect(eulerFromCameraRotation(R).pitchDeg).toBeCloseTo(0, 6);
  });
  it('beta 45 pitches the camera down 45°', () => {
    const e = eulerFromCameraRotation(cameraRotationFromQuat(quatFromDeviceOrientation(0, 45, 0, 0)));
    expect(e.pitchDeg).toBeCloseTo(-45, 6);
    expect(e.rollDeg).toBeCloseTo(0, 6);
  });
  it('screen angle 90 rolls the camera by −90° and leaves the forward axis alone', () => {
    const R = cameraRotationFromQuat(quatFromDeviceOrientation(0, 90, 0, 90));
    const e = eulerFromCameraRotation(R);
    expect(e.rollDeg).toBeCloseTo(-90, 6);
    expect(e.pitchDeg).toBeCloseTo(0, 6);
    expect(cameraAxes(R).forward.z).toBeCloseTo(-1, 9);
  });
  it('alpha turns the heading; explicit Euler rotations round-trip; the horizon pitch has the right sign', () => {
    expect(eulerFromCameraRotation(cameraRotationFromQuat(quatFromDeviceOrientation(30, 90, 0, 0))).yawDeg).toBeCloseTo(30, 6);
    const rt = eulerFromCameraRotation(cameraRotation({ yawDeg: 20, pitchDeg: -15, rollDeg: 5 }));
    expect(rt.yawDeg).toBeCloseTo(20, 6);
    expect(rt.pitchDeg).toBeCloseTo(-15, 6);
    expect(rt.rollDeg).toBeCloseTo(5, 6);
    expect(rotationAngleDeg(LEVEL, cameraRotation({ yawDeg: 25 }))).toBeCloseTo(25, 6);
    expect(pitchFromHorizon(0.5, 720, K.fy)).toBeCloseTo(0, 9);
    expect(pitchFromHorizon(0.4, 720, K.fy)).toBeLessThan(0); // horizon above the centre → looking down
    expect(DEFAULT_CAMERA_HEIGHT_M).toEqual({ phone: 1.4, laptop: 1.05, unknown: 1.4 });
    expect(mat3FromQuat(QUAT_IDENTITY)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('plane — rays, planes, projection, calibration', () => {
  it('level camera at 1.4 m: a pixel 25 % of the frame below centre hits the floor 1.4·fy/(0.25·H) ahead; above the horizon it misses', () => {
    const v = K.cy + 0.25 * K.H;
    const hit = intersectPlane(rayFromPixel(K, LEVEL, C14, K.cx, v), floorPlane());
    expect(hit).not.toBeNull();
    expect(hit!.P.y).toBeCloseTo(0, 9);
    expect(hit!.P.x).toBeCloseTo(0, 9);
    expect(-hit!.P.z).toBeCloseTo((1.4 * K.fy) / (0.25 * K.H), 6);
    expect(intersectPlane(rayFromPixel(K, LEVEL, C14, K.cx, K.cy - 10), floorPlane())).toBeNull();
    const up = intersectPlane(rayFromPixel(K, LEVEL, C14, K.cx, K.cy - 100), ceilingPlane(2.9));
    expect(up!.P.y).toBeCloseTo(2.9, 9);
  });
  it('projectToPixel inverts rayFromPixel, is null behind the camera, and a facing wall plane sits at −D', () => {
    const P = { x: 0.5, y: 0, z: -3 };
    const px = projectToPixel(K, LEVEL, C14, P)!;
    expect(px.v).toBeCloseTo(K.cy + (K.fy * 1.4) / 3, 9);
    expect(px.u).toBeCloseTo(K.cx + (K.fx * 0.5) / 3, 9);
    const back = intersectPlane(rayFromPixel(K, LEVEL, C14, px.u, px.v), floorPlane())!;
    expect(back.P.x).toBeCloseTo(0.5, 9);
    expect(back.P.z).toBeCloseTo(-3, 9);
    expect(projectToPixel(K, LEVEL, C14, { x: 0, y: 1, z: 3 })).toBeNull();
    const wall = wallPlane(wallNormalFacing(LEVEL), 2.5);
    const w = intersectPlane(rayFromPixel(K, LEVEL, C14, K.cx + 100, K.cy), wall)!;
    expect(w.P.z).toBeCloseTo(-2.5, 9);
  });
  it('door calibration, level camera: the closed form recovers h = 1.4 m and the lens FOV cancels', () => {
    const bottom = projectToPixel(KP, LEVEL, C14, { x: 0, y: 0, z: -3 })!;
    const top = projectToPixel(KP, LEVEL, C14, { x: 0, y: 2.03, z: -3 })!;
    const s = solveCameraHeight({ K: KP, R: LEVEL, taps: { bottom, top } });
    expect(s.ok).toBe(true);
    expect(s.method).toBe('closed_form');
    expect(s.h).toBeCloseTo(1.4, 6);
    const wrongLens = intrinsicsFor(720, 1280, 'phone', { fovLongDeg: 80 });
    expect(solveCameraHeight({ K: wrongLens, taps: { bottom, top } }).h).toBeCloseTo(1.4, 6);
    expect(solveCameraHeight({ K: KP, taps: { bottom: top, top: bottom } }).ok).toBe(false);
  });
  it('door calibration, camera pitched −20°: bisection recovers h = 1.4 m', () => {
    const R = cameraRotation({ pitchDeg: -20 });
    const bottom = projectToPixel(KP, R, C14, { x: 0, y: 0, z: -3 })!;
    const top = projectToPixel(KP, R, C14, { x: 0, y: 2.03, z: -3 })!;
    const s = solveCameraHeight({ K: KP, R, taps: { bottom, top } });
    expect(s.ok).toBe(true);
    expect(s.method).toBe('bisection');
    expect(s.h).toBeCloseTo(1.4, 3);
    expect(s.residualPx).toBeLessThan(0.01);
    expect(s.confidence).toBeGreaterThan(0.5);
  });
  it('a wall reference gives the wall depth: an 86 mm switch plate over 40 px', () => {
    expect(wallDistanceFromReference(K, 86, 40)).toBeCloseTo((K.fx * 0.086) / 40, 9);
    expect(wallDistanceFromReference(K, 86, 2)).toBeNull();
  });
});

describe('anchor + footprint', () => {
  const bathtub = { w_mm: 1700, h_mm: 600, d_mm: 750 };
  it('a floor tap becomes a world anchor; the bathtub footprint (padded by its 300 mm clearance) projects below the horizon, symmetric about the tap column', () => {
    const a = anchorFromPixel({ K, R: LEVEL, C: C14, u: K.cx, v: K.cy + 180, surface: 'floor' });
    if (a?.kind !== 'horizontal') throw new Error('expected a horizontal anchor');
    expect(a.P.y).toBeCloseTo(0, 9);
    const back = anchorToPixel(a, K, LEVEL, C14)!;
    expect(back.u).toBeCloseTo(K.cx, 6);
    expect(back.v).toBeCloseTo(K.cy + 180, 6);
    const corners = footprintCorners(a, bathtub, ruleFor('bathtub'))!;
    expect(corners).toHaveLength(4);
    const xs = corners.map((c) => c.x),
      zs = corners.map((c) => c.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.3, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1.35, 9);
    const poly = projectFootprint(corners, K, LEVEL, C14)!;
    expect(poly.every((p) => p.v > K.cy)).toBe(true);
    expect(poly[0].u + poly[1].u).toBeCloseTo(2 * K.cx, 6);
    const rot = footprintCorners({ ...a, yawDeg: 90 }, bathtub, ruleFor('bathtub'))!;
    const rx = rot.map((c) => c.x);
    expect(Math.max(...rx) - Math.min(...rx)).toBeCloseTo(1.35, 9);
    expect(anchorFromPixel({ K, R: LEVEL, C: C14, u: K.cx, v: K.cy - 5, surface: 'floor' })).toBeNull();
    expect(footprintCorners(screenAnchor(10, 10, 'floor'), bathtub, ruleFor('cement'))).toBeNull();
    expect(anchorToPixel(screenAnchor(10, 12, 'floor'), K, LEVEL, C14)).toEqual({ u: 10, v: 12 });
  });
  it('a wall tap becomes a vertical anchor with the normal facing the camera and a w × h footprint', () => {
    const a = anchorFromPixel({ K, R: LEVEL, C: C14, u: K.cx + 50, v: K.cy - 40, surface: 'wall', wallDistanceM: 2 });
    if (a?.kind !== 'vertical') throw new Error('expected a vertical anchor');
    expect(a.P.z).toBeCloseTo(-2, 9);
    expect(a.n.z).toBeCloseTo(1, 9);
    const corners = footprintCorners(a, { w_mm: 150, h_mm: 500, d_mm: 150 }, ruleFor('fire-extinguishers'))!;
    const ys = corners.map((c) => c.y),
      xs = corners.map((c) => c.x);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.8, 9); // 0.5 + 2 × 0.15
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.45, 9); // 0.15 + 2 × 0.15
    expect(corners.every((c) => Math.abs(c.z + 2) < 1e-9)).toBe(true);
  });
});

describe('gate hysteresis', () => {
  const ALLOW: GateResult = {
    allowed: true,
    surface: 'floor',
    reason: 'Placing on the floor',
    guidance: '',
    confidence: 0.5,
    kind: 'allow',
    sceneConfidence: 0.7,
  };
  const REFUSE: GateResult = {
    allowed: false,
    surface: null,
    reason: 'No floor is visible — I can see wall',
    guidance: 'Point at a floor to place this',
    confidence: 0.5,
    kind: 'no_surface',
    sceneConfidence: 0.7,
  };
  const run = (...vs: GateResult[]) => vs.reduce((s, v) => stepGate(s, v), initialGateState());
  it('A, A → allowed after the second allow', () => {
    const s1 = stepGate(initialGateState(), ALLOW);
    expect(s1.status).toBe('pending');
    expect(wavering(s1)).toBe(true);
    const s2 = stepGate(s1, ALLOW);
    expect(s2.status).toBe('allowed');
    expect(s2.wavering).toBe(false);
    expect(s2.published?.surface).toBe('floor');
  });
  it('A, R → still pending and wavering ("Checking…")', () => {
    const s = run(ALLOW, REFUSE);
    expect(s.status).toBe('pending');
    expect(s.wavering).toBe(true);
    expect(s.published).toBeNull();
  });
  it('A, R, R → refused after two consecutive refusals', () => {
    const s = run(ALLOW, REFUSE, REFUSE);
    expect(s.status).toBe('refused');
    expect(s.published?.guidance).toMatch(/^Point at a/);
  });
  it('a reject-scene refusal at 0.9 refuses on the first frame (the bathtub never dithers) — even from a locked allow', () => {
    const bath = gate(ruleFor('bathtub'), scene('living_room', [S('floor'), S('wall')], { sceneConfidence: 0.9 }));
    expect(bath.kind).toBe('reject_scene');
    expect(stepGate(initialGateState(), bath).status).toBe('refused');
    const flipped = stepGate(run(ALLOW, ALLOW), bath);
    expect(flipped.status).toBe('refused');
    expect(flipped.flips).toBe(1);
  });
  it('a confident allow (scene ≥ 0.8, surface ≥ 0.6) locks on the first frame; a lock survives a single refusal without flipping', () => {
    const confident = gate(ruleFor('cement'), scene('living_room', [S('floor', 0.9)], { sceneConfidence: 0.9 }));
    const s = stepGate(initialGateState(), confident);
    expect(s.status).toBe('allowed');
    const wobble = stepGate(s, REFUSE);
    expect(wobble.status).toBe('allowed');
    expect(wobble.wavering).toBe(true);
    expect(wobble.flips).toBe(0);
    const back = stepGate(wobble, confident);
    expect(back.status).toBe('allowed');
    expect(back.wavering).toBe(false);
  });
  it('a surface change needs M consecutive allows on the new surface', () => {
    const wallAllow: GateResult = { ...ALLOW, surface: 'wall' };
    const s = run(ALLOW, ALLOW, wallAllow);
    expect(s.published?.surface).toBe('floor');
    expect(stepGate(s, wallAllow).published?.surface).toBe('wall');
  });
});

describe('scene smoothing', () => {
  it('ema; surfaces merge by type with confidence/bbox EMA; new surfaces enter raw; scalars EMA', () => {
    expect(ema(0, 1, 0.5)).toBe(0.5);
    const prev = scene('living_room', [{ type: 'floor', confidence: 0.8, bbox: [0, 0.6, 1, 0.4] }, S('wall', 0.6)]);
    const next = scene('living_room', [{ type: 'floor', confidence: 0.4, bbox: [0, 0.5, 1, 0.5] }, S('ceiling', 0.7)], { horizonY: 0.55, freeArea: 0.2 });
    const s = smoothScene(prev, next);
    const floor = s.surfaces.find((x) => x.type === 'floor')!;
    expect(floor.confidence).toBeCloseTo(0.6, 9);
    expect(floor.bbox).toEqual([0, 0.55, 1, 0.45]);
    expect(s.surfaces.find((x) => x.type === 'ceiling')?.confidence).toBe(0.7);
    expect(s.horizonY).toBeCloseTo(0.5, 9);
    expect(s.freeArea).toBeCloseTo(0.4, 9);
    expect(s.surfaces[0].confidence).toBeGreaterThanOrEqual(s.surfaces[1].confidence);
  });
  it('missing surfaces decay ×0.6 per frame and drop below 0.2', () => {
    const prev = scene('living_room', [S('floor', 0.8), S('wall', 0.6)]);
    const next = scene('living_room', [S('floor', 0.8)]);
    const s1 = smoothScene(prev, next);
    expect(s1.surfaces.find((x) => x.type === 'wall')?.confidence).toBeCloseTo(0.36, 9);
    const s2 = smoothScene(s1, next);
    expect(s2.surfaces.find((x) => x.type === 'wall')?.confidence).toBeCloseTo(0.216, 9);
    const s3 = smoothScene(s2, next);
    expect(s3.surfaces.find((x) => x.type === 'wall')).toBeUndefined();
  });
  it('scene type is the majority of the last 3 analyses, ties → the latest; references merge by kind', () => {
    let s = smoothScene(null, scene('living_room', []));
    s = smoothScene(s, scene('bathroom', []));
    expect(s.sceneType).toBe('bathroom');
    s = smoothScene(s, scene('living_room', []));
    expect(s.sceneType).toBe('living_room');
    s = smoothScene(s, scene('bathroom', [], { references: [{ kind: 'door', realMm: 2030, px: 400, confidence: 0.8 }] }));
    s = smoothScene(s, scene('bathroom', [], { references: [{ kind: 'door', realMm: 2030, px: 300, confidence: 0.6 }] }));
    expect(s.sceneType).toBe('bathroom');
    expect(s.sceneHistory).toEqual(['living_room', 'bathroom', 'bathroom']);
    expect(s.references[0].px).toBeCloseTo(350, 9);
    expect(s.references[0].confidence).toBeCloseTo(0.7, 9);
  });
});

describe('fit verdict', () => {
  const bathtub = { w_mm: 1700, h_mm: 600, d_mm: 750 };
  const inside = [
    { u: 400, v: 500 },
    { u: 800, v: 500 },
    { u: 800, v: 650 },
    { u: 400, v: 650 },
  ];
  it('a bathtub on 2 × 2 m of clear bathroom floor fits', () => {
    const v = fitVerdict({
      dims: bathtub,
      rule: ruleFor('bathtub'),
      cornersPx: inside,
      surfaceBbox: [0, 0.6, 1, 0.4],
      frameW: 1280,
      frameH: 720,
      freeAreaM2: 4,
    });
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(true);
    expect(v.needs).toEqual({ wM: 1.7, dM: 0.75 });
  });
  it('on 1 × 1 m it fails with the exact chip text', () => {
    const v = fitVerdict({
      dims: bathtub,
      rule: ruleFor('bathtub'),
      cornersPx: inside,
      surfaceBbox: [0, 0.6, 1, 0.4],
      frameW: 1280,
      frameH: 720,
      freeAreaM2: 1,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('Not enough clear floor here (needs 1.7 m × 0.75 m) — step back');
  });
  it('corners outside the surface bbox fail; the wall variant names the wall and w × h; no geometry → unchecked', () => {
    const v = fitVerdict({
      dims: bathtub,
      rule: ruleFor('bathtub'),
      cornersPx: [...inside, { u: 1300, v: 700 }],
      surfaceBbox: [0, 0.6, 1, 0.4],
      frameW: 1280,
      frameH: 720,
    });
    expect(v.ok).toBe(false);
    const w = fitVerdict({
      dims: { w_mm: 150, h_mm: 500, d_mm: 150 },
      rule: ruleFor('fire-extinguishers'),
      surface: 'wall',
      cornersPx: inside,
      surfaceBbox: [0, 0, 1, 1],
      frameW: 1280,
      frameH: 720,
      freeAreaM2: 0.05,
    });
    expect(w.reason).toBe('Not enough clear wall here (needs 0.15 m × 0.5 m) — step back');
    const unchecked = fitVerdict({ dims: bathtub, rule: ruleFor('bathtub'), cornersPx: null, frameW: 1280, frameH: 720 });
    expect(unchecked.ok).toBe(true);
    expect(unchecked.checked).toBe(false);
  });
  it('visibleSurfaceAreaM2: the floor band seen by a level camera at 1.4 m is a plausible trapezoid', () => {
    const area = visibleSurfaceAreaM2({ K, R: LEVEL, C: C14, plane: floorPlane(), bbox: [0, 0.6, 1, 0.4], frameW: 1280, frameH: 720 });
    expect(area).toBeGreaterThan(5);
    expect(area).toBeLessThan(200);
  });
});

/** A smooth, everywhere-textured synthetic frame; `shift` moves the content by (sx, sy) px. */
function texture(sx = 0, sy = 0): Uint8Array {
  const out = new Uint8Array(LK_WIDTH * LK_HEIGHT);
  for (let y = 0; y < LK_HEIGHT; y++) {
    for (let x = 0; x < LK_WIDTH; x++) {
      const X = x - sx,
        Y = y - sy;
      const v = 128 + 40 * Math.sin(X / 3.1 + Y / 7.3) + 30 * Math.cos(Y / 2.9 - X / 8.7) + 25 * Math.sin((X + Y) / 5.3) + 20 * Math.cos((X - 2 * Y) / 11);
      out[y * LK_WIDTH + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

describe('optical flow — pyramidal Lucas–Kanade', () => {
  it('recovers a synthetic (3, −2) px shift within 0.5 px with high confidence', () => {
    const f = lkTranslation(texture(), texture(3, -2));
    expect(Math.abs(f.dx - 3)).toBeLessThan(0.5);
    expect(Math.abs(f.dy + 2)).toBeLessThan(0.5);
    expect(f.confidence).toBeGreaterThan(0.6);
    expect(f.windows).toBeGreaterThan(20);
  });
  it('identical frames → zero flow at full confidence; a flat frame → zero confidence', () => {
    const f = lkTranslation(texture(), texture());
    expect(Math.abs(f.dx)).toBeLessThan(0.01);
    expect(Math.abs(f.dy)).toBeLessThan(0.01);
    expect(f.confidence).toBeGreaterThan(0.9);
    const flat = new Uint8Array(LK_WIDTH * LK_HEIGHT).fill(90);
    expect(lkTranslation(flat, flat).confidence).toBe(0);
  });
});

describe('call budget', () => {
  it('dedupes in-flight calls, enforces the 2.5 s interval, caps the session at 40 and resumes', () => {
    let t = 0;
    const b = new CallBudget({ now: () => t });
    const first = b.begin('start');
    expect(first).not.toBeNull();
    expect(b.begin('timer')).toBeNull();
    expect(b.check()).toBe('in_flight');
    t = 1000;
    b.end(first!);
    expect(b.check()).toBe('too_soon');
    expect(b.begin()).toBeNull();
    expect(b.nextAllowedAt()).toBe(2500);
    t = 2500;
    const second = b.begin('motion');
    expect(second).not.toBeNull();
    b.end(second!);
    for (let i = 2; i < 40; i++) {
      t += 2500;
      const k = b.begin();
      expect(k).not.toBeNull();
      b.end(k!);
    }
    t += 2500;
    expect(b.check()).toBe('exhausted');
    expect(b.exhausted).toBe(true);
    expect(b.remaining).toBe(0);
    expect(b.begin()).toBeNull();
    b.resume(5);
    expect(b.remaining).toBe(5);
    const again = b.begin('manual');
    expect(again).not.toBeNull();
    b.end(again!);
    expect(b.snapshot().calls).toBe(41);
  });
  it('the motion trigger fires on ≥ 15° rotation or ≥ 20 % flow, only when the budget allows a call', () => {
    let t = 0;
    const b = new CallBudget({ now: () => t });
    expect(b.motion({ rotationDeg: 20 })).toBe(true);
    const k = b.begin('motion')!;
    expect(b.motion({ rotationDeg: 40 })).toBe(false);
    b.end(k);
    t = 3000;
    expect(b.motion({ rotationDeg: 5, flowFrac: 0.1 })).toBe(false);
    expect(b.motion({ flowFrac: 0.25 })).toBe(true);
  });
});

describe('tracking state machine', () => {
  it('phone: sensor silence > 400 ms → lost (model at 35 %, "Hold steady"); a sample recovers; 2 s without recovery unlocks', () => {
    let t = 0;
    const tr = createTracker({ now: () => t, deviceClass: 'phone' });
    tr.sensor();
    tr.lock();
    expect(tr.state.status).toBe('tracking');
    expect(tr.state.modelOpacity).toBe(1);
    t = 300;
    tr.sensor();
    t = 650;
    expect(tr.tick().status).toBe('tracking');
    t = 800;
    const lost = tr.tick();
    expect(lost.status).toBe('lost');
    expect(lost.reason).toBe('sensor_silence');
    expect(lost.modelOpacity).toBe(0.35);
    expect(lost.hint).toBe('Hold steady');
    t = 1500;
    expect(tr.sensor().status).toBe('tracking');
    t = 2000;
    expect(tr.tick().status).toBe('lost');
    t = 3999;
    expect(tr.tick().status).toBe('lost');
    t = 4000;
    expect(tr.tick().status).toBe('acquiring');
    expect(tr.state.modelOpacity).toBe(0);
    expect(tr.state.hint).toBeNull();
  });
  it('flow residual > 6 px sustained for 0.5 s → lost; a low residual recovers', () => {
    let t = 0;
    const tr = createTracker({ now: () => t });
    tr.sensor();
    tr.lock();
    for (t = 100; t <= 500; t += 100) {
      tr.sensor();
      expect(tr.flow(0, 0, 8).status).toBe('tracking');
    }
    t = 600;
    tr.sensor();
    expect(tr.flow(0, 0, 8).status).toBe('lost');
    expect(tr.state.reason).toBe('flow_residual');
    t = 700;
    tr.sensor();
    expect(tr.flow(0, 0, 2).status).toBe('tracking');
  });
  it('laptop (no sensors): an accumulated shift > 12 % of the frame → lost, never sensor silence; the pure reducer agrees', () => {
    let t = 0;
    const tr = createTracker({ now: () => t, deviceClass: 'laptop', frameW: 160 });
    tr.lock();
    t = 5000;
    expect(tr.tick().status).toBe('tracking');
    expect(tr.flow(10, 0).status).toBe('tracking');
    expect(tr.flow(10, 0).status).toBe('lost');
    expect(tr.state.reason).toBe('shift');
    expect(tr.flow(-10, 0).status).toBe('tracking');
    const pure = stepTracking(initialTrackingState(0), { type: 'lock', at: 0 });
    expect(pure.status).toBe('tracking');
    expect(pure.locks).toBe(1);
    expect(TRACKING_THRESHOLDS).toEqual({ sensorSilenceMs: 400, residualPx: 6, residualHoldMs: 500, shiftFrac: 0.12, unlockMs: 2000, lostOpacity: 0.35 });
  });
});

describe('tier detection', () => {
  const laptopNav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error('test')) },
  } as unknown as Navigator;
  const iphoneNav = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error('test')) },
  } as unknown as Navigator;
  it('laptop webcam in a secure context → C; iPhone → C with Quick Look still available; no camera → P; http → P', async () => {
    const lap = await detectTier(laptopNav, { secureContext: true, search: '' });
    expect(lap.tier).toBe('C');
    expect(lap.deviceClass).toBe('laptop');
    expect(lap.orientationSensors).toBe(false);
    expect(lap.override).toBeNull();
    const ip = await detectTier(iphoneNav, { secureContext: true, search: '', orientationSensors: true });
    expect(ip.tier).toBe('C');
    expect(ip.quickLook).toBe(true);
    expect(ip.deviceClass).toBe('phone');
    const noCam = await detectTier({ ...laptopNav, mediaDevices: undefined } as unknown as Navigator, { secureContext: true, search: '' });
    expect(noCam.tier).toBe('P');
    expect(noCam.reason).toBe('Photo mode with upload');
    const http = await detectTier(laptopNav, { secureContext: false, search: '' });
    expect(http.tier).toBe('P');
    expect(http.camera).toBe(true);
    expect(http.secureContext).toBe(false);
  });
  it('?tier= forces a tier for device testing; the server returns P with every field present; iPadOS desktop UA is a phone', async () => {
    const forced = await detectTier(laptopNav, { secureContext: true, search: '?tier=p' });
    expect(forced.tier).toBe('P');
    expect(forced.override).toBe('P');
    expect(forced.camera).toBe(true);
    expect(tierOverrideFrom('?tier=X')).toBeNull();
    expect(tierOverrideFrom('?a=1&tier=C')).toBe('C');
    const server = await detectTier(null);
    expect(server).toEqual({
      tier: 'P',
      webxr: false,
      quickLook: false,
      camera: false,
      reason: 'server',
      orientationSensors: false,
      secureContext: false,
      deviceClass: 'unknown',
      override: null,
    });
    expect(deviceClassFor({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('phone');
    // 0.4.0 added the surface guide: matchSurface / surfacePrompt / defaultDropPoint, which
    // is what made live AR work for every category rather than only for a bulb on a wall.
    // 0.6.0 measures wall distance from the floor line (vision/depth.ts) instead of assuming 2.2 m.
    expect(AR_ENGINE_VERSION).toBe('0.6.0');
  });
});
