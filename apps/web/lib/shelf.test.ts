import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  brandsOf,
  chipsFor,
  decodeShelf,
  EMPTY_SHELF,
  encodeShelf,
  factsOf,
  isFiltering,
  keeps,
  OFFER_MIN,
  order,
  priceCeiling,
  type ShelfFact,
} from './shelf';

/**
 * The chips over "On the shelf now".
 *
 * The rule this file exists to hold is that A CHIP MUST NARROW SOMETHING. A row of filters that
 * do not change what you see is worse than no row, because it teaches a shopper to ignore the
 * chips that do work — and whether a given chip narrows anything depends on the shelf it is drawn
 * over, which is a thing you can only get wrong quietly.
 */
const fact = (over: Partial<ShelfFact> & { sku: string }): ShelfFact => ({
  name: over.sku,
  brand: 'Brand',
  price: 100,
  off: 0,
  inStock: true,
  checked: false,
  ...over,
});

describe('the price ceiling', () => {
  it('prefers a round number, because a chip is a decision and not a computation', () => {
    /* A mixed shelf — bulbs beside cement. 100 is round, sits inside the range, and cuts it in
       half; the exact figure matters less than that it is one a person would have chosen. */
    expect(priceCeiling([65, 70, 95, 129, 410, 437])).toBe(100);
    expect(priceCeiling([100, 900])).toBe(500);
    expect(priceCeiling([395_000, 470_000, 825_000])).toBe(500_000);
    /* 1,160–1,350 has exactly one round number inside it, and it is not a tidy one. */
    expect(priceCeiling([1160, 1200, 1230, 1240, 1249, 1295, 1350])).toBe(1250);
  });

  it('lands strictly inside the range, so the chip both keeps and excludes something', () => {
    for (const prices of [
      [50, 65, 70, 70, 95, 129],
      [410, 415, 430, 437],
      [395_000, 470_000, 825_000],
      [1160, 1200, 1230, 1240, 1249, 1295, 1350],
    ]) {
      const c = priceCeiling(prices);
      expect(c, `no ceiling for ${prices.join(', ')}`).not.toBeNull();
      const kept = prices.filter((p) => p < (c as number)).length;
      expect(kept, `${c} keeps ${kept} of ${prices.length}`).toBeGreaterThan(0);
      expect(kept).toBeLessThan(prices.length);
    }
  });

  it('falls back to a real price when no round number fits between the cheapest and the dearest', () => {
    /* Cement: 410–437. Every round number is either below all of them or above all of them, so a
       real price does the cutting — and it still lands on the one that halves the shelf. */
    expect(priceCeiling([410, 415, 430, 437])).toBe(430);
  });

  it('picks the round number that comes closest to keeping half, not merely the roundest one', () => {
    /* Bulbs: 50, 65, 70, 70, 95, 129. Under 100 keeps five of six and under 125 keeps five too —
       both are rounder than 75, and both barely filter. 75 keeps four, which is the cut. */
    expect(priceCeiling([50, 65, 70, 70, 95, 129])).toBe(75);
  });

  it('offers nothing when there is no cut to make', () => {
    expect(priceCeiling([])).toBeNull();
    expect(priceCeiling([500])).toBeNull();
    expect(priceCeiling([500, 500, 500])).toBeNull();
  });

  it('ignores missing and nonsense prices rather than sorting them to the front', () => {
    expect(priceCeiling([Number.NaN, 0, -5, 100, 900])).not.toBeNull();
    expect(priceCeiling([Number.NaN, 100])).toBeNull();
  });
});

