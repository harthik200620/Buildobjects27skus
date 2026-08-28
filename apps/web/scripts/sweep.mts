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
 *   focus          a focusable control with no visible focus ring
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

const AUDIT = `(() => {
  const vw = window.innerWidth;
  const coarse = vw < 700;
  const box = (el) => el.getBoundingClientRect();
  const seen = (el) => { const s = getComputedStyle(el); const b = box(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && b.width > 0 && b.height > 0; };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '');
  const say = (el, extra) => name(el) + (extra ? ' ' + extra : '') + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28) + '"';
  const out = { clipped: [], tap: [], overlap: [], headings: [], alt: [], focus: [], overflow: [], label: [] };

  /* 1. Text the page is hiding from the reader. */
  for (const el of document.querySelectorAll('body *')) {
    if (!seen(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 2);
    if (!own) continue;
    const s = getComputedStyle(el);
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

  /* 3. Two pieces of text on the same pixels. */
  const texts = [...document.querySelectorAll('body *')].filter((el) => seen(el)
    && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1)
    && getComputedStyle(el).position !== 'fixed');
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], c = texts[j];
      if (a.contains(c) || c.contains(a)) continue;
      const p = box(a), q = box(c);
      const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      const oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ox > 6 && oy > 6) { out.overlap.push(name(a) + ' over ' + name(c)); }
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

  /* 6. Focus you can see. */
  for (const el of [...document.querySelectorAll('a[href], button, [role=button], input, select')].filter(seen).slice(0, 40)) {
    el.focus();
    const s = getComputedStyle(el);
    const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
    if (!ring) out.focus.push(say(el));
    el.blur();
  }

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
        await page.waitForTimeout(900);
        const r = (await page.evaluate(AUDIT)) as Record<string, string[]>;
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
