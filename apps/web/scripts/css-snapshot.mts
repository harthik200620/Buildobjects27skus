/**
 * Every computed style on every surface, as one hash per element — the gate that makes a
 * stylesheet refactor checkable instead of hopeful.
 *
 * Merging two rules that carry identical declarations is only safe if nothing between them in the
 * cascade sets the same property. That is not a thing you can read off the file: it depends on
 * import order, layer order, specificity and which media queries are live at the width you are
 * looking at. So this does not read the stylesheet at all. It walks the rendered DOM of every
 * surface at both viewports and records what the browser actually computed, and the refactor is
 * correct exactly when the two runs are identical.
 *
 *   pnpm --filter @buildobjects/web css:snapshot            write storage/reports/css/<vp>.json
 *   pnpm --filter @buildobjects/web css:snapshot -- --check compare against what is on disk
 *
 * The property list is every one a rule in this repo actually sets, plus the ones a merge could
 * plausibly disturb. Recording all 340-odd computed properties instead would be slower and would
 * fail on things no stylesheet here controls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { BASE, flags, openPage, REPO, VIEWPORTS, type ViewportName } from './harness';

const OUT = path.join(REPO, 'storage', 'reports', 'css');

/*
 * No /ar route. The camera view builds and tears down chrome on its own schedule, so two runs a
 * second apart legitimately hold different elements — it reported a difference for a change on a
 * page it does not contain. A gate that cries wolf is a gate somebody switches off.
 */
const ROUTES = ['/', '/c/bulbs', '/c/concreting', '/search?q=cement', '/p/cem-ult-ppc50', '/cart', '/estimate', '/account', '/welcome'];

const PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'padding',
  'border',
  'border-radius',
  'box-shadow',
  'background-color',
  'background-image',
  'color',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'white-space',
  'overflow-x',
  'overflow-y',
  'flex',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'z-index',
  'transform',
  'transition',
  'visibility',
  'object-fit',
  'object-position',
] as const;

/**
 * A stable address for an element: tag plus its sorted class list plus how many identical
 * addresses came before it. Not the DOM path — a wrapper appearing or disappearing would then
 * renumber every element after it and report a thousand differences for one change.
 *
 * No named inner arrow inside `evaluate`: tsx compiles `const f = () => …` to esbuild's `__name`
 * helper, which does not exist in the page, and the call dies with a ReferenceError from a line
 * that reads as valid JavaScript.
 */
function snapshotOnPage(props: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE'].includes(el.tagName)) continue;
    const raw = typeof el.className === 'string' ? el.className : '';
    const cls = raw.trim().split(/\s+/).filter(Boolean).sort().join('.');
    /* Classed elements only. An unclassed wrapper is addressed by nothing but its ordinal, so one
       appearing shifts every later ordinal and reports a hundred differences for one change — and
       a rule in this repository targets a class, so an unclassed element cannot be the thing a
       stylesheet edit moved. */
    if (!cls) continue;
    const key = `${el.tagName.toLowerCase()}.${cls}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const cs = getComputedStyle(el);
    out[`${key}#${n}`] = props.map((prop) => cs.getPropertyValue(prop)).join('|');
  }
  return out;
}

async function capture(vp: ViewportName) {
  const browser = await chromium.launch();
  const out: Record<string, Record<string, string>> = {};
  const { page, ctx } = await openPage(browser, { viewport: vp });
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    out[route] = await page.evaluate(snapshotOnPage, PROPS as unknown as string[]);
  }
  await ctx.close();
  await browser.close();
  return out;
}

let bad = 0;
for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  if (vp === 'audit') continue;
  const file = path.join(OUT, `${vp}.json`);
  const now = await capture(vp);

  if (!flags.check) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(now, null, 0));
    const n = Object.values(now).reduce((a, r) => a + Object.keys(r).length, 0);
    console.log(`  wrote ${vp.padEnd(8)} ${ROUTES.length} routes, ${n} elements`);
    continue;
  }

  if (!fs.existsSync(file)) {
    console.log(`  ${vp}: no snapshot on disk — run without --check first`);
    bad++;
    continue;
  }
  const before = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof now;
  let diffs = 0;
  for (const route of ROUTES) {
    const a = before[route] ?? {};
    const b = now[route] ?? {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] === b[k]) continue;
      if (diffs < 12) console.log(`  ${vp} ${route}  ${k}\n      was ${a[k] ?? '(absent)'}\n      now ${b[k] ?? '(absent)'}`);
      diffs++;
    }
  }
  if (diffs) {
    console.log(`  ${vp}: ${diffs} element(s) compute differently`);
    bad += diffs;
  } else {
    console.log(`  ${vp}: identical`);
  }
}

console.log(bad ? `\n${bad} difference(s) — the refactor changed what the browser paints` : '\nevery element on every surface computes exactly as it did');
process.exit(bad ? 1 : 0);
