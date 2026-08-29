import { describe, expect, it } from 'vitest';
import { detectSurfaces, gridFromRgba, horizonFromPitch, lightingOf, matchSurface, ruleFor, segment } from '../src/index';

/**
 * The on-device vision replaces a Gemini round trip, so it has to be tested the way the model
 * never was: against synthetic frames whose correct answer is known by construction.
 *
 * Each scene below is painted pixel by pixel — a wall meeting a floor at a known height, a bright
 * ceiling, a window in a wall — and then run through the whole path a real frame takes. If the
 * segmenter merges a wall into a floor, or gravity stops deciding which is which, these fail.
 */

const W = 320;
const H = 240;
const FY = 260; // ≈ a phone's vertical focal length at this frame height

interface Band {
  /** Fraction of the frame height where this band starts. */
  from: number;
  rgb: [number, number, number];
  /** Per-pixel noise amplitude, 0–255. Texture is what stops a region being flat. */
  noise?: number;
}

/** Paint horizontal bands — the layout of almost every indoor frame. */
function bands(list: Band[], w = W, h = H): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  // Deterministic pseudo-noise: a hash, not Math.random, so a failure is reproducible.
  const noiseAt = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) % 1000) / 1000 - 0.5;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let band = list[0];
    for (const b of list) if (t >= b.from) band = b;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const n = (band.noise ?? 0) * noiseAt(x, y) * 2;
      px[p] = band.rgb[0] + n;
      px[p + 1] = band.rgb[1] + n;
      px[p + 2] = band.rgb[2] + n;
      px[p + 3] = 255;
    }
  }
  return px;
}

const analyse = (px: Uint8ClampedArray, pitchDeg: number | null) => detectSurfaces({ grid: gridFromRgba(px, W, H), pitchDeg, fy: FY, height: H });

describe('horizonFromPitch', () => {
  it('is the inverse of the pitch the pose module derives from a horizon', () => {
    // Level: the horizon is the middle of the frame.
    expect(horizonFromPitch(0, H, FY)).toBeCloseTo(0.5, 5);
    // Looking down puts the horizon above the middle; looking up puts it below.
    expect(horizonFromPitch(-20, H, FY)).toBeLessThan(0.5);
    expect(horizonFromPitch(20, H, FY)).toBeGreaterThan(0.5);
  });
});

describe('segment', () => {
  it('keeps a wall and a floor apart rather than merging them into one flat region', () => {
    const grid = gridFromRgba(
      bands([
        { from: 0, rgb: [205, 203, 198] },
        { from: 0.6, rgb: [96, 82, 70] },
      ]),
      W,
      H,
    );
    const regions = segment(grid);
    expect(regions.length).toBeGreaterThanOrEqual(2);
    // The two largest are the two surfaces, and they differ in brightness.
    const [a, b] = regions;
    expect(Math.abs(a.luma - b.luma)).toBeGreaterThan(0.2);
  });

  it('refuses to seed a region on a busy surface', () => {
    // A heavily patterned frame has no plane in it, and saying so is the point.
    const grid = gridFromRgba(bands([{ from: 0, rgb: [140, 130, 120], noise: 190 }]), W, H);
    expect(segment(grid)).toHaveLength(0);
  });

  it('reports regions largest-first, so the dominant surface is the first answer', () => {
    const grid = gridFromRgba(
      bands([
        { from: 0, rgb: [210, 210, 205] },
        { from: 0.8, rgb: [70, 60, 55] },
      ]),
      W,
      H,
    );
    const regions = segment(grid);
    for (let i = 1; i < regions.length; i++) expect(regions[i - 1].area).toBeGreaterThanOrEqual(regions[i].area);
  });
});

