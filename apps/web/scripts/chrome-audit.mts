/**
 * The chrome, under a real wheel.
 *
 * Every other gate in here reads a page that is standing still. The bar's whole job is what it
 * does while the page MOVES, and three separate defects shipped because nothing measured that:
 *
 *   · The ⌘K palette is `position: fixed; inset: 0` and lived inside the header, which carries a
 *     backdrop-filter — and a backdrop-filter makes an element a containing block for fixed
 *     descendants exactly the way a transform does. So `inset: 0` resolved to the BAR. Measured on
 *     the shipped page at 1024×680: the overlay laid out at 1009×143 and its scrim at 1009×61.
 *     The panel overflowed its box and drew in roughly the right place, so it looked correct and
 *     was not — pressing the dimmed page below the palette did nothing, because there was no
 *     scrim down there to press.
 *   · The catalogue menu is fixed at coordinates measured off its trigger in VIEWPORT space, and
 *     was laid out against the same wrong box.
 *   · Four pinned panels — the filter rail, the buy column, the cart total, the estimator's grand
 *     total — hung from four different heights, none of which was the height of the condensed bar
 *     they were hanging under.
 *
 * So: drive a real wheel, and check the four things that only exist in motion.
 *
 *   pnpm --filter @buildobjects/web chrome:audit
 *
 * Exits non-zero on any failure, so it can join the gate.
 *
 * ONE RULE FOR EVERYTHING INSIDE A page.evaluate() BELOW: no named inner arrows. tsx compiles
 * `const f = () => …` to esbuild's `__name` helper, which does not exist in the page, and the
 * call dies with `ReferenceError: __name is not defined` — from a line that reads as valid
 * JavaScript. Inline the helper, or write it out twice.
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';

/** Matches FLOOR in components/ScrollProgress.tsx. The bar never leaves inside the first screenful. */
const FLOOR = 240;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (base) => {
  await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', otp: '000000', pincode: '500001', regionId: 'hyd' }),
  });
}, BASE);

/* The cart's lines live in localStorage, so an unseeded cart is empty — and an empty cart paints
   no sticky total, which would make the check below pass by having nothing to check. */
await page.evaluate(() =>
  localStorage.setItem(
    'bo_estimate_picks',
    JSON.stringify([
      { sku_code: 'CEM-ULT-PPC50', qty: 12 },
      { sku_code: 'TIL-KAJ-GP00215', qty: 4 },
    ]),
  ),
);

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
   3. ONE OFFSET FOR EVERY PINNED PANEL
   ═══════════════════════════════════════════════════════════════════════════
   Not "close enough": identical. Four panels that are all "just under the bar" stopping at four
   different heights is what moving between two pages used to look like. */
console.log('\nwhat every pinned panel hangs from:');
const pinnedRoutes = ['/c/bulbs', '/p/cem-ult-ppc50', '/cart', '/estimate'];
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
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky') continue;
      const top = Number.parseFloat(cs.top);
      /* top: 0 is a different job — a header inside a scroll region, not a panel under the bar. */
      if (!Number.isFinite(top) || top <= 0) continue;
      n += 1;
      if (Math.round(top) !== target) bad.push(`${String(el.className).split(' ')[0] || el.tagName} at ${Math.round(top)}`);
    }
    return { target, n, bad };
  });
  /* A route with nothing pinned on it is not a pass, it is a check that did not run. */
  check(
    found.bad.length === 0 && found.n > 0,
    `${path.padEnd(20)} ${found.n} pinned panel(s) at ${found.target}px${found.bad.length ? `   OFF: ${found.bad.join(', ')}` : ''}${found.n === 0 ? '   NOTHING PINNED — the route did not render what this measures' : ''}`,
  );
}

/* And the one on the estimator is the one the complaint was about: it must pin under the bar and
   stay there for the length of the breakdown that explains it. */
await page.goto(`${BASE}/estimate`, { waitUntil: 'networkidle' });
const grand = await page.evaluate(async () => {
  const el = document.querySelector('.grand') as HTMLElement;
  const tops: number[] = [];
  const max = document.documentElement.scrollHeight - window.innerHeight;
  for (let y = 0; y <= max; y += 150) {
    window.scrollTo(0, y);
    /* Inlined, not a named `sleep`. tsx compiles a named inner arrow to esbuild's __name
       helper, which does not exist in the page — the same trap scale-audit.mts hit. */
    await new Promise((r) => setTimeout(r, 30));
    tops.push(Math.round(el.getBoundingClientRect().top));
  }
  const cs = getComputedStyle(el);
  const pinned = Math.round(Number.parseFloat(cs.top));
  /* And it is as wide as the column it sits in. `align-self: start` is the reflex for a sticky
     item and, in the flex COLUMN this lives in, runs across the row instead — it shrank the card
     to its content width and every other number here still passed. */
  const column = el.parentElement as HTMLElement;
  return {
    pinned,
    held: tops.filter((t) => t === pinned).length * 150,
    fits: Math.round(el.getBoundingClientRect().height) + pinned <= window.innerHeight,
    elevated: cs.boxShadow !== 'none',
    width: Math.round(el.getBoundingClientRect().width),
    column: Math.round(column.getBoundingClientRect().width),
  };
});
check(
  grand.held > 800 && grand.fits && grand.elevated && grand.width === grand.column,
  `the estimated cost card   pinned at ${grand.pinned}px for ${grand.held}px of scroll   fits ${grand.fits}   elevated ${grand.elevated}   ${grand.width}px wide in a ${grand.column}px column`,
);

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE OVERLAYS ARE LAID OUT AGAINST THE SCREEN
   ═══════════════════════════════════════════════════════════════════════════
   This is the containing-block trap, and it is invisible by inspection: the panel overflows its
   wrong box and draws in roughly the right place. Only the numbers say so. */
console.log('\nthe overlays:');
await page.setViewportSize({ width: 1024, height: 680 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

await page.click('.search-cue');
await page.waitForSelector('.palette');
/* Written out twice rather than through a `box(sel)` helper: tsx compiles a named inner arrow to
   esbuild's __name, which does not exist in the page. */
const palette = await page.evaluate(() => {
  const p = document.querySelector('.palette')?.getBoundingClientRect();
  const s = document.querySelector('.palette-scrim')?.getBoundingClientRect();
  return {
    palette: p ? [Math.round(p.width), Math.round(p.height)] : null,
    scrim: s ? [Math.round(s.width), Math.round(s.height)] : null,
    screen: [document.documentElement.clientWidth, window.innerHeight],
  };
});
const covers = (b: number[] | null) => !!b && b[0] === palette.screen[0] && b[1] === palette.screen[1];
check(
  covers(palette.palette) && covers(palette.scrim),
  `⌘K covers the screen   palette ${palette.palette?.join('×')}   scrim ${palette.scrim?.join('×')}   screen ${palette.screen.join('×')}`,
);
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
