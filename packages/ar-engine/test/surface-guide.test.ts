import { describe, expect, it } from 'vitest';
import {
  areaPrompt,
  defaultDropPoint,
  hasOpenArea,
  matchSurface,
  needsOpenArea,
  productNoun,
  ruleFor,
  surfaceDistanceM,
  surfacePrompt,
  surfaceSatisfies,
} from '../src/index';
import type { SceneAnalysis, Surface, SurfaceDetection } from '../src/types';

/**
 * The live camera cannot be driven in CI — there is no camera and no vision model — so the rules
 * that decide what it does are tested here instead. Every case below is a real SKU's category:
 * these nine assertions are the difference between "AR works for the bulb" and "AR works".
 */

const scene = (surfaces: SurfaceDetection[], freeArea = 0.6): SceneAnalysis => ({
  sceneType: 'living_room',
  sceneConfidence: 0.9,
  surfaces,
  references: [],
  freeArea,
  horizonY: 0.5,
  lighting: { direction: 'left', warm: false, brightness: 0.5 },
  provider: 'gemini',
});
const at = (type: Surface, confidence: number, bbox?: [number, number, number, number]): SurfaceDetection => ({ type, confidence, ...(bbox ? { bbox } : {}) });

describe('matchSurface', () => {
  it('gives every live category the surface it actually belongs on', () => {
    // The bug this replaces: the view matched the literal string 'wall' for all of them, so the
    // twenty-four SKUs below could only ever be mounted on a wall.
    const room = scene([at('wall', 0.9), at('floor', 0.8), at('ceiling', 0.6)]);
    const expected: [string, Surface][] = [
      ['bulbs', 'ceiling'],
      ['cctv', 'wall'],
      ['cement', 'floor'],
      ['epoxy', 'floor'],
      ['fire-extinguishers', 'wall'],
      ['glass', 'window'],
      ['tiles', 'floor'],
      ['total-stations', 'ground'],
    ];
    for (const [category, surface] of expected) {
      expect(matchSurface(ruleFor(category), room).surface, category).toBe(surface);
    }
  });

  it('accepts ground where a rule asked for floor, and floor where it asked for ground', () => {
    // A cement bag outdoors sits on "ground"; the rule names "floor" first. Same plane.
    expect(matchSurface(ruleFor('cement'), scene([at('ground', 0.8)])).surface).toBe('floor');
    // A total station indoors: the rule names "ground" first, the room reports "floor".
    expect(matchSurface(ruleFor('total-stations'), scene([at('floor', 0.8)])).surface).toBe('ground');
  });

  it('never treats a wall as a ceiling', () => {
    expect(surfaceSatisfies('ceiling', 'wall')).toBe(false);
    expect(surfaceSatisfies('wall', 'ceiling')).toBe(false);
  });

  it('follows the rule preference order, not the confidence order', () => {
    // CCTV is ['wall', 'ceiling']; the ceiling here is the more confident detection.
    const m = matchSurface(ruleFor('cctv'), scene([at('ceiling', 0.95), at('wall', 0.5)]));
    expect(m.surface).toBe('wall');
  });

  it('ignores a detection the model is not confident about', () => {
    expect(matchSurface(ruleFor('cctv'), scene([at('wall', 0.2)])).surface).toBeNull();
  });

  it('reports no surface rather than the wrong one', () => {
    // A cement bag in front of a bare wall has nowhere to go, and must say so.
    expect(matchSurface(ruleFor('cement'), scene([at('wall', 0.95)])).surface).toBeNull();
  });
});

