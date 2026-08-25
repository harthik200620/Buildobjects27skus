import { SURFACE_LABEL } from '../placement';
import type { PlacementRule, ProductDims, SceneAnalysis, Surface } from '../types';
import { isVerticalSurface } from './anchor';
import { intersectPlane, type Pixel, type PixelIntrinsics, type Plane, rayFromPixel } from './plane';
import { add, cross, dot, type Mat3, normalize, scale, sub, UP, type Vec3 } from './pose';

/** The footprint must fit inside `freeArea / FIT_AREA_FACTOR` — the 30 % is walking clearance. */
export const FIT_AREA_FACTOR = 1.3;

type Bbox = [number, number, number, number];

export interface FitInput {
  dims: ProductDims;
  rule: PlacementRule;
  /** The surface being placed on; defaults to the rule's first surface. */
  surface?: Surface;
  /** The projected footprint polygon in video pixels (from `projectFootprint`); null for screen anchors. */
  cornersPx: Pixel[] | null;
  /** The surface's visible region as the analysis reports it, normalised [x, y, w, h]; the whole frame when omitted. */
  surfaceBbox?: Bbox | null;
  frameW: number;
  frameH: number;
  /** Clear area on the surface in m² (see `freeAreaM2`); skipped when unknown. */
  freeAreaM2?: number | null;
  /** Slack for corners just outside the bbox, px; default 2 % of the frame's short side. */
  tolerancePx?: number;
}

export interface FitVerdict {
  ok: boolean;
  /** False when neither corners nor an area were available — the verdict is then a non-verdict. */
  checked: boolean;
  reason: string;
  /** The bare product footprint in metres (w × d on horizontal surfaces, w × h on walls) — what the "needs W × D" chip shows. */
  needs: { wM: number; dM: number };
  surface: Surface;
}

const fmtM = (m: number): string => {
  const r = Math.round(m * 100) / 100;
  return String(r);
};

/** "Not enough clear floor here (needs 1.7 m × 0.75 m) — step back" — the exact chip text. */
export function fitFailureReason(surface: Surface, needs: { wM: number; dM: number }): string {
  return `Not enough clear ${SURFACE_LABEL[surface]} here (needs ${fmtM(needs.wM)} m × ${fmtM(needs.dM)} m) — step back`;
}

/**
 * Does the product fit where it is anchored? Two checks, each applied when its input is known:
 * every footprint corner lies inside the surface's visible bbox (with a little tolerance), and
 * `footprint × 1.3 ≤ freeArea m²`. Either failure yields the "step back" reason.
 */
export function fitVerdict(input: FitInput): FitVerdict {
  const surface = input.surface ?? input.rule.surfaces[0] ?? 'floor';
  const vertical = isVerticalSurface(surface);
  const wM = input.dims.w_mm / 1000;
  const dM = (vertical ? input.dims.h_mm : input.dims.d_mm) / 1000;
  const needs = { wM, dM };
  const failReason = fitFailureReason(surface, needs);
  let checked = false;

  if (input.cornersPx && input.cornersPx.length > 0) {
    checked = true;
    const [bx, by, bw, bh] = input.surfaceBbox ?? [0, 0, 1, 1];
    const tol = input.tolerancePx ?? 0.02 * Math.min(input.frameW, input.frameH);
    const x0 = bx * input.frameW - tol,
      x1 = (bx + bw) * input.frameW + tol;
    const y0 = by * input.frameH - tol,
      y1 = (by + bh) * input.frameH + tol;
    const inside = input.cornersPx.every((c) => c.u >= x0 && c.u <= x1 && c.v >= y0 && c.v <= y1);
    if (!inside) return { ok: false, checked, reason: failReason, needs, surface };
  }
  if (typeof input.freeAreaM2 === 'number' && Number.isFinite(input.freeAreaM2)) {
    checked = true;
    if (wM * dM * FIT_AREA_FACTOR > input.freeAreaM2) return { ok: false, checked, reason: failReason, needs, surface };
  }
  return { ok: true, checked, reason: checked ? `Fits on the ${SURFACE_LABEL[surface]}` : 'Fit not checked — no surface geometry yet', needs, surface };
}

export interface SurfaceAreaInput {
  K: PixelIntrinsics;
  R: Mat3;
  C: Vec3;
  plane: Plane;
  /** The surface's visible region, normalised [x, y, w, h]. */
  bbox: Bbox;
  frameW: number;
  frameH: number;
  /** Rays that miss the plane or hit beyond this range are clamped to it (metres). */
  maxRangeM?: number;
}

/**
 * Approximate visible area of a surface in m²: the bbox's four corner rays are cast onto the
 * plane (rays that miss — e.g. a floor bbox reaching above the horizon — are clamped to
 * `maxRangeM` along the ray and dropped onto the plane) and the resulting quadrilateral's area
 * is taken in the plane. A heuristic for the "step back" verdict, not a measurement.
 */
export function visibleSurfaceAreaM2(input: SurfaceAreaInput): number {
  const { K, R, C, plane, bbox, frameW, frameH } = input;
  const maxRange = input.maxRangeM ?? 12;
  const [bx, by, bw, bh] = bbox;
  const cornersPx: Pixel[] = [
    { u: bx * frameW, v: by * frameH },
    { u: (bx + bw) * frameW, v: by * frameH },
    { u: (bx + bw) * frameW, v: (by + bh) * frameH },
    { u: bx * frameW, v: (by + bh) * frameH },
  ];
  const onPlane = (P: Vec3): Vec3 => sub(P, scale(plane.n, dot(plane.n, P) - plane.d));
  const pts = cornersPx.map(({ u, v }) => {
    const ray = rayFromPixel(K, R, C, u, v);
    const hit = intersectPlane(ray, plane);
    if (hit && hit.t <= maxRange) return hit.P;
    return onPlane(add(ray.origin, scale(ray.dir, maxRange)));
  });
  // 2D coordinates in the plane.
  const n = plane.n;
  const a = Math.abs(n.y) > 0.9 ? { x: 1, y: 0, z: 0 } : normalize(cross(UP, n));
  const b = normalize(cross(n, a));
  const xy = pts.map((P) => [dot(P, a), dot(P, b)] as const);
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i],
      [x2, y2] = xy[(i + 1) % xy.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/** `scene.freeArea` (a 0–1 fraction of the best surface) turned into m² on the named surface. Null when the surface has no bbox. */
export function freeAreaM2(scene: SceneAnalysis, surface: Surface, geo: Omit<SurfaceAreaInput, 'bbox'>): number | null {
  const det = scene.surfaces.find((s) => s.type === surface);
  if (!det?.bbox) return null;
  return visibleSurfaceAreaM2({ ...geo, bbox: det.bbox }) * Math.max(0, Math.min(1, scene.freeArea));
}
