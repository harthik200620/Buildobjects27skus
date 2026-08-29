import type { DeviceClass } from '../types';
import { DEG, RAD } from './camera-math';

/**
 * Minimal vector / quaternion / 3×3 matrix helpers (no three.js) and the device-orientation
 * pose model.
 *
 * Frames (metres, right-handed):
 *  - World: Y up, the floor is y = 0, the camera stands at C = (0, h, 0). 3DoF — the user
 *    rotates, does not walk. With alpha = 0 an upright phone looks along −Z, +X is to its right.
 *    This is exactly three.js's frame for `DeviceOrientationControls`, so the quaternion from
 *    `quatFromDeviceOrientation` can be handed to a three.js camera unchanged.
 *  - three.js camera local frame: X right, Y up, looks along −Z.
 *  - Pinhole camera frame (what `plane.ts` uses): X right, Y DOWN, Z forward — the computer-vision
 *    convention, so that (u, v) = (fx·X/Z + cx, fy·Y/Z + cy) with v increasing downwards.
 *    `cameraRotationFromQuat` converts the three.js quaternion into the pinhole camera-to-world
 *    rotation R (world = R · cam + C); `R` is the only rotation `plane.ts` / `anchor.ts` consume.
 *
 * Euler angles (degrees): yaw about world Y (positive = turning left / counter-clockwise from
 * above), pitch positive = looking up, roll = atan2(right.y, up.y) (positive = the camera's right
 * vector tilts upward). An upright phone with a screen rotation of θ has roll = −θ.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
/** Row-major 3×3: m[row * 3 + col]. Column j is the world direction of local axis j. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
export const UP: Vec3 = { x: 0, y: 1, z: 0 };
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
}

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** a ⊗ b — three.js `multiplyQuaternions` order (apply b first, then a). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const h = angleRad / 2,
    s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

/** three.js `Euler(x, y, z, 'YXZ')` → quaternion, i.e. the rotation Ry(y) · Rx(x) · Rz(z). */
export function quatFromEulerYXZ(xRad: number, yRad: number, zRad: number): Quat {
  const c1 = Math.cos(xRad / 2),
    c2 = Math.cos(yRad / 2),
    c3 = Math.cos(zRad / 2);
  const s1 = Math.sin(xRad / 2),
    s2 = Math.sin(yRad / 2),
    s3 = Math.sin(zRad / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

const Q_MINUS_HALF_PI_X: Quat = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * The W3C DeviceOrientation → camera quaternion, as three.js's `DeviceOrientationControls`:
 * `Euler(beta, alpha, −gamma, 'YXZ') · q_x(−π/2) · q_z(−screenAngle)`. alpha/beta/gamma in
 * degrees straight from the event, screenAngle = `screen.orientation.angle` (0 / 90 / 180 / 270).
 * Result: the three.js camera orientation (local −Z forward, Y up) in the Y-up world frame.
 */
export function quatFromDeviceOrientation(alphaDeg: number, betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Quat {
  const e = quatFromEulerYXZ(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG);
  return quatNormalize(quatMultiply(quatMultiply(e, Q_MINUS_HALF_PI_X), quatFromAxisAngle(Z_AXIS, -screenAngleDeg * DEG)));
}

/** Rotation matrix of a unit quaternion (row-major; column j = world direction of local axis j). */
export function mat3FromQuat(q: Quat): Mat3 {
  const { x, y, z, w } = q;
  const xx = x * x,
    yy = y * y,
    zz = z * z,
    xy = x * y,
    xz = x * z,
    yz = y * z,
    wx = w * x,
    wy = w * y,
    wz = w * z;
  return [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r as unknown as Mat3;
}

/** m · v */
export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
}

/** mᵀ · v — for a rotation, the inverse transform. */
export function mat3TMulVec(m: Mat3, v: Vec3): Vec3 {
  return { x: m[0] * v.x + m[3] * v.y + m[6] * v.z, y: m[1] * v.x + m[4] * v.y + m[7] * v.z, z: m[2] * v.x + m[5] * v.y + m[8] * v.z };
}

export const mat3Col = (m: Mat3, j: 0 | 1 | 2): Vec3 => ({ x: m[j], y: m[3 + j], z: m[6 + j] });

/** three.js local (X right, Y up, −Z forward) → pinhole (X right, Y down, Z forward): a half-turn about X. */
const FLIP_YZ: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** The pinhole camera-to-world rotation R for a three.js camera quaternion (world = R · cam + C). */
export const cameraRotationFromQuat = (q: Quat): Mat3 => mat3Mul(mat3FromQuat(q), FLIP_YZ);

/** The pinhole camera-to-world rotation for explicit Euler angles (degrees) — laptops (pitch from the horizon) and tests. */
export function cameraRotation(e: { yawDeg?: number; pitchDeg?: number; rollDeg?: number } = {}): Mat3 {
  return cameraRotationFromQuat(quatFromEulerYXZ((e.pitchDeg ?? 0) * DEG, (e.yawDeg ?? 0) * DEG, (e.rollDeg ?? 0) * DEG));
}

/** World-frame unit vectors of the pinhole camera's right / up / forward axes. */
export function cameraAxes(R: Mat3): { right: Vec3; up: Vec3; forward: Vec3 } {
  return { right: mat3Col(R, 0), up: scale(mat3Col(R, 1), -1), forward: mat3Col(R, 2) };
}

/** Euler angles (degrees) of a pinhole camera rotation — see the frame conventions above. */
export function eulerFromCameraRotation(R: Mat3): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  const { right, up, forward } = cameraAxes(R);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
  const yaw = Math.atan2(-forward.x, -forward.z);
  const roll = Math.atan2(right.y, up.y);
  return { yawDeg: yaw * RAD, pitchDeg: pitch * RAD, rollDeg: roll * RAD };
}

/** Angle (degrees) between two camera rotations — the motion trigger's "rotation since the last call". */
export function rotationAngleDeg(a: Mat3, b: Mat3): number {
  const fa = cameraAxes(a).forward,
    fb = cameraAxes(b).forward;
  const ua = cameraAxes(a).up,
    ub = cameraAxes(b).up;
  const c = Math.max(-1, Math.min(1, dot(fa, fb)));
  const cu = Math.max(-1, Math.min(1, dot(ua, ub)));
  return Math.max(Math.acos(c), Math.acos(cu)) * RAD;
}

/**
 * Laptop pose: no sensors, so the pitch comes from the smoothed horizon line. `horizonY` is the
 * analysis's normalised eye-level row (0 top … 1 bottom): a horizon above the centre means the
 * camera looks down. Returns degrees (negative = looking down).
 */
export function pitchFromHorizon(horizonY: number, H: number, fy: number): number {
  const dv = horizonY * H - H / 2;
  return Math.atan2(dv, fy) * RAD;
}

/** Typical camera heights (metres) when no door calibration has happened: a phone held in the hand, a laptop on a desk. */
export const DEFAULT_CAMERA_HEIGHT_M: Record<DeviceClass, number> = { phone: 1.4, laptop: 1.05, unknown: 1.4 };

/** The camera position in the world frame — on the vertical axis at height h. */
export const cameraPosition = (heightM: number): Vec3 => ({ x: 0, y: heightM, z: 0 });
