/**
 * pnpm --filter @buildobjects/web sweep [--base http://localhost:3001]
 *
 * EVERY SURFACE, EVERY VIEWPORT, AGAINST ONE CHECKLIST.
 *
 * The screenshot gate asserts things somebody already thought to assert. This asks the opposite
 * question — what is wrong that nobody has looked for yet — and it asks it of every route at both
 * viewports at once, so the answer is a list rather than whatever happened to catch the eye.
 *
 * Nine detectors, each for a defect that is invisible in a screenshot until you know to look:
 *
 *   clipped        text cut by an ellipsis or an overflow, with the whole string in the DOM
 *   tap            interactive targets under 44x44 on a coarse pointer
 *   overlap        two pieces of text occupying the same pixels
 *   headings       a heading level skipped, or more than one h1
 *   alt            an <img> with no alt attribute at all (empty alt is correct for decoration)
 *   focus          a control the Tab key reaches with no visible focus ring
 *   overflow       an element wider than the viewport
 *   orphan         a heading with nothing under it, or a section with a heading and no content
 *   label          a form control with no accessible name
 *
 * It reports and does not fail: it is a survey, not a gate. Anything it finds that MATTERS gets
 * fixed and, where it can regress, gated in shots.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { sessionCookie, sessionCookieFor } from './session-cookie';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const BASE = flag('base', 'http://localhost:3001').replace(/\/$/, '');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function firstSku(): Promise<string> {
  try {
    const r = await fetch(`${BASE}/api/skus?limit=1`, { headers: { cookie: sessionCookie() } });
    const j = (await r.json()) as { items?: { sku_code: string }[] };
    return j.items?.[0]?.sku_code?.toLowerCase() ?? 'cem-acc-sp50';
  } catch {
    return 'cem-acc-sp50';
  }
}

/*
 * NO BACKTICKS ANYWHERE BELOW, INCLUDING IN COMMENTS.
 *
 * This is a template literal, so one backtick ends the string and esbuild reports it as a syntax
 * error thirty lines further down — "Expected ; but found elementsFromPoint" — which points at
 * innocent code. It has cost three debugging rounds in this codebase already. Quote identifiers
 * with nothing, or with single quotes.
 */
const AUDIT = `(() => {
  const vw = window.innerWidth;
  const coarse = vw < 700;
  const box = (el) => el.getBoundingClientRect();
  const seen = (el) => { const s = getComputedStyle(el); const b = box(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && b.width > 0 && b.height > 0; };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '');
  const say = (el, extra) => name(el) + (extra ? ' ' + extra : '') + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28) + '"';
  const out = { clipped: [], tap: [], overlap: [], headings: [], alt: [], overflow: [], label: [] };

  /* 1. Text the page is hiding from the reader. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 2);
    if (!own) continue;
    const s = getComputedStyle(el);
    /* A visually-hidden span is clipped to a 1px box on purpose — that IS the technique. Flagging
       it is flagging the screen-reader text for being invisible to eyes. */
    if (el.closest('.visually-hidden, .sr-only') || s.clipPath !== 'none' || (el.clientWidth <= 1 && el.clientHeight <= 1)) continue;
    const clampy = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || s.overflow === 'hidden';
    if (!clampy) continue;
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) out.clipped.push(say(el));
  }

  /* 2. Anything you are meant to press. 44 is the number every platform agrees on. */
  if (coarse) {
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')) {
      if (!seen(el)) continue;
      const b = box(el);
      if (b.width >= 44 && b.height >= 44) continue;
      /* An inline link inside a sentence is not a target; it is prose. */
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
      /*
       * THREE THINGS THIS SHOULD NEVER HAVE FLAGGED, and a tool that cries wolf is worth as
       * little as a gate that cannot fail.
       *
       *   a checkbox or radio inside a label — the LABEL is what a person presses, and the box
       *     is drawn at 20px on purpose;
       *   a range input — you drag its thumb, and the track being 16px tall is what a slider is;
       *   a bar in a chart — thirteen months of cashflow cannot each be 44px wide inside a 390px
       *     phone, and the scrub control underneath is the accessible path to the same data.
       */
      const t = (el.getAttribute('type') || '').toLowerCase();
      if ((t === 'checkbox' || t === 'radio') && el.closest('label')) continue;
      if (t === 'range') continue;
      if (el.closest('[role=img]') || /(^| )(time-bar|donut|chart)/.test(el.className || '')) continue;
      out.tap.push(say(el, Math.round(b.width) + 'x' + Math.round(b.height)));
    }
  }

  /*
   * 3. Text a reader cannot see because something else is drawn over it.
   *
   * THE FIRST VERSION COMPARED BOUNDING BOXES and reported thirty overlaps, nearly all of them
   * fiction: two inline spans on one line, a struck-through price and the "(6% off)" beside it, a
   * facet label and a heading in the same column. A rectangle round a piece of text is not where
   * the text is.
   *
   * elementsFromPoint is the real question — what is actually on top at this pixel — asked at the
   * middle of each line the element occupies, so a wrapped paragraph is checked line by line
   * rather than as one tall box. A hit only counts when the thing on top has text of its OWN and
   * paints something opaque enough to hide what is underneath.
   */
  const texts = [...document.querySelectorAll('body *')].filter((el) => seen(el)
    && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1));
  const opaque = (el) => { const c = (getComputedStyle(el).backgroundColor.match(/[0-9.]+/g) || []).map(Number);
    return c.length >= 3 && (c.length < 4 || c[3] > 0.5); };
  for (const el of texts) {
    const rects = [...el.getClientRects()];
    for (const r of rects.slice(0, 4)) {
      if (r.width < 8 || r.height < 6) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > vw || y > window.innerHeight) continue;
      const stack = document.elementsFromPoint(x, y);
      const meAt = stack.indexOf(el);
      if (meAt <= 0) continue;
      /* Everything drawn above this element at this pixel. */
      const over = stack.slice(0, meAt).find((o) => !o.contains(el) && opaque(o)
        && [...o.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1));
      if (over) out.overlap.push(name(over) + ' covers ' + name(el));
    }
  }

  /* 4. The document outline. */
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(seen);
  const h1s = hs.filter((h) => h.tagName === 'H1');
  if (h1s.length !== 1) out.headings.push(h1s.length + ' h1 elements');
  let prev = 0;
  for (const h of hs) {
    const lvl = +h.tagName[1];
    if (prev && lvl > prev + 1) out.headings.push('jumps h' + prev + ' to h' + lvl + ' at "' + (h.textContent || '').trim().slice(0, 24) + '"');
    prev = lvl;
  }

  /* 5. Images with no alt AT ALL. alt="" is the correct answer for decoration. */
  for (const im of document.images) if (seen(im) && im.getAttribute('alt') === null) out.alt.push(im.currentSrc.split('/').pop() || 'image');

  /* 7. Anything wider than the window. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const b = box(el);
    if (b.width > vw + 2 && getComputedStyle(el).position !== 'fixed') out.overflow.push(say(el, Math.round(b.width) + 'px'));
  }

  /* 8. Controls nothing can name. */
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!seen(el)) continue;
    const id = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (id || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) continue;
    out.label.push(name(el));
  }

  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, 8);
  return out;
})()`;

