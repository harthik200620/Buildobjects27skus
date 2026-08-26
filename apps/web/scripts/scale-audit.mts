/**
 * Count the distinct radii and type sizes each page actually paints.
 *
 * This is the gate for the complaint that is hardest to act on: "it looks cheap". Nobody points
 * at a radius. What they are seeing is a page painting seven different corner radii and seventeen
 * different type sizes — six of which differ from their neighbour by half a pixel — because forty
 * stylesheets each picked a number that looked right in isolation. A reader cannot name it and
 * cannot stop registering it.
 *
 * The home page measured SEVEN radii and SEVENTEEN sizes when this was written, against a token
 * scale that offers six radii and eleven sizes. The strays were 5px and 9px corners, and 10.5,
 * 12.5 and 13.5px type — none of them a token, all of them one increment from one.
 *
 * Two things it deliberately does NOT do:
 *
 *   · It does not check values against the token list. A size can be perfectly legitimate and not
 *     appear in the scale — the wordmark derives its own from `--wm-size`, and every display step
 *     is a clamp that resolves differently at every viewport. Counting DISTINCT values catches the
 *     sprawl without arguing about which value is allowed.
 *   · It does not fail on one over. The budgets below are ceilings a page has to work to exceed,
 *     not targets; a page at the ceiling is fine and a page four past it has stopped having a
 *     system.
 *
 *   pnpm --filter @buildobjects/web scale:audit
 *
 * Exits non-zero over budget, so it can join the gate.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';

/**
 * Per-route budgets: what each page measures today, plus one.
 *
 * Plus one and no more, deliberately. A budget with slack in it is not a gate, it is a note —
 * the page drifts up to the ceiling over a few passes and nothing ever reports it. One is room
 * for a genuinely new kind of control; two is the beginning of the sprawl this exists to catch.
 * Raising a number here should feel like a decision, and the diff should say why.
 *
 * A listing page legitimately carries more kinds of control than the front door, which is why
 * these are per-route rather than one number for the store.
 */
const ROUTES: { path: string; radii: number; sizes: number }[] = [
  { path: '/', radii: 6, sizes: 15 },
  { path: '/search', radii: 7, sizes: 11 },
  { path: '/c/bulbs', radii: 7, sizes: 12 },
  { path: '/p/cem-ult-ppc50', radii: 8, sizes: 14 },
  { path: '/cart', radii: 7, sizes: 11 },
  { path: '/estimate', radii: 7, sizes: 15 },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

/* Sign in once; every route below the front door needs the session cookie. */
await page.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (base) => {
  await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', otp: '000000', pincode: '500001', regionId: 'hyd' }),
  });
}, BASE);
/* The cart is empty otherwise, and an empty cart paints none of the chrome this is counting. */
await page.evaluate(() =>
  localStorage.setItem(
    'bo_estimate_picks',
    JSON.stringify([
      { sku_code: 'CEM-ULT-PPC50', qty: 12 },
      { sku_code: 'TIL-KAJ-GP00215', qty: 4 },
    ]),
  ),
);

