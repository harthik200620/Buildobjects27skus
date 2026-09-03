/**
 * THE CART THAT PRICED EVERY LINE AT ZERO RUPEES.
 *
 * `loadCalculatorCatalog` is the one place seven callers go for "what does this SKU cost" — the
 * cart page, the estimate page, /api/estimate/catalog (which the estimator's own client-side
 * top-up effect calls), the BO assistant's tools, the saved-estimate store, and refine.ts. It
 * queried the database and, on ANY failure, caught the error and returned `{}` — a pattern every
 * other loader in this codebase avoids by falling through to `lib/static-catalogue.ts`, the same
 * 27-SKU snapshot the deployment serves everything else from.
 *
 * The Vercel deployment has no database at all, so that catch fired on every request, `{}` reached
 * every one of those seven callers, and `catalog[p.sku_code]?.selling_price ?? 0` did exactly what
 * it was told: it is a valid price for something genuinely unpriced, and there was no signal
 * anywhere that the data had simply never arrived. Reported directly, from a screenshot of the
 * live cart: two real, priced SKUs (TIL-KAJ-GP00215 at ₹1,240, TIL-SOM-T31F119001859102 at
 * ₹1,160 in the snapshot) both showing ₹0, subtotal ₹0, "take ₹0 off".
 *
 * This is the same "no live services" contract `catalog-fallback.test.ts` checks for search and
 * categories, asked of the calculator's catalogue instead.
 */

import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  /* Refused on connect rather than left to time out, so the fallback is what is slow-path tested
     and the suite is not — see catalog-fallback.test.ts for why this string in particular. */
  process.env.DATABASE_URL = 'mysql://none:none@127.0.0.1:1/none';
});

describe('the calculator catalogue with no database', () => {
  it('still prices the SKUs CATALOG_MAP names, with no code asked for at all', async () => {
    /* The cart's exact call: loadCalculatorCatalog([]). Every mapped code — cement, tiles, bulbs,
       solar, fire, epoxy, cctv, glass, each basic/medium/premium — still has to come back priced,
       because nothing downstream of this call knows to ask for a specific SKU by name. */
    const { loadCalculatorCatalog } = await import('./estimator');
    const catalog = await loadCalculatorCatalog([]);

    const ultratech = catalog['CEM-ULT-PPC50'];
    expect(ultratech).toBeDefined();
    expect(ultratech.selling_price).toBeGreaterThan(0);
    expect(ultratech.brand).toBeTruthy();
    expect(ultratech.name).toBeTruthy();
  });

  it('prices a SKU asked for by exact code, the way "Add to Estimate" and the cart do', async () => {
    /* The two lines from the reported screenshot, verbatim. Neither is a CATALOG_MAP code — they
       reach this function only because a shopper picked them, which is exactly the path
       lib/picks.ts feeds into the cart page and the estimator's own top-up effect. */
    const { loadCalculatorCatalog } = await import('./estimator');
    const catalog = await loadCalculatorCatalog(['TIL-KAJ-GP00215', 'TIL-SOM-T31F119001859102']);

    expect(catalog['TIL-KAJ-GP00215']?.selling_price).toBe(1240);
    expect(catalog['TIL-SOM-T31F119001859102']?.selling_price).toBe(1160);
  });

  it('leaves a code out rather than inventing a price for one the snapshot does not carry', async () => {
    const { loadCalculatorCatalog } = await import('./estimator');
    const catalog = await loadCalculatorCatalog(['NOT-A-REAL-SKU-CODE']);
    expect(catalog['NOT-A-REAL-SKU-CODE']).toBeUndefined();
  });
});
