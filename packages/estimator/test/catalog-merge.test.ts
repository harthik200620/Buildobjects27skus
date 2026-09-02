import { describe, expect, it } from 'vitest';
import { mergeCatalog } from '../src/catalog';
import type { CatalogPrice, CatalogPrices } from '../src/types';

/**
 * The merge that stopped /estimate fetching forever.
 *
 * The calculator holds a price snapshot and tops it up from /api/estimate/catalog for any SKU the
 * shopper added from the store. That top-up runs in an effect which reads the snapshot, merges the
 * answer into it, and lists the snapshot as its dependency — so the merge's RETURN IDENTITY is the
 * loop condition. `{ ...prev, ...incoming }` always allocates, so the effect always re-ran; while
 * the endpoint answered completely that stopped on the second pass, and when it answered 200 with
 * a code missing it never stopped. The endpoint prices from the database and the deployment has
 * none, so it answered `{}` to every visitor carrying a pick.
 */
const price = (sku_code: string, selling_price = 400): CatalogPrice => ({
  sku_code,
  category: 'cement',
  name: sku_code,
  brand: 'UltraTech',
  unit: 'bag',
  selling_price,
  price_provenance: 'fetched',
});

describe('folding a price response into the snapshot', () => {
  it('keeps the SAME OBJECT when the answer adds nothing, so no state change can be triggered', () => {
    const prev: CatalogPrices = { 'CEM-ULT-PPC50': price('CEM-ULT-PPC50') };
    expect(mergeCatalog(prev, {})).toBe(prev);
  });

  it('keeps the same object when every code in the answer is already held', () => {
    const prev: CatalogPrices = { A: price('A'), B: price('B') };
    expect(mergeCatalog(prev, { A: price('A') })).toBe(prev);
    expect(mergeCatalog(prev, { A: price('A'), B: price('B') })).toBe(prev);
  });

  it('returns a new object carrying the additions when there is something new', () => {
    const prev: CatalogPrices = { A: price('A') };
    const next = mergeCatalog(prev, { B: price('B') });
    expect(next).not.toBe(prev);
    expect(Object.keys(next).sort()).toEqual(['A', 'B']);
  });

  it('lets a later answer overwrite a code it already held, when it also brings a new one', () => {
    const prev: CatalogPrices = { A: price('A', 100) };
    const next = mergeCatalog(prev, { A: price('A', 999), B: price('B') });
    expect(next.A.selling_price).toBe(999);
  });

  it('does not mutate the snapshot it was given', () => {
    const prev: CatalogPrices = { A: price('A') };
    mergeCatalog(prev, { B: price('B') });
    expect(Object.keys(prev)).toEqual(['A']);
  });
});
