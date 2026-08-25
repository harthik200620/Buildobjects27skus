/**
 * How far away a surface is, from geometry rather than from a guess.
 *
 * The live camera used a single constant — 2.2 m — for every vertical surface, and the first pass
 * at improving it read distance off the size of the detected region's bounding box. Both are
 * wrong in the way that matters: distance sets the projected size of the product, so a wall
 * assumed at 2.2 m when it is 4 m away renders a fire extinguisher at nearly twice its real size,
 * and the whole promise of the feature is that what you see is the true size.
 *
 * The geometry is simple and exact once the camera's pitch is known, which it is — the device
 * reports it. A pixel below the horizon is looking at the floor. The angle below horizontal for
 * that pixel, the camera's height above the floor, and one tangent give the horizontal distance
 * to the point it lands on. Where the floor meets a wall, that distance IS the distance to the
 * wall.
 *
 * The one assumption is the camera height, and it is an assumption the engine already makes and
 * can refine from a door or a switch plate (see live/plane.ts `solveCameraHeight`).
 */

const DEG = Math.PI / 180;

/** Nothing in a room is usefully closer or further than this; also stops tan() blowing up. */
export const MIN_DEPTH_M = 0.4;
export const MAX_DEPTH_M = 12;

export interface FloorDistanceInput {
  /** Row of the pixel, in full-frame pixels from the top. */
  vPx: number;
  /** Camera pitch in degrees; negative looks down. */
  pitchDeg: number;
  /** Vertical focal length, and the principal point's row, in full-frame pixels. */
  fy: number;
  cy: number;
  /** Height of the camera above the floor, metres. */
  cameraHeightM: number;
}

/**
 * Horizontal distance to the point on the floor that a given image row is looking at.
 *
 * Returns null when the ray does not reach the floor — a pixel at or above the horizon is looking
 * at a wall or the sky, and there is no intersection to report. Callers must treat that as "not
 * known" rather than substituting a default, because a wrong distance is worse than none.
 */
export function floorDistanceAtRow(input: FloorDistanceInput): number | null {
  const { vPx, pitchDeg, fy, cy, cameraHeightM } = input;
  if (!(cameraHeightM > 0) || !(fy > 0)) return null;
  /*
   * Angle of this pixel below the optical axis, then below horizontal. The camera's pitch tilts
   * the axis; a pixel further down the frame adds to the depression. Only a ray that ends up
   * pointing downward can meet the floor.
   */
  const belowAxis = Math.atan((vPx - cy) / fy);
  const depression = belowAxis - pitchDeg * DEG;
  if (depression <= 1e-4) return null; // level or rising: never meets the floor
  const d = cameraHeightM / Math.tan(depression);
  if (!Number.isFinite(d) || d <= 0) return null;
  return Math.min(MAX_DEPTH_M, Math.max(MIN_DEPTH_M, d));
}

/**
 * The inverse: which image row a point on the floor at distance `d` projects to. Used to draw the
 * placement footprint and to sanity-check the forward calculation in tests.
 */
export function rowAtFloorDistance(d: number, pitchDeg: number, fy: number, cy: number, cameraHeightM: number): number | null {
  if (!(d > 0) || !(cameraHeightM > 0)) return null;
  const depression = Math.atan(cameraHeightM / d);
  return cy + fy * Math.tan(depression + pitchDeg * DEG);
}

/**
 * Distance to a wall, taken from where the floor runs into it.
 *
 * `floorTopRow` is the highest row the floor region reaches — the line where the floor stops,
 * which in an ordinary room is the base of the wall. Everything above it is the wall going up,
 * and the wall stands at the distance that floor line is at.
 */
export function wallDistanceFromFloorLine(floorTopRow: number, pitchDeg: number, fy: number, cy: number, cameraHeightM: number): number | null {
  return floorDistanceAtRow({ vPx: floorTopRow, pitchDeg, fy, cy, cameraHeightM });
}
