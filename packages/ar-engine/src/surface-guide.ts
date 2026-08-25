import { SURFACE_LABEL } from './placement';
import type { PlacementRule, SceneAnalysis, Surface, SurfaceDetection } from './types';
import { rowForWallHeight } from './vision/depth';

/**
 * What surface a product needs, whether the camera is looking at one, and what to say when it
 * is not.
 *
 * The live-camera view used to answer all three questions with the word "wall". It filtered the
 * scene analysis for `type === 'wall'`, offered a Wall/Ceiling toggle, assumed every surface was
 * 2.2 m away, and told the user to "point camera at your wall or ceiling" — which is correct for
 * a bulb and wrong for the twenty-four SKUs that belong on the floor or the ground. A cement bag
 * could not be put on the floor at all: the only two mounts on offer were both vertical.
 *
 * Every fact needed to fix that already exists in PLACEMENT_RULES — `surfaces`, `surfaceLabel`,
 * `heightBandMm`, `minClearanceMm`. This module reads them instead of hard-coding one category's
 * answer, so adding a category stays what it has always been: one entry in the rules table.
 */

/** A detection is only worth acting on above this; below it the analysis is guessing. */
export const SURFACE_MIN_CONFIDENCE = 0.35;

/**
 * Surfaces that stand in for one another. A model that reports "floor" indoors and "ground"
 * outdoors is describing the same horizontal plane a cement bag rests on, and a rule that names
 * only one of them should still accept the other. Kept deliberately tight: a wall is never a
 * ceiling, because a wall-flush camera pointed at a ceiling is upside down.
 */
const EQUIVALENT: Partial<Record<Surface, Surface[]>> = {
  floor: ['ground'],
  ground: ['floor'],
  roof: ['ground', 'floor'],
  table: ['floor'],
  window: ['wall'],
};

/** Does a detected surface satisfy a surface the rule asked for? */
export function surfaceSatisfies(wanted: Surface, found: Surface): boolean {
  return wanted === found || (EQUIVALENT[wanted]?.includes(found) ?? false);
}

export interface SurfaceMatch {
  /** The rule surface the camera can currently satisfy, or null when none is in view. */
  surface: Surface | null;
  /** The detection that satisfied it. */
  detection: SurfaceDetection | null;
  /** 0–100, for the "locked" chip. */
  confidence: number;
}

/**
 * The best surface in view that this product is allowed to sit on.
 *
 * Rule order is preference order (PLACEMENT_RULES lists the primary surface first), so a CCTV
 * camera prefers a wall to a ceiling even when both are detected with equal confidence, and a
 * tile prefers the floor to a wall. Within one rule surface, the most confident detection wins.
 */
export function matchSurface(rule: PlacementRule, analysis: SceneAnalysis | null): SurfaceMatch {
  const found = (analysis?.surfaces ?? []).filter((s) => s.confidence >= SURFACE_MIN_CONFIDENCE);
  if (found.length === 0) return { surface: null, detection: null, confidence: 0 };
  for (const wanted of rule.surfaces) {
    const hits = found.filter((f) => surfaceSatisfies(wanted, f.type)).sort((a, b) => b.confidence - a.confidence);
    if (hits[0]) return { surface: wanted, detection: hits[0], confidence: Math.round(hits[0].confidence * 100) };
  }
  return { surface: null, detection: null, confidence: 0 };
}

/**
 * What to call the thing in a sentence: "Point your camera at a wall to place this camera."
 *
 * Deriving it from the product name does not work — trimming the last word of "Dahua
 * HAC-HDW1200TRQ" gives "this dahua", and of "UltraTech Portland Pozzolana Cement (PPC) 50 kg"
 * gives "this ultratech portland pozzolana cement (ppc) 50". The category already knows the
 * common noun, and the common noun is what a sentence wants.
 */
const CATEGORY_NOUN: Record<string, string> = {
  bulbs: 'bulb',
  cctv: 'camera',
  cement: 'cement bag',
  epoxy: 'epoxy kit',
  'fire-extinguishers': 'extinguisher',
  glass: 'glass panel',
  'solar-panels': 'solar panel',
  tiles: 'tile',
  'total-stations': 'total station',
  bathtub: 'bathtub',
};

