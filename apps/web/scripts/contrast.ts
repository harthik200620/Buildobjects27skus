/**
 * pnpm --filter @buildobjects/web contrast
 *
 * Parses packages/ui/src/theme.css and asserts the WCAG contrast the theme relies on:
 *   · text pairs ≥ 4.5 — ink / ink-2 / ink-3 / teal-700 / teal-800 / success / warn / danger on
 *     canvas / canvas-2 / surface-2; header inks on header / header-2; white on teal-700;
 *     on-brand on brand; every badge's text on its background;
 *   · non-text pairs ≥ 3.0 — line-strong (inputs) and the focus ring on white and canvas-2;
 *   · ink-3 never meets surface-3 — the pair is 4.2, so any rule in theme / store / legacy CSS
 *     that sets both is a failure.
 * Prints every pair and exits 1 on the first failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const THEME = path.join(ROOT, 'packages', 'ui', 'src', 'theme.css');
const APP_CSS = [path.join(here, '..', 'app', 'store.css'), path.join(here, '..', 'app', 'legacy.css')];

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
    process.exit(1);
  }
  return v;
}

type Pair = { fg: string; bg: string; min: number; why: string };
const pairs: Pair[] = [];
const textInks = ['ink', 'ink-2', 'ink-3', 'teal-700', 'teal-800', 'success', 'warn', 'danger'];
const lightSurfaces = ['canvas', 'canvas-2', 'surface-2'];
for (const fg of textInks) for (const bg of lightSurfaces) pairs.push({ fg, bg, min: 4.5, why: 'text' });
for (const fg of ['header-ink', 'header-ink-2']) for (const bg of ['header', 'header-2']) pairs.push({ fg, bg, min: 4.5, why: 'header text' });
pairs.push({ fg: 'white', bg: 'teal-700', min: 4.5, why: 'primary button text' });
pairs.push({ fg: 'white', bg: 'teal-800', min: 4.5, why: 'primary button hover text' });
pairs.push({ fg: 'white', bg: 'ink', min: 4.5, why: 'toast text' });
pairs.push({ fg: 'on-brand', bg: 'brand', min: 4.5, why: 'brand button / count pill text' });
pairs.push({ fg: 'warn', bg: 'warn-bg', min: 4.5, why: '.badge-estimated / .badge-low' });
pairs.push({ fg: 'success', bg: 'success-bg', min: 4.5, why: '.badge-stock' });
pairs.push({ fg: 'danger', bg: 'danger-bg', min: 4.5, why: '.badge-out' });
pairs.push({ fg: 'teal-900', bg: 'teal-50', min: 4.5, why: '.badge-cert' });
pairs.push({ fg: 'ink-2', bg: 'surface-2', min: 4.5, why: '.badge-muted' });
pairs.push({ fg: 'ink', bg: 'teal-50', min: 4.5, why: 'selected chip / segment text' });
pairs.push({ fg: 'line-strong', bg: 'canvas', min: 3, why: 'input border (non-text)' });
pairs.push({ fg: 'line-strong', bg: 'canvas-2', min: 3, why: 'input border on canvas-2 (non-text)' });
pairs.push({ fg: 'teal-700', bg: 'canvas', min: 3, why: 'focus ring (non-text)' });
pairs.push({ fg: 'teal-700', bg: 'canvas-2', min: 3, why: 'focus ring on canvas-2 (non-text)' });
pairs.push({ fg: 'brand', bg: 'header', min: 3, why: 'focus ring inside the header (non-text)' });
pairs.push({ fg: 'brand', bg: 'header-2', min: 3, why: 'nav underline (non-text)' });

/* The BO Coins surfaces are dark panels on a light store, so they need checking against their
   own background rather than the page's. Translucent tokens are skipped by the parser above —
   only the solid values a user actually reads text against are listed. */
for (const fg of ['coin-ink', 'on-dark', 'credit', 'debit']) pairs.push({ fg, bg: 'coin-surface', min: 4.5, why: 'BO Coins wallet text' });
pairs.push({ fg: 'coin', bg: 'coin-surface', min: 3, why: 'wallet panel border (non-text)' });
// The CTA is a gradient; its darker end is the worst case for the label on top.
pairs.push({ fg: 'engine-ink', bg: 'engine-to', min: 4.5, why: 'Activate BO Engine label' });
pairs.push({ fg: 'engine-ink', bg: 'engine-from', min: 4.5, why: 'Activate BO Engine label (light end)' });

let failed = 0;
const rows: string[] = [];
for (const p of pairs) {
  const r = ratio(need(p.fg), need(p.bg));
  const ok = r >= p.min;
  if (!ok) failed += 1;
  rows.push(`${ok ? '✓' : '✗'} ${p.fg.padEnd(13)} on ${p.bg.padEnd(11)} ${r.toFixed(2).padStart(6)}  (≥ ${p.min})  ${p.why}`);
}
console.log(rows.join('\n'));

// ink-3 must never sit on surface-3 (4.2:1). Scan every rule block for the pair.
const forbidden = ratio(need('ink-3'), need('surface-3'));
console.log(`\nink-3 on surface-3 = ${forbidden.toFixed(2)} — forbidden pair, checking no rule sets both…`);
for (const file of [THEME, ...APP_CSS]) {
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const blocks = src.split('}');
  for (const block of blocks) {
    const body = block.slice(block.lastIndexOf('{') + 1);
    const setsInk3 = /(^|[\s;])color\s*:\s*var\(--color-ink-3\)/.test(body);
    const setsSurface3 = /background(?:-color)?\s*:\s*var\(--color-surface-3\)/.test(body);
    if (setsInk3 && setsSurface3) {
      failed += 1;
      const selector = block.slice(0, block.lastIndexOf('{')).trim().split('\n').pop();
      console.log(`✗ ${path.relative(ROOT, file)}: "${selector}" sets ink-3 text on surface-3`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} contrast check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${pairs.length} pairs pass; ink-3 never meets surface-3.`);