describe('which chips a shelf offers', () => {
  it('offers none of the optional ones when they would keep everything', () => {
    const all = [fact({ sku: 'A', off: 20, checked: true }), fact({ sku: 'B', off: 30, checked: true })];
    expect(chipsFor(all).map((c) => c.key)).toEqual([]);
  });

  it('offers none of them when they would keep nothing either', () => {
    const none = [fact({ sku: 'A', off: 0, checked: false }), fact({ sku: 'B', off: 2, checked: false })];
    expect(chipsFor(none).map((c) => c.key)).toEqual([]);
  });

  it('offers exactly the ones that split the shelf', () => {
    const mixed = [
      fact({ sku: 'A', price: 100, off: 25, checked: true, inStock: true }),
      fact({ sku: 'B', price: 900, off: 0, checked: false, inStock: false }),
    ];
    expect(
      chipsFor(mixed)
        .map((c) => c.key)
        .sort(),
    ).toEqual(['checked', 'offers', 'stock', 'under']);
  });

  it('carries the ceiling as a number, so nothing has to parse it back out of the label', () => {
    const chip = chipsFor([fact({ sku: 'A', price: 100 }), fact({ sku: 'B', price: 900 })]).find((c) => c.key === 'under');
    expect(chip?.value).toBe(500);
    expect(chip?.label).toBe('Under ₹500');
  });

  it('writes the ceiling in Indian digit grouping', () => {
    const chip = chipsFor([fact({ sku: 'A', price: 100_000 }), fact({ sku: 'B', price: 900_000 })]).find((c) => c.key === 'under');
    expect(chip?.label).toBe('Under ₹5,00,000');
  });

  it('only offers a brand choice when there is a choice', () => {
    expect(brandsOf([fact({ sku: 'A', brand: 'ACC' }), fact({ sku: 'B', brand: 'ACC' })])).toEqual([]);
    expect(brandsOf([fact({ sku: 'A', brand: 'UltraTech' }), fact({ sku: 'B', brand: 'ACC' })])).toEqual(['ACC', 'UltraTech']);
  });
});

describe('what a filter keeps', () => {
  const none = new Set<string>();
  const shelf = [
    fact({ sku: 'CHEAP', price: 100, off: 25, checked: true, brand: 'ACC' }),
    fact({ sku: 'DEAR', price: 900, off: 0, checked: false, brand: 'UltraTech', inStock: false }),
  ];

  it('is exclusive at the ceiling, so "Under ₹500" never shows a ₹500 item', () => {
    expect(keeps(fact({ sku: 'X', price: 500 }), { ...EMPTY_SHELF, under: 500 }, none)).toBe(false);
    expect(keeps(fact({ sku: 'X', price: 499 }), { ...EMPTY_SHELF, under: 500 }, none)).toBe(true);
  });

  it('drops an unpriced item from a price filter rather than treating it as free', () => {
    expect(keeps(fact({ sku: 'X', price: null }), { ...EMPTY_SHELF, under: 500 }, none)).toBe(false);
  });

  it('holds every chip to its own field', () => {
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, offers: true }, none)).map((f) => f.sku)).toEqual(['CHEAP']);
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, checked: true }, none)).map((f) => f.sku)).toEqual(['CHEAP']);
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, stock: true }, none)).map((f) => f.sku)).toEqual(['CHEAP']);
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, brands: ['UltraTech'] }, none)).map((f) => f.sku)).toEqual(['DEAR']);
  });

  it('uses the saving bar the chip promises', () => {
    expect(keeps(fact({ sku: 'X', off: OFFER_MIN }), { ...EMPTY_SHELF, offers: true }, none)).toBe(true);
    expect(keeps(fact({ sku: 'X', off: OFFER_MIN - 1 }), { ...EMPTY_SHELF, offers: true }, none)).toBe(false);
  });

  it('combines filters with AND, not OR', () => {
    const both = { ...EMPTY_SHELF, offers: true, brands: ['UltraTech'] };
    expect(shelf.filter((f) => keeps(f, both, none))).toEqual([]);
  });

  it('reads the estimate for "In my estimate" and keeps nothing when the estimate is empty', () => {
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, picks: true }, none))).toEqual([]);
    expect(shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, picks: true }, new Set(['DEAR']))).map((f) => f.sku)).toEqual(['DEAR']);
  });

  it('keeps everything when nothing is chosen', () => {
    expect(shelf.filter((f) => keeps(f, EMPTY_SHELF, none))).toHaveLength(2);
    expect(isFiltering(EMPTY_SHELF)).toBe(false);
    expect(isFiltering({ ...EMPTY_SHELF, sort: 'price_asc' })).toBe(true);
  });
});

