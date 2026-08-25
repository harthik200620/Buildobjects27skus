import { describe, expect, it } from 'vitest';
import {
  analyzeFromGrid,
  defaultAnchor,
  estimateScale,
  fidelityScore,
  gate,
  lumaGridFromRgba,
  PLACEMENT_RULES,
  placementFor,
  ruleFor,
  type SceneAnalysis,
  type SceneType,
  type SurfaceDetection,
} from '../src';

/**
 * The 12-photo gating test set. Each case is a scene analysis as the vision
 * provider returns it — room type + visible surfaces — and the product category being placed.
 * The expectation is what a buyer must see: placed on the right surface, or refused with the
 * guidance chip. Pure and deterministic, so it runs in CI without a camera.
 */
const scene = (sceneType: SceneType, surfaces: SurfaceDetection[], extra: Partial<SceneAnalysis> = {}): SceneAnalysis => ({
  sceneType,
  sceneConfidence: 0.9,
  surfaces,
  references: [],
  freeArea: 0.6,
  horizonY: 0.45,
  lighting: { direction: 'left', warm: true, brightness: 0.5 },
  provider: 'gemini',
  ...extra,
});
const S = (type: SurfaceDetection['type'], confidence = 0.85): SurfaceDetection => ({ type, confidence, bbox: [0, 0, 1, 1] });

const CASES: { id: number; photo: string; category: string; analysis: SceneAnalysis; expect: 'place' | 'refuse'; surface?: string }[] = [
  {
    id: 1,
    photo: 'living room, ceiling + wall + floor visible',
    category: 'bulbs',
    analysis: scene('living_room', [S('ceiling'), S('wall'), S('floor')]),
    expect: 'place',
    surface: 'ceiling',
  },
  { id: 2, photo: 'corridor, only the floor in frame', category: 'bulbs', analysis: scene('corridor', [S('floor')]), expect: 'refuse' },
  { id: 3, photo: 'bathroom wall with tiles', category: 'tiles', analysis: scene('bathroom', [S('wall'), S('floor', 0.6)]), expect: 'place', surface: 'floor' },
  {
    id: 4,
    photo: 'bedroom, bed fills the frame, no free surface',
    category: 'tiles',
    analysis: scene('bedroom', [S('wall', 0.2), S('floor', 0.25)]),
    expect: 'refuse',
  },
  { id: 5, photo: 'office wall, high up', category: 'cctv', analysis: scene('office', [S('wall'), S('ceiling', 0.7)]), expect: 'place', surface: 'wall' },
  {
    id: 6,
    photo: 'open construction site',
    category: 'total-stations',
    analysis: scene('site', [S('ground'), S('floor', 0.5)]),
    expect: 'place',
    surface: 'ground',
  },
  { id: 7, photo: 'bedroom floor', category: 'total-stations', analysis: scene('bedroom', [S('floor')]), expect: 'refuse' },
  { id: 8, photo: 'flat roof from above', category: 'solar-panels', analysis: scene('roof', [S('roof'), S('ground', 0.4)]), expect: 'place', surface: 'roof' },
  { id: 9, photo: 'living room floor (solar panel)', category: 'solar-panels', analysis: scene('living_room', [S('floor'), S('wall')]), expect: 'refuse' },
  {
    id: 10,
    photo: 'living room (the canonical bathtub refusal)',
    category: 'bathtub',
    analysis: scene('living_room', [S('floor'), S('wall')]),
    expect: 'refuse',
  },
  {
    id: 11,
    photo: 'bathroom floor against a wall',
    category: 'bathtub',
    analysis: scene('bathroom', [S('floor'), S('wall')]),
    expect: 'place',
    surface: 'floor',
  },
  { id: 12, photo: 'window wall in a bedroom', category: 'glass', analysis: scene('bedroom', [S('window'), S('wall')]), expect: 'place', surface: 'window' },
];

describe('scene gate — 12-photo test set', () => {
  for (const c of CASES) {
    it(`#${c.id} ${c.category} in ${c.photo} → ${c.expect}${c.surface ? ` on ${c.surface}` : ''}`, () => {
      const r = gate(ruleFor(c.category), c.analysis);
      expect(r.allowed).toBe(c.expect === 'place');
      if (c.expect === 'place') expect(r.surface).toBe(c.surface);
      else {
        expect(r.guidance).toMatch(/^Point at a |^Step back/);
        expect(r.reason.length).toBeGreaterThan(8);
      }
    });
  }
  it('unknown scenes never refuse on scene type alone — only on missing surfaces', () => {
    const r = gate(ruleFor('bathtub'), scene('unknown', [S('floor')], { sceneConfidence: 0.2 }));
    expect(r.allowed).toBe(true);
  });
  it('every catalogue category has a rule with at least one surface and a guidance label', () => {
    for (const cat of ['bulbs', 'cctv', 'tiles', 'glass', 'solar-panels', 'fire-extinguishers', 'cement', 'epoxy', 'total-stations']) {
      const rule = PLACEMENT_RULES[cat];
      expect(rule, cat).toBeDefined();
      expect(rule.surfaces.length).toBeGreaterThan(0);
      expect(rule.surfaceLabel.length).toBeGreaterThan(3);
    }
  });
});

