import { clamp01 } from '@buildobjects/catalog';
import type { SceneAnalysis, SceneType, Surface, SurfaceDetection } from '../types';
import { wallDistanceFromFloorLine } from './depth';
import { type CellGrid, gridMean, sobel } from './frame';

/**
 * Where the surfaces are, worked out on the device.
 *
 * Sending every third frame to Gemini works and costs an API key, a round trip and a per-frame
 * bill, so AR only ran for whoever had all three. This segments the frame into flat regions and
 * decides what each one is using the strongest cue a phone has: gravity. The device reports its
 * orientation, so the horizon is known geometry rather than something to infer — flat and wide
 * below it is floor, flat and bright above it is ceiling, straddling it is a wall. Vision alone
 * has to find vanishing points and gets a corridor wrong.
 *
 * It deliberately does NOT name the room. A luminance grid cannot say "kitchen", and pretending
 * otherwise is how a placement gate starts refusing a cement bag in a bedroom for imaginary
 * reasons. It reports `unknown` unless the sky is visible.
 */

/** Cells merge into one region while they are this close in brightness. */
const LUMA_TOLERANCE = 0.1;
/** …and this close in colour, summed across both opponent channels. */
const CHROMA_TOLERANCE = 0.14;
/** A cell busier than this is texture, not a plane, and never seeds a region. */
const TEXTURE_MAX = 0.16;
/** A structural edge this strong is a boundary between surfaces; regions never cross it. */
const EDGE_MAX = 0.55;
/** Regions smaller than this fraction of the frame are noise. */
const MIN_AREA = 0.03;
/** How far from the horizon a region's centroid must sit to be called above or below it. */
const HORIZON_MARGIN = 0.06;

export interface Region {
  cells: number;
  /** Normalised [x, y, w, h]. */
  bbox: [number, number, number, number];
  cx: number;
  cy: number;
  luma: number;
  /** Mean red-green and blue-yellow opponents — what makes sky separable from a bright wall. */
  cr: number;
  cb: number;
  texture: number;
  /** Fraction of the frame. */
  area: number;
}

/**
 * Flood-fill the grid into flat regions.
 *
 * Four-connected on purpose: eight-connected leaks diagonally across the thin bright line where a
 * wall meets a ceiling, which merges the two into one region and loses both.
 */
export function segment(grid: CellGrid): Region[] {
  const { cols, rows, luma, cr, cb, texture } = grid;
  const { mag } = sobel(grid);
  const n = cols * rows;
  const label = new Int32Array(n).fill(-1);
  const regions: Region[] = [];
  const stack: number[] = [];

  for (let seed = 0; seed < n; seed++) {
    if (label[seed] >= 0 || texture[seed] > TEXTURE_MAX || mag[seed] > EDGE_MAX) continue;
    const id = regions.length;
    stack.length = 0;
    stack.push(seed);
    label[seed] = id;
    let cells = 0;
    let sumL = 0;
    let sumCr = 0;
    let sumCb = 0;
    let sumT = 0;
    let minC = cols;
    let maxC = -1;
    let minR = rows;
    let maxR = -1;
    let sumC = 0;
    let sumR = 0;

    while (stack.length) {
      const i = stack.pop() as number;
      const c = i % cols;
      const r = (i / cols) | 0;
      cells += 1;
      sumL += luma[i];
      sumCr += cr[i];
      sumCb += cb[i];
      sumT += texture[i];
      sumC += c;
      sumR += r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;

      const neighbours = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1];
      for (const j of neighbours) {
        if (j < 0 || label[j] >= 0) continue;
        if (mag[j] > EDGE_MAX) continue;
        if (Math.abs(luma[j] - luma[i]) > LUMA_TOLERANCE) continue;
        if (Math.abs(cr[j] - cr[i]) + Math.abs(cb[j] - cb[i]) > CHROMA_TOLERANCE) continue;
        label[j] = id;
        stack.push(j);
      }
    }

    const area = cells / n;
    if (area < MIN_AREA) {
      // Too small to be a surface: release the labels so a larger neighbour can claim them.
      for (let i = 0; i < n; i++) if (label[i] === id) label[i] = -2;
      continue;
    }
    regions.push({
      cells,
      bbox: [minC / cols, minR / rows, (maxC - minC + 1) / cols, (maxR - minR + 1) / rows],
      cx: sumC / cells / cols,
      cy: sumR / cells / rows,
      luma: sumL / cells,
      cr: sumCr / cells,
      cb: sumCb / cells,
      texture: sumT / cells,
      area,
    });
  }
  return regions.sort((a, b) => b.area - a.area);
}

