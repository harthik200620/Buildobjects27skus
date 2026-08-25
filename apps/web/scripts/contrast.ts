/**
 * pnpm --filter @buildobjects/web contrast
 *
 * Two gates over the deep teal and silver theme, both parsing packages/ui/src/theme.css.
 *
 * 1. CONTRAST. Every pair the theme relies on, measured:
 *      · text ≥ 4.5 — ink / ink-2 / ink-3 / teal-300 / teal-700 / brand / success / warn /
 *        danger on canvas / canvas-2 / surface / surface-2 / surface-3; header inks on the two
 *        header tones; on-brand on the primary ramp; every badge on its own background; the
 *        two plate inks on the two plate tones;
 *      · non-text ≥ 3.0 — the input border and the focus ring on the surfaces they appear on.
 *    The light theme this replaces had one illegal pair (ink-3 on surface-3 measured 4.2) and
 *    a bespoke scan to keep any rule from setting both. The dark palette has no illegal pair —
 *    the same combination measures 4.73 — so that scan is gone and every ink is legal on every
 *    surface. If a future palette re-introduces one, this file is where it fails.
 *
 * 2. LITERALS. A dark theme is only cohesive while every colour comes from a token, and the
 *    failure mode is a single #fff or rgba(255,255,255,…) left behind in a stylesheet, which
 *    reads as a bright hole on #06181d. So the app's CSS is scanned for literal colours and the
 *    allowlist below is the complete, deliberate set.
 *
 * Prints every pair, then every literal, and exits 1 on the first failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const THEME = path.join(ROOT, 'packages', 'ui', 'src', 'theme.css');
const APP_CSS = [
  path.join(here, '..', 'app', 'store.css'),
  path.join(here, '..', 'app', 'legacy.css'),
  path.join(here, '..', 'app', 'styles', 'home.css'),
  path.join(here, '..', 'app', 'styles', 'listing.css'),
  path.join(here, '..', 'app', 'styles', 'ar.css'),
  path.join(here, '..', 'app', 'styles', 'estimator.css'),
];

const css = fs.readFileSync(THEME, 'utf8');
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) tokens.set(m[1], m[2].toLowerCase());
tokens.set('white', '#ffffff');

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function need(name: string): string {
  const v = tokens.get(name);
  if (!v) {
    console.error(`✗ token --color-${name} is missing from theme.css`);
    process.exitCode = 1;
    return '#ff00ff';
  }
  return v;
}

type Pair = { fg: string; bg: string; min: number; why: string };
const pairs: Pair[] = [];

/* Every ink against every surface. On the light theme this matrix had a hole in it; here it is
   complete, which is the whole reason the palette was retuned rather than merely inverted. */
const textInks = ['ink', 'ink-2', 'ink-3', 'teal-300', 'teal-700', 'brand', 'success', 'warn', 'danger'];
const surfaces = ['canvas', 'canvas-2', 'surface', 'surface-2', 'surface-3'];
for (const fg of textInks) for (const bg of surfaces) pairs.push({ fg, bg, min: 4.5, why: 'text' });

for (const fg of ['header-ink', 'header-ink-2']) for (const bg of ['header', 'header-2']) pairs.push({ fg, bg, min: 4.5, why: 'header text' });

/* The primary ramp. teal-700/800/900 are the fill and its hover and press; the label on all
   three is the dark on-brand ink, because white on #56d3d8 is 1.79 and always was. */
pairs.push({ fg: 'on-brand', bg: 'brand', min: 4.5, why: 'brand button / count pill text' });
pairs.push({ fg: 'on-brand', bg: 'teal-700', min: 4.5, why: 'primary button text' });
pairs.push({ fg: 'on-brand', bg: 'teal-800', min: 4.5, why: 'primary button hover text' });
pairs.push({ fg: 'on-brand', bg: 'teal-900', min: 4.5, why: 'primary button pressed text' });

pairs.push({ fg: 'warn', bg: 'warn-bg', min: 4.5, why: '.badge-estimated / .badge-low' });
pairs.push({ fg: 'success', bg: 'success-bg', min: 4.5, why: '.badge-stock' });
pairs.push({ fg: 'danger', bg: 'danger-bg', min: 4.5, why: '.badge-out' });
pairs.push({ fg: 'teal-900', bg: 'teal-50', min: 4.5, why: '.badge-cert' });
pairs.push({ fg: 'ink-2', bg: 'surface-2', min: 4.5, why: '.badge-muted' });
pairs.push({ fg: 'ink', bg: 'teal-50', min: 4.5, why: 'selected chip / segment text' });
pairs.push({ fg: 'ink', bg: 'teal-100', min: 4.5, why: 'mark.hl / focus halo text' });