describe('the order the cards are drawn in', () => {
  const shelf = [fact({ sku: 'MID', price: 500, off: 5 }), fact({ sku: 'LOW', price: 100, off: 40 }), fact({ sku: 'NONE', price: null, off: 0 })];

  it('leaves our own order alone by default', () => {
    expect([...order(shelf, 'default')]).toEqual([
      ['MID', 0],
      ['LOW', 1],
      ['NONE', 2],
    ]);
  });

  it('sorts by price, and an item with no price is unknown rather than cheap', () => {
    const asc = order(shelf, 'price_asc');
    expect(asc.get('LOW')).toBe(0);
    expect(asc.get('MID')).toBe(1);
    expect(asc.get('NONE')).toBe(2);
    const desc = order(shelf, 'price_desc');
    expect(desc.get('MID')).toBe(0);
    expect(desc.get('LOW')).toBe(1);
    expect(desc.get('NONE')).toBe(2);
  });

  it('sorts by saving', () => {
    expect(order(shelf, 'saving').get('LOW')).toBe(0);
  });

  it('ranks every card, so none is left at order 0 on top of another', () => {
    for (const sort of ['default', 'price_asc', 'price_desc', 'saving'] as const) {
      const rank = order(shelf, sort);
      expect(new Set(rank.values()).size).toBe(shelf.length);
    }
  });
});

describe('the URL', () => {
  it('survives a round trip', () => {
    const state = { under: 500, offers: true, checked: false, stock: true, picks: true, brands: ['ACC', 'UltraTech'], sort: 'price_asc' as const };
    expect(decodeShelf(encodeShelf(state))).toEqual(state);
  });

  it('writes nothing at all when nothing is chosen', () => {
    expect(encodeShelf(EMPTY_SHELF).toString()).toBe('');
  });

  it('keeps the query it was given and replaces only its own keys', () => {
    const base = new URLSearchParams('q=cement&s_offers=1&page=2');
    const out = encodeShelf({ ...EMPTY_SHELF, stock: true }, base);
    expect(out.get('q')).toBe('cement');
    expect(out.get('page')).toBe('2');
    expect(out.get('s_offers')).toBeNull();
    expect(out.get('s_stock')).toBe('1');
  });

  it('reads the searchParams shape a server component is handed', () => {
    expect(decodeShelf({ s_under: '500', s_offers: '1', s_brand: 'ACC|Dahua', s_sort: 'saving' })).toEqual({
      ...EMPTY_SHELF,
      under: 500,
      offers: true,
      brands: ['ACC', 'Dahua'],
      sort: 'saving',
    });
  });

  it('ignores a hand-typed URL rather than trusting it', () => {
    expect(decodeShelf({ s_under: 'free', s_sort: 'cheapest', s_brand: '||' })).toEqual(EMPTY_SHELF);
    expect(decodeShelf({ s_under: '-9' }).under).toBeNull();
  });
});

/*
 * The catalogue this store actually ships, rather than a fixture that agrees with the code.
 * `lib/static-catalogue.ts` is what the deployment serves, so these are the real shelves.
 */
describe('the shelves this store actually has', () => {
  const flagship = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue', 'flagship.json'), 'utf8'));
  const rows = (Array.isArray(flagship) ? flagship : (Object.values(flagship)[0] as unknown[])) as Parameters<typeof factsOf>[0];
  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);

  it('has something to filter', () => {
    expect(rows.length).toBeGreaterThan(20);
    expect(byCategory.size).toBeGreaterThan(5);
  });

  it.each([...byCategory.keys()])('every chip offered on the %s shelf narrows it', (category) => {
    const facts = factsOf(byCategory.get(category) ?? []);
    const chips = chipsFor(facts);
    const picked = new Set<string>();
    for (const chip of chips) {
      const state = chip.key === 'under' ? { ...EMPTY_SHELF, under: chip.value ?? 0 } : { ...EMPTY_SHELF, [chip.key]: true };
      const kept = facts.filter((f) => keeps(f, state, picked)).length;
      expect(kept, `${chip.label} keeps nothing on ${category}`).toBeGreaterThan(0);
      expect(kept, `${chip.label} keeps everything on ${category}`).toBeLessThan(facts.length);
    }
  });
});
