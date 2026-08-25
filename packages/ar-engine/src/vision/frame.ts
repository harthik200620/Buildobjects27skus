/**
 * A camera frame, reduced to something you can reason about thirty times a second.
 *
 * Everything downstream — segmentation, surface classification, lighting — reads this and never
 * touches raw pixels again. One pass over the image produces a coarse grid where each cell knows
 * its brightness, its two colour opponents, and how busy it is; that is enough to tell a flat
 * wall from a patterned rug, and it costs one linear scan rather than a convolution per frame.
 *
 * Deliberately no colour-space conversion beyond opponents. Converting to Lab per pixel is the
 * obvious "correct" move and it is thirty times the arithmetic for a decision — "are these two
 * cells the same surface" — that opponent channels answer just as well at this resolution.
 */

export interface CellGrid {
  cols: number;
  rows: number;
  /** Mean luminance per cell, 0–1. */
  luma: Float32Array;
  /** Red-green opponent, −1…1. */
  cr: Float32Array;
  /** Blue-yellow opponent, −1…1. */
  cb: Float32Array;
  /** Mean absolute deviation of luminance inside the cell, 0–1: how textured it is. */
  texture: Float32Array;
}

export const DEFAULT_COLS = 32;
export const DEFAULT_ROWS = 24;

/**
 * Reduce RGBA pixels to a cell grid.
 *
 * @param rgba   Row-major RGBA bytes, `width * height * 4` long.
 * @param width  Source width in pixels.
 * @param height Source height in pixels.
 */
export function gridFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, cols = DEFAULT_COLS, rows = DEFAULT_ROWS): CellGrid {
  const n = cols * rows;
  const luma = new Float32Array(n);
  const cr = new Float32Array(n);
  const cb = new Float32Array(n);
  const texture = new Float32Array(n);
  const count = new Float32Array(n);
  // Two passes over the pixels: means first, then the deviation those means define. Computing
  // the deviation in one pass (sum of squares) is possible and loses precision on 8-bit data
  // exactly where it matters — the near-flat cells this is trying to identify.
  const px = new Float32Array(n);

  for (let y = 0; y < height; y++) {
    const row = ((y * rows) / height) | 0;
    for (let x = 0; x < width; x++) {
      const col = ((x * cols) / width) | 0;
      const i = row * cols + col;
      const p = (y * width + x) * 4;
      const r = rgba[p] / 255;
      const g = rgba[p + 1] / 255;
      const b = rgba[p + 2] / 255;
      luma[i] += 0.299 * r + 0.587 * g + 0.114 * b;
      cr[i] += r - g;
      cb[i] += b - (r + g) / 2;
      count[i] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const c = Math.max(1, count[i]);
    luma[i] /= c;
    cr[i] /= c;
    cb[i] /= c;
    px[i] = luma[i];
  }
  for (let y = 0; y < height; y++) {
    const row = ((y * rows) / height) | 0;
    for (let x = 0; x < width; x++) {
      const col = ((x * cols) / width) | 0;
      const i = row * cols + col;
      const p = (y * width + x) * 4;
      const l = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
      texture[i] += Math.abs(l - px[i]);
    }
  }
  for (let i = 0; i < n; i++) texture[i] /= Math.max(1, count[i]);

  return { cols, rows, luma, cr, cb, texture };
}

/** Mean of a channel over the whole grid. */
export function gridMean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

/**
 * Structural gradient at grid resolution — a 3×3 Sobel over the luma cells.
 *
 * This is what separates "a flat surface" from "the edge between two surfaces". Intra-cell
 * texture cannot do it: a cell straddling a wall/floor join is smooth inside itself and busy
 * relative to its neighbours, which is exactly the case a segmenter must not merge across.
 */
export function sobel(grid: CellGrid): { mag: Float32Array; angle: Float32Array } {
  const { cols, rows, luma } = grid;
  const mag = new Float32Array(cols * rows);
  const angle = new Float32Array(cols * rows);
  const at = (c: number, r: number) => luma[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gx = -at(c - 1, r - 1) - 2 * at(c - 1, r) - at(c - 1, r + 1) + at(c + 1, r - 1) + 2 * at(c + 1, r) + at(c + 1, r + 1);
      const gy = -at(c - 1, r - 1) - 2 * at(c, r - 1) - at(c + 1, r - 1) + at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1);
      const i = r * cols + c;
      mag[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, angle };
}
