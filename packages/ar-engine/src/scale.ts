import type { Placement, PlacementRule, ProductDims, ReferenceObject, ScaleEstimate, SceneAnalysis, Surface } from './types';

/** Real-world sizes of the references the analyser can detect (mm). */
export const REFERENCE_MM: Record<ReferenceObject['kind'], number> = {
  door: 2030,
  switch_plate: 86,
  tile_joint: 600,
  a4_sheet: 297,
  brick: 190,
  person: 1700,
  ceiling_fan: 1200,
  window: 1200,
};

/**
 * mm-per-pixel at the reference's depth. Best reference wins (door > person > window > fan >
 * tile joint > switch plate > brick > A4) weighted by detection confidence; manual two-tap
 * calibration overrides; with nothing, a conservative default for a phone photo of a room.
 */
export function estimateScale(scene: SceneAnalysis, manual?: { px: number; realMm: number } | null): ScaleEstimate {
  if (manual && manual.px > 4)
    return { mmPerPx: manual.realMm / manual.px, confidence: 0.9, source: 'manual', note: `Calibrated on a ${manual.realMm} mm reference you marked` };
  const priority: ReferenceObject['kind'][] = ['door', 'person', 'window', 'ceiling_fan', 'tile_joint', 'switch_plate', 'brick', 'a4_sheet'];
  const best = [...scene.references]
    .filter((r) => r.px > 4)
    .sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || b.confidence - a.confidence)[0];
  if (best)
    return {
      mmPerPx: (best.realMm || REFERENCE_MM[best.kind]) / best.px,
      confidence: Math.min(0.85, best.confidence),
      source: 'reference',
      referenceKind: best.kind,
      note: `Scaled from a ${best.kind.replace(/_/g, ' ')} (${best.realMm || REFERENCE_MM[best.kind]} mm)`,
    };
  // Default: a typical phone photo frames ~3.2 m of wall across its width at 1000 px → 3.2 mm/px.
  return {
    mmPerPx: 3.2,
    confidence: 0.3,
    source: 'default',
    note: 'No reference found — assuming a typical room photo. Tap the top and bottom of a door to calibrate.',
  };
}

/**
 * A simple floor-plane depth model: the horizon line is eye level; a point on the floor at
 * normalised y (0 top … 1 bottom) is nearer the camera the lower it sits. Relative scale
 * against the reference plane at yRef: s = (y − horizon) / (yRef − horizon), clamped.
 */
export function depthFactor(y: number, horizonY: number, yRef = 0.85): number {
  const denom = Math.max(0.05, yRef - horizonY);
  const f = (y - horizonY) / denom;
  return Math.min(3, Math.max(0.25, f));
}

/** The product's rendered size in normalised photo units for a given anchor position. */
export function placementFor(opts: {
  rule: PlacementRule;
  dims: ProductDims;
  scene: SceneAnalysis;
  scale: ScaleEstimate;
  surface: Surface;
  x: number;
  y: number;
  photoWidthPx: number;
  photoHeightPx: number;
  rotationDeg?: number;
  scaleMultiplier?: number;
}): Placement {
  const { rule, dims, scene, scale, surface, x, y, photoWidthPx, photoHeightPx } = opts;
  const mult = Math.max(0.1, Math.min(10, opts.scaleMultiplier ?? 1.0));
  const onFloorPlane = surface === 'floor' || surface === 'ground' || surface === 'table' || surface === 'roof';
  // Wall & window are vertical planes: keep 1:1 scale so a bulb stays wall-locked even when
  // the camera rotates or the user drags vertically. Depth runs only on horizontal planes.
  const depth = onFloorPlane ? depthFactor(y, scene.horizonY) : surface === 'ceiling' ? depthFactor(1 - y, 1 - scene.horizonY) : 1;
  const mmPerPxHere = scale.mmPerPx / Math.max(0.25, depth) / mult;
  // A vertically-mounted protrusion (a bulb on a wall, a camera on a wall) presents its RADIAL
  // diameter to the camera in both axes — the length runs along the wall normal (depth), so the
  // on-wall footprint is ~square (w_mm × w_mm), matching the 3/4 render sprite. Only flat-lying
  // floor items and true-vertical wall items (a glass pane) keep the full length in the frame.
  const isWallProtrusion =
    (surface === 'wall' || surface === 'window') && (rule.orientation === 'wall_flush' || rule.anchor === 'back' || rule.category === 'bulbs');
  const facingW = rule.orientation === 'flat' && onFloorPlane ? dims.w_mm : dims.w_mm;
  const facingH = rule.orientation === 'flat' && onFloorPlane ? dims.d_mm * 0.55 + dims.h_mm * 0.6 : isWallProtrusion ? dims.w_mm : dims.h_mm;
  const w = facingW / mmPerPxHere / photoWidthPx;
  const h = facingH / mmPerPxHere / photoHeightPx;
  return { surface, x, y, w, h, rotationDeg: opts.rotationDeg ?? 0, depth, mmPerPxHere };
}

/** Default drop point for a surface: floor items low-centre, wall items at the rule's height band, ceiling items up top. */
export function defaultAnchor(rule: PlacementRule, surface: Surface, scene: SceneAnalysis): { x: number; y: number } {
  const s = scene.surfaces.find((d) => d.type === surface);
  const b = s?.bbox;
  if (surface === 'ceiling') return { x: b ? b[0] + b[2] / 2 : 0.5, y: b ? b[1] + b[3] * 0.55 : 0.12 };
  if (surface === 'wall' || surface === 'window') {
    const band = rule.heightBandMm ? (rule.heightBandMm[0] + rule.heightBandMm[1]) / 2 : 1500;
    const t = Math.min(0.9, Math.max(0.1, 1 - band / 3000));
    return { x: b ? b[0] + b[2] / 2 : 0.5, y: b ? b[1] + b[3] * t : t * 0.8 + 0.1 };
  }
  return { x: b ? b[0] + b[2] / 2 : 0.5, y: b ? Math.min(0.95, b[1] + b[3] * 0.7) : 0.8 };
}
