import { REFERENCE_MM } from '../scale';
import type { Intrinsics } from './camera-math';
import { add, cameraAxes, dot, eulerFromCameraRotation, type Mat3, mat3MulVec, mat3TMulVec, normalize, scale, sub, UP, type Vec3, v3 } from './pose';

/**
 * Ray / plane geometry in the metric world frame (see pose.ts for the conventions): the floor is
 * y = 0, the camera is at C = (0, h, 0), R is the pinhole camera-to-world rotation. Pixels are
 * video pixels with the origin top-left.
 */
export type PixelIntrinsics = Pick<Intrinsics, 'fx' | 'fy' | 'cx' | 'cy'>;
export interface Pixel {
  u: number;
  v: number;
}
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}
/** The points X with dot(n, X) = d; n is a unit normal facing the camera's side of the plane. */
export interface Plane {
  n: Vec3;
  d: number;
}
export interface PlaneHit {
  P: Vec3;
  t: number;
}

/** The world-space ray through video pixel (u, v): d_cam = ((u − cx)/fx, (v − cy)/fy, 1), d_world = R · d_cam. */
export function rayFromPixel(K: PixelIntrinsics, R: Mat3, C: Vec3, u: number, v: number): Ray {
  const dCam = v3((u - K.cx) / K.fx, (v - K.cy) / K.fy, 1);
  return { origin: C, dir: normalize(mat3MulVec(R, dCam)) };
}

/** Ray–plane intersection, forward hits only (t > 0). */
export function intersectPlane(ray: Ray, plane: Plane, eps = 1e-9): PlaneHit | null {
  const denom = dot(plane.n, ray.dir);
  if (Math.abs(denom) < eps) return null;
  const t = (plane.d - dot(plane.n, ray.origin)) / denom;
  if (!(t > eps)) return null;
  return { P: add(ray.origin, scale(ray.dir, t)), t };
}

/** The horizontal plane y = heightM (0 = the floor; a table top sits at its height). Normal faces up. */
export const floorPlane = (heightM = 0): Plane => ({ n: UP, d: heightM });

/** The ceiling at height hCeil, normal facing down toward the camera. */
export const ceilingPlane = (hCeil: number): Plane => ({ n: v3(0, -1, 0), d: -hCeil });

/**
 * A vertical wall D metres from the camera's vertical axis, with the horizontal unit normal n
 * pointing from the wall back toward the camera (so the wall sits in the −n direction). With the
 * camera on the axis at (0, h, 0) this is dot(n, X) = −D.
 */
export function wallPlane(n: Vec3, D: number): Plane {
  const nn = normalize(v3(n.x, 0, n.z));
  return { n: nn.x === 0 && nn.z === 0 ? v3(0, 0, 1) : nn, d: -D };
}

/** The horizontal unit normal of a wall squarely facing the camera (opposite the camera's heading). */
export function wallNormalFacing(R: Mat3): Vec3 {
  const f = cameraAxes(R).forward;
  const h = normalize(v3(f.x, 0, f.z));
  return h.x === 0 && h.z === 0 ? v3(0, 0, 1) : scale(h, -1);
}

/** World point → video pixel; null when the point is behind the camera. */
export function projectToPixel(K: PixelIntrinsics, R: Mat3, C: Vec3, P: Vec3): Pixel | null {
  const p = mat3TMulVec(R, sub(P, C));
  if (!(p.z > 1e-9)) return null;
  return { u: (K.fx * p.x) / p.z + K.cx, v: (K.fy * p.y) / p.z + K.cy };
}

/** Depth of a wall-mounted reference of known size (switch plate 86 mm, A4 297 mm): D = fx · realM / px. Null when the pixel extent is too small to trust. */
export function wallDistanceFromReference(K: PixelIntrinsics, realMm: number, px: number): number | null {
  if (!(px > 4) || !(realMm > 0)) return null;
  return (K.fx * (realMm / 1000)) / px;
}

export const CAMERA_HEIGHT_RANGE_M: readonly [number, number] = [0.3, 3];
const LEVEL_TOLERANCE_DEG = 0.5;

export interface CameraHeightInput {
  K: PixelIntrinsics;
  /** The camera rotation at the time of the taps; omit (or pass a level rotation) for the closed form. */
  R?: Mat3 | null;
  /** The two calibration taps in video pixels: the bottom of the door (on the floor) and its top. */
  taps: { bottom: Pixel; top: Pixel };
  /** The reference's real height in mm — a door by default (2030). */
  realMm?: number;
  /** Plausible camera heights to search, metres. */
  range?: readonly [number, number];
}

export interface CameraHeightSolution {
  ok: boolean;
  /** Camera height above the floor in metres, null when the taps cannot be solved. */
  h: number | null;
  method: 'closed_form' | 'bisection';
  /** Vertical re-projection error of the top tap at the solved height, px (0 for the closed form). */
  residualPx: number;
  /** 0–1; scales with the door's pixel span (≥ 120 px is full) and the residual. */
  confidence: number;
  note: string;
}

