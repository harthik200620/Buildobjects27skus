/**
 * Pyramidal Lucas–Kanade translation estimate between two small grayscale frames (160×120 by
 * default): 2 pyramid levels, an 8×6 grid of 7×7 windows, 5 Gauss–Newton iterations per window,
 * the frame translation = the median of the well-conditioned windows' flows. Pure TypeScript, no
 * allocations beyond a few small typed arrays — ≈ 1 ms per frame in a browser.
 *
 * Result convention: `next(x + dx, y + dy) ≈ prev(x, y)` — the scene content moved by (dx, dy)
 * pixels from `prev` to `next` (x right, y down, in the small frame's pixels).
 */
export const LK_WIDTH = 160;
export const LK_HEIGHT = 120;

export interface LkOptions {
  levels: number;
  cols: number;
  rows: number;
  /** Half window: 3 → 7×7. */
  radius: number;
  iterations: number;
  /** Minimum smaller eigenvalue of the structure tensor per window pixel — below it the window is texture-less and skipped. */
  minEigenPerPx: number;
}

export const LK_DEFAULTS: LkOptions = { levels: 2, cols: 8, rows: 6, radius: 3, iterations: 5, minEigenPerPx: 1 };

export interface FlowEstimate {
  dx: number;
  dy: number;
  /** 0–1: the inlier ratio (windows within 1 px of the median) scaled by how many windows were usable. */
  confidence: number;
  /** Windows with enough texture to solve. */
  windows: number;
  inliers: number;
}

export interface GrayFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 2×2 box-filtered half-resolution copy (odd trailing rows/columns are dropped). */
export function downsample2(f: GrayFrame): GrayFrame {
  const w = Math.floor(f.width / 2),
    h = Math.floor(f.height / 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * f.width,
      r1 = r0 + f.width;
    for (let x = 0; x < w; x++) {
      const c = 2 * x;
      out[y * w + x] = (f.data[r0 + c] + f.data[r0 + c + 1] + f.data[r1 + c] + f.data[r1 + c + 1] + 2) >> 2;
    }
  }
  return { data: out, width: w, height: h };
}

/** RGBA (canvas `getImageData`) → Rec. 709 luma bytes. */
export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const n = width * height,
    out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2] + 0.5) | 0;
  }
  return out;
}

function sampleBilinear(img: Uint8Array, w: number, h: number, x: number, y: number): number {
  const xc = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const yc = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(xc),
    y0 = Math.floor(yc);
  const x1 = x0 + 1 < w ? x0 + 1 : x0,
    y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = xc - x0,
    fy = yc - y0;
  const i00 = img[y0 * w + x0],
    i10 = img[y0 * w + x1],
    i01 = img[y1 * w + x0],
    i11 = img[y1 * w + x1];
  return (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function lkTranslation(prev: Uint8Array, next: Uint8Array, width = LK_WIDTH, height = LK_HEIGHT, opts: Partial<LkOptions> = {}): FlowEstimate {
  const o = { ...LK_DEFAULTS, ...opts };
  if (prev.length < width * height || next.length < width * height) throw new Error(`lkTranslation: frames must hold ${width}×${height} bytes`);
  const pyrA: GrayFrame[] = [{ data: prev, width, height }];
  const pyrB: GrayFrame[] = [{ data: next, width, height }];
  for (let l = 1; l < o.levels; l++) {
    pyrA.push(downsample2(pyrA[l - 1]));
    pyrB.push(downsample2(pyrB[l - 1]));
  }

  const r = o.radius,
    side = 2 * r + 1,
    n = side * side;
  const Ix = new Float32Array(n),
    Iy = new Float32Array(n),
    A0 = new Float32Array(n);
  let gx = 0,
    gy = 0;
  let result: FlowEstimate = { dx: 0, dy: 0, confidence: 0, windows: 0, inliers: 0 };

  for (let l = o.levels - 1; l >= 0; l--) {
    const A = pyrA[l],
      B = pyrB[l];
    const w = A.width,
      h = A.height,
      a = A.data,
      b = B.data;
    const flows: [number, number][] = [];
    for (let j = 0; j < o.rows; j++) {
      for (let i = 0; i < o.cols; i++) {
        const cx = Math.round(((i + 0.5) * w) / o.cols),
          cy = Math.round(((j + 0.5) * h) / o.rows);
        if (cx - r < 1 || cx + r > w - 2 || cy - r < 1 || cy + r > h - 2) continue;
        let gxx = 0,
          gxy = 0,
          gyy = 0,
          k = 0;
        for (let y = cy - r; y <= cy + r; y++) {
          for (let x = cx - r; x <= cx + r; x++) {
            const idx = y * w + x;
            const ix = (a[idx + 1] - a[idx - 1]) / 2,
              iy = (a[idx + w] - a[idx - w]) / 2;
            Ix[k] = ix;
            Iy[k] = iy;
            A0[k] = a[idx];
            gxx += ix * ix;
            gxy += ix * iy;
            gyy += iy * iy;
            k++;
          }
        }
        const tr = gxx + gyy,
          det = gxx * gyy - gxy * gxy;
        const lmin = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
        if (!(det > 1e-6) || lmin / n < o.minEigenPerPx) continue;
        let vx = gx,
          vy = gy,
          valid = true;
        for (let it = 0; it < o.iterations; it++) {
          if (cx - r + vx < 0 || cx + r + vx > w - 1 || cy - r + vy < 0 || cy + r + vy > h - 1) {
            valid = false;
            break;
          }
          let bx = 0,
            by = 0;
          k = 0;
          for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
              const e = A0[k] - sampleBilinear(b, w, h, x + vx, y + vy);
              bx += Ix[k] * e;
              by += Iy[k] * e;
              k++;
            }
          }
          const ddx = (gyy * bx - gxy * by) / det,
            ddy = (gxx * by - gxy * bx) / det;
          vx += ddx;
          vy += ddy;
          if (ddx * ddx + ddy * ddy < 1e-4) break;
        }
        if (valid && Number.isFinite(vx) && Number.isFinite(vy)) flows.push([vx, vy]);
      }
    }
    if (flows.length === 0) {
      if (l > 0) {
        gx *= 2;
        gy *= 2;
        continue;
      }
      return { dx: gx, dy: gy, confidence: 0, windows: 0, inliers: 0 };
    }
    const mx = median(flows.map((f) => f[0])),
      my = median(flows.map((f) => f[1]));
    if (l > 0) {
      gx = mx * 2;
      gy = my * 2;
      continue;
    }
    const inliers = flows.filter(([x, y]) => Math.hypot(x - mx, y - my) <= 1).length;
    const coverage = Math.min(1, flows.length / ((o.cols * o.rows) / 2));
    result = { dx: mx, dy: my, confidence: (inliers / flows.length) * coverage, windows: flows.length, inliers };
  }
  return result;
}
