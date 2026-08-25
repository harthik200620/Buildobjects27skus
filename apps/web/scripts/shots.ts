/**
 * pnpm --filter @buildobjects/web shots [--base http://localhost:3000] [--strict] [--only home,plp] [--out dir]
 *
 * Full-page screenshots of every surface at desktop (1350×940) and mobile (390×844 @2x) with a demo
 * session cookie, plus the layout assertions from the v2 plan (no horizontal overflow, products above
 * the fold, the PLP rail/results geometry, clamped facet labels, PDP buy box, no brand-teal text on
 * light surfaces, no backdrop-filter, stable header height). Assertions are reported always and fail
 * the process only with --strict, so the script is usable while a page is mid-rewrite.
 * Writes storage/reports/shots/{page}-{desktop|mobile}.png and storage/reports/shots/report.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { sessionCookie, sessionCookieFor } from './session-cookie';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const BASE = flag('base', 'http://localhost:3000').replace(/\/$/, '');
const STRICT = args.includes('--strict');
const ONLY = flag('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = path.resolve(flag('out', path.join(ROOT, 'storage', 'reports', 'shots')));

type Check = { page: string; viewport: 'desktop' | 'mobile'; name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (page: string, viewport: 'desktop' | 'mobile', name: string, ok: boolean, detail?: string) => {
  checks.push({ page, viewport, name, ok, detail });
};

async function firstSku(): Promise<string> {
  try {
    const r = await fetch(`${BASE}/api/skus?limit=1`, { headers: { cookie: sessionCookie() } });
    const j = (await r.json()) as { items?: { sku_code: string }[] };
    return j.items?.[0]?.sku_code?.toLowerCase() ?? 'cem-ult-ppc50';
  } catch {
    return 'cem-ult-ppc50';
  }
}

interface Shot {
  key: string;
  url: string;
  auth: boolean;
}

type Rect = { x: number; y: number; w: number; h: number } | null;
interface Metrics {
  overflow: boolean;
  firstCard: Rect;
  tileImg: boolean;
  results: Rect;
  cardWidths: number[];
  toolbarSticky: boolean | null;
  facetOverflow: number;
  facetCount: number;
  h1InCentre: boolean;
  buybox: Rect;
  buyCta: Rect;
  backdrop: number;
  brandText: number;
  innerHeight: number;
}

const METRICS_JS = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  const firstCard = r(document.querySelector('.prod-card'));
  const tileImg = !!document.querySelector('.tile img[src*="/img/"], .cat-tile img[src*="/img/"]');
  const results = r(document.querySelector('section[aria-label="Results"]'));
  const cardWidths = [...document.querySelectorAll('.prod-card')].map((c) => c.getBoundingClientRect().width);
  const toolbar = document.querySelector('.plp-toolbar');
  const toolbarSticky = toolbar ? getComputedStyle(toolbar).position === 'sticky' : null;
  const facetOverflow = [...document.querySelectorAll('.facet-val')].filter((el) => el.scrollWidth > el.clientWidth + 1).length;
  const facetCount = document.querySelectorAll('.facet-val').length;
  const h1InCentre = !!document.querySelector('.pdp-centre h1');
  const buybox = r(document.querySelector('.buybox'));
  const buyCta = r(document.querySelector('.buybox .btn-primary'));
  const backdrop = [...document.querySelectorAll('*')].filter((el) => { const v = getComputedStyle(el).backdropFilter; return v && v !== 'none'; }).length;
  const brandText = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('header, .header, .ar-stage, canvas, svg, .welcome-figure')) return false;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    return hasText && getComputedStyle(el).color === 'rgb(86, 211, 216)';
  }).length;
  return { overflow, firstCard, tileImg, results, cardWidths, toolbarSticky, facetOverflow, facetCount, h1InCentre, buybox, buyCta, backdrop, brandText, innerHeight: window.innerHeight };
})()`;

async function shoot(browser: Browser, shot: Shot, viewport: 'desktop' | 'mobile') {
  const ctx: BrowserContext = await browser.newContext(
    viewport === 'desktop'
      ? { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1 }
      : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  );
  if (shot.auth) await ctx.addCookies([sessionCookieFor(BASE)]);
  const page: Page = await ctx.newPage();
  const label = `${shot.key}-${viewport}`;
  try {
    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'networkidle', timeout: 120_000 });
    // header height before hydration settles vs after
    const headerBefore = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().height ?? 0);
    await page.waitForTimeout(1200);
    const headerAfter = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().height ?? 0);
    const headerVar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0);
    if (headerVar > 0)
      check(
        shot.key,
        viewport,
        'header height equals --header-h (before/after hydration)',
        Math.abs(headerBefore - headerVar) <= 2 && Math.abs(headerAfter - headerVar) <= 2,
        `before ${headerBefore}px after ${headerAfter}px var ${headerVar}px`,
      );

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true });

    // Passed as a string: tsx/esbuild's keepNames injects a `__name` helper into function
    // expressions, which does not exist inside the page when Playwright serialises a callback.
    const m = (await page.evaluate(METRICS_JS)) as Metrics;

    check(shot.key, viewport, 'no horizontal overflow', !m.overflow);
    check(shot.key, viewport, 'no backdrop-filter', m.backdrop === 0, `${m.backdrop} elements`);
    check(shot.key, viewport, 'no brand-teal text on light surfaces', m.brandText === 0, `${m.brandText} elements`);
    if (m.facetCount > 0) check(shot.key, viewport, 'facet labels fit', m.facetOverflow === 0, `${m.facetOverflow}/${m.facetCount} overflow`);
    if (shot.key === 'home' && viewport === 'desktop') {
      check(
        shot.key,
        viewport,
        'first product card above 900px',
        !!m.firstCard && m.firstCard.y < 900,
        m.firstCard ? `top ${Math.round(m.firstCard.y)}px` : 'no .prod-card',
      );
      check(shot.key, viewport, 'category tile shows a real product thumbnail', m.tileImg);
    }
    if ((shot.key === 'plp' || shot.key === 'search') && viewport === 'desktop') {
      check(
        shot.key,
        viewport,
        'results beside the rail (x ≥ 260, y < 420)',
        !!m.results && m.results.x >= 260 && m.results.y < 420,
        m.results ? `x ${Math.round(m.results.x)} y ${Math.round(m.results.y)}` : 'no results section',
      );
      check(
        shot.key,
        viewport,
        'every product card ≥ 180px wide',
        m.cardWidths.length > 0 && m.cardWidths.every((w) => w >= 180),
        `min ${Math.round(Math.min(...m.cardWidths, Infinity))}px of ${m.cardWidths.length}`,
      );
    }
    if ((shot.key === 'plp' || shot.key === 'search') && viewport === 'mobile')
      check(shot.key, viewport, 'toolbar is sticky', m.toolbarSticky === true, String(m.toolbarSticky));
    if (shot.key === 'pdp' && viewport === 'desktop') {
      check(shot.key, viewport, 'h1 inside .pdp-centre', m.h1InCentre);
      check(
        shot.key,
        viewport,
        'buy box in the right column (x > 900)',
        !!m.buybox && m.buybox.x > 900,
        m.buybox ? `x ${Math.round(m.buybox.x)}` : 'no .buybox',
      );
      check(
        shot.key,
        viewport,
        'primary CTA visible without scrolling',
        !!m.buyCta && m.buyCta.y + m.buyCta.h <= m.innerHeight,
        m.buyCta ? `bottom ${Math.round(m.buyCta.y + m.buyCta.h)}px` : 'no CTA',
      );
    }
    console.log(`  ✓ ${label.padEnd(18)} ${await page.title()}`);
  } catch (e) {
    check(shot.key, viewport, 'page loads', false, (e as Error).message.split('\n')[0]);
    console.log(`  ✗ ${label.padEnd(18)} ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sku = await firstSku();
  const all: Shot[] = [
    { key: 'home', url: '/', auth: true },
    { key: 'plp', url: '/c/bulbs', auth: true },
    { key: 'search', url: '/search?q=cement', auth: true },
    { key: 'pdp', url: `/p/${sku}`, auth: true },
    { key: 'estimate', url: '/estimate?city=vijayawada&l=30&w=40&floors=1&tier=medium', auth: true },
    { key: 'ar', url: `/ar/${sku}`, auth: true },
    { key: 'welcome', url: '/welcome', auth: false },
  ];
  const shots = ONLY.length ? all.filter((s) => ONLY.includes(s.key)) : all;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const s of shots) {
      await shoot(browser, s, 'desktop');
      await shoot(browser, s, 'mobile');
    }
  } finally {
    await browser.close();
  }
  const failed = checks.filter((c) => !c.ok);
  for (const c of failed) console.log(`  ✗ ${c.page}/${c.viewport}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · screenshots → ${path.relative(ROOT, OUT)}`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, strict: STRICT, checks }, null, 2));
  if (STRICT && failed.length) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