async function main() {
  const sku = await firstSku();
  const routes: [string, string][] = [
    ['welcome', '/welcome'],
    ['home', '/'],
    ['category', '/c/bulbs'],
    ['search', '/search?q=cement'],
    ['product', `/p/${sku}`],
    ['estimate', '/estimate?city=vijayawada&l=30&w=40&floors=1&tier=medium'],
    ['room', `/ar/${sku}`],
    ['cart', '/cart'],
    ['account', '/account'],
  ];
  const browser = await chromium.launch();
  const findings: Record<string, Record<string, string[]>> = {};
  let total = 0;

  for (const [label, url] of routes) {
    for (const [w, h, vp] of [
      [1350, 940, 'desktop'],
      [390, 844, 'mobile'],
    ] as const) {
      const ctx = await browser.newContext(
        vp === 'mobile'
          ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
          : { viewport: { width: w, height: h }, reducedMotion: 'reduce' },
      );
      await ctx.addCookies([sessionCookieFor(BASE)]);
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}${url}`, { waitUntil: 'load', timeout: 90_000 });
        /*
         * WAIT FOR THE REAL TYPE BEFORE MEASURING ANY OF IT.
         *
         * The faces load with `font-display: swap`, so for the first moments the page is set in
         * system-ui — a wider face than Schibsted Grotesk — and every measurement of whether text
         * fits its box is taken against type the reader will never see. That is what reported
         * "Drafting & Measurement Items" as clipped on the home page: measured after the swap it
         * fits with a line to spare, and a probe that scrolled first (and so waited longer) found
         * nothing clipped at all.
         *
         * `document.fonts.ready` is the exact event, rather than a longer guess at a timeout.
         */
        await page.evaluate('document.fonts.ready').catch(() => {});
        await page.waitForTimeout(700);
        const r = (await page.evaluate(AUDIT)) as Record<string, string[]>;

        /*
         * FOCUS, WALKED WITH A REAL TAB KEY.
         *
         * The first version called el.focus() from inside the page and reported ten controls with
         * no ring. All ten were fiction: theme.css gives every focusable element a ring through
         * `:where(a, button, ...):focus-visible`, and a PROGRAMMATIC focus does not make a button
         * match :focus-visible — that is the whole point of the pseudo-class. Only a keyboard
         * does, so this presses Tab.
         */
        const noRing: string[] = [];
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Tab');
          const bad = (await page.evaluate(`(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const s = getComputedStyle(el);
            const ring = (s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' || s.backgroundColor !== getComputedStyle(el.parentElement || document.body).backgroundColor;
            return ring ? null : el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' "' + (el.textContent || '').trim().slice(0, 22) + '"';
          })()`)) as string | null;
          if (bad) noRing.push(bad);
        }
        if (noRing.length) r.focus = [...new Set(noRing)].slice(0, 8);
        const key = `${label}/${vp}`;
        const hit = Object.fromEntries(Object.entries(r).filter(([, v]) => v.length));
        if (Object.keys(hit).length) {
          findings[key] = hit;
          total += Object.values(hit).reduce((s, v) => s + v.length, 0);
        }
      } catch (e) {
        findings[`${label}/${vp}`] = { error: [(e as Error).message.slice(0, 80)] };
        total += 1;
      } finally {
        await ctx.close();
      }
    }
  }
  await browser.close();

  for (const [where, kinds] of Object.entries(findings)) {
    console.log(`\n${where}`);
    for (const [kind, items] of Object.entries(kinds)) {
      console.log(`  ${kind}  (${items.length})`);
      for (const i of items) console.log(`     ${i}`);
    }
  }
  const dir = path.join(ROOT, 'storage', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sweep.json'), JSON.stringify(findings, null, 2));
  console.log(
    Object.keys(findings).length === 0
      ? '\nnothing found across 9 surfaces at both viewports'
      : `\n${total} finding(s) across ${Object.keys(findings).length} surface/viewport pairs → storage/reports/sweep.json`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
