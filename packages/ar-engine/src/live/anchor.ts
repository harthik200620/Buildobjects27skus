import type { PlacementRule, ProductDims, Surface } from '../types';
import { RAD } from './camera-math';
import {
  ceilingPlane,
  floorPlane,
  intersectPlane,
  type Pixel,
  type PixelIntrinsics,
  type Plane,
  projectToPixel,
  rayFromPixel,
  wallNormalFacing,
  wallPlane,
} from './plane';
import { add, cross, type Mat3, normalize, scale, UP, type Vec3, v3 } from './pose';

/**
 * Where the product sits. Horizontal anchors (floor / ceiling / roof / ground / table) are a
 * world point on the plane plus a yaw about Y; vertical anchors (wall / window) are a world point
 * plus the wall's normal; screen anchors are for devices without a pose (no sensors, permission
 * denied): a pixel on a named surface that the web layer pans with the optical flow and scales
 * with the photo-mode depth model.
 */
export type HorizontalSurface = 'floor' | 'ceiling' | 'roof' | 'ground' | 'table';
export type VerticalSurface = 'wall' | 'window';
export interface HorizontalAnchor {
  kind: 'horizontal';
  surface: HorizontalSurface;
  P: Vec3;
  yawDeg: number;
}
export interface VerticalAnchor {
  kind: 'vertical';
  surface: VerticalSurface;
  P: Vec3;
  n: Vec3;
}
export interface ScreenAnchor {
  kind: 'screen';
  surface: Surface;
  u: number;
  v: number;
  yawDeg: number;
}
export type Anchor = HorizontalAnchor | VerticalAnchor | ScreenAnchor;

/** Typical Indian residential ceiling (≈ 10 ft). */
export const DEFAULT_CEILING_M = 2.9;
export const DEFAULT_TABLE_M = 0.72;
/** Wall depth assumed before a switch plate / A4 reference or a floor-wall tap has measured it. */
export const DEFAULT_WALL_DISTANCE_M = 2.5;

export const isVerticalSurface = (s: Surface): s is VerticalSurface => s === 'wall' || s === 'window';

export interface SurfacePlaneOptions {
  hCeil?: number;
  tableHeightM?: number;
  wallDistanceM?: number;
  /** Horizontal unit normal of the wall pointing toward the camera; defaults to squarely facing the camera. */
  wallNormal?: Vec3;
}

/** The world plane of a named surface under the current pose. */
export function surfacePlane(surface: Surface, R: Mat3, opts: SurfacePlaneOptions = {}): Plane {
  switch (surface) {
    case 'ceiling':
      return ceilingPlane(opts.hCeil ?? DEFAULT_CEILING_M);
    case 'table':
      return floorPlane(opts.tableHeightM ?? DEFAULT_TABLE_M);
    case 'wall':
    case 'window':
      return wallPlane(opts.wallNormal ?? wallNormalFacing(R), opts.wallDistanceM ?? DEFAULT_WALL_DISTANCE_M);
    default:
      return floorPlane(0);
  }
}

export interface AnchorFromPixelInput extends SurfacePlaneOptions {
  K: PixelIntrinsics;
  R: Mat3;
  C: Vec3;
  /** The tap / drag position in video pixels. */
  u: number;
  v: number;
  surface: Surface;
  yawDeg?: number;
}

/** Cast the pixel's ray onto the surface's plane. Null when the ray misses (e.g. a floor tap above the horizon). */
export function anchorFromPixel(input: AnchorFromPixelInput): Anchor | null {
  const plane = surfacePlane(input.surface, input.R, input);
  const hit = intersectPlane(rayFromPixel(input.K, input.R, input.C, input.u, input.v), plane);
  if (!hit) return null;
  if (isVerticalSurface(input.surface)) return { kind: 'vertical', surface: input.surface, P: hit.P, n: plane.n };
  return { kind: 'horizontal', surface: input.surface as HorizontalSurface, P: hit.P, yawDeg: input.yawDeg ?? 0 };
}

export const screenAnchor = (u: number, v: number, surface: Surface, yawDeg = 0): ScreenAnchor => ({ kind: 'screen', surface, u, v, yawDeg });

/** The anchor's pixel under the current pose (screen anchors are already pixels); null when behind the camera. */
export function anchorToPixel(anchor: Anchor, K: PixelIntrinsics, R: Mat3, C: Vec3): Pixel | null {
  if (anchor.kind === 'screen') return { u: anchor.u, v: anchor.v };
  return projectToPixel(K, R, C, anchor.P);
}

/** The yaw (degrees) that turns a product's front (+Z local) toward the camera from a horizontal anchor. */
export function yawFacing(P: Vec3, C: Vec3): number {
  return Math.atan2(C.x - P.x, C.z - P.z) * RAD;
}

/** The product's extent on the surface, padded by the rule's clearance on every side (metres): w × d on horizontal surfaces, w × h on walls. */
export function footprintSize(dims: ProductDims, rule: PlacementRule, surface: Surface): { wM: number; dM: number } {
  const pad = (2 * rule.minClearanceMm) / 1000;
  const vertical = isVerticalSurface(surface);
  return { wM: dims.w_mm / 1000 + pad, dM: (vertical ? dims.h_mm : dims.d_mm) / 1000 + pad };
}

/**
 * The four corners of the clearance-padded footprint in world space (counter-clockwise seen from
 * the surface's normal side, starting front-left). Horizontal anchors rotate the w × d rectangle
 * by the yaw about Y; vertical anchors span w × h in the wall plane. Screen anchors have no
 * world geometry → null (the web layer draws a 2D box from the photo-mode scale instead).
 */
export function footprintCorners(anchor: Anchor, dims: ProductDims, rule: PlacementRule): Vec3[] | null {
  if (anchor.kind === 'screen') return null;
  const { wM, dM } = footprintSize(dims, rule, anchor.surface);
  const hw = wM / 2,
    hd = dM / 2;
  if (anchor.kind === 'horizontal') {
    const psi = (anchor.yawDeg * Math.PI) / 180;
    const c = Math.cos(psi),
      s = Math.sin(psi);
    const local: [number, number][] = [
      [-hw, hd],
      [hw, hd],
      [hw, -hd],
      [-hw, -hd],
    ];
    return local.map(([x, z]) => add(anchor.P, v3(x * c + z * s, 0, -x * s + z * c)));
  }
  const right = normalize(cross(UP, anchor.n));
  const r = right.x === 0 && right.y === 0 && right.z === 0 ? v3(1, 0, 0) : right;
  return [
    add(anchor.P, add(scale(r, -hw), scale(UP, -hd))),
    add(anchor.P, add(scale(r, hw), scale(UP, -hd))),
    add(anchor.P, add(scale(r, hw), scale(UP, hd))),
    add(anchor.P, add(scale(r, -hw), scale(UP, hd))),
  ];
}

/** World corners → pixel polygon; null when any corner is behind the camera. */
export function projectFootprint(corners: Vec3[], K: PixelIntrinsics, R: Mat3, C: Vec3): Pixel[] | null {
  const out: Pixel[] = [];
  for (const P of corners) {
    const px = projectToPixel(K, R, C, P);
    if (!px) return null;
    out.push(px);
  }
  return out;
}
