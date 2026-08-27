import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  autoFitScale,
  cameraPosition,
  cameraRotation,
  DEFAULT_CAMERA_HEIGHT_M,
  fitModelToDims,
  framePlacement,
  fullFrame,
  horizontalHeading,
  idealViewingDistanceM,
  intrinsicsFor,
  PLACEMENT_DISTANCE_M,
  type ProductDims,
  placementFromPixel,
  productCorners,
  projectBox,
  ruleFor,
  surfacePlane,
} from '../src/index';

/**
 * EVERY SKU, EVERY ANGLE A PHONE IS HELD AT.
 *
 * This is the harness that was missing. All three causes of the last "I opened the camera and
 * there is no product" report were found by opening the view and looking at it, which is not a
 * regression test — and sure enough the next round of the same bug shipped, in a different form,
 * and was reported the same way.
 *
 * What it asserts is the one thing the feature is judged on: for every product in the catalogue,
 * at every camera pitch, EITHER the product is genuinely framed, OR the view knows which way it
 * went and says so. Silently rendering nothing is the failure, and it is now a test failure.
 *
 * Against the code as it shipped this fails immediately and comprehensively: every floor SKU had
 * no anchor at all above about +15 degrees of pitch, a cement bag at +10 landed 25 m away at
 * 21 x 31 px, and a solar panel at -45 projected to a box 176 000 px across.
 */

interface CatalogueRow {
  sku: { code: string };
  category?: { slug?: string } | null;
  dims?: { w: number; h: number; d: number } | null;
}

/** The real catalogue, so this covers the SKUs that ship rather than one made-up box per category. */
const CATALOGUE: { code: string; category: string; dims: ProductDims }[] = (() => {
  const file = path.resolve(__dirname, '../../../apps/web/data/catalogue/skus.json');
  const rows: Record<string, CatalogueRow> = JSON.parse(readFileSync(file, 'utf8'));
  return Object.values(rows)
    .filter((r): r is CatalogueRow & { dims: { w: number; h: number; d: number } } => !!r.dims && !!r.category?.slug)
    .map((r) => ({
      code: r.sku.code,
      category: r.category?.slug as string,
      dims: { w_mm: r.dims.w, h_mm: r.dims.h, d_mm: r.dims.d },
    }));
})();

/** Portrait phone video, the shape the live view actually receives. */
const W = 720;
const H = 1280;
const K = intrinsicsFor(W, H, 'phone');
const C = cameraPosition(DEFAULT_CAMERA_HEIGHT_M.phone);
const VIEW = fullFrame(K);

/** +30 is a phone tilted up at a ceiling; -89 is one held flat over the floor. */
const PITCHES = [30, 20, 10, 0, -10, -20, -30, -45, -60, -75, -89];
/** Turning on the spot must not change any of this. */
const YAWS = [0, 47, 180, -120];

describe('the catalogue', () => {
  it('has SKUs with dimensions to place', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(27);
  });
});

