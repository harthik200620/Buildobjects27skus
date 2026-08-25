/**
 * Catch text that asks for a font cut the type program does not ship.
 *
 * A browser given `font-weight: 700` for a face that only has 400 does not fall back politely —
 * it SYNTHESISES the weight, smearing the outlines outward. On body copy that is merely poor; on
 * a wide geometric display face like Audiowide it is unmistakable, and it is exactly the greasy,
 * over-inked look that reads as amateur next to properly drawn type.
 *
 * Two of these were shipping and neither was visible in the source:
 *
 *   · Every page heading in the store is written `class="display page-title"`. `.display` selects
 *     Audiowide, which has ONE cut at 400; `.page-title` set 700. The brand's own voice was
 *     rendered wrong on the title of every page except the home page.
 *   · Twelve inline `fontWeight: 800` / `900` in the reward engine, against a program whose
 *     heaviest cut is 700.
 *
 * Neither is findable by reading CSS, because the pairing only exists once two classes meet on
 * one element in a rendered page. So this walks the real DOM of every route and reports any
 * element whose computed (family, weight) is not a face the document actually declares.
 *
 *   pnpm --filter @buildobjects/web type:audit
 *
 * Exits non-zero on a finding, so it can join the gate.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const ROUTES = ['/', '/search', '/c/concreting', '/c/steel', '/c/cement', '/p/cem-ult-ppc50', '/cart', '/estimate', '/ar/cem-ult-ppc50'];

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

let bad = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  const findings = await page.evaluate(() => {
    const declared = new Set(
      [...document.fonts].filter((f) => !f.family.includes('Fallback')).map((f) => `${f.family}|${Number.parseInt(String(f.weight), 10) || f.weight}`),
    );
    const families = new Set([...declared].map((d) => d.split('|')[0]));
    const out: { tag: string; cls: string; family: string; weight: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      const family = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      /* Only our own faces — a system fallback has whatever weights the system has. */
      if (!families.has(family)) continue;
      const key = `${family}|${cs.fontWeight}`;
      if (declared.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 44), family, weight: cs.fontWeight, text: text.slice(0, 36) });
    }
    return out;
  });

  if (findings.length === 0) {
    console.log(`  ok    ${route}`);
  } else {
    for (const f of findings) {
      bad += 1;
      console.log(`  FAIL  ${route}  <${f.tag} class="${f.cls}">  wants ${f.family} ${f.weight}, which is not a declared cut  — "${f.text}"`);
    }
  }
}

await browser.close();
console.log(bad === 0 ? '\nno synthesised weights: every rendered pairing has a real font file behind it' : `\n${bad} synthesised weight(s)`);
process.exit(bad === 0 ? 0 : 1);
