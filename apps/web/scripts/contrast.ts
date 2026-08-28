/**
 * pnpm --filter @buildobjects/web contrast
 *
 * Four gates over the deep teal and silver theme, all parsing packages/ui/src/theme.css.
 *
 * 1. CONTRAST. Every pair the theme relies on, measured: text ≥ 4.5, non-text ≥ 3.0.
 * 2. INK-4 IS DECORATIVE. --ink-4 measures 3.6 on the canvas, which is legal for a rule and
 *    illegal for a word. Any selector that sets it as a colour and also sets a font-size above
 *    12px fails. New in v2, because v2 is the first palette with a step this quiet in it.
 * 3. LITERALS IN CSS. A dark theme is only cohesive while every colour comes from a token.
 * 4. LITERALS AS UTILITIES. The same rule applied to .tsx, because a Tailwind colour utility
 *    beats every token in theme.css and neither of the first two gates could see it.
 *
 * ── ON RESOLVING TOKENS ────────────────────────────────────────────────────────
 *
 * v2 renamed the palette — --color-ink-2 became --ink-2, --color-surface became --surf-2 — and
 * kept the v1 names as aliases pointing at the new ones, so about nine hundred existing
 * declarations keep working while surfaces are moved over one at a time. That means a token's
 * value is now reached through a chain (`--color-ink-2: var(--ink-2)` → `--ink-2: #c3d6d9`)
 * rather than sitting there as a hex literal.
 *
 * A first pass at this gate read only `--color-*: #hex` and reported eighty-nine failures on a
 * palette where nothing was wrong — every alias looked like a missing token. So it resolves
 * var() chains now, with a depth limit, and it checks the CANONICAL names. If an alias is ever
 * pointed somewhere wrong, gate 1 measures the wrong colour and says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const THEME = path.join(ROOT, 'packages', 'ui', 'src', 'theme.css');
/*
 * Every stylesheet in the app, found rather than listed.
 *
 * This was six hardcoded paths, and the moment three new sheets were added — cart.css,
 * gallery.css, spec.css — they were outside the gate without anything saying so. A guard whose
 * coverage has to be remembered is a guard that silently shrinks.
 */
const APP_DIR = path.join(here, '..', 'app');
function stylesheets(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(p, out);
    /* globals.css is skipped: it is nothing but @import lines, and every file it names is
       already in this walk. */
    if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'globals.css') out.push(p);
  }
  return out;
}
const APP_CSS = stylesheets(APP_DIR).sort();

const css = fs.readFileSync(THEME, 'utf8');

/** Every custom property declared in the theme, value unresolved. */
const declared = new Map<string, string>();
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) declared.set(m[1], m[2].trim());

/**
 * Follow `var()` until a hex falls out.
 *
 * Only single-var values are followed — `var(--x)` and nothing else — because a token that
 * resolves to a gradient or a shadow is not a colour and has no business in a contrast check.
 */
function resolve(name: string, depth = 0): string | null {
  const raw = declared.get(name);
  if (raw === undefined || depth > 8) return null;
  const hex = raw.match(/^#[0-9a-fA-F]{3,8}$/);
  if (hex) return hex[0].toLowerCase();
  const via = raw.match(/^var\((--[a-z0-9-]+)\)$/);
  return via ? resolve(via[1], depth + 1) : null;
}

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
  const v = resolve(name);
  if (!v) {
    console.error(`✗ ${name} is missing from theme.css, or does not resolve to a colour`);
    process.exitCode = 1;
    return '#ff00ff';
  }
  return v;
}

type Pair = { fg: string; bg: string; min: number; why: string };
const pairs: Pair[] = [];

/*
 * Every ink against every surface.
 *
 * ink-4 is deliberately NOT in this list. It measures 3.6 on the canvas and is decorative by
 * definition; gate 2 below is what holds it to that, and putting it here would only assert a
 * failure the palette intends.
 */
const textInks = ['--ink-1', '--ink-2', '--ink-3', '--teal-700', '--teal-800', '--teal-900', '--ok', '--warn', '--bad'];
const surfaces = ['--color-canvas', '--surf-1', '--surf-2', '--surf-3', '--surf-4'];
for (const fg of textInks) for (const bg of surfaces) pairs.push({ fg, bg, min: 4.5, why: 'text' });

/* The primary ramp. teal-700/800/900 are the fill and its hover and press; the label on all
   three is the dark on-brand ink, because white on #56d3d8 is 1.79 and always was. */
for (const bg of ['--teal-700', '--teal-800', '--teal-900']) pairs.push({ fg: '--on-brand', bg, min: 4.5, why: 'primary button text' });

/* Amber belongs to BO Coins and to warnings, and to nothing else. */
pairs.push({ fg: '--on-amber', bg: '--amber-700', min: 4.5, why: 'text on the coin' });
pairs.push({ fg: '--on-amber', bg: '--amber-800', min: 4.5, why: 'text on the coin figure' });
pairs.push({ fg: '--amber-800', bg: '--color-canvas', min: 4.5, why: 'the coin balance on the page' });
pairs.push({ fg: '--amber-800', bg: '--surf-2', min: 4.5, why: 'the coin balance on a card' });
pairs.push({ fg: '--amber-800', bg: '--surf-3', min: 4.5, why: 'the coin balance on the wallet' });