/**
 * The horizon, in normalised frame coordinates, from the camera's pitch.
 *
 * The inverse of `pitchFromHorizon` in live/pose.ts — the same relation read the other way, which
 * is the direction that matters once the device is telling us its orientation instead of us
 * guessing it from the image.
 */
export function horizonFromPitch(pitchDeg: number, H: number, fy: number): number {
  const dv = Math.tan((pitchDeg * Math.PI) / 180) * fy;
  return (H / 2 + dv) / H;
}

export interface DetectInput {
  grid: CellGrid;
  /** Camera pitch in degrees; negative looks down. Null when the device has no orientation sensor. */
  pitchDeg: number | null;
  /** Vertical focal length in pixels, and the frame height, for the horizon. */
  fy: number;
  height: number;
  /** Height of the camera above the floor, metres — what turns the floor line into a distance. */
  cameraHeightM?: number;
}

/**
 * Classify every region and return the scene.
 *
 * Confidence is deliberately a product of three independent things — how large the region is, how
 * flat it is, and how well it agrees with where gravity says that surface should be. A big flat
 * region in the wrong place scores low, and so does a small flat one in the right place. Only
 * agreement on all three clears the 0.35 the placement code requires.
 */
export function detectSurfaces(input: DetectInput): SceneAnalysis {
  const { grid, pitchDeg, fy, height, cameraHeightM = 1.4 } = input;
  const regions = segment(grid);
  const meanLuma = gridMean(grid.luma);

  /* With no gyro, fall back to the frame's own middle. It is a worse prior than gravity and it is
     the same one the photo path has always used, so the behaviour degrades rather than breaks. */
  const horizonY = pitchDeg === null ? 0.5 : Math.max(-0.4, Math.min(1.4, horizonFromPitch(pitchDeg, height, fy)));

  const surfaces: SurfaceDetection[] = [];
  const push = (type: Surface, confidence: number, r: Region) => {
    if (confidence < 0.2) return;
    surfaces.push({ type, confidence: clamp01(confidence), bbox: r.bbox });
  };

  let sawSky = false;
  let sawCeiling = false;
  let biggest = 0;

  for (const r of regions) {
    biggest = Math.max(biggest, r.area);
    const size = clamp01((r.area - MIN_AREA) * 3.2); // 0 at the floor of usefulness, 1 by ~35%
    const flat = clamp01(1 - r.texture / TEXTURE_MAX);
    const wide = r.bbox[2] > 0.45;

    /*
     * A region is classified by what it SPANS, not by where its centroid sits.
     *
     * Centroid was the first attempt and it mislabelled the commonest frame there is: a wall
     * filling the top 58% of the image has its middle above the horizon, so a level camera
     * pointed at a wall and a floor reported a ceiling and no wall at all. What makes something a
     * wall is that the horizon runs through it — so that is the test.
     */
    const top = r.bbox[1];
    const bottom = r.bbox[1] + r.bbox[3];
    const spansHorizon = top < horizonY - HORIZON_MARGIN && bottom > horizonY + HORIZON_MARGIN;
    const below = !spansHorizon && top >= horizonY - HORIZON_MARGIN;
    const above = !spansHorizon && bottom <= horizonY + HORIZON_MARGIN;

    /*
     * Sky: bright, BLUE, touching the top of the frame, and sitting mostly above the horizon.
     *
     * The blue is the load-bearing half — without it a white wall reaching the top of an indoor
     * frame reads as sky, reports the room as outdoors, and refuses everything meant for indoors.
     *
     * Tested before the above/below/span split rather than inside it, because sky is the one
     * region that legitimately touches the horizon: that is what a horizon is. Requiring it to
     * sit entirely above the line meant a sky band ending 1% past it was classified as a wall.
     */
    if (r.bbox[1] < 0.08 && wide && r.luma > 0.45 && r.cb > 0.06 && r.cy < horizonY + HORIZON_MARGIN) {
      sawSky = true;
      continue; // sky is not a surface anything is placed on
    }

    if (below) {
      /* Floor and ground are the same plane; which word is right depends on whether we are
         indoors, and the placement rules already treat them as interchangeable. */
      push('floor', size * flat * (wide ? 1 : 0.7) * 0.95, r);
      continue;
    }
    if (above) {
      // A ceiling is flat, bright, and overhead. A dark region overhead is usually a soffit or
      // the underside of something, not a surface to hang a light from.
      const bright = clamp01((r.luma - meanLuma + 0.12) * 4);
      const conf = size * flat * bright;
      if (conf > 0.2) sawCeiling = true;
      push('ceiling', conf, r);
      continue;
    }
    // Spans the horizon: the flat thing you are looking straight at.
    const tall = clamp01(r.bbox[3] * 2.4);
    push('wall', size * flat * (0.6 + 0.4 * tall), r);
  }

  /*
   * Measure the wall, rather than assuming it.
   *
   * The highest row the floor reaches is the line where the floor runs into the wall, and that
   * line is at a distance the camera's own pitch and height determine exactly. Attaching it to
   * the wall detection is what lets the placement render a product at its true projected size
   * instead of at whatever a 2.2 m constant implied.
   */
  if (pitchDeg !== null) {
    const floors = surfaces.filter((s2) => s2.type === 'floor' && s2.bbox);
    const walls = surfaces.filter((s2) => s2.type === 'wall');
    if (floors.length && walls.length) {
      const floorTopRow = Math.min(...floors.map((f) => (f.bbox as [number, number, number, number])[1])) * height;
      const d = wallDistanceFromFloorLine(floorTopRow, pitchDeg, fy, height / 2, cameraHeightM);
      if (d !== null) for (const w of walls) w.distanceM = d;
    }
  }

  /*
   * Windows: a compact, much-brighter-than-everything region sitting inside the wall band. Found
   * by looking at cells rather than regions, because a blown-out window is usually saturated and
   * therefore textureless in a way that makes it merge with whatever surrounds it.
   */
  const win = brightPatch(grid, horizonY, meanLuma);
  if (win) surfaces.push(win);

  /* Outdoors when the sky is visible; indoors when a ceiling is. Both, or neither, is unknown —
     which is the honest answer and the one the placement rules handle. */
  const sceneType: SceneType = sawSky && !sawCeiling ? 'exterior' : 'unknown';

  if (!surfaces.length) {
    /* Nothing flat enough to place on. Reporting an empty list is what makes the UI say "point
       your camera at a wall" instead of anchoring a product to noise. */
    return {
      sceneType,
      sceneConfidence: 0.2,
      surfaces: [],
      references: [],
      freeArea: 0,
      horizonY,
      lighting: lightingOf(grid),
      provider: 'device',
      notes: 'no flat region large enough to place on',
    };
  }

  return {
    sceneType,
    sceneConfidence: sawSky || sawCeiling ? 0.6 : 0.3,
    surfaces: surfaces.sort((a, b) => b.confidence - a.confidence),
    references: [],
    freeArea: clamp01(biggest * 1.6),
    horizonY,
    lighting: lightingOf(grid),
    provider: 'device',
  };
}