/**
 * Camera height from two taps on a door of known height that stands on the floor.
 * Level camera (pitch and roll within 0.5°): the closed form h = realM·(v_b − cy)/(v_b − v_t) —
 * the focal length cancels, so this is immune to a wrong lens FOV. Pitched camera: bisection on
 * h ∈ range of f(h) = v_top_predicted(h) − v_t, where the bottom tap's ray meets the floor at a
 * distance proportional to h and the door top sits realM above that point.
 */
export function solveCameraHeight(input: CameraHeightInput): CameraHeightSolution {
  const { K } = input;
  const realMm = input.realMm ?? REFERENCE_MM.door;
  const realM = realMm / 1000;
  const { bottom, top } = input.taps;
  const [lo, hi] = input.range ?? CAMERA_HEIGHT_RANGE_M;
  const spanPx = bottom.v - top.v;
  const spanConf = Math.min(1, Math.max(0, spanPx / 120));
  const fail = (method: CameraHeightSolution['method'], note: string): CameraHeightSolution => ({
    ok: false,
    h: null,
    method,
    residualPx: Number.NaN,
    confidence: 0,
    note,
  });
  if (!(spanPx > 4)) return fail('closed_form', 'Tap the bottom of the door first, then its top');

  const R = input.R ?? null;
  let level = true;
  if (R) {
    const e = eulerFromCameraRotation(R);
    level = Math.abs(e.pitchDeg) <= LEVEL_TOLERANCE_DEG && Math.abs(e.rollDeg) <= LEVEL_TOLERANCE_DEG;
  }

  if (level) {
    const num = bottom.v - K.cy;
    if (!(num > 0)) return fail('closed_form', 'The door bottom must be below the centre of the frame — tilt down a little');
    const h = (realM * num) / spanPx;
    if (h < lo || h > hi)
      return {
        ok: false,
        h,
        method: 'closed_form',
        residualPx: 0,
        confidence: 0,
        note: `Implausible camera height ${h.toFixed(2)} m — tap the very bottom and top of the door`,
      };
    return {
      ok: true,
      h,
      method: 'closed_form',
      residualPx: 0,
      confidence: 0.85 * spanConf,
      note: `Height ${h.toFixed(2)} m from a ${realMm} mm door (level camera)`,
    };
  }

  const Rm = R as Mat3;
  const f = (h: number): number | null => {
    const C = v3(0, h, 0);
    const hit = intersectPlane(rayFromPixel(K, Rm, C, bottom.u, bottom.v), floorPlane());
    if (!hit) return null;
    const px = projectToPixel(K, Rm, C, add(hit.P, v3(0, realM, 0)));
    return px ? px.v - top.v : null;
  };
  let flo = f(lo),
    fhi = f(hi);
  if (flo === null || fhi === null) return fail('bisection', 'The door bottom must be below the horizon — tap where the door meets the floor');
  let a = lo,
    b = hi;
  if (flo * fhi > 0) {
    // No sign change across the whole range: scan for a bracket, else take the best sample.
    const N = 64;
    let bestH = lo,
      bestAbs = Math.abs(flo),
      prevH = lo,
      prevF = flo,
      bracketed = false;
    for (let i = 1; i <= N; i++) {
      const h = lo + ((hi - lo) * i) / N;
      const fh = f(h);
      if (fh === null) continue;
      if (Math.abs(fh) < bestAbs) {
        bestAbs = Math.abs(fh);
        bestH = h;
      }
      if (prevF * fh <= 0) {
        a = prevH;
        b = h;
        flo = prevF;
        fhi = fh;
        bracketed = true;
        break;
      }
      prevH = h;
      prevF = fh;
    }
    if (!bracketed) {
      const ok = bestAbs <= 4;
      return {
        ok,
        h: ok ? bestH : null,
        method: 'bisection',
        residualPx: bestAbs,
        confidence: ok ? 0.3 * spanConf : 0,
        note: ok
          ? `Height ${bestH.toFixed(2)} m from a ${realMm} mm door (best fit, ${bestAbs.toFixed(1)} px off)`
          : 'Those taps do not fit a door standing on the floor — try again',
      };
    }
  }
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === null) break;
    if (flo * fm <= 0) {
      b = m;
      fhi = fm;
    } else {
      a = m;
      flo = fm;
    }
    if (b - a < 1e-9) break;
  }
  const h = (a + b) / 2;
  const residual = Math.abs(f(h) ?? Number.NaN);
  const resConf = Number.isFinite(residual) ? (residual <= 0.5 ? 1 : Math.max(0.3, 1 - residual / 20)) : 0;
  return {
    ok: Number.isFinite(residual),
    h,
    method: 'bisection',
    residualPx: residual,
    confidence: 0.85 * spanConf * resConf,
    note: `Height ${h.toFixed(2)} m from a ${realMm} mm door (pitched camera)`,
  };
}
