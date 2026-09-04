/**
 * pnpm --filter @buildobjects/web exec tsx scripts/trace-mark.mts
 *
 * Reads public/logo-mark.png and writes lib/mark-paths.ts: the mark as vector geometry, for the
 * loading animation in components/Splash.tsx.
 *
 * WHY TRACE RATHER THAN DRAW. The mark exists only as a PNG, and the animation needs parts, not a
 * picture: the three stems light one at a time, the bowl is drawn along its own length, and a beam
 * is aimed down the middle stem's axis. Redrawing it by eye was tried first. The artwork is a
 * keystoned "b" — the stems fan by half a degree, the bowl's right side leans two degrees further
 * than the stems, and its corners are neither circles nor ellipses — so every redrawing was a
 * near miss, and a near miss beside the real mark in the header is worse than either alone.
 *
 * HOW. Every boundary is read from the alpha channel at sub-pixel precision: a straight edge
 * crossing a pixel covers it in proportion to how far across it lies, so the coverage of the last
 * partial pixel and the first solid one together say where the edge is. The stems are straight and
 * become fitted lines. The bowl's two rings are traced row by row and simplified with
 * Douglas–Peucker to a quarter of a pixel, which at the size the splash draws them is a tenth of a
 * device pixel. Each ring's SPINE — the path the draw animation strokes and the glint rides — is
 * its outer boundary offset inward by half its thickness.
 *
 * Coordinates are the PNG's own pixels (815 × 815), so the numbers here can be checked against
 * the file with any image viewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'public', 'logo-mark.png');
const OUT = path.join(here, '..', 'lib', 'mark-paths.ts');

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
if (W !== H) throw new Error(`expected a square mark, got ${W}×${H}`);

type Run = { s: number; e: number };
type Pt = [number, number];

const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3] / 255);

/** Opaque runs along one row (or column), as inclusive pixel indices. */
function runs(read: (i: number) => number, n: number): Run[] {
  const out: Run[] = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && read(i) > 0.5;
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      out.push({ s, e: i - 1 });
      s = -1;
    }
  }
  return out;
}
const rowRuns = (y: number) => runs((x) => alpha(x, y), W);
const colRuns = (x: number) => runs((y) => alpha(x, y), H);

/* Sub-pixel edges of a run, from the coverage of the pixels either side. */
const leftOf = (r: Run, y: number) => r.s + 1 - alpha(r.s, y) - alpha(r.s - 1, y);
const rightOf = (r: Run, y: number) => r.e + alpha(r.e, y) + alpha(r.e + 1, y);
const topOf = (r: Run, x: number) => r.s + 1 - alpha(x, r.s) - alpha(x, r.s - 1);
const bottomOf = (r: Run, x: number) => r.e + alpha(x, r.e) + alpha(x, r.e + 1);

/** Least squares x = a + b·y. */
function line(pts: Pt[]): { a: number; b: number } {
  const n = pts.length;
  let sy = 0;
  let sx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sy += y;
    sx += x;
    syy += y * y;
    sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * syy - sy * sy);
  return { a: (sx - b * sy) / n, b };
}

