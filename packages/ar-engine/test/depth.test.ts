import { describe, expect, it } from 'vitest';
import { floorDistanceAtRow, MAX_DEPTH_M, MIN_DEPTH_M, rowAtFloorDistance, surfaceDistanceM, wallDistanceFromFloorLine } from '../src/index';

/**
 * Distance sets the projected size of the product, so these are the numbers that decide whether
 * a fire extinguisher on a wall looks like a fire extinguisher or like a fire hydrant. The live
 * view used a flat 2.2 m for every vertical surface; this is the geometry that replaced it.
 *
 * Every case below is solved independently by hand from the camera height and the angle, so the
 * test would catch the code and the author making the same mistake.
 */

const FY = 900; // vertical focal length, full-frame pixels
const CY = 540; // principal point row (1080-tall frame)
const H = 1.4; // camera height, metres

describe('floorDistanceAtRow', () => {
  it('puts a point at the camera height directly below 45° at exactly that distance', () => {
    // A 45° depression from 1.4 m up meets the floor 1.4 m away. Level camera, so the pixel is
    // one focal length below the principal point: atan(900/900) = 45°.
    expect(floorDistanceAtRow({ vPx: CY + FY, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H })).toBeCloseTo(1.4, 2);
  });

  it('reads further away as the pixel rises toward the horizon', () => {
    const near = floorDistanceAtRow({ vPx: CY + 800, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H });
    const mid = floorDistanceAtRow({ vPx: CY + 400, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H });
    const far = floorDistanceAtRow({ vPx: CY + 120, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H });
    expect(near).not.toBeNull();
    expect(near as number).toBeLessThan(mid as number);
    expect(mid as number).toBeLessThan(far as number);
  });

  it('refuses a pixel at or above the horizon rather than inventing a distance', () => {
    // Level camera: the principal row IS the horizon, and nothing above it meets the floor.
    expect(floorDistanceAtRow({ vPx: CY, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H })).toBeNull();
    expect(floorDistanceAtRow({ vPx: CY - 200, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H })).toBeNull();
  });

  it('accounts for the camera being tilted', () => {
    /*
     * The same pixel is looking at a nearer piece of floor when the phone is tilted down: the
     * depression is the pitch plus the pixel's own angle below the axis. This is the cue the old
     * constant threw away entirely.
     */
    const level = floorDistanceAtRow({ vPx: CY + 300, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H }) as number;
    const tilted = floorDistanceAtRow({ vPx: CY + 300, pitchDeg: -20, fy: FY, cy: CY, cameraHeightM: H }) as number;
    expect(tilted).toBeLessThan(level);
  });

  it('scales with the camera height, because a taller viewpoint sees further along the same ray', () => {
    const low = floorDistanceAtRow({ vPx: CY + 400, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: 1.0 }) as number;
    const high = floorDistanceAtRow({ vPx: CY + 400, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: 2.0 }) as number;
    expect(high / low).toBeCloseTo(2, 1);
  });

  it('stays inside the range a room can be', () => {
    const grazing = floorDistanceAtRow({ vPx: CY + 1, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H }) as number;
    expect(grazing).toBeLessThanOrEqual(MAX_DEPTH_M);
    const underfoot = floorDistanceAtRow({ vPx: CY + 20000, pitchDeg: 0, fy: FY, cy: CY, cameraHeightM: H }) as number;
    expect(underfoot).toBeGreaterThanOrEqual(MIN_DEPTH_M);
  });

  it('round-trips against the projection it inverts', () => {
    for (const d of [0.8, 1.5, 3, 6]) {
      const row = rowAtFloorDistance(d, -12, FY, CY, H) as number;
      expect(floorDistanceAtRow({ vPx: row, pitchDeg: -12, fy: FY, cy: CY, cameraHeightM: H })).toBeCloseTo(d, 2);
    }
  });
});

describe('wallDistanceFromFloorLine', () => {
  it('puts the wall where the floor stops', () => {
    // A wall 3 m away meets the floor at a known row; reading that row back gives 3 m.
    const row = rowAtFloorDistance(3, -10, FY, CY, H) as number;
    expect(wallDistanceFromFloorLine(row, -10, FY, CY, H)).toBeCloseTo(3, 2);
  });

  it('is null when the floor line is above the horizon', () => {
    expect(wallDistanceFromFloorLine(CY - 50, 0, FY, CY, H)).toBeNull();
  });
});

describe('surfaceDistanceM', () => {
  const bbox: [number, number, number, number] = [0.1, 0.1, 0.5, 0.5];

  it('uses a measured distance in preference to its own estimate', () => {
    const measured = surfaceDistanceM('wall', { surface: 'wall', confidence: 90, detection: { type: 'wall', confidence: 0.9, bbox, distanceM: 4.6 } });
    const guessed = surfaceDistanceM('wall', { surface: 'wall', confidence: 90, detection: { type: 'wall', confidence: 0.9, bbox } });
    expect(measured).toBeCloseTo(4.6, 2);
    expect(guessed).not.toBeCloseTo(4.6, 2);
  });

  it('falls back to the apparent-size estimate only when nothing was measured', () => {
    const d = surfaceDistanceM('wall', { surface: 'wall', confidence: 90, detection: { type: 'wall', confidence: 0.9, bbox } });
    expect(d).toBeGreaterThan(0.6);
    expect(d).toBeLessThan(8);
  });

  it('clamps a nonsense measurement instead of trusting it', () => {
    const far = surfaceDistanceM('wall', { surface: 'wall', confidence: 90, detection: { type: 'wall', confidence: 0.9, bbox, distanceM: 900 } });
    expect(far).toBeLessThanOrEqual(8);
  });
});
