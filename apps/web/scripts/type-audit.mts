/**
 * Catch text asking for a font cut the type program does not ship.
 *
 * A browser given `font-weight: 700` for a face that has only 400 SYNTHESISES the weight, smearing
 * the outlines outward — unmistakable on a wide geometric face like Audiowide, and exactly the
 * over-inked look that reads as amateur beside properly drawn type.
 *
 * Two were shipping and neither was visible in the source, because the pairing only exists once
 * two classes meet on one element in a rendered page: every page heading was `.display`
 * (Audiowide, one cut at 400) plus `.page-title` (700), and twelve inline `fontWeight: 800/900`
 * in the reward engine. So this walks the real DOM of every route.
 *
 * A declared face carries a weight RANGE — the UI face is one variable file covering 400-800 — so
 * a weight matches if it falls inside any range declared for its family. Matching on equality
 * reported all twenty-seven weights of a correct program as synthesised, which is the failure mode
 * that gets a gate switched off.
 *
 *   pnpm --filter @buildobjects/web type:audit   (non-zero on a finding, so it can join the gate)
 */
import { chromium } from 'playwright';
import { BASE } from './harness';

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
    /*
     * A declared face is a family plus a RANGE of weights, not a single cut.
     *
     * This read `Number.parseInt(f.weight)` and matched on equality, which is correct for a
     * static cut and silently wrong for a variable one: Schibsted Grotesk is declared
     * `400 800`, parseInt returns 400, and every 500, 600 and 700 in the store was reported as
     * synthesised — twenty-seven findings on a type program that is right. A gate that cries
     * wolf gets switched off, which is worse than not having it.
     *
     * So each face contributes [min, max] and a weight matches if it falls inside any range
     * declared for its family. A static cut is the degenerate case where min === max, so the
     * original check is preserved exactly.
     */
    const ranges = new Map<string, [number, number][]>();
    for (const f of document.fonts) {
      if (f.family.includes('Fallback')) continue;
      const parts = String(f.weight)
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      if (!parts.length) continue;
      const span: [number, number] = [parts[0], parts[parts.length - 1]];
      const list = ranges.get(f.family) ?? [];
      list.push(span);
      ranges.set(f.family, list);
    }
    const families = new Set(ranges.keys());
    const declared = {
      has(key: string) {
        const [family, weight] = key.split('|');
        const w = Number(weight);
        return (ranges.get(family) ?? []).some(([lo, hi]) => w >= lo && w <= hi);
      },
    };
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