describe('detectSurfaces', () => {
  it('calls the band below the horizon a floor and the one across it a wall', () => {
    // Camera level: horizon at 0.5. Wall above, floor below.
    const s = analyse(
      bands([
        { from: 0, rgb: [206, 204, 200] },
        { from: 0.62, rgb: [92, 78, 66], noise: 14 },
      ]),
      0,
    );
    const kinds = s.surfaces.filter((x) => x.confidence >= 0.35).map((x) => x.type);
    expect(kinds).toContain('wall');
    expect(kinds).toContain('floor');
  });

  it('uses gravity, not pixels, to decide which surface is which', () => {
    /*
     * The same image twice. Tilted down, the big flat area is underfoot and is a floor; tilted
     * up, the identical pixels are overhead. Nothing but the reported pitch changes, which is
     * exactly the cue a purely image-based detector does not have.
     */
    const px = bands([
      { from: 0, rgb: [150, 148, 145] },
      { from: 0.5, rgb: [205, 205, 202] },
    ]);
    const down = analyse(px, -35); // horizon off the top: everything in frame is underfoot
    const up = analyse(px, 35); // horizon off the bottom: everything in frame is overhead
    const best = (s: ReturnType<typeof analyse>, t: string) => Math.max(0, ...s.surfaces.filter((x) => x.type === t).map((x) => x.confidence));
    expect(best(down, 'floor')).toBeGreaterThan(best(up, 'floor'));
    expect(best(up, 'ceiling')).toBeGreaterThan(best(down, 'ceiling'));
  });

  it('finds a bright ceiling overhead', () => {
    // Pitch is POSITIVE here: looking up. The first version of this test passed -30 — looking
    // down — and then asserted a ceiling, which is the one thing that cannot be overhead when
    // the camera is tilted at the floor. The code was right and the test was wrong.
    const s = analyse(
      bands([
        { from: 0, rgb: [242, 242, 240] },
        { from: 0.55, rgb: [150, 145, 140] },
      ]),
      30,
    );
    expect(s.surfaces.some((x) => x.type === 'ceiling' && x.confidence >= 0.3)).toBe(true);
  });

  it('reports no surface at all when nothing is flat, instead of guessing', () => {
    const s = analyse(bands([{ from: 0, rgb: [130, 120, 110], noise: 200 }]), 0);
    expect(s.surfaces).toHaveLength(0);
    expect(s.freeArea).toBe(0);
    expect(s.notes).toContain('no flat region');
  });

  it('calls it outdoors when the sky is in frame, and unknown otherwise', () => {
    const sky = analyse(
      bands([
        { from: 0, rgb: [120, 170, 225] },
        { from: 0.45, rgb: [110, 100, 90], noise: 12 },
      ]),
      -8,
    );
    expect(sky.sceneType).toBe('exterior');
    const indoors = analyse(
      bands([
        { from: 0, rgb: [205, 203, 200] },
        { from: 0.65, rgb: [95, 82, 70], noise: 12 },
      ]),
      0,
    );
    expect(indoors.sceneType).toBe('unknown');
  });

  it('labels itself as the device, never as a model', () => {
    expect(analyse(bands([{ from: 0, rgb: [200, 200, 200] }]), 0).provider).toBe('device');
  });

  it('feeds the placement rules well enough to place a cement bag on a floor', () => {
    // The end-to-end point of all of it: pixels in, correct mount out, no API key involved.
    const s = analyse(
      bands([
        { from: 0, rgb: [206, 204, 200] },
        { from: 0.58, rgb: [92, 78, 66], noise: 14 },
      ]),
      -12,
    );
    expect(matchSurface(ruleFor('cement'), s).surface).toBe('floor');
    expect(matchSurface(ruleFor('tiles'), s).surface).toBe('floor');
    expect(matchSurface(ruleFor('cctv'), s).surface).toBe('wall');
  });
});

describe('lightingOf', () => {
  it('finds the bright side of the frame', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const v = x < W / 2 ? 40 : 220;
        px[p] = px[p + 1] = px[p + 2] = v;
        px[p + 3] = 255;
      }
    }
    expect(lightingOf(gridFromRgba(px, W, H)).direction).toBe('right');
  });

  it('calls a red-biased frame warm', () => {
    const warm = gridFromRgba(bands([{ from: 0, rgb: [220, 160, 110] }]), W, H);
    const cool = gridFromRgba(bands([{ from: 0, rgb: [110, 160, 220] }]), W, H);
    expect(lightingOf(warm).warm).toBe(true);
    expect(lightingOf(cool).warm).toBe(false);
  });
});
