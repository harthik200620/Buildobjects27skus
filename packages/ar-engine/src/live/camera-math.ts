import type { DeviceClass } from '../types';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/**
 * Pinhole intrinsics of the live video frame.
 *
 * Conventions: pixel origin at the top-left of the VIDEO frame (not the CSS stage — the web
 * layer's coverMap converts), u to the right, v down, in video pixels. The lens is modelled
 * with a field of view across the LONG side of the frame (phone main cameras ≈ 66°, laptop
 * webcams ≈ 70°); the short side follows from the aspect ratio. Square pixels (fx = fy) and a
 * centred principal point. A lens slider (50–80°, persisted by the web layer) overrides the
 * long-side FOV.
 */
export interface Intrinsics {
  /** Frame size in video pixels. */
  W: number;
  H: number;
  /** Focal lengths in pixels (square pixels: fx = fy). */
  fx: number;
  fy: number;
  /** Principal point — the frame centre. */
  cx: number;
  cy: number;
  fovXDeg: number;
  fovYDeg: number;
  /** The FOV across the long side that produced these intrinsics. */
  fovLongDeg: number;
  deviceClass: DeviceClass;
  source: 'default' | 'override';
}

export const DEFAULT_FOV_LONG_DEG: Record<DeviceClass, number> = { phone: 66, laptop: 70, unknown: 66 };
const FOV_HARD_CLAMP: readonly [number, number] = [30, 120];

/** `fovShort = 2·atan(tan(fovLong/2)·short/long)`, `fy = (H/2)/tan(fovY/2)`, `fx = fy`, `cx = W/2`, `cy = H/2`. */
export function intrinsicsFor(W: number, H: number, deviceClass: DeviceClass = 'unknown', override?: { fovLongDeg?: number | null } | null): Intrinsics {
  const o = override?.fovLongDeg;
  const hasOverride = typeof o === 'number' && Number.isFinite(o) && o > 0;
  const fovLongDeg = Math.min(FOV_HARD_CLAMP[1], Math.max(FOV_HARD_CLAMP[0], hasOverride ? o : DEFAULT_FOV_LONG_DEG[deviceClass]));
  const long = Math.max(W, H),
    short = Math.min(W, H);
  const fovShortDeg = 2 * Math.atan(Math.tan((fovLongDeg / 2) * DEG) * (short / long)) * RAD;
  const landscape = W >= H;
  const fovXDeg = landscape ? fovLongDeg : fovShortDeg;
  const fovYDeg = landscape ? fovShortDeg : fovLongDeg;
  const fy = H / 2 / Math.tan((fovYDeg / 2) * DEG);
  return { W, H, fx: fy, fy, cx: W / 2, cy: H / 2, fovXDeg, fovYDeg, fovLongDeg, deviceClass, source: hasOverride ? 'override' : 'default' };
}

/** Intrinsics of a resampled copy of the frame (the ≤ 768-px analysis JPEG, the 160×120 flow frame). Non-uniform resampling makes fx ≠ fy, which is correct for that copy. */
export function scaleIntrinsics(K: Intrinsics, newW: number, newH: number): Intrinsics {
  const sx = newW / K.W,
    sy = newH / K.H;
  return { ...K, W: newW, H: newH, fx: K.fx * sx, fy: K.fy * sy, cx: K.cx * sx, cy: K.cy * sy };
}
