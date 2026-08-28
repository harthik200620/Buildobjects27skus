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
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { BASE, flags, only, openPage, REPO, VIEWPORTS } from './harness';
import { sessionCookie, sessionCookieFor } from './session-cookie';

const STRICT = !!flags.strict;
const ONLY = only;
const OUT = path.resolve(flags.out ?? path.join(REPO, 'storage', 'reports', 'shots'));

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
  /** Worst gap, in px, between two prices in the same grid row. Must be 0. */
  priceSpread: number;
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
  /*
   * DO THE PRICES IN A ROW SIT ON ONE LINE?
   *
   * The most obvious tell a product grid has, and the cheapest to lose: names in this catalogue
   * run from "Plus Cement" to "Portland Pozzolana Cement (PPC) 50 kg bag", the title takes up to
   * three lines, and anything that stops a card filling its row puts two prices twenty-two pixels
   * apart. Three separate causes were found and fixed in one sitting — a price stacked from the
   * top instead of the bottom, two auto margins splitting the free space between them, and a
   * wrapper div that took the grid's stretch and did not pass it on.
   *
   * Cards are grouped into rows by their own top edge, so this holds however many columns the
   * viewport gives.
   */
  const rowSpread = (sel) => {
    let worst = 0;
    for (const grid of document.querySelectorAll('.prod-grid')) {
      const rows = new Map();
      for (const c of grid.querySelectorAll('.prod-card')) {
        const t = Math.round(c.getBoundingClientRect().top / 5) * 5;
        if (!rows.has(t)) rows.set(t, []);
        rows.get(t).push(c);
      }
      for (const [, group] of rows) {
        if (group.length < 2) continue;
        const ys = group.map((c) => c.querySelector(sel)).filter(Boolean).map((e) => Math.round(e.getBoundingClientRect().top));
        if (ys.length > 1) worst = Math.max(worst, Math.max(...ys) - Math.min(...ys));
      }
    }
    return worst;
  };
  const priceSpread = rowSpread('.price-block');
  return { overflow, firstCard, firstTile, catTiles, catTilesWithArt, results, cardWidths, hasFilterControl, facetOverflow, facetCount, h1InBuyPanel, buybox, buyCta, backdrop, lowContrast, priceSpread, innerHeight: window.innerHeight };
})()`;

/**
 * TEXT OVER A PHOTOGRAPH, MEASURED AGAINST THE PHOTOGRAPH.
 *
 * The WCAG pass in METRICS_JS walks up to the first ancestor that paints an OPAQUE background,
 * which is the correct answer everywhere in this store except over a `.plate` — the photographic
 * backplate under the home hero, every category head, the search, cart and account heads. There
 * the nearest opaque thing is the page canvas, so the check scores white-on-canvas, sails through,
 * and never once looks at the picture the words are actually sitting on.
 *
 * This hides the copy, photographs what is left, and scores each run of text against the region it
 * occupied — taking mean + 2 standard deviations, so a headline crossing a bright window is judged
 * on the window rather than on the average of the sky.
 *
 * It was written to check a change to the hero scrim and immediately earned its place: opening
 * that scrim lifted the backdrop from 28 to 31 out of 255 — nothing anybody would notice — while
 * dropping the three stat labels from 5.03:1 to 4.33:1, under the 4.5 they need. The change was
 * reverted. Neither number was visible to anything else in this harness.
 */
async function plateContrast(page: Page, key: string, viewport: 'desktop' | 'mobile') {
  const plate = await page
    .locator('.plate')
    .first()
    .boundingBox()
    .catch(() => null);
  if (!plate || plate.width < 40 || plate.height < 40) return;

  const targets = (await page.evaluate(`(() => {
    const plate = document.querySelector('.plate');
    if (!plate) return [];
    const host = plate.parentElement;
    if (!host) return [];
    const out = [];
    for (const el of host.querySelectorAll('*')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1);
      if (!own) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity < 0.5) continue;
      /*
       * ANYTHING THAT PAINTS ITS OWN GROUND IS NOT OVER THE PHOTOGRAPH.
       *
       * The hero's primary button sits on the plate and on its own teal fill, and this scored it
       * against the picture at 1.58:1 — a failure that is not one. A button, a chip or a pill
       * carries its backdrop with it; only text with nothing of its own between it and the
       * photograph belongs here. Walk up to the plate looking for an opaque ancestor, exactly the
       * way the WCAG pass above does.
       */
      let cur = el, own_bg = false;
      while (cur && cur !== plate.parentElement) {
        const c = (getComputedStyle(cur).backgroundColor.match(/[0-9.]+/g) || []).map(Number);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) { own_bg = true; break; }
        cur = cur.parentElement;
      }
      if (own_bg) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      out.push({ sel: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0],
                 text: (el.textContent || '').trim().slice(0, 20), x: r.x, y: r.y, w: r.width, h: r.height,
                 color: st.color, size: parseFloat(st.fontSize), weight: +st.fontWeight });
    }
    return out;
  })()`)) as { sel: string; text: string; x: number; y: number; w: number; h: number; color: string; size: number; weight: number }[];
  if (!targets.length) return;

  /* Hide the copy; what is left in that rectangle is exactly the backdrop it sat on. */
  const hide = await page.addStyleTag({
    content: '.hero-in, .page-head, .cat-head, .plate ~ *, .plate + * { visibility: hidden !important; }',
  });
  await page.waitForTimeout(150);
  const shot = await page.screenshot({ clip: plate });
  /* `n` is typed as Node here; only Element carries remove(). */
  await hide.evaluate((n) => (n as unknown as Element).remove()).catch(() => {});

  const meta = await sharp(shot).metadata();
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const bad: string[] = [];

  for (const t of targets) {
    const left = Math.max(0, Math.round(t.x - plate.x));
    const top = Math.max(0, Math.round(t.y - plate.y));
    const w = Math.min(Math.round(t.w), (meta.width ?? 0) - left);
    const h = Math.min(Math.round(t.h), (meta.height ?? 0) - top);
    if (w < 6 || h < 5) continue;
    const st = await sharp(shot)
      .extract({ left, top, width: w, height: h })
      .stats()
      .catch(() => null);
    if (!st) continue;
    /* The brightest realistic part of the backdrop is the hard case for the light ink this store
       sets over photographs. */
    const back = st.channels.slice(0, 3).map((c) => Math.min(255, c.mean + 2 * c.stdev));
    const fg = (t.color.match(/[\d.]+/g) ?? ['255', '255', '255']).slice(0, 3).map(Number);
    const l1 = lum(fg);
    const l2 = lum(back);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    const need = large ? 3 : 4.5;
    if (ratio + 0.02 < need) bad.push(`${t.sel} ${ratio.toFixed(2)}:1 (needs ${need}) "${t.text}"`);
  }
  check(key, viewport, 'text over a photograph clears its bar against the photograph', bad.length === 0, bad.join(' · '));
}

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
    await plateContrast(page, shot.key, viewport);

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
    check(shot.key, viewport, 'prices line up across a row', m.priceSpread === 0, `worst gap ${m.priceSpread}px`);
    /*
     * THERE IS NO "nothing loops under reduced motion" CHECK HERE, AND THAT IS DELIBERATE.
     *
     * One was written and removed the same hour. Measured across all nine surfaces it reported
     * zero infinite animations — correctly, and for a reason that makes the check worthless:
     * theme.css already sets `animation-iteration-count: 1 !important` on every element and both
     * pseudo-elements under prefers-reduced-motion. Nothing CAN loop, so the check cannot fail.
     * Adding a rogue infinite animation to the hero and re-running proved it: 12/12 still passed.
     *
     * A gate that cannot fail is a green light that means nothing, which is the failure mode two
     * other checks in this codebase had already shipped with. The guarantee lives at the root,
     * where it belongs; this is a note so nobody writes the check again.
     */
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
  const { page, ctx } = await openPage(browser, { motion: 'no-preference' });
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(
      `(async () => { const s = Math.round(innerHeight * 0.8); for (let y = 0; y < document.body.scrollHeight; y += s) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } })()`,
    );
    /*
     * WAIT FOR THE CONDITION, NOT FOR A CLOCK.
     *
     * This was a flat 1500 ms, chosen as "longer than --dur-4 plus the longest stagger step", and
     * on a loaded machine it was not: the run that added the tap-target work reported "3 still at
     * opacity 0" and two clean runs immediately after found 0 of 47. A gate that fails at random
     * is a gate people learn to re-run, which is how the thirteen-of-thirty-two era started.
     *
     * Poll instead, up to six seconds. It settles in well under one when nothing is wrong, and
     * when something IS wrong it still reports it — just without the coin toss.
     */
    /*
     * POLLED ON A TIMER, NOT ON A FRAME.
     *
     * waitForFunction defaults to polling on requestAnimationFrame, which stalls in precisely the
     * situation this pass runs in: eighteen contexts have just been driven through this browser,
     * frames get throttled, and the poll stops asking. It reported "3 still at opacity 0" once
     * inside a full run while five isolated repetitions of the identical scroll found 0 of 47 —
     * the page was fine and the waiting was not.
     *
     * A 100 ms timer keeps asking whatever the compositor is doing. Ten seconds because the last
     * element of a staggered grid can be most of a second behind the first, and a slow machine
     * stretches that; it settles in well under one when nothing is wrong.
     */
    await page
      .waitForFunction(`[...document.querySelectorAll('[data-reveal]')].every((e) => +getComputedStyle(e).opacity > 0.99)`, null, {
        timeout: 10_000,
        polling: 100,
      })
      .catch(() => {});
    await page.waitForTimeout(200);
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

  /*
   * The navigation bar, which has exactly one way to fail badly: staying up.
   *
   * It fills while a page is on its way and the arriving page is what finishes it. A bar still
   * filling after the page has landed is worse than no bar, and it is invisible to every other
   * check here — a screenshot of a settled page cannot show it.
   */
  const { page: navPage, ctx: nav } = await openPage(browser);
  try {
    const pending = () => navPage.evaluate(`document.documentElement.hasAttribute('data-nav-pending')`) as Promise<boolean>;
    await navPage.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120_000 });
    check('motion', 'desktop', 'the navigation bar is down when nothing is in flight', !(await pending()));
    await navPage.locator('.cat-grid a').first().click({ noWaitAfter: true });
    await navPage.waitForTimeout(60);
    check('motion', 'desktop', 'a click raises the navigation bar', await pending());
    await navPage.waitForURL(/\/c\//, { timeout: 60_000 });
    await navPage.waitForTimeout(500);
    check('motion', 'desktop', 'the arriving page puts it back down', !(await pending()), 'a bar still filling after the page has landed');
  } catch (e) {
    check('motion', 'desktop', 'the navigation bar behaves', false, (e as Error).message.slice(0, 90));
  } finally {
    await nav.close();
  }

  /* The failsafe, from the outside: no script, nothing hidden. */
  const bare = await browser.newContext({ ...VIEWPORTS.desktop, javaScriptEnabled: false });
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
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · screenshots → ${path.relative(REPO, OUT)}`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, strict: STRICT, checks }, null, 2));
  if (STRICT && failed.length) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
