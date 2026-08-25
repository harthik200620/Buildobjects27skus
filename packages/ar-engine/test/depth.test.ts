import { describe, expect, it } from 'vitest';
import {
  autoFitScale,
  defaultDropPoint,
  dropPointFor,
  floorDistanceAtRow,
  MAX_AUTO_FIT,
  MAX_DEPTH_M,
  MIN_DEPTH_M,
  rowAtFloorDistance,
  rowForWallHeight,
  ruleFor,
  surfaceDistanceM,
  wallDistanceFromFloorLine,
} from '../src/index';

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

describe('rowForWallHeight — the level-camera case', () => {
  it('puts a wall product where it would really be mounted, phone held level', () => {
    /*
     * Camera at 1.4 m, level, wall 3 m away. Worked by hand:
     *   fire extinguisher at 1.0 m  → elevation atan(-0.4/3) = -7.59° → row 540 + 900·tan(7.59°) = 660
     *   CCTV at 2.4 m               → elevation atan( 1.0/3) = 18.43° → row 540 - 900·tan(18.43°) = 240
     * The fixed fractions this replaced would have put them at 594 and 302 — both floating.
     */
    expect(rowForWallHeight(1.0, 3, 0, FY, CY, H) as number).toBeCloseTo(660, 0);
    expect(rowForWallHeight(2.4, 3, 0, FY, CY, H) as number).toBeCloseTo(240, 0);
  });

  it('places a product at exactly camera height on the horizon', () => {
    // Same height as the lens, level camera: dead centre, at any distance.
    for (const d of [1, 3, 8]) expect(rowForWallHeight(H, d, 0, FY, CY, H) as number).toBeCloseTo(CY, 6);
  });

  it('moves the product down the frame as the phone tilts up, and vice versa', () => {
    const level = rowForWallHeight(1.0, 3, 0, FY, CY, H) as number;
    const up = rowForWallHeight(1.0, 3, 15, FY, CY, H) as number;
    const down = rowForWallHeight(1.0, 3, -15, FY, CY, H) as number;
    expect(up).toBeGreaterThan(level);
    expect(down).toBeLessThan(level);
  });

  it('converges on the horizon for a distant wall, whatever the mounting height', () => {
    const far = rowForWallHeight(2.4, 400, 0, FY, CY, H) as number;
    expect(Math.abs(far - CY)).toBeLessThan(10);
  });
});

describe('dropPointFor', () => {
  const geo = (pitchDeg: number, distanceM = 3) => ({ pitchDeg, fy: FY, height: 1080, cameraHeightM: H, distanceM });

  it('solves the row for a wall mount instead of using a fixed fraction', () => {
    // Fire extinguisher: band 800-1200 mm, mid 1.0 m. Level camera, wall 3 m → v = 660/1080.
    const solved = dropPointFor(ruleFor('fire-extinguishers'), 'wall', geo(0));
    expect(solved.v).toBeCloseTo(660 / 1080, 2);
    expect(solved.v).not.toBeCloseTo(defaultDropPoint(ruleFor('fire-extinguishers'), 'wall').v, 2);
  });

  it('puts a CCTV camera high on the wall when the phone is level', () => {
    const solved = dropPointFor(ruleFor('cctv'), 'wall', geo(0));
    expect(solved.v).toBeLessThan(0.35); // band 2200-3000 mm, well above the lens
  });

  it('keeps horizontal mounts on their plane rather than solving a height', () => {
    // A cement bag is pinned by the floor plane; there is no wall height to compute.
    expect(dropPointFor(ruleFor('cement'), 'floor', geo(-20))).toEqual(defaultDropPoint(ruleFor('cement'), 'floor'));
  });

  it('falls back to the fraction when the device reports no orientation', () => {
    expect(dropPointFor(ruleFor('cctv'), 'wall', geo(0) && { ...geo(0), pitchDeg: null })).toEqual(defaultDropPoint(ruleFor('cctv'), 'wall'));
    expect(dropPointFor(ruleFor('cctv'), 'wall', null)).toEqual(defaultDropPoint(ruleFor('cctv'), 'wall'));
  });

  it('keeps an off-frame product just inside the edge so it can still be dragged', () => {
    // Standing very close to a wall: a high mount projects far above the frame.
    const v = dropPointFor(ruleFor('cctv'), 'wall', geo(0, 0.5)).v;
    expect(v).toBeGreaterThanOrEqual(0.06);
    expect(v).toBeLessThanOrEqual(0.94);
  });
});

describe('autoFitScale', () => {
  const bulb = { w_mm: 60, h_mm: 110, d_mm: 60 };
  const module = { w_mm: 1133, h_mm: 2278, d_mm: 30 };

  it('enlarges a bulb across the room, because 25 px cannot be judged', () => {
    // 110 mm tall, 2.2 m away, fy 900 → 45 px. Below the legibility floor.
    const fit = autoFitScale(bulb, 2.2, 900);
    expect(fit.enlarged).toBe(true);
    expect(fit.scale).toBeGreaterThan(1.5);
  });

  it('leaves a solar module alone, because it is already legible', () => {
    // This is the case the old blanket 1.8x multiplier got wrong: a 2.3 m panel needs no help.
    const fit = autoFitScale(module, 3, 900);
    expect(fit.enlarged).toBe(false);
    expect(fit.scale).toBe(1);
  });

  it('enlarges exactly to the legibility floor and no further', () => {
    const fit = autoFitScale(bulb, 2.2, 900, 96);
    const projected = (0.11 * 900) / 2.2;
    expect(fit.scale).toBeCloseTo(96 / projected, 1);
  });

  it('needs less enlargement the closer you stand', () => {
    expect(autoFitScale(bulb, 0.8, 900).scale).toBeLessThan(autoFitScale(bulb, 3.5, 900).scale);
  });

  it('never asks for more than the cap, however far away', () => {
    expect(autoFitScale(bulb, 40, 900).scale).toBeLessThanOrEqual(MAX_AUTO_FIT);
  });

  it('does nothing when the inputs are unusable rather than dividing by zero', () => {
    expect(autoFitScale(bulb, 0, 900)).toEqual({ scale: 1, enlarged: false });
    expect(autoFitScale({ w_mm: 0, h_mm: 0, d_mm: 0 }, 2, 900)).toEqual({ scale: 1, enlarged: false });
  });
});
