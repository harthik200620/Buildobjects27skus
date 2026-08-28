/**
 * The chrome, under a real wheel.
 *
 * Every other gate reads a page standing still. The bar's whole job is what it does while the
 * page MOVES, and three defects shipped because nothing measured that: a fixed overlay resolving
 * `inset: 0` against the BAR rather than the viewport (a backdrop-filter makes an element a
 * containing block for fixed descendants, exactly as a transform does), the catalogue menu laid
 * out against the same wrong box, and four pinned panels hanging from four different heights.
 *
 *   pnpm --filter @buildobjects/web chrome:audit
 *
 * Exits non-zero on failure, so it can join the gate.
 *
 * ONE RULE INSIDE EVERY page.evaluate() BELOW: no named inner arrows. tsx compiles
 * `const f = () => …` to esbuild's `__name` helper, which does not exist in the page, and the call
 * dies with `ReferenceError: __name is not defined` from a line that reads as valid JavaScript.
 */
import { chromium, type Page } from 'playwright';
import { BASE, openPage, seedCart } from './harness';

/** Matches FLOOR in components/ScrollProgress.tsx. The bar never leaves inside the first screenful. */
const FLOOR = 240;

const browser = await chromium.launch();
const { page } = await openPage(browser, { viewport: 'audit', motion: 'no-preference' });
await seedCart(page);

let failures = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${line}`);
};

/**
 * Where the bar is, and — the part that matters — where its PAINT is.
 *
 * `.header` is block-level, so its box is the full width of the document whatever the design is
 * doing; measuring that would have passed the floating bar too. What changed is which element
 * carries the fill: it used to be a capped, rounded `.header-bar` laid on a transparent
 * `.header`, and it is the `.header` itself now. So find whichever element actually paints and
 * measure THAT.
 */
const readBar = (p: Page) =>
  p.evaluate(() => {
    const el = document.querySelector('.header') as HTMLElement;
    const row = document.querySelector('.header-bar') as HTMLElement;
    const logo = document.querySelector('.header-logo') as HTMLElement;
    const fill = getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' ? row : el;
    const f = fill.getBoundingClientRect();
    return {
      top: Math.round(el.getBoundingClientRect().top),
      height: Math.round(el.getBoundingClientRect().height),
      fillTop: Math.round(f.top),
      fillLeft: Math.round(f.left),
      fillRight: Math.round(f.right),
      fillRadius: Math.round(Number.parseFloat(getComputedStyle(fill).borderTopLeftRadius)),
      client: document.documentElement.clientWidth,
      logoLeft: Math.round(logo.getBoundingClientRect().left),
      away: document.documentElement.dataset.nav === 'away',
      y: Math.round(window.scrollY),
    };
  });

/* A wheel, not scrollTo(). The deadband exists to survive real input, and scrollTo() produces one
   clean jump that any implementation survives. Settling matters too: the transform is a 200ms
   transition, so a measurement taken on the frame the class flips reads the old position. */
const wheel = async (p: Page, dy: number, ticks = 1) => {
  for (let i = 0; i < ticks; i += 1) await p.mouse.wheel(0, dy);
  await p.waitForTimeout(360);
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. FLUSH, AND FULL WIDTH
   ═══════════════════════════════════════════════════════════════════════════
   The bar is the top of the shop, not an instrument hovering over it: it starts at the very top
   edge, it reaches both side edges, and above 1200px the mark stands exactly above the first
   character of the page beneath it. Below that the ladder tightens the row's padding to keep the
   controls from colliding, and the alignment is the thing that gives. */
console.log('\nthe bar, across widths:');
for (const width of [1920, 1512, 1440, 1366, 1280, 1024, 768, 430, 360]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const bar = await readBar(page);
  /* The PAGE's shell, not the first `.shell` in the document — that one belongs to the
     deliver-to strip, which sits above the page and is not what the mark lines up with. */
  const shellLeft = await page.evaluate(() => {
    const shell = document.querySelector('main .shell, .page.shell') as HTMLElement | null;
    if (!shell) return null;
    return Math.round(shell.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(shell).paddingLeft));
  });
  const aligned = width < 1200 || shellLeft === null || Math.abs(bar.logoLeft - shellLeft) <= 1;
  const flush = bar.fillTop === 0 && bar.fillLeft === 0 && bar.fillRight === bar.client && bar.fillRadius === 0;
  check(
    flush && aligned,
    `${String(width).padStart(5)}px   fill ${bar.fillLeft}→${bar.fillRight} of ${bar.client} at y ${bar.fillTop}, radius ${bar.fillRadius}   mark at ${bar.logoLeft}${shellLeft === null ? '' : ` vs page copy at ${shellLeft}`}`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. AWAY ON THE WAY DOWN, BACK ON THE WAY UP
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\nthe bar, under a wheel:');
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/c/bulbs`, { waitUntil: 'networkidle' });