/** "this bulb", "this cement bag", "this product" when the category has no noun written yet. */
export function productNoun(category: string): string {
  return `this ${CATEGORY_NOUN[category] ?? 'product'}`;
}

export type PromptTone = 'seek' | 'seeking' | 'ok';

export interface SurfacePrompt {
  tone: PromptTone;
  text: string;
}

/**
 * The sentence over the camera feed.
 *
 * This is the most-read text in the AR view, because it is what appears when nothing is working
 * yet. It is written for someone holding a phone in a half-built house, so it says the one thing
 * to do and names the surface in the words the rule uses: "Point your camera at a wall to place
 * this." — not "no valid placement surface detected".
 *
 * `seeking` is the state between "the camera just opened" and "the model has answered". Telling
 * someone their wall is missing before anything has looked at it is how a working feature gets
 * reported as broken.
 */
export function surfacePrompt(rule: PlacementRule, match: SurfaceMatch, analysed: boolean, noun = 'this product'): SurfacePrompt {
  if (match.surface) {
    const label = SURFACE_LABEL[match.surface] ?? match.surface;
    return { tone: 'ok', text: `${cap(label)} found — tap to place ${noun}, drag to move it.` };
  }
  if (!analysed) return { tone: 'seeking', text: 'Looking for a surface — move your phone slowly across the room.' };
  return { tone: 'seek', text: `Point your camera at ${article(rule.surfaceLabel)} to place ${noun}.` };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "a wall", "an open ground", "the floor" — small, but the prompt is read by everyone. */
function article(label: string): string {
  if (/^(the|a|an)\s/i.test(label)) return label;
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * How far in front of the camera a vertical surface is assumed to be, in metres.
 *
 * The live view used a single constant of 2.2 m for everything. That is a reasonable guess for
 * the wall a bulb goes on and badly wrong for a window across a room or a CCTV camera under a
 * soffit — the product landed at the wrong depth and therefore at the wrong apparent size, which
 * is the whole point of a true-scale view.
 *
 * When the analysis gives a bounding box we can do better than a constant: a surface that fills
 * the frame is close, one that occupies a corner is far. The box area is a crude proxy for
 * distance, but it is a proxy that moves in the right direction, and it is clamped to a band
 * that no room violates.
 */
export const DEFAULT_SURFACE_DISTANCE_M = 2.2;
export const MIN_SURFACE_DISTANCE_M = 0.6;
export const MAX_SURFACE_DISTANCE_M = 8;

export function surfaceDistanceM(surface: Surface, match: SurfaceMatch): number {
  // Horizontal surfaces are solved by the ray/plane intersection from the camera height; the
  // distance below is only consulted for the vertical ones, which have no such constraint.
  if (surface === 'floor' || surface === 'ground' || surface === 'ceiling' || surface === 'roof' || surface === 'table') {
    return DEFAULT_SURFACE_DISTANCE_M;
  }
  /*
   * A measurement always beats an estimate. When the base of the wall is visible the on-device
   * analyser has already solved its distance exactly from the floor line (see vision/depth.ts),
   * and that is the number to use.
   */
  const measured = match.detection?.distanceM;
  if (measured !== undefined && Number.isFinite(measured)) {
    return Math.max(MIN_SURFACE_DISTANCE_M, Math.min(MAX_SURFACE_DISTANCE_M, measured));
  }
  /*
   * Otherwise fall back to the region's apparent size. This is a genuine guess and it is only
   * reached when the floor is out of frame — pointing straight at a wall, for instance, where
   * there is no geometric constraint available at all.
   */
  const bbox = match.detection?.bbox;
  if (!bbox) return DEFAULT_SURFACE_DISTANCE_M;
  const area = Math.max(0.01, Math.min(1, bbox[2] * bbox[3]));
  // A wall filling the frame reads ~1.2 m; a quarter of the frame reads ~2.4 m; a sliver ~6 m.
  const d = DEFAULT_SURFACE_DISTANCE_M / Math.sqrt(area * 3.3);
  return Math.max(MIN_SURFACE_DISTANCE_M, Math.min(MAX_SURFACE_DISTANCE_M, Number(d.toFixed(2))));
}

/**
 * Where in the frame to drop the product before the user has tapped anything.
 *
 * Returned as normalised [u, v] of the *visible* frame. A wall-mounted product wants the upper
 * third — a fire extinguisher at a metre, a CCTV camera under the ceiling — while anything that
 * rests on the ground wants the lower third, because that is where the floor is in a photograph
 * taken by a standing person. The old view dropped everything at y = 0.35, which put a cement
 * bag in mid-air.
 */
export function defaultDropPoint(rule: PlacementRule, surface: Surface): { u: number; v: number } {
  if (surface === 'ceiling') return { u: 0.5, v: 0.2 };
  if (surface === 'floor' || surface === 'ground' || surface === 'table' || surface === 'roof') return { u: 0.5, v: 0.68 };
  // Vertical: use the rule's own mounting band to choose high or mid wall.
  const band = rule.heightBandMm;
  if (band && band[0] >= 1800) return { u: 0.5, v: 0.28 };
  if (band && band[1] <= 1400) return { u: 0.5, v: 0.55 };
  return { u: 0.5, v: 0.42 };
}

export interface DropGeometry {
  pitchDeg: number | null;
  fy: number;
  /** Full frame height in pixels; the principal point is taken as its centre. */
  height: number;
  cameraHeightM: number;
  /** Measured or estimated distance to the surface. */
  distanceM: number;
}

/**
 * Where to put the product, solved rather than guessed.
 *
 * `defaultDropPoint` returns a fixed fraction of the frame per mount type, which is a reasonable
 * approximation at a typical downward tilt and visibly wrong when the phone is held level — the
 * case a person is most likely to be in when they point it at a wall. Given the camera's pitch,
 * its height and the distance to the surface, the row a real mounting height projects to is
 * arithmetic, so this uses it and falls back to the fraction only when the geometry is unknown.
 *
 * The horizontal position stays centred: nothing in the frame tells us where along the wall a
 * person wants the product, and they can drag it.
 */
export function dropPointFor(rule: PlacementRule, surface: Surface, geo: DropGeometry | null): { u: number; v: number } {
  const fallback = defaultDropPoint(rule, surface);
  if (!geo || geo.pitchDeg === null || !(geo.height > 0)) return fallback;

  // Only vertical mounts have a height to solve for; horizontal ones are pinned by the plane.
  const vertical = surface === 'wall' || surface === 'window';
  if (!vertical) return fallback;

  /* The middle of the rule's own mounting band, or eye level when it declares none. */
  const band = rule.heightBandMm;
  const heightM = band ? (band[0] + band[1]) / 2 / 1000 : 1.5;
  const row = rowForWallHeight(heightM, geo.distanceM, geo.pitchDeg, geo.fy, geo.height / 2, geo.cameraHeightM);
  if (row === null) return fallback;

  const v = row / geo.height;
  /* Off-frame means the product genuinely is not in view at this angle — keep it just inside the
     edge so it can be seen and dragged, rather than anchoring it somewhere invisible. */
  return { u: 0.5, v: Math.max(0.06, Math.min(0.94, v)) };
}

/**
 * Whether the product needs a run of clear surface rather than a point — a solar array needs
 * roof, a tile field needs floor. `freeArea` is the analysis's estimate of how much of the best
 * surface is unobstructed; below the threshold the product would be placed through furniture.
 */
export function needsOpenArea(rule: PlacementRule): boolean {
  return rule.category === 'solar-panels' || rule.category === 'tiles' || rule.minClearanceMm >= 200;
}

export function hasOpenArea(rule: PlacementRule, analysis: SceneAnalysis | null): boolean {
  if (!needsOpenArea(rule)) return true;
  if (!analysis) return true; // nothing measured yet is not a refusal
  return analysis.freeArea >= 0.25;
}

/** The follow-on sentence when the surface is right but there is not enough of it. */
export function areaPrompt(rule: PlacementRule): string {
  return `Not enough clear ${rule.surfaceLabel} in view — step back so more of it is in frame.`;
}