describe('surfacePrompt', () => {
  it('names the surface the product needs, in the rule’s own words', () => {
    const p = surfacePrompt(ruleFor('cctv'), { surface: null, detection: null, confidence: 0 }, true, productNoun('cctv'));
    expect(p.tone).toBe('seek');
    expect(p.text).toBe('Point your camera at a wall or ceiling, high up to place this camera.');
  });

  it('asks for the floor for a cement bag and the ground for a total station', () => {
    const none = { surface: null, detection: null, confidence: 0 };
    expect(surfacePrompt(ruleFor('cement'), none, true, productNoun('cement')).text).toContain('at a floor to place this cement bag');
    expect(surfacePrompt(ruleFor('total-stations'), none, true, productNoun('total-stations')).text).toContain(
      'open ground or a site to place this total station',
    );
  });

  it('does not claim a surface is missing before anything has looked for one', () => {
    const p = surfacePrompt(ruleFor('bulbs'), { surface: null, detection: null, confidence: 0 }, false);
    expect(p.tone).toBe('seeking');
    expect(p.text).not.toContain('Point your camera');
  });

  it('switches to an instruction once the surface is found', () => {
    const p = surfacePrompt(ruleFor('tiles'), { surface: 'floor', detection: at('floor', 0.9), confidence: 90 }, true, productNoun('tiles'));
    expect(p.tone).toBe('ok');
    expect(p.text).toBe('Floor found — tap to place this tile, drag to move it.');
  });

  it('never says "this dahua"', () => {
    // Trimming the product name produced exactly that; the noun comes from the category.
    expect(productNoun('cctv')).toBe('this camera');
    expect(productNoun('cement')).toBe('this cement bag');
    expect(productNoun('nothing-yet')).toBe('this product');
  });
});

describe('defaultDropPoint', () => {
  it('drops a ground product low in frame and a high-mounted one high', () => {
    // y = 0.35 for everything put every cement bag, tile and total station in mid-air.
    expect(defaultDropPoint(ruleFor('cement'), 'floor').v).toBeGreaterThan(0.6);
    expect(defaultDropPoint(ruleFor('tiles'), 'floor').v).toBeGreaterThan(0.6);
    expect(defaultDropPoint(ruleFor('cctv'), 'wall').v).toBeLessThan(0.35); // band starts at 2200 mm
    expect(defaultDropPoint(ruleFor('fire-extinguishers'), 'wall').v).toBeGreaterThan(0.5); // band tops out at 1200 mm
    expect(defaultDropPoint(ruleFor('bulbs'), 'ceiling').v).toBeLessThan(0.3);
  });
});

describe('surfaceDistanceM', () => {
  it('reads a wall filling the frame as closer than a wall in the corner', () => {
    const near = surfaceDistanceM('wall', { surface: 'wall', detection: at('wall', 0.9, [0, 0, 1, 1]), confidence: 90 });
    const far = surfaceDistanceM('wall', { surface: 'wall', detection: at('wall', 0.9, [0.7, 0.1, 0.2, 0.2]), confidence: 90 });
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThanOrEqual(0.6);
    expect(far).toBeLessThanOrEqual(8);
  });

  it('falls back to the default when there is no bounding box', () => {
    expect(surfaceDistanceM('wall', { surface: 'wall', detection: at('wall', 0.9), confidence: 90 })).toBe(2.2);
  });
});

describe('open area', () => {
  it('requires clear space for a solar array and a tile field, not for a bulb', () => {
    expect(needsOpenArea(ruleFor('solar-panels'))).toBe(true);
    expect(needsOpenArea(ruleFor('tiles'))).toBe(true);
    expect(needsOpenArea(ruleFor('bulbs'))).toBe(false);
  });

  it('refuses a cluttered surface for a solar panel and explains what to do', () => {
    expect(hasOpenArea(ruleFor('solar-panels'), scene([at('ground', 0.9)], 0.1))).toBe(false);
    expect(hasOpenArea(ruleFor('solar-panels'), scene([at('ground', 0.9)], 0.5))).toBe(true);
    expect(areaPrompt(ruleFor('solar-panels'))).toContain('step back');
  });

  it('does not refuse before anything has been measured', () => {
    expect(hasOpenArea(ruleFor('solar-panels'), null)).toBe(true);
  });
});
