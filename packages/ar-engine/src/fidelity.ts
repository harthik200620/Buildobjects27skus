/**
 * The fidelity law: the composite must depict the actual SKU. A cheap, deterministic check —
 * a soft-binned colour-histogram intersection blended with the mean-colour distance between
 * the product reference and the composited product region — catches the common failure (the
 * model painted a different-looking product). Scores < FIDELITY_MIN trigger a regenerate; after
 * the retry budget the geometry-locked overlay wins.
 */
export const FIDELITY_MIN = 0.42;
const BINS = 6;

/** Soft (trilinear) colour histogram — a pixel near a bin edge counts toward both neighbours, so small lighting shifts do not zero the score. */
export function histogram(data: Uint8ClampedArray | Uint8Array, bins = BINS, alphaMin = 16): Float32Array {
  const h = new Float32Array(bins * bins * bins);
  let n = 0;
  const split = (v: number): [number, number, number] => {
    const pos = Math.max(0, Math.min(bins - 1, (v / 256) * bins - 0.5));
    const i0 = Math.floor(pos);
    return [i0, Math.min(bins - 1, i0 + 1), pos - i0];
  };
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaMin) continue;
    const [r0, r1, rf] = split(data[i]),
      [g0, g1, gf] = split(data[i + 1]),
      [b0, b1, bf] = split(data[i + 2]);
    for (const [r, wr] of [
      [r0, 1 - rf],
      [r1, rf],
    ] as [number, number][])
      for (const [g, wg] of [
        [g0, 1 - gf],
        [g1, gf],
      ] as [number, number][])
        for (const [b, wb] of [
          [b0, 1 - bf],
          [b1, bf],
        ] as [number, number][])
          h[(r * bins + g) * bins + b] += wr * wg * wb;
    n++;
  }
  if (n) for (let i = 0; i < h.length; i++) h[i] /= n;
  return h;
}

export function histogramIntersection(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

export function meanColor(data: Uint8ClampedArray | Uint8Array, alphaMin = 16): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaMin) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/** 0–1. Half histogram overlap, half closeness of the mean colour (441 = the RGB diagonal). */
export function fidelityScore(reference: Uint8ClampedArray | Uint8Array, candidate: Uint8ClampedArray | Uint8Array): number {
  const hist = histogramIntersection(histogram(reference), histogram(candidate));
  const [r1, g1, b1] = meanColor(reference),
    [r2, g2, b2] = meanColor(candidate);
  const dist = Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 441.67;
  return Math.max(0, Math.min(1, 0.5 * hist + 0.5 * (1 - dist)));
}