let over = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' });
  const found = await page.evaluate(() => {
    const radii: Record<string, number> = {};
    const sizes: Record<string, number> = {};
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect();
      /* Anything smaller than 4px square is a rule, a dot or a hairline, and its corner
         radius is not something a reader can see. */
      if (box.width < 4 || box.height < 4) continue;
      const cs = getComputedStyle(el);
      const br = cs.borderTopLeftRadius;
      /* 50% is "a circle", which is a shape rather than a radius on the scale. */
      if (br && br !== '0px' && br !== '50%') radii[br] = (radii[br] ?? 0) + 1;
      /* Leaf nodes only: an inherited size counted on every ancestor is the same size. */
      if ((el.textContent ?? '').trim() && el.children.length === 0) sizes[cs.fontSize] = (sizes[cs.fontSize] ?? 0) + 1;
    }
    /* Sorted inline rather than through a named helper: tsx compiles a `const f = () => …`
       inside page.evaluate into a call to esbuild's `__name`, which does not exist in the
       page and throws ReferenceError before the first count comes back. */
    return {
      radii: Object.entries(radii)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`),
      sizes: Object.entries(sizes)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`),
    };
  });

  const bad = found.radii.length > route.radii || found.sizes.length > route.sizes;
  if (bad) over += 1;
  console.log(
    `${bad ? '✗' : '✓'} ${route.path.padEnd(20)} ${String(found.radii.length).padStart(2)}/${route.radii} radii   ${String(found.sizes.length).padStart(2)}/${route.sizes} sizes`,
  );
  if (bad) {
    console.log(`    radii  ${found.radii.join('  ')}`);
    console.log(`    sizes  ${found.sizes.join('  ')}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   The header bar, at every width a person actually browses at
   ═══════════════════════════════════════════════════════════════════════════
   The bar is one flex row holding a 367px lockup, a nav, a 250px search cue and three
   actions, and for a while it needed 1560px of viewport to hold all of them. Below
   that `.header-nav` was allowed to shrink, so it was squeezed narrower than its own
   labels and "See in room" ran straight through the search field's magnifier — a flex
   item narrower than its content does not wrap or clip, it overflows onto whatever is
   beside it.

   It shipped, and nothing caught it: every gate the store had reads ONE width, and
   1440 — the width most people actually browse at — was not it.

   So this walks the widths people use and fails if any two children of the bar
   overlap, if the row overflows its own box, or if the document scrolls sideways.
   Cheap, and it is the exact defect rather than a proxy for it.
   ═════════════════════════════════════════════════════════════════════════ */
const WIDTHS = [1920, 1680, 1600, 1512, 1440, 1366, 1280, 1180, 1024, 900, 768, 600, 430, 390, 360];
let collisions = 0;
console.log('\nthe header bar, across widths:');
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const bar = await page.evaluate(() => {
    const row = document.querySelector('.header-bar') as HTMLElement;
    const kids = [...row.children]
      .map((c) => {
        const box = c.getBoundingClientRect();
        return { cls: String((c as HTMLElement).className || c.tagName).split(' ')[0], left: box.left, right: box.right, w: box.width };
      })
      /* A zero-width child — a hidden divider, a collapsed spacer — cannot collide. */
      .filter((k) => k.w > 0.5);
    const hits: string[] = [];
    for (let i = 0; i < kids.length - 1; i++) if (kids[i].right > kids[i + 1].left + 0.5) hits.push(`${kids[i].cls} → ${kids[i + 1].cls}`);

    /*
     * A SHRUNKEN BOX DOES NOT OVERLAP — ITS TEXT DOES, and box overlap alone misses it.
     *
     * That is exactly how the shipped bug looked: `.header-nav` had flex-shrink: 1, so at
     * 1440 it was squeezed narrower than its own labels. Its BOX stayed politely beside the
     * search cue's box and the check above reported no overlap; the text inside spilled out
     * of the box and ran through the magnifier. Verified by probe: with the shrink restored
     * this file reported a clean ✓ at 1440 while the bar was visibly broken.
     *
     * scrollWidth > clientWidth is the direct question — "is this element's content wider
     * than the element?" — and it is the one that catches it.
     */
    for (const el of [row, ...row.querySelectorAll('*')]) {
      const e = el as HTMLElement;
      if (e.scrollWidth - e.clientWidth <= 1) continue;
      /* Deliberately scrollable strips (the palette's scope chips, the ticker) opt out. */
      if (getComputedStyle(e).overflowX !== 'visible') continue;
      const name = String(e.className || e.tagName).split(' ')[0];
      const note = `${name} content ${Math.round(e.scrollWidth - e.clientWidth)}px wider than its box`;
      if (!hits.includes(note)) hits.push(note);
    }

    /*
     * The spacers are no longer where the give is. Search takes the middle and shrinks to fit, so
     * a spacer at 0 means "the field absorbed the room", not "one character from breaking" — the
     * number that says how close the row is to failing is the field's own clipped width.
     */
    const spacer = document.querySelector('.header-spacer') as HTMLElement;
    const cue = document.querySelector('.search') as HTMLElement;
    return {
      hits,
      barOverflow: Math.round(row.scrollWidth - row.clientWidth),
      pageOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      slack: Math.round(spacer ? spacer.getBoundingClientRect().width : 0),
      cue: Math.round(cue ? cue.getBoundingClientRect().width : 0),
    };
  });
  const bad = bar.hits.length > 0 || bar.barOverflow > 0 || bar.pageOverflow > 0;
  if (bad) collisions += 1;
  const notes = [
    bar.hits.length ? `OVERLAP ${bar.hits.join(', ')}` : '',
    bar.barOverflow > 0 ? `bar overflows by ${bar.barOverflow}px` : '',
    bar.pageOverflow > 0 ? `page scrolls sideways by ${bar.pageOverflow}px` : '',
  ].filter(Boolean);
  console.log(
    `${bad ? '✗' : '✓'} ${String(width).padStart(5)}px   search ${String(bar.cue).padStart(3)}px   spare ${String(bar.slack).padStart(3)}px${notes.length ? `   ${notes.join('   ')}` : ''}`,
  );
}

await browser.close();
const failed = over + collisions;
console.log(
  failed === 0
    ? '\nevery page is inside its shape and type budget, and the bar holds at every width'
    : `\n${over} page(s) over budget, ${collisions} width(s) with a broken bar`,
);
process.exit(failed === 0 ? 0 : 1);