describe('true scale', () => {
  it('a 2030 mm door spanning 400 px gives 5.075 mm/px; manual calibration overrides', () => {
    const s = scene('living_room', [S('wall')], { references: [{ kind: 'door', realMm: 2030, px: 400, confidence: 0.8 }] });
    expect(estimateScale(s).mmPerPx).toBeCloseTo(5.075, 3);
    expect(estimateScale(s, { px: 500, realMm: 2030 }).mmPerPx).toBeCloseTo(4.06, 2);
    expect(estimateScale(scene('living_room', [S('wall')])).source).toBe('default');
  });
  it('a bulwall bulb renders at its radial (≈square) footprint for a known scale — the length protrudes out of the wall', () => {
    const s = scene('living_room', [S('ceiling')], { references: [{ kind: 'door', realMm: 2030, px: 400, confidence: 0.9 }] });
    const p = placementFor({
      rule: ruleFor('bulbs'),
      dims: { w_mm: 60, h_mm: 110, d_mm: 60 },
      scene: s,
      scale: estimateScale(s),
      surface: 'wall',
      x: 0.5,
      y: 0.3,
      photoWidthPx: 1000,
      photoHeightPx: 1000,
    });
    // On a wall a protruding bulb presents its 60 mm diameter in both axes (the 110 mm length is
    // depth along the wall normal), so the placement rect is ~square and honest to mmPerPx.
    const expected = 60 / 5.075 / 1000;
    expect(Math.abs(p.w - expected) / expected).toBeLessThan(0.1);
    expect(Math.abs(p.h - expected) / expected).toBeLessThan(0.1);
  });
  it('floor items get larger as they come nearer the camera', () => {
    const s = scene('living_room', [S('floor')]);
    const far = placementFor({
      rule: ruleFor('cement'),
      dims: { w_mm: 450, h_mm: 700, d_mm: 140 },
      scene: s,
      scale: estimateScale(s),
      surface: 'floor',
      x: 0.5,
      y: 0.6,
      photoWidthPx: 1000,
      photoHeightPx: 1000,
    });
    const near = placementFor({
      rule: ruleFor('cement'),
      dims: { w_mm: 450, h_mm: 700, d_mm: 140 },
      scene: s,
      scale: estimateScale(s),
      surface: 'floor',
      x: 0.5,
      y: 0.9,
      photoWidthPx: 1000,
      photoHeightPx: 1000,
    });
    expect(near.w).toBeGreaterThan(far.w);
  });
  it('default anchors land in the right band per surface', () => {
    const s = scene('living_room', [S('ceiling'), S('wall'), S('floor')]);
    expect(defaultAnchor(ruleFor('bulbs'), 'ceiling', s).y).toBeLessThan(0.6);
    expect(defaultAnchor(ruleFor('cement'), 'floor', s).y).toBeGreaterThan(0.6);
  });
});

describe('fallback analyser + fidelity', () => {
  it('reads a bright-top / dark-bottom grid as ceiling + floor', () => {
    const w = 64,
      h = 64,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const l = y < h * 0.3 ? 235 : y > h * 0.65 ? 60 : 150;
        data[i] = data[i + 1] = data[i + 2] = l;
        data[i + 3] = 255;
      }
    const a = analyzeFromGrid(lumaGridFromRgba(data, w, h), 'living_room', w, h);
    expect(a.surfaces.find((s) => s.type === 'ceiling')?.confidence ?? 0).toBeGreaterThan(0.3);
    expect(a.surfaces.find((s) => s.type === 'floor')?.confidence ?? 0).toBeGreaterThan(0.4);
    expect(a.provider).toBe('mock');
  });
  it('fidelity: same colours score high, a different product scores low', () => {
    const px = (r: number, g: number, b: number, n = 500) => {
      const a = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        a[i * 4] = r;
        a[i * 4 + 1] = g;
        a[i * 4 + 2] = b;
        a[i * 4 + 3] = 255;
      }
      return a;
    };
    expect(fidelityScore(px(200, 30, 30), px(190, 40, 35))).toBeGreaterThan(0.7); // same product, slightly different light
    expect(fidelityScore(px(200, 30, 30), px(30, 30, 200))).toBeLessThan(0.3); // a different-looking product
    expect(fidelityScore(px(200, 30, 30), px(200, 30, 30))).toBeCloseTo(1, 5);
  });
});
