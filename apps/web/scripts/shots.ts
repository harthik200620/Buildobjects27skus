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
  firstTile: Rect;
  catTiles: number;
  catTilesWithArt: number;
  results: Rect;
  cardWidths: number[];
  hasFilterControl: boolean;
  facetOverflow: number;
  facetCount: number;
  h1InBuyPanel: boolean;
  buybox: Rect;
  buyCta: Rect;
  backdrop: number;
  lowContrast: string[];
  innerHeight: number;
}

const METRICS_JS = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  const firstCard = r(document.querySelector('.prod-card'));
  /* .tile and .cat-tile are v1 names; the tile has been .cat-card with a .cat-photo img for a
     while, so this asserted the absence of a class nobody uses. It counts loaded tiles now, which
     is the fact it was reaching for: a category grid where the art has not arrived looks broken. */
  const catTiles = document.querySelectorAll('.cat-card').length;
  const firstTile = r(document.querySelector('.cat-card'));
  const catTilesWithArt = [...document.querySelectorAll('.cat-card .cat-photo img')].filter((i) => i.naturalWidth > 0).length;
  const results = r(document.querySelector('section[aria-label="Results"]'));
  const cardWidths = [...document.querySelectorAll('.prod-card')].map((c) => c.getBoundingClientRect().width);
  const hasFilterControl = !!document.querySelector('.filter-rail, .facet, [data-filter-open], button[aria-controls*="filter" i], button[aria-label*="filter" i]');
  const facetOverflow = [...document.querySelectorAll('.facet-val')].filter((el) => el.scrollWidth > el.clientWidth + 1).length;
  const facetCount = document.querySelectorAll('.facet-val').length;
  /*
   * .buybox and .pdp-centre were the v1 class contract and no longer exist anywhere in the app —
   * the panel is .buy-panel and the product name is its h1. Three checks were therefore asserting
   * the absence of classes nobody had used for months, which is worse than having no check at all:
   * a gate that always reports the same three failures is a gate everybody learns to scroll past,
   * and the real regressions scroll past with it.
   *
   * (No backticks in here: this whole block is a template literal handed to page.evaluate.)
   */
  const h1InBuyPanel = !!document.querySelector('.buy-panel h1');
  const buybox = r(document.querySelector('.buy-panel'));
  const buyCta = r(document.querySelector('.buy-panel .btn-primary'));
  const backdrop = [...document.querySelectorAll('*')].filter((el) => { const v = getComputedStyle(el).backdropFilter; return v && v !== 'none'; }).length;
  /*
   * WHAT THE CONTRAST ACTUALLY IS, ON THE RENDERED PAGE.
   *
   * This replaces a check for one specific colour — brand teal used as text "on light surfaces" —
   * written when the store was light, and reporting the same handful of failures on every page
   * ever since it went dark. Brand teal on a #06181d canvas is about 10:1; the rule was flagging
   * the most legible text on the page.
   *
   * Measuring instead of proxying: every element with text of its own, its colour against the
   * first ancestor that actually paints a background, scored by WCAG with the large-text
   * allowance. It cannot go stale when the palette changes, it covers every colour rather than
   * one, and it is the thing the old rule was a guess at.
   */
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const parseC = (v) => { const m = (v || '').match(/[0-9.]+/g); return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : null; };
  const bgOf = (el) => {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const c = parseC(getComputedStyle(cur).backgroundColor);
      if (c && c[3] > 0.85) return c;
      cur = cur.parentElement;
    }
    return parseC(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  };
  const lowContrast = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('.ar-stage, canvas, svg, [aria-hidden="true"]')) return;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    if (!own) return;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity < 0.3) return;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const fg = parseC(st.color);
    if (!fg || fg[3] < 0.5) return;
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(st.fontSize);
    const large = px >= 24 || (px >= 18.66 && +st.fontWeight >= 700);
    if (ratio + 0.05 < (large ? 3 : 4.5)) {
      lowContrast.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ').slice(0, 2).join('.') + ' ' + ratio.toFixed(2) + ':1 "' + (el.textContent || '').trim().slice(0, 24) + '"');
    }
  });
  return { overflow, firstCard, firstTile, catTiles, catTilesWithArt, results, cardWidths, hasFilterControl, facetOverflow, facetCount, h1InBuyPanel, buybox, buyCta, backdrop, lowContrast, innerHeight: window.innerHeight };
})()`;

async function shoot(browser: Browser, shot: Shot, viewport: 'desktop' | 'mobile') {
  /*
   * `reducedMotion: 'reduce'`, and it is the difference between a screenshot of the store and a
   * screenshot of a hero above four thousand pixels of nothing.
   *
   * The scroll choreography hides `[data-reveal]` content before first paint and reveals it as it
   * intersects. A full-page screenshot never scrolls, so nothing below the fold ever intersects,
   * and every shot this harness has produced showed a blank column under the hero: 81 of 81
   * reveal elements on the home page at opacity 0. The layout assertions were being measured on
   * that page too.
   *
   * `reduce` makes the bootstrap in lib/reveal-bootstrap.ts return before it hides anything, which
   * is exactly the state a settled page is in — and the state a person who has scrolled sees. It
   * is also the honest setting for a screenshot: motion is not what is being captured.
   */
  const ctx: BrowserContext = await browser.newContext(
    viewport === 'desktop'
      ? { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, reducedMotion: 'reduce' }
      : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' },
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

    /*
     * SCROLL THE WHOLE PAGE FIRST, THEN GO BACK TO THE TOP.
     *
     * `fullPage: true` stretches the viewport and captures in one pass without ever scrolling, so
     * anything waiting on the viewport never happens: `loading="lazy"` images below the fold stay
     * unloaded. Seven of the thirty-five category tiles on the home page came out as empty dark
     * boxes in every shot this harness has taken — not because the images are missing (all
     * thirty-five are on disk and all thirty-five load) but because nothing had asked for them.
     *
     * A screenshot that shows a worse page than the one that ships is worse than no screenshot:
     * it invites fixing things that are not broken.
     */
    await page
      .evaluate(`(async () => {
        const step = Math.max(200, Math.round(window.innerHeight * 0.8));
        /* Bounded: a page that grows as it loads must not turn this into an infinite scroll. */
        for (let i = 0; i < 40; i++) {
          const y = i * step;
          if (y > document.body.scrollHeight) break;
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 50));
        }
        window.scrollTo(0, 0);
      })()`)
      .catch(() => {});
    /* The dev server holds an HMR socket open, so `networkidle` can never settle there. */
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    /*
     * Decode, not just fetch: an image that has arrived but not decoded still paints blank.
     *
     * Raced against a deadline, because `decode()` on an image that never settles never settles
     * either — it does not reject, so a per-image `.catch` does nothing, and the whole run hangs on
     * one lazy image below the fold of a five-thousand-pixel product page.
     */
    await page
      .evaluate(
        `Promise.race([
          Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}))),
          new Promise((r) => setTimeout(r, 3000)),
        ])`,
      )
      .catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true });

    // Passed as a string: tsx/esbuild's keepNames injects a `__name` helper into function
    // expressions, which does not exist inside the page when Playwright serialises a callback.
    const m = (await page.evaluate(METRICS_JS)) as Metrics;

    check(shot.key, viewport, 'no horizontal overflow', !m.overflow);
    /*
     * A blur or two on persistent chrome is a deliberate design choice — the header is glass, and
     * the buy panel sits over the gallery. What this rule exists to catch is a blur PER CARD: the
     * home page carried twenty-six, one on every "Arriving soon" pill, each a separate compositing
     * pass over a lazily-loaded photograph on the first screen a phone ever draws.
     *
     * Written as zero, it failed on every page forever and taught everyone to ignore it, which is
     * how the twenty-six survived. Three is the whole of the store's intentional glass.
     */
    check(shot.key, viewport, 'backdrop-filter only on persistent chrome', m.backdrop <= 3, `${m.backdrop} elements`);
    check(shot.key, viewport, 'every text passes WCAG AA against what is behind it', m.lowContrast.length === 0, m.lowContrast.slice(0, 4).join(' · ') || 'ok');
    if (m.facetCount > 0) check(shot.key, viewport, 'facet labels fit', m.facetOverflow === 0, `${m.facetOverflow}/${m.facetCount} overflow`);
    if (shot.key === 'home' && viewport === 'desktop') {
      /*
       * The home page shows CATEGORIES, never products — that is a decision, not an omission, and
       * this check was asserting the opposite: it looked for a `.prod-card` and reported "no
       * .prod-card" forever on a page that is correct precisely because it has none.
       *
       * What it was reaching for is that the catalogue starts near the top rather than below a
       * screen and a half of preamble, so that is what it asks now, against the tile that is
       * actually there.
       */
      check(
        shot.key,
        viewport,
        'the catalogue is reachable within two screens',
        !!m.firstTile && m.firstTile.y < m.innerHeight * 2,
        m.firstTile ? `top ${Math.round(m.firstTile.y)}px of ${m.innerHeight * 2}px` : 'no .cat-card',
      );
      check(
        shot.key,
        viewport,
        'every category tile has its artwork',
        m.catTiles > 0 && m.catTilesWithArt === m.catTiles,
        `${m.catTilesWithArt}/${m.catTiles}`,
      );
    }
    if ((shot.key === 'plp' || shot.key === 'search') && viewport === 'desktop') {
      /*
       * Beside the rail, and products on the first screen. The y bound was a flat 420px, which is
       * a number about a page that no longer exists; what it was protecting is that a category
       * page shows PRODUCTS without scrolling, so that is what it asks — of the card, not of the
       * container that happens to hold it.
       */
      check(
        shot.key,
        viewport,
        'results sit beside the filter rail',
        !!m.results && m.results.x >= 260,
        m.results ? `x ${Math.round(m.results.x)}` : 'no results section',
      );
      check(
        shot.key,
        viewport,
        'a product is visible without scrolling',
        !!m.firstCard && m.firstCard.y < m.innerHeight,
        m.firstCard ? `first card at ${Math.round(m.firstCard.y)}px of ${m.innerHeight}px` : 'no .prod-card',
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
      /*
       * `.plp-toolbar` has not existed for a long time — the category page is a FilterRail beside a
       * results section — so this asserted the stickiness of a component nobody renders and reported
       * "null" on every run. What matters on a phone is that the filters are reachable at all
       * without scrolling back to the top, which is what the rail's own control does.
       */
      check(shot.key, viewport, 'the filters are reachable', m.hasFilterControl, m.hasFilterControl ? 'ok' : 'no filter control on the page');
    if (shot.key === 'pdp' && viewport === 'desktop') {
      check(shot.key, viewport, 'the product name is the h1, in the buy panel', m.h1InBuyPanel);
      check(
        shot.key,
        viewport,
        'buy box in the right-hand column',
        !!m.buybox && m.buybox.x > 1350 * 0.55,
        m.buybox ? `x ${Math.round(m.buybox.x)} of 1350` : 'no .buy-panel',
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

/**
 * THE ONE PASS WITH THE MOTION TURNED ON.
 *
 * Every screenshot above is taken with `reducedMotion: 'reduce'`, for good reasons stated in
 * `shoot` — but it means this harness is structurally blind to the entire motion layer. The
 * store hides content before first paint and reveals it with script: `[data-reveal]` starts at
 * opacity 0, and lazily-loaded photographs start there too. Under `reduce` none of that runs, so
 * a bug that leaves the page permanently blank passes thirty-three checks and ships.
 *
 * This walks one page the way a reader does, waits for the last transition to finish, and then
 * asserts the only thing that actually matters: nothing the motion layer hid is still hidden.
 * The 0.4 floor is the deliberate dimming on an "arriving soon" tile — the one thing in the
 * store that is meant to sit under full strength.
 *
 * And with JavaScript off entirely, `.js-reveal` must never be on the document: the class is
 * what hides things, a script is what adds it, and content must never be behind a script that
 * did not arrive.
 */
async function motionPass(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1350, height: 940 }, reducedMotion: 'no-preference' });
  await ctx.addCookies([sessionCookieFor(BASE)]);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(
      `(async () => { const s = Math.round(innerHeight * 0.8); for (let y = 0; y < document.body.scrollHeight; y += s) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } })()`,
    );
    /* Longer than --dur-4 plus the longest stagger step, so a slow finisher is not a failure. */
    await page.waitForTimeout(1500);
    const m = (await page.evaluate(`(() => {
      const dim = (el) => +getComputedStyle(el).opacity;
      const imgs = [...document.images].filter((i) => dim(i) < 0.4);
      const reveals = [...document.querySelectorAll('[data-reveal]')].filter((e) => dim(e) < 0.99);
      return { armed: document.documentElement.classList.contains('js-reveal'),
               images: document.images.length, hiddenImages: imgs.length, hiddenReveals: reveals.length,
               sample: imgs.slice(0, 2).map((i) => (i.currentSrc || '').split('/').pop()) };
    })()`)) as { armed: boolean; images: number; hiddenImages: number; hiddenReveals: number; sample: string[] };

    check('motion', 'desktop', 'the motion layer is actually armed', m.armed, 'js-reveal absent — nothing below is being tested');
    check('motion', 'desktop', 'every photograph ends up visible', m.hiddenImages === 0, `${m.hiddenImages}/${m.images} still faded — ${m.sample.join(', ')}`);
    check('motion', 'desktop', 'every revealed element ends up shown', m.hiddenReveals === 0, `${m.hiddenReveals} still at opacity 0`);
  } finally {
    await ctx.close();
  }

  /* The failsafe, from the outside: no script, nothing hidden. */
  const bare = await browser.newContext({ viewport: { width: 1350, height: 940 }, javaScriptEnabled: false });
  await bare.addCookies([sessionCookieFor(BASE)]);
  const plain = await bare.newPage();
  try {
    await plain.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120_000 });
    const html = await plain.content();
    check('motion', 'desktop', 'nothing is hidden when the script never runs', !/<html[^>]*class="[^"]*js-reveal/.test(html));
  } finally {
    await bare.close();
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
    /* Two surfaces this harness has never photographed, and both are ones a customer reaches with
       something at stake: the cart is where the money is committed, the account is where the
       orders and the coins live. Empty states count — an empty cart is the state most visitors
       see, and it is the one nobody designs. */
    { key: 'cart', url: '/cart', auth: true },
    { key: 'account', url: '/account', auth: true },
    { key: 'welcome', url: '/welcome', auth: false },
  ];
  const shots = ONLY.length ? all.filter((s) => ONLY.includes(s.key)) : all;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const s of shots) {
      await shoot(browser, s, 'desktop');
      await shoot(browser, s, 'mobile');
    }
    if (!ONLY.length) await motionPass(browser);
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