describe('framePlacement, across every SKU and every camera pitch', () => {
  it('always produces an anchor, at a distance a room can hold', () => {
    const bad: string[] = [];
    for (const { code, category, dims } of CATALOGUE) {
      const rule = ruleFor(category);
      for (const surface of rule.surfaces) {
        for (const pitchDeg of PITCHES) {
          for (const yawDeg of YAWS) {
            const R = cameraRotation({ pitchDeg, yawDeg });
            const f = framePlacement({ K, R, C, rule, dims, surface, view: VIEW });
            if (f.anchor.kind === 'screen') bad.push(`${code} ${surface} @${pitchDeg}/${yawDeg}: screen anchor`);
            if (!(f.distanceM >= PLACEMENT_DISTANCE_M[0] - 1e-6 && f.distanceM <= PLACEMENT_DISTANCE_M[1] + 1e-6)) {
              bad.push(`${code} ${surface} @${pitchDeg}/${yawDeg}: ${f.distanceM.toFixed(1)} m is outside the placement band`);
            }
            if (!Number.isFinite(f.distanceM)) bad.push(`${code} ${surface} @${pitchDeg}/${yawDeg}: distance is not finite`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never leaves a product invisible without saying where it went', () => {
    /* The contract. Either you can see it, or the view is pointing at it. Never neither. */
    const bad: string[] = [];
    for (const { code, category, dims } of CATALOGUE) {
      const rule = ruleFor(category);
      for (const surface of rule.surfaces) {
        for (const pitchDeg of PITCHES) {
          const R = cameraRotation({ pitchDeg });
          const f = framePlacement({ K, R, C, rule, dims, surface, view: VIEW });
          if (f.coverage < 0.72 && f.nudge === null) {
            bad.push(`${code} ${surface} @${pitchDeg}: ${(f.coverage * 100).toFixed(0)} % on screen and no nudge`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('frames the product properly wherever its own surface is in view', () => {
    /*
     * EVERY PRODUCT HAS A COMFORTABLE RANGE OF ANGLES AT WHICH IT IS FULLY VISIBLE.
     *
     * Stated as a contiguous RUN rather than as a fixed band per mount, because the natural angle
     * is not the same gesture for every product and hard-coding one per surface would assert the
     * catalogue rather than the behaviour. You tilt up at a ceiling bulb, look level at a window,
     * further up at a CCTV camera under a soffit, and down at a cement bag — all four are just
     * "point at the thing", and that is what this measures.
     *
     * A run of four samples is twenty degrees of tilt. One angle that happens to work is not a
     * feature: a placement fully framed at exactly one pitch and gone either side of it reads, to
     * somebody holding a phone, as the product flickering in and out of existence.
     *
     * What this deliberately does NOT assert is what happens when you tilt AWAY. A world-locked
     * product slides off the frame when you stop looking at it — that is what world-locked means —
     * and the nudge test above is what covers it.
     */
    const NEEDED = 4;
    const bad: string[] = [];
    for (const { code, category, dims } of CATALOGUE) {
      const rule = ruleFor(category);
      for (const surface of rule.surfaces) {
        let run = 0;
        let bestRun = 0;
        let best = 0;
        for (let pitchDeg = 40; pitchDeg >= -89; pitchDeg -= 5) {
          const f = framePlacement({ K, R: cameraRotation({ pitchDeg }), C, rule, dims, surface, view: VIEW });
          best = Math.max(best, f.coverage);
          run = f.coverage >= 0.9 ? run + 1 : 0;
          bestRun = Math.max(bestRun, run);
        }
        if (bestRun < NEEDED) {
          bad.push(`${code} ${surface}: fully visible over only ${bestRun * 5} degrees of tilt (best ${(best * 100).toFixed(0)} %)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('renders every product at a size that can be judged', () => {
    /*
     * The other half of "not visible properly": a product that IS on screen but is twenty pixels
     * across. A cement bag used to land 25 m down the floor and project to 21 x 31 px, which is
     * on screen, correct, and useless.
     */
    const bad: string[] = [];
    for (const { code, category, dims } of CATALOGUE) {
      const rule = ruleFor(category);
      const surface = rule.surfaces[0];
      for (const pitchDeg of [0, -10, -20, -30]) {
        const R = cameraRotation({ pitchDeg });
        const f = framePlacement({ K, R, C, rule, dims, surface, view: VIEW });
        /*
         * At the scale the view actually draws it. `applyAutoFit` lifts a product that is too small
         * to judge — a 110 mm bulb on a ceiling across the room is genuinely eighteen pixels at
         * true size — and measuring without it would be measuring something nobody ever sees.
         */
        const mult = autoFitScale(dims, f.distanceM, K.fy).scale;
        const corners = productCorners(f.anchor, dims, rule, mult);
        const box = corners ? projectBox(corners, K, R, C, VIEW) : null;
        if (!box) {
          bad.push(`${code} @${pitchDeg}: nothing projected`);
          continue;
        }
        /* Small items are lifted to legibility by autoFitScale, which is measured in its own test;
           this is about the placement not throwing anything to the far end of the room. */
        if (f.distanceM > 6.01) bad.push(`${code} @${pitchDeg}: placed ${f.distanceM.toFixed(1)} m away`);
        if (Math.max(box.w, box.h) < 24) bad.push(`${code} @${pitchDeg}: ${box.w.toFixed(0)} x ${box.h.toFixed(0)} px is too small to see`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the two cases the browser audit caught that the maths alone did not', () => {
  it('does not let a bad wall measurement hide the product', () => {
    /*
     * All three CCTV SKUs were invisible at every camera angle. The on-device analyser had put the
     * wall under a metre away, the placement pinned itself to that reading, and a camera mounted at
     * 2.6 m on a wall that close is above the top of the frame at any pitch a person holds a phone
     * at. A measurement that makes the product invisible is likelier to be wrong than the geometry.
     */
    const dims: ProductDims = { w_mm: 85, h_mm: 79, d_mm: 85 };
    const rule = ruleFor('cctv');
    for (const pitchDeg of [25, 15, 5]) {
      const f = framePlacement({ K, R: cameraRotation({ pitchDeg }), C, rule, dims, surface: 'wall', view: VIEW, measuredDistanceM: 0.6 });
      expect(f.coverage, `pitch ${pitchDeg}`).toBeGreaterThan(0.9);
    }
  });

  it('still puts the product on the wall it measured, when that wall can carry it', () => {
    const dims: ProductDims = { w_mm: 85, h_mm: 79, d_mm: 85 };
    const f = framePlacement({ K, R: cameraRotation({ pitchDeg: 15 }), C, rule: ruleFor('cctv'), dims, surface: 'wall', view: VIEW, measuredDistanceM: 3.2 });
    expect(f.method).toBe('measured_wall');
    /* Within a sample of the measurement, not pinned to it exactly — the sweep is 48 steps wide. */
    expect(Math.abs(Math.hypot(f.distanceM, 0) - 3.2)).toBeLessThan(0.6);
  });

  it('frames what will actually be drawn, at the auto-fit scale', () => {
    /*
     * Framing needs to know how big the product will be drawn and auto-fit needs to know how far
     * away it ended up, so the view runs them twice. Running them once, in one direction, judged an
     * 85 mm CCTV camera at true size and then drew it at 536 % — comfortably framed on paper, off
     * the top of the screen in the room.
     */
    const bad: string[] = [];
    for (const { code, category, dims } of CATALOGUE) {
      const rule = ruleFor(category);
      const surface = rule.surfaces[0];
      for (const pitchDeg of [10, 0, -10, -20]) {
        const R = cameraRotation({ pitchDeg });
        const first = framePlacement({ K, R, C, rule, dims, surface, view: VIEW });
        const mult = autoFitScale(dims, first.distanceM, K.fy).scale;
        const second = framePlacement({ K, R, C, rule, dims, surface, view: VIEW, scaleMult: mult });
        if (second.coverage < 0.85 && second.nudge === null) bad.push(`${code} @${pitchDeg}: ${(second.coverage * 100).toFixed(0)} % at x${mult} and no nudge`);
        /* And it must settle: a third pass may not disagree with the second. */
        const third = framePlacement({ K, R, C, rule, dims, surface, view: VIEW, scaleMult: autoFitScale(dims, second.distanceM, K.fy).scale });
        if (Math.abs(third.distanceM - second.distanceM) > 0.5)
          bad.push(`${code} @${pitchDeg}: does not settle, ${second.distanceM.toFixed(2)} then ${third.distanceM.toFixed(2)} m`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('horizontalHeading', () => {
  it('is defined when the phone points straight down, where the naive projection vanishes', () => {
    for (const pitchDeg of [-88, -89, -89.9, -90, 90, 89.9]) {
      const h = horizontalHeading(cameraRotation({ pitchDeg, yawDeg: 33 }));
      expect(Number.isFinite(h.x)).toBe(true);
      expect(Number.isFinite(h.z)).toBe(true);
      expect(Math.hypot(h.x, h.z)).toBeCloseTo(1, 6);
      expect(h.y).toBe(0);
    }
  });

  it('follows the camera when it has a heading to follow', () => {
    const a = horizontalHeading(cameraRotation({ pitchDeg: -20, yawDeg: 0 }));
    const b = horizontalHeading(cameraRotation({ pitchDeg: -20, yawDeg: 90 }));
    expect(Math.abs(a.x * b.x + a.z * b.z)).toBeLessThan(1e-6); // 90 degrees apart
  });
});

describe('placementFromPixel', () => {
  it('bounds how far a drag can throw the product', () => {
    /* The floor near the horizon: one pixel of drag used to be several metres of floor, and a drag
       that crossed the horizon line put the product 25 m away and then lost it. */
    const R = cameraRotation({ pitchDeg: -2 });
    const plane = surfacePlane('floor', R);
    for (let v = 620; v <= 700; v += 4) {
      const a = placementFromPixel({ K, R, C, u: 360, v, surface: 'floor', plane });
      if (a.kind === 'screen') throw new Error('screen anchor');
      const d = Math.hypot(a.P.x - C.x, a.P.y - C.y, a.P.z - C.z);
      expect(d).toBeLessThanOrEqual(PLACEMENT_DISTANCE_M[1] + 1e-6);
      expect(d).toBeGreaterThanOrEqual(PLACEMENT_DISTANCE_M[0] - 1e-6);
      /* Clamped along the ray, then dropped back onto the plane: still on the floor, never floating. */
      expect(a.P.y).toBeCloseTo(0, 6);
    }
  });

  it('places above the horizon rather than refusing', () => {
    /* `anchorFromPixel` returns null here, and null was rendered as an empty camera feed. */
    const R = cameraRotation({ pitchDeg: 10 });
    const a = placementFromPixel({ K, R, C, u: 360, v: 40, surface: 'floor', plane: surfacePlane('floor', R) });
    expect(a.kind).toBe('horizontal');
    if (a.kind === 'screen') return;
    expect(a.P.y).toBeCloseTo(0, 6);
  });
});

describe('idealViewingDistanceM', () => {
  it('scales with the product, the way a person steps back from a big one', () => {
    const tin = idealViewingDistanceM({ w_mm: 180, h_mm: 200, d_mm: 180 }, K, VIEW);
    const panel = idealViewingDistanceM({ w_mm: 1134, h_mm: 2278, d_mm: 35 }, K, VIEW);
    expect(tin).toBeLessThan(panel);
    expect(tin).toBeGreaterThanOrEqual(PLACEMENT_DISTANCE_M[0]);
    expect(panel).toBeLessThanOrEqual(PLACEMENT_DISTANCE_M[1]);
  });
});

describe('fitModelToDims', () => {
  it('leaves a mesh that already agrees with its product alone', () => {
    const fit = fitModelToDims({ x: 0.06, y: 0.11, z: 0.06 }, { w_mm: 60, h_mm: 110, d_mm: 60 });
    expect(fit.scale).toBeCloseTo(1, 6);
    expect(fit.rotation).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(fit.note).toBeNull();
  });

  it('stands up a CCTV camera the generator left on its side', () => {
    /* CCT-CPP-USC-TA24L2C-L: stated 70 x 70 x 163, mesh long axis on X. Height-only rescaling drew
       it 154 x 70 x 70 — the body pointing across the wall instead of out of it. */
    const fit = fitModelToDims({ x: 0.163, y: 0.074, z: 0.074 }, { w_mm: 70, h_mm: 70, d_mm: 163 });
    expect(fit.size.z).toBeCloseTo(0.163, 3);
    expect(fit.size.x).toBeCloseTo(0.074, 3);
  });

  it('unswaps an extinguisher whose width and depth were the wrong way round', () => {
    /* FIR-SAF-ABC-SP-6KG: stated 160 x 505 x 205, drawn 194 x 505 x 123 — facing sideways. */
    const fit = fitModelToDims({ x: 0.194, y: 0.505, z: 0.123 }, { w_mm: 160, h_mm: 505, d_mm: 205 });
    expect(fit.size.y).toBeCloseTo(0.505, 3);
    expect(fit.size.z).toBeGreaterThan(fit.size.x); // depth is the larger of the two, as stated
  });

  it('never mirrors a product', () => {
    /* A mirrored transform turns the lettering on a cement bag backwards, which is worse than any
       proportion error it might fix. Determinant +1 on every permutation this can produce. */
    const cases: [number, number, number][] = [
      [1, 2, 3],
      [3, 2, 1],
      [2, 1, 3],
      [1, 3, 2],
      [3, 1, 2],
      [2, 3, 1],
    ];
    for (const [x, y, z] of cases) {
      const m = fitModelToDims({ x, y, z }, { w_mm: 3000, h_mm: 2000, d_mm: 1000 }).rotation;
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 9);
    }
  });

  it('says so when the mesh cannot carry the stated proportions', () => {
    const fit = fitModelToDims({ x: 1, y: 1, z: 1 }, { w_mm: 600, h_mm: 1200, d_mm: 9 });
    expect(fit.note).toContain('differ from the stated size');
  });

  it('survives a mesh with no extent', () => {
    const fit = fitModelToDims({ x: 0, y: 0, z: 0 }, { w_mm: 60, h_mm: 110, d_mm: 60 });
    expect(fit.scale).toBe(1);
    expect(fit.note).toContain('no measurable extent');
  });
});
