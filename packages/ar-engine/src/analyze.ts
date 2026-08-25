import { clamp01 } from '@buildobjects/catalog';
import type { SceneAnalysis, SceneType, SurfaceDetection } from './types';

/**
 * Deterministic fallback scene analysis when no vision model is configured. It reads the
 * photo's luminance layout (a 16×16 grid of mean luminance + local contrast) to guess which
 * bands are ceiling / wall / floor, estimates the horizon, and leaves the room TYPE to the
 * user (the UI asks, and is honest that it did). Never pretends to be a model.
 */
export interface LumaGrid {
  cols: number;
  rows: number;
  luma: number[];
  contrast: number[];
}

export function analyzeFromGrid(grid: LumaGrid, userScene: SceneType | null, width: number, height: number): SceneAnalysis {
  const { cols, rows, luma, contrast } = grid;
  const rowMean = (r: number, arr: number[]) => {
    let s = 0;
    for (let c = 0; c < cols; c++) s += arr[r * cols + c];
    return s / cols;
  };
  const topL = avg([rowMean(0, luma), rowMean(1, luma), rowMean(2, luma)]);
  const topC = avg([rowMean(0, contrast), rowMean(1, contrast), rowMean(2, contrast)]);
  const midC = avg(
    Array.from({ length: rows }, (_, r) => r)
      .slice(Math.floor(rows * 0.3), Math.floor(rows * 0.7))
      .map((r) => rowMean(r, contrast)),
  );
  const botL = avg([rowMean(rows - 1, luma), rowMean(rows - 2, luma), rowMean(rows - 3, luma)]);
  const botC = avg([rowMean(rows - 1, contrast), rowMean(rows - 2, contrast), rowMean(rows - 3, contrast)]);
  const landscape = width >= height;

  const surfaces: SurfaceDetection[] = [];
  // Ceiling: a bright, low-contrast top band.
  const ceilingConf = clamp01((topL - 0.35) * 1.6) * clamp01(1.4 - topC * 6);
  if (ceilingConf > 0.2) surfaces.push({ type: 'ceiling', confidence: ceilingConf, bbox: [0, 0, 1, 0.28] });
  // Floor: the bottom band, usually darker than the top and moderately textured.
  const floorConf = clamp01(0.55 + (topL - botL) * 0.8 - Math.max(0, botC - 0.35));
  surfaces.push({ type: 'floor', confidence: floorConf, bbox: [0, 0.62, 1, 0.38] });
  // Wall: the middle band, low contrast = flat wall.
  const wallConf = clamp01(1.1 - midC * 4);
  surfaces.push({ type: 'wall', confidence: Math.max(0.35, wallConf), bbox: [0.05, 0.18, 0.9, 0.5] });
  // Window: a very bright rectangle in the middle band.
  let brightCells = 0;
  for (let r = Math.floor(rows * 0.2); r < Math.floor(rows * 0.6); r++) for (let c = 0; c < cols; c++) if (luma[r * cols + c] > 0.85) brightCells++;
  const winConf = clamp01((brightCells / (cols * rows * 0.4)) * 3);
  if (winConf > 0.25) surfaces.push({ type: 'window', confidence: winConf, bbox: [0.25, 0.2, 0.5, 0.4] });

  const scene: SceneType = userScene ?? 'unknown';
  if (scene === 'exterior' || scene === 'site' || scene === 'roof') {
    surfaces.push({ type: 'ground', confidence: Math.max(0.5, floorConf), bbox: [0, 0.55, 1, 0.45] });
    if (scene === 'roof') surfaces.push({ type: 'roof', confidence: 0.7, bbox: [0, 0.4, 1, 0.6] });
  }
  return {
    sceneType: scene,
    sceneConfidence: userScene ? 0.95 : 0.2,
    surfaces: surfaces.sort((a, b) => b.confidence - a.confidence),
    references: [],
    freeArea: clamp01(0.9 - midC),
    horizonY: landscape ? 0.45 : 0.42,
    lighting: { direction: luminanceSide(grid), warm: false, brightness: avg(luma) },
    provider: 'mock',
    notes: userScene
      ? 'Surfaces estimated from the photo; room type confirmed by you.'
      : 'Surfaces estimated from the photo; tell me the room type to run the gate.',
  };
}

function luminanceSide(g: LumaGrid): 'left' | 'right' | 'top' | 'front' | 'unknown' {
  let l = 0,
    r = 0;
  for (let row = 0; row < g.rows; row++) for (let c = 0; c < g.cols; c++) c < g.cols / 2 ? (l += g.luma[row * g.cols + c]) : (r += g.luma[row * g.cols + c]);
  if (Math.abs(l - r) / Math.max(1, l + r) < 0.06) return 'front';
  return l > r ? 'left' : 'right';
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Build the 16×16 luminance/contrast grid from raw RGBA pixels (browser canvas or sharp). */
export function lumaGridFromRgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number, cols = 16, rows = 16): LumaGrid {
  const luma: number[] = new Array(cols * rows).fill(0);
  const contrast: number[] = new Array(cols * rows).fill(0);
  const cw = width / cols,
    ch = height / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let sum = 0,
        sum2 = 0,
        n = 0;
      const x0 = Math.floor(c * cw),
        x1 = Math.floor((c + 1) * cw),
        y0 = Math.floor(r * ch),
        y1 = Math.floor((r + 1) * ch);
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          sum += l;
          sum2 += l * l;
          n++;
        }
      const m = n ? sum / n : 0;
      luma[r * cols + c] = m;
      contrast[r * cols + c] = n ? Math.sqrt(Math.max(0, sum2 / n - m * m)) : 0;
    }
  return { cols, rows, luma, contrast };
}