/* The silver plate is the one light ground in the store, so it needs its own inks checked
   against it rather than the page's — the same reasoning the light theme applied to the
   wallet, in the opposite direction. */
pairs.push({ fg: 'on-plate', bg: 'plate', min: 4.5, why: 'ink over a product photograph' });
pairs.push({ fg: 'on-plate', bg: 'plate-2', min: 4.5, why: 'ink over the bright end of a plate' });
pairs.push({ fg: 'on-plate-2', bg: 'plate', min: 4.5, why: 'caption over a product photograph' });

pairs.push({ fg: 'coin-ink', bg: 'surface-2', min: 4.5, why: 'BO Coins figure on the wallet' });
pairs.push({ fg: 'coin-ink', bg: 'surface', min: 4.5, why: 'BO Coins figure on a card' });
pairs.push({ fg: 'credit', bg: 'surface-2', min: 4.5, why: 'coins earned' });
pairs.push({ fg: 'debit', bg: 'surface-2', min: 4.5, why: 'coins spent' });

pairs.push({ fg: 'line-strong', bg: 'canvas', min: 3, why: 'input border (non-text)' });
pairs.push({ fg: 'line-strong', bg: 'canvas-2', min: 3, why: 'input border on canvas-2 (non-text)' });
pairs.push({ fg: 'line-strong', bg: 'surface', min: 3, why: 'input border on a card (non-text)' });
pairs.push({ fg: 'brand', bg: 'canvas', min: 3, why: 'focus ring (non-text)' });
pairs.push({ fg: 'brand', bg: 'surface-2', min: 3, why: 'focus ring on a raised surface (non-text)' });
pairs.push({ fg: 'brand', bg: 'header', min: 3, why: 'focus ring inside the header (non-text)' });
pairs.push({ fg: 'brand', bg: 'header-2', min: 3, why: 'nav underline (non-text)' });
pairs.push({ fg: 'on-brand', bg: 'plate', min: 3, why: 'plate hairline (non-text)' });

let failed = 0;
const rows: string[] = [];
for (const p of pairs) {
  const r = ratio(need(p.fg), need(p.bg));
  const ok = r >= p.min;
  if (!ok) failed += 1;
  rows.push(`${ok ? '✓' : '✗'} ${p.fg.padEnd(13)} on ${p.bg.padEnd(11)} ${r.toFixed(2).padStart(6)}  (≥ ${p.min})  ${p.why}`);
}
console.log(rows.join('\n'));

/*
 * The literal scan. Every one of these is a colour that cannot be a token, with the reason it
 * cannot. Anything else in the app's CSS is a light-theme leftover or a hurried inline value,
 * and either way it is the thing that makes a dark page look unfinished.
 */
const ALLOWED_LITERALS = new Map<string, string>([
  ['#ffffff', 'header-ink — pure white on the deepest teal, and the AR HUD label'],
  ['#fff', 'shorthand for the same'],
  ['transparent', 'not a colour'],
  ['currentcolor', 'not a colour'],
  ['rgb(255 255 255 / 9%)', 'the skeleton sheen — a highlight, not a surface'],
  ['rgb(0 0 0 / 0%)', 'a gradient stop that fades to nothing'],
  ['rgb(0 0 0 / 100%)', "a mask gradient's opaque stop — a mask reads alpha, so this is opacity and not a colour"],
]);
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

console.log('\nliteral colours outside the token system:');
let literals = 0;
for (const file of [...APP_CSS]) {
  if (!fs.existsSync(file)) continue;
  // Blank out every comment before scanning, preserving newlines so the line numbers still point
  // at the real file. A first pass tested only whether a line *started* like a comment, which let
  // the middle lines of a block comment through — including this file's own note naming the two
  // teals it replaced.
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const lines = src.split('\n');
  for (const [i, line] of lines.entries()) {
    for (const m of line.matchAll(LITERAL)) {
      const raw = m[0].toLowerCase().replace(/\s+/g, ' ');
      if (ALLOWED_LITERALS.has(raw)) continue;
      // A var() fallback inside rgb() is still tokenised.
      if (raw.includes('var(')) continue;
      literals += 1;
      failed += 1;
      console.log(`✗ ${path.relative(ROOT, file)}:${i + 1}  ${m[0].trim()}`);
    }
  }
}
if (!literals) console.log(`  none — every colour in ${APP_CSS.filter((f) => fs.existsSync(f)).length} stylesheets comes from a token`);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${pairs.length} pairs pass; no untokenised colour in the app's CSS.`);
