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

await browser.close();
console.log(over === 0 ? '\nevery page is inside its shape and type budget' : `\n${over} page(s) over budget`);
process.exit(over === 0 ? 0 : 1);