/* The silver plate is the one light ground in the store, so it needs its own inks checked
   against it rather than the page's. */
pairs.push({ fg: '--on-plate-1', bg: '--plate-1', min: 4.5, why: 'ink over a product photograph' });
pairs.push({ fg: '--on-plate-1', bg: '--plate-2', min: 4.5, why: 'ink over the bright end of a plate' });
pairs.push({ fg: '--on-plate-2', bg: '--plate-1', min: 4.5, why: 'caption over a product photograph' });

/* Selected states put ink on the two darkest teals. */
pairs.push({ fg: '--ink-1', bg: '--teal-100', min: 4.5, why: 'selected chip / segment text' });
pairs.push({ fg: '--ink-1', bg: '--teal-200', min: 4.5, why: 'mark.hl / focus halo text' });
pairs.push({ fg: '--teal-800', bg: '--teal-100', min: 4.5, why: 'selected scope chip' });

/* Non-text: borders, rings and rules only have to be seen, not read. */
pairs.push({ fg: '--teal-700', bg: '--color-canvas', min: 3, why: 'focus ring (non-text)' });
pairs.push({ fg: '--teal-700', bg: '--surf-3', min: 3, why: 'focus ring on a raised surface (non-text)' });
pairs.push({ fg: '--teal-700', bg: '--surf-1', min: 3, why: 'the header bar underline (non-text)' });
pairs.push({ fg: '--ink-4', bg: '--color-canvas', min: 3, why: 'ink-4 as a rule — decorative, and this is its floor' });
pairs.push({ fg: '--ink-4', bg: '--surf-2', min: 3, why: 'ink-4 as a rule on a card (non-text)' });

let failed = 0;
const rows: string[] = [];
for (const p of pairs) {
  const r = ratio(need(p.fg), need(p.bg));
  const ok = r >= p.min;
  if (!ok) failed += 1;
  rows.push(`${ok ? '✓' : '✗'} ${p.fg.padEnd(15)} on ${p.bg.padEnd(15)} ${r.toFixed(2).padStart(6)}  (≥ ${p.min})  ${p.why}`);
}
console.log(rows.join('\n'));

/* ═══════════════════════════════════════════════════════════════════════════
   Gate two: --ink-4 is decorative, and the build enforces it
   ═══════════════════════════════════════════════════════════════════════════
   --ink-4 is #61797e, 3.6:1 on the canvas. That is legal for a hairline, a disabled
   glyph or a watermark figure, and illegal for anything a person has to read — WCAG
   AA wants 4.5 for body text and 3.0 for text at 24px or 19px bold.

   The palette needs a step this quiet, and a token this quiet WILL end up on a
   caption the first time somebody wants a line to recede. So: any rule that sets
   --ink-4 as its colour and also sets a font-size above 12px fails the build. Twelve
   is the ceiling because nothing in the type scale below --t-micro (11px) is text a
   sentence is made of, and an eyebrow at 11px in ink-4 is a label, not prose.
   ═════════════════════════════════════════════════════════════════════════ */
console.log('\n--ink-4 used as text:');
let inkFour = 0;
/* One declaration block: everything between a `{` and the next `}` at the same level.
   Good enough for this codebase's flat, hand-written CSS, and it reports the line. */
for (const file of APP_CSS) {
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const block of src.matchAll(/\{([^{}]*)\}/g)) {
    const body = block[1];
    if (!/(?:^|[^-])color\s*:\s*var\(--ink-4\)/m.test(body)) continue;
    const size = body.match(/font-size\s*:\s*([\d.]+)px/);
    /* A font-size in rem: 0.75rem is the 12px ceiling. */
    const rem = body.match(/font-size\s*:\s*([\d.]+)rem/);
    const px = size ? parseFloat(size[1]) : rem ? parseFloat(rem[1]) * 16 : null;
    /*
     * SAYING NOTHING ABOUT THE SIZE IS NOT THE SAME AS BEING SMALL.
     *
     * This used to fail only when the same block ALSO declared a font-size above 12px — so a rule
     * that set the colour and left the size to a parent was waved through, which is most of them.
     * Eight rules across the account, estimator and lift stylesheets were painting words in the
     * store's decorative ink, and this gate printed "ink-4 is decorative everywhere" on every run
     * while they did. The rendered-page check in scripts/shots.ts is what caught two of them, at a
     * measured 3.93:1, and only because those two happened to sit on a page it photographs.
     *
     * A token documented "DECORATIVE ONLY. Never body text." can only be used where the size is
     * known to be tiny, and the only place that can be known is the rule itself. So an unstated
     * size fails too: declare the 11px and the gate lets it through.
     */
    if (px === null || px > 12) {
      const line = src.slice(0, block.index).split('\n').length;
      const at = px === null ? 'text of an unstated size' : `${px}px text`;
      console.log(`✗ ${path.relative(ROOT, file)}:${line}  --ink-4 on ${at} — it measures 3.6:1 and cannot carry a word`);
      inkFour += 1;
      failed += 1;
    }
  }
}
if (!inkFour) console.log('  none — ink-4 is only ever a rule, a disabled glyph or a watermark');