/** Douglas–Peucker: the fewest vertices that stay within `eps` of the traced curve. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

/** The curve moved `d` to the right of its direction of travel — inward, for a clockwise outline. */
function offset(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / len) * d, p[1] + (dx / len) * d];
  });
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const poly = (pts: Pt[], close: boolean) => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(' L')}${close ? ' Z' : ''}`;

/* ───────────────────────── the stems ───────────────────────── */

const rows = Array.from({ length: H }, (_, y) => rowRuns(y));
const yFirst = rows.findIndex((r) => r.length);
let yLast = H - 1;
while (!rows[yLast].length) yLast--;

/* The first three runs of every row are the stems; the bowl sits to their right throughout. */
const stemEdges = [0, 1, 2].map((i) => {
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let y = yFirst + 12; y <= yLast - 12; y++) {
    const r = rows[y][i];
    L.push([leftOf(r, y), y + 0.5]);
    R.push([rightOf(r, y), y + 0.5]);
  }
  return { left: line(L), right: line(R) };
});

/* Their horizontal ends, read down a column through each stem's own middle. */
const at = (l: { a: number; b: number }, y: number) => l.a + l.b * y;
const tops: number[] = [];
const bottoms: number[] = [];
for (const s of stemEdges) {
  const xt = Math.round((at(s.left, yFirst) + at(s.right, yFirst)) / 2);
  const xb = Math.round((at(s.left, yLast) + at(s.right, yLast)) / 2);
  tops.push(topOf(colRuns(xt)[0], xt));
  const cb = colRuns(xb);
  bottoms.push(bottomOf(cb[cb.length - 1], xb));
}
const yTop = tops.reduce((a, b) => a + b) / 3;
const yBot = bottoms.reduce((a, b) => a + b) / 3;

const stems = stemEdges.map((s) =>
  poly(
    [
      [at(s.left, yTop), yTop],
      [at(s.right, yTop), yTop],
      [at(s.right, yBot), yBot],
      [at(s.left, yBot), yBot],
    ],
    true,
  ),
);

/* The middle stem's axis, bottom to top. */
const mid = stemEdges[1];
const axisFrom: Pt = [(at(mid.left, yBot) + at(mid.right, yBot)) / 2, yBot];
const axisTo: Pt = [(at(mid.left, yTop) + at(mid.right, yTop)) / 2, yTop];
const axisLength = Math.hypot(axisTo[0] - axisFrom[0], axisTo[1] - axisFrom[1]);
/* Degrees a horizontal line turns, clockwise, to lie along the stem: negative, since it leans right. */
const axisAngle = (Math.atan2(axisTo[1] - axisFrom[1], axisTo[0] - axisFrom[0]) * 180) / Math.PI;
const yMid = (yTop + yBot) / 2;
const acrossToPerp = Math.sin((-axisAngle * Math.PI) / 180);
const band = (at(stemEdges[2].right, yMid) - at(stemEdges[0].left, yMid)) * acrossToPerp;
const stemThickness = (at(mid.right, yMid) - at(mid.left, yMid)) * acrossToPerp;

/* ───────────────────────── the bowl ───────────────────────── */

/* A column through the bowl's four straight segments and nothing else: exactly four runs. */
let probe = -1;
for (let x = Math.round(at(stemEdges[2].right, yFirst)) + 10; x < W; x++) {
  if (colRuns(x).length === 4) {
    probe = x;
    break;
  }
}
if (probe < 0) throw new Error('no column crosses exactly the four bowl segments');
const [segOT, segIT, segIB, segOB] = colRuns(probe);
/* o = outer ring, i = inner ring; the ring's own outer and inner faces. */
const ooTop = topOf(segOT, probe);
const oiTop = bottomOf(segOT, probe);
const ioTop = topOf(segIT, probe);
const iiTop = bottomOf(segIT, probe);
const iiBot = topOf(segIB, probe);
const ioBot = bottomOf(segIB, probe);
const oiBot = topOf(segOB, probe);
const ooBot = bottomOf(segOB, probe);

const between = (lo: number, hi: number) => {
  const out: number[] = [];
  for (let y = Math.ceil(lo - 0.5); y + 0.5 < hi; y++) out.push(y);
  return out;
};
const last = (y: number) => rows[y][rows[y].length - 1];
const fourth = (y: number) => {
  if (rows[y].length < 5) throw new Error(`row ${y}: expected the inner ring's stroke to be its own run`);
  return rows[y][3];
};

const OO: Pt[] = between(ooTop, ooBot).map((y) => [rightOf(last(y), y), y + 0.5]);
const OI: Pt[] = between(oiTop, oiBot).map((y) => [leftOf(last(y), y), y + 0.5]);
const IO: Pt[] = between(ioTop, ioBot).map((y) => [rightOf(fourth(y), y), y + 0.5]);
const II: Pt[] = between(iiTop, iiBot).map((y) => [leftOf(fourth(y), y), y + 0.5]);

/* The slanted cut that ends all four segments on the left. */
const cutPts: Pt[] = [];
for (const [lo, hi] of [
  [ooTop, oiTop],
  [ioTop, iiTop],
  [iiBot, ioBot],
  [oiBot, ooBot],
] as const)
  for (const y of between(lo + 1, hi - 1)) cutPts.push([leftOf(rows[y][3], y), y + 0.5]);