await wheel(page, 60, 2);
let bar = await readBar(page);
check(!bar.away && bar.top === 0 && bar.y < FLOOR, `holds inside the first screenful   y ${bar.y}   top ${bar.top}`);

await wheel(page, 120, 6);
bar = await readBar(page);
check(bar.away && bar.top <= -bar.height + 1, `leaves on the way down   y ${bar.y}   top ${bar.top} of ${bar.height}`);

/* Two pixels is a trackpad settling, not a reader changing their mind. */
await wheel(page, -2, 1);
bar = await readBar(page);
check(bar.away, `a 2px nudge does not bring it back   y ${bar.y}   top ${bar.top}`);

await wheel(page, -120, 1);
bar = await readBar(page);
check(!bar.away && bar.top === 0, `back on the way up   y ${bar.y}   top ${bar.top}`);

/* And it is never left off-screen at the top of a page, whatever the last gesture was. */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(360);
bar = await readBar(page);
check(!bar.away && bar.top === 0, `present at the top of the page   y ${bar.y}   top ${bar.top}`);

/* ═══════════════════════════════════════════════════════════════════════════
   3. NOTHING MOVES UNDER THE READER
   ═══════════════════════════════════════════════════════════════════════════
   This is the check that should have existed from the first round, and its absence is why the
   same complaint had to be made three times.

   The bar used to condense 76 → 62 on scroll. A sticky element keeps its space in the flow, so
   those fourteen pixels came off the top of the document and EVERY ELEMENT ON EVERY PAGE moved up
   by fourteen the moment anybody scrolled past eight — and back down on the way home. It was
   reported as "the estimator's cost card comes down with the scroll", and both earlier fixes went
   looking at the card. It was never the card. It was the page.

   So: take an element's position in the DOCUMENT — its viewport rect plus the scroll offset — at
   a spread of scroll positions including the two edges and the settling points either side of the
   `data-scrolled` threshold. A page that does not reflow gives one number. Any second number is a
   layout shift, and the routes below cover every page that carries the bar. */