/* ═══════════════════════════════════════════════════════════════════════════
   Gate three: literal colours in the app's CSS
   ═══════════════════════════════════════════════════════════════════════════
   A dark theme is only cohesive while every colour comes from a token, and the
   failure mode is a single #fff left behind in a stylesheet, which reads as a bright
   hole on #06181d.

   AN ALPHA OF A TOKEN IS STILL THE TOKEN. v2's hairlines, scrims, washes and glows
   are all `rgb(R G B / A%)` where R G B is a colour the theme names — the brand teal
   at 22% for the spine's numerals, the canvas at 82% for a plate's scrim, white at 7%
   for a keycap. Requiring a named token for every alpha step would mean forty tokens
   that each appear once, which is a worse system than the literal it replaced. So the
   scan resolves the triple: if the theme names that colour, the alpha form passes.
   Anything whose triple the theme does NOT name is exactly what this gate is for.
   ═════════════════════════════════════════════════════════════════════════ */
const ALLOWED_LITERALS = new Map<string, string>([
  ['transparent', 'not a colour'],
  ['currentcolor', 'not a colour'],
  ['#000', 'a mask gradient stop — a mask reads alpha, so this is opacity and not a colour'],
  ['#fff', 'a mask gradient stop, and the AR HUD label on a camera image'],
  ['#ffffff', 'the same, written long'],
]);

/** Every RGB triple the theme names, so an alpha form of one can be recognised. */
const tokenTriples = new Set<string>();
for (const name of declared.keys()) {
  const hex = resolve(name);
  if (hex) tokenTriples.add(rgb(hex).join(' '));
}
/* Black and white are not tokens and never will be: they are the ends of the scale that
   every scrim, shadow and specular highlight is built from. */
tokenTriples.add('0 0 0');
tokenTriples.add('255 255 255');

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

console.log('\nliteral colours outside the token system:');
let literals = 0;
for (const file of APP_CSS) {
  if (!fs.existsSync(file)) continue;
  // Blank out every comment before scanning, preserving newlines so the line numbers still point
  // at the real file.
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const [i, line] of src.split('\n').entries()) {
    for (const m of line.matchAll(LITERAL)) {
      const raw = m[0].toLowerCase().replace(/\s+/g, ' ');
      if (ALLOWED_LITERALS.has(raw)) continue;
      // A var() fallback inside rgb() is still tokenised.
      if (raw.includes('var(')) continue;
      // An alpha of a colour the theme names.
      const triple = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*[/,]/);
      if (triple && tokenTriples.has(`${triple[1]} ${triple[2]} ${triple[3]}`)) continue;
      // A bare hex the theme names is fine too — it is the token's own value written out.
      if (raw.startsWith('#') && tokenTriples.has(rgb(raw).join(' '))) continue;
      literals += 1;
      failed += 1;
      console.log(`✗ ${path.relative(ROOT, file)}:${i + 1}  ${m[0].trim()}`);
    }
  }
}
if (!literals) console.log(`  none — every colour in ${APP_CSS.length} stylesheets is a token or an alpha of one`);

/* ═══════════════════════════════════════════════════════════════════════════
   Gate four: literal colours written as Tailwind utilities in components
   ═══════════════════════════════════════════════════════════════════════════
   The gates above read stylesheets, and for a long time that was the whole surface.
   It is not: this project's own layering rule is that "a utility class on the same
   element still wins", which means `bg-white` in a .tsx beats every token in
   theme.css — and no stylesheet gate could see it.

   What that cost: the sort control on every listing page carried `bg-white` alongside
   the app's ink colour. White text on a white box, 1.09:1, on the control that
   reorders the results. It shipped, and it was found by measuring a rendered page
   rather than by anything in this file.
   ═════════════════════════════════════════════════════════════════════════ */
const TSX_LITERAL =
  /\b(?:bg|text|border|ring|from|via|to|decoration|outline|shadow|fill|stroke|accent|caret|divide|placeholder)-(?:white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b(?:-\d{2,3})?|\b(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl)[^\]]*\]/g;

function components(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) components(p, out);
    if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

console.log('\nliteral colours written as utilities in components:');
let utilities = 0;
for (const file of [...components(path.join(here, '..', 'app')), ...components(path.join(here, '..', 'components'))]) {
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
  for (const [i, line] of src.split('\n').entries()) {
    for (const m of line.matchAll(TSX_LITERAL)) {
      utilities += 1;
      failed += 1;
      console.log(`✗ ${path.relative(ROOT, file)}:${i + 1}  ${m[0]}`);
    }
  }
}
if (!utilities) console.log('  none — no component paints a colour the theme does not name');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${pairs.length} pairs pass; ink-4 is decorative everywhere; no untokenised colour in the app.`);