/** The brightest compact patch in the wall band, if it is bright enough to be an opening. */
function brightPatch(grid: CellGrid, horizonY: number, meanLuma: number): SurfaceDetection | null {
  const { cols, rows, luma } = grid;
  const r0 = Math.max(0, Math.floor((horizonY - 0.35) * rows));
  const r1 = Math.min(rows, Math.ceil((horizonY + 0.25) * rows));
  let minC = cols;
  let maxC = -1;
  let minR = rows;
  let maxR = -1;
  let hits = 0;
  const threshold = Math.max(0.72, meanLuma + 0.3);
  for (let r = r0; r < r1; r++) {
    for (let c = 0; c < cols; c++) {
      if (luma[r * cols + c] < threshold) continue;
      hits += 1;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  const area = hits / (cols * rows);
  if (hits < 4 || area < 0.015 || area > 0.4) return null;
  return {
    type: 'window',
    confidence: clamp01(area * 6),
    bbox: [minC / cols, minR / rows, (maxC - minC + 1) / cols, (maxR - minR + 1) / rows],
  };
}

/** Where the light is coming from, how warm it is, and how much of it there is. */
export function lightingOf(grid: CellGrid): SceneAnalysis['lighting'] {
  const { cols, rows, luma, cr } = grid;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = luma[r * cols + c];
      if (c < cols / 2) left += v;
      else right += v;
      if (r < rows / 2) top += v;
      else bottom += v;
    }
  }
  const brightness = gridMean(luma);
  const dx = (right - left) / Math.max(1, right + left);
  const dy = (top - bottom) / Math.max(1, top + bottom);
  let direction: SceneAnalysis['lighting']['direction'] = 'unknown';
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 0.06) direction = dx > 0 ? 'right' : 'left';
  else if (Math.abs(dy) > 0.06) direction = dy > 0 ? 'top' : 'front';
  return { direction, warm: gridMean(cr) > 0.02, brightness: clamp01(brightness) };
}