const cut = line(cutPts);
const cutAt = (y: number): Pt => [at(cut, y), y];

const EPS = 0.25;
const ringOuter = poly([cutAt(ooTop), ...simplify(OO, EPS), cutAt(ooBot), cutAt(oiBot), ...simplify(OI, EPS).reverse(), cutAt(oiTop)], true);
const ringInner = poly([cutAt(ioTop), ...simplify(IO, EPS), cutAt(ioBot), cutAt(iiBot), ...simplify(II, EPS).reverse(), cutAt(iiTop)], true);

/* Spines start a little before the cut so a stroke along them covers the cut end squarely. */
const LEAD = 24;
const tOuter = (oiTop - ooTop + (ooBot - oiBot)) / 2;
const tInner = (iiTop - ioTop + (ioBot - iiBot)) / 2;
const spine = (face: Pt[], top: number, bot: number, t: number) => {
  const outline: Pt[] = [[at(cut, top) - LEAD, top], ...face, [at(cut, bot) - LEAD, bot]];
  return poly(simplify(offset(outline, t / 2), 0.5), false);
};
const spineOuter = spine(OO, ooTop, ooBot, tOuter);
const spineInner = spine(IO, ioTop, ioBot, tInner);
const spineStroke = Math.ceil(Math.max(tOuter, tInner)) + 34;

/* ───────────────────────── write ───────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;
const out = `/* GENERATED by scripts/trace-mark.mts from public/logo-mark.png — run that again rather than editing this. */

/** The PNG's own pixel grid; every number below is in it. */
export const MARK_VIEW = ${W};

/** The three stems, left to right, as closed paths. */
export const MARK_STEMS: readonly [string, string, string] = [
  '${stems[0]}',
  '${stems[1]}',
  '${stems[2]}',
];

/** The bowl's outer ring, from the top cut clockwise to the bottom cut and back along its inner face. */
export const MARK_RING_OUTER = '${ringOuter}';

/** The bowl's inner ring, the same way round. */
export const MARK_RING_INNER = '${ringInner}';

/** Each ring's centreline, starting just before the top cut and ending just past the bottom one. */
export const MARK_SPINE_OUTER = '${spineOuter}';
export const MARK_SPINE_INNER = '${spineInner}';

/** A stroke this wide along a spine covers its ring with a margin on both faces. */
export const MARK_SPINE_STROKE = ${spineStroke};

/**
 * The middle stem's axis: its centre, its two ends (bottom first), its length, and the degrees a
 * horizontal line rotates — clockwise positive, so negative here — to lie along it.
 */
export const MARK_AXIS = {
  x: ${r1((axisFrom[0] + axisTo[0]) / 2)},
  y: ${r1((axisFrom[1] + axisTo[1]) / 2)},
  from: [${r1(axisFrom[0])}, ${r1(axisFrom[1])}] as const,
  to: [${r1(axisTo[0])}, ${r1(axisTo[1])}] as const,
  length: ${r1(axisLength)},
  angle: ${Math.round(axisAngle * 100) / 100},
} as const;

/** Perpendicular distance from the first stem's outer face to the third's — the width of the stroke group. */
export const MARK_BAND = ${r1(band)};

/** Perpendicular thickness of one stem. */
export const MARK_STEM = ${r1(stemThickness)};
`;
fs.writeFileSync(OUT, out);

console.log(`traced ${path.relative(process.cwd(), SRC)} (${W}×${H}) → ${path.relative(process.cwd(), OUT)}`);
console.log(`  stems  y ${r1(yTop)}…${r1(yBot)}   lean ${axisAngle.toFixed(2)}°   stem ${r1(stemThickness)} thick   group ${r1(band)} wide`);
console.log(
  `  bowl   outer ring ${r1(tOuter)} thick, inner ${r1(tInner)}   cut x = ${cut.a.toFixed(1)} ${cut.b < 0 ? '−' : '+'} ${Math.abs(cut.b).toFixed(4)}·y   probe column ${probe}`,
);
console.log(
  `  points outer ${ringOuter.split('L').length}  inner ${ringInner.split('L').length}  spines ${spineOuter.split('L').length} / ${spineInner.split('L').length}`,
);