console.log('\nwhat moves when the reader scrolls:');
const SHIFT_ROUTES: { path: string; sel: string }[] = [
  { path: '/', sel: '.home' },
  { path: '/c/bulbs', sel: '.prod-grid' },
  { path: '/p/cem-ult-ppc50', sel: '.pdp' },
  { path: '/cart', sel: '.cart' },
  { path: '/estimate', sel: '.grand' },
];
for (const { path, sel } of SHIFT_ROUTES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const seen = await page.evaluate(async (s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) return null;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const out = new Set<number>();
    /* 5 and 20 straddle the 8px `data-scrolled` threshold, which is where the old shift fired. */
    for (const y of [0, 5, 20, 60, 400, 1000, Math.max(0, max), 60, 0]) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 340));
      out.add(Math.round(el.getBoundingClientRect().top + window.scrollY));
    }
    return [...out];
  }, sel);
  check(
    seen !== null && seen.length === 1,
    `${path.padEnd(20)} ${sel.padEnd(12)} ${seen === null ? 'ELEMENT ABSENT — the check did not run' : seen.length === 1 ? `holds at ${seen[0]}` : `MOVES: ${seen.join(', ')}`}`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. EVERY PINNED PANEL HANGS FROM ONE OFFSET, AND FITS THE ROOM IT IS PINNED INTO
   ═══════════════════════════════════════════════════════════════════════════
   Two rules, and the second one is not a nicety. Measured on a 1280 × 700 laptop before it was
   fixed: the category page's filter rail was 1,267px tall — 181 % of the viewport — pinned at the
   top, so its bottom six hundred pixels could not be reached by any gesture. The product page's
   buy panel was 662px against 700, which is a panel standing in front of the whole screen rather
   than beside it.

   The estimator is deliberately NOT in this list. Its cost card is 460px, which pinned covers
   two-thirds of a laptop screen and follows the reader down the page in front of the breakdown it
   is meant to be explaining. It was reported twice; it scrolls with the page now. */
console.log('\nwhat every pinned panel hangs from, and whether it fits:');
const pinnedRoutes = ['/c/bulbs', '/p/cem-ult-ppc50', '/cart'];
for (const path of pinnedRoutes) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const found = await page.evaluate(() => {
    const want = getComputedStyle(document.documentElement).getPropertyValue('--sticky-top');
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;top:${want}`;
    document.body.appendChild(probe);
    const target = Math.round(Number.parseFloat(getComputedStyle(probe).top));
    probe.remove();
    const bad: string[] = [];
    const tooTall: string[] = [];
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky') continue;
      const top = Number.parseFloat(cs.top);
      /* top: 0 is a different job — a header inside a scroll region, not a panel under the bar. */
      if (!Number.isFinite(top) || top <= 0) continue;
      n += 1;
      const name = String(el.className).split(' ')[0] || el.tagName;
      if (Math.round(top) !== target) bad.push(`${name} at ${Math.round(top)}`);
      /* Taller than the room it is pinned into means the bottom of it is unreachable, unless it
         scrolls inside itself. Either is fine; neither is optional. */
      const room = window.innerHeight - top;
      const h = el.getBoundingClientRect().height;
      const scrollsItself = el.scrollHeight > el.clientHeight + 1 || getComputedStyle(el).overflowY === 'auto';
      if (h > room + 1 && !scrollsItself) tooTall.push(`${name} ${Math.round(h)}px in ${Math.round(room)}px`);
    }
    return { target, n, bad, tooTall };
  });
  /* A route with nothing pinned on it is not a pass, it is a check that did not run. */
  const notes = [
    found.bad.length ? `OFF: ${found.bad.join(', ')}` : '',
    found.tooTall.length ? `UNREACHABLE: ${found.tooTall.join(', ')}` : '',
    found.n === 0 ? 'NOTHING PINNED — the route did not render what this measures' : '',
  ].filter(Boolean);
  check(
    found.bad.length === 0 && found.tooTall.length === 0 && found.n > 0,
    `${path.padEnd(20)} ${found.n} pinned panel(s) at ${found.target}px${notes.length ? `   ${notes.join('   ')}` : ''}`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE OVERLAYS ARE LAID OUT AGAINST THE SCREEN
   ═══════════════════════════════════════════════════════════════════════════
   This is the containing-block trap, and it is invisible by inspection: the panel overflows its
   wrong box and draws in roughly the right place. Only the numbers say so. */
console.log('\nthe overlays:');
await page.setViewportSize({ width: 1024, height: 680 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

/*
 * SEARCH IS ONE FIELD, AND ITS SUGGESTIONS HANG OFF IT.
 *
 * This used to assert that the ⌘K palette covered the screen — the right test for an overlay,
 * and there is no overlay any more. The header carried a BUTTON dressed as a search field that
 * opened a second, real field in a modal; two search bars, and the one you pressed was not the
 * one you typed into.
 *
 * What replaces it is the invariant that keeps that from coming back: exactly ONE text input in
 * the header, the keystrokes land in it, and the suggestions are laid out against IT rather than
 * against the viewport. That last part is the same containing-block trap as before, from the
 * other side — the header's backdrop-filter would capture anything fixed, so the panel has to be
 * absolute inside the bar, and the way to prove it is that its left edge is the bar's left edge.
 */
await page.click('.search-input');
await page.keyboard.type('cem');
await page.waitForSelector('.search-drop');
const search = await page.evaluate(() => {
  const bar = document.querySelector('.search')?.getBoundingClientRect();
  const drop = document.querySelector('.search-drop')?.getBoundingClientRect();
  return {
    inputs: document.querySelectorAll('header input[type="text"], header .search-input').length,
    focused: document.activeElement?.className ?? '',
    bar: bar ? [Math.round(bar.left), Math.round(bar.right)] : null,
    drop: drop ? [Math.round(drop.left), Math.round(drop.right), Math.round(drop.top)] : null,
    barBottom: bar ? Math.round(bar.bottom) : 0,
  };
});
check(search.inputs === 1, `one search field in the header   found ${search.inputs}`);
check(search.focused.includes('search-input'), `the keystrokes land in it   focus is .${search.focused || '(none)'}`);
check(
  !!search.bar && !!search.drop && Math.abs(search.drop[0] - search.bar[0]) <= 1 && Math.abs(search.drop[1] - search.bar[1]) <= 1,
  `the suggestions hang off the field   bar ${search.bar?.join('→')}   drop ${search.drop?.slice(0, 2).join('→')}`,
);
check(!!search.drop && search.drop[2] >= search.barBottom, `and below it   field ends ${search.barBottom}   drop starts ${search.drop?.[2]}`);
await page.keyboard.press('Escape');

const menu = await page.evaluate(async () => {
  const trigger = [...document.querySelectorAll<HTMLElement>('.navlink')].find((b) => b.textContent?.includes('Catalogue'));
  if (!trigger) return null;
  const t = trigger.getBoundingClientRect();
  trigger.click();
  /* Long enough for .fade-in to finish. It animates translateY(4px) → none over 160ms, so a
     measurement taken while it runs reads the panel up to four pixels low — which is most of the
     gap being measured. */
  await new Promise((r) => setTimeout(r, 280));
  const p = document.querySelector('.cat-menu')?.getBoundingClientRect();
  return p ? { dx: Math.round(p.left - t.left), dy: Math.round(p.top - t.bottom) } : null;
});
check(
  !!menu && Math.abs(menu.dx) <= 1 && menu.dy >= 0 && menu.dy <= 8,
  `the catalogue menu hangs off its own trigger   ${menu ? `${menu.dx}px across, ${menu.dy}px under` : 'did not open'}`,
);

await browser.close();
console.log(failures === 0 ? '\nthe chrome holds: flush, full width, gone on the way down, and every panel on one line' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
