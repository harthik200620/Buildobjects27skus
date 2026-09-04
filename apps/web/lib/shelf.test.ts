import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arrivalDays,
  arrivals,
  brandsOf,
  chipsFor,
  decodeShelf,
  EMPTY_SHELF,
  encodeShelf,
  factsOf,
  isFiltering,
  keeps,
  OFFER_FLOOR,
  offerBar,
  order,
  priceCeiling,
  RATING_MIN,
  type ShelfFact,
  type ShelfState,
} from './shelf';
import { EMPTY_SHOPPER, type Shopper } from './shopper';

/**
 * The chips over "On the shelf now".
 *
 * Two rules live here and they pull in opposite directions, which is why both are written down.
 *
 *   THE ROW IS THE SAME ROW EVERY TIME. A shopper learns it once. The named chips are always
 *   drawn, including the four that are about the reader rather than the shelf, and on a device
 *   that has never rated or ordered anything those keep nothing — the true answer, and the reason
 *   nothing here is seeded with invented ratings or invented orders.
 *
 *   A NUMBER ON A CHIP MUST COME FROM THE SHELF. "Under ₹250" keeps everything over a shelf of
 *   bulbs and nothing over a shelf of total stations, so the price ceiling and the discount bar
 *   are both computed from what is actually there.
 */
const fact = (over: Partial<ShelfFact> & { sku: string }): ShelfFact => ({
  name: over.sku,
  brand: 'Brand',
  price: 100,
  off: 0,
  inStock: true,
  checked: false,
  days: 2,
  ...over,
});

/** A device that has done nothing, which is what most of these assert against. */
const nobody: Shopper = EMPTY_SHOPPER;
const none = new Set<string>();

describe('the price ceiling', () => {
  it('prefers a round number, because a chip is a decision and not a computation', () => {
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

describe('the discount bar', () => {
  it('is the one that best halves the shelf, not a fixed number', () => {
    /* Cement is discounted 5, 6 and 6. At 5 the chip keeps everything and does nothing; at 10
       nothing qualifies and it empties the shelf. 6 keeps two of three. */
    expect(offerBar([5, 6, 6])).toBe(6);
  });

  it('never calls a trivial saving great', () => {
    expect(offerBar([1, 2, 3])).toBeNull();
    expect(offerBar([])).toBeNull();
    expect(offerBar([0, 0, OFFER_FLOOR])).toBe(OFFER_FLOOR);
  });
});

describe('when it can arrive', () => {
  it('is the region lead time for anything on the shelf', () => {
    expect(arrivalDays('in_stock', 2)).toBe(2);
    expect(arrivalDays('low', 2)).toBe(2);
  });

  it('is longer for a pre-order, and unknowable when it is out of stock', () => {
    expect(arrivalDays('preorder', 2)).toBeGreaterThan(2);
    /* Not a large number: "we cannot say" is not the same as "eventually". */
    expect(arrivalDays('out_of_stock', 2)).toBeNull();
  });

  it('is unknowable where we do not deliver', () => {
    expect(arrivalDays('in_stock', null)).toBeNull();
  });

  it('lists each distinct date once, soonest first, with how many land on it', () => {
    expect(arrivals([fact({ sku: 'A', days: 5 }), fact({ sku: 'B', days: 2 }), fact({ sku: 'C', days: 2 }), fact({ sku: 'D', days: null })])).toEqual([
      { days: 2, count: 2 },
      { days: 5, count: 1 },
    ]);
  });
});

describe('which chips a shelf offers', () => {
  const keys = (facts: ShelfFact[]) => chipsFor(facts).map((c) => c.key);

  /* The row a shopper learns once. A row that changes shape between two shelves is a row nobody
     trusts, so these are drawn whatever is on the shelf and whatever the device knows. */
  const ALWAYS = ['offers', 'rating', 'ordered', 'fresh', 'friends', 'schedule'];

  it.each([
    ['a shelf where everything is alike', [fact({ sku: 'A' }), fact({ sku: 'B' })]],
    ['a shelf with nothing discounted', [fact({ sku: 'A', off: 0 }), fact({ sku: 'B', off: 1 })]],
    ['a shelf of one', [fact({ sku: 'A' })]],
  ])('draws the whole row over %s', (_, facts) => {
    for (const key of ALWAYS) expect(keys(facts as ShelfFact[])).toContain(key);
  });

  it('offers no price chip when there is no price cut to make, and one when there is', () => {
    expect(keys([fact({ sku: 'A', price: 100 }), fact({ sku: 'B', price: 100 })])).not.toContain('under');
    expect(keys([fact({ sku: 'A', price: 100 }), fact({ sku: 'B', price: 900 })])).toContain('under');
  });

  it('offers no Schedule when nothing on the shelf can be given a date', () => {
    expect(keys([fact({ sku: 'A', days: null })])).not.toContain('schedule');
  });

  /*
   * "In stock" and "Price checked" are the exception, deliberately: unlike the rest they are pure
   * facts about the stock, so over a shelf where everything is in stock the chip can only ever do
   * nothing. Those two appear when they split the shelf and not otherwise.
   */
  it('holds the two stock chips to the must-narrow rule', () => {
    const same = [fact({ sku: 'A', checked: true, inStock: true }), fact({ sku: 'B', checked: true, inStock: true })];
    expect(keys(same)).not.toContain('checked');
    expect(keys(same)).not.toContain('stock');
    const mixed = [fact({ sku: 'A', checked: true, inStock: true }), fact({ sku: 'B', checked: false, inStock: false })];
    expect(keys(mixed)).toContain('checked');
    expect(keys(mixed)).toContain('stock');
  });

  it('carries the numbers as numbers, so nothing has to parse them back out of a label', () => {
    const chips = chipsFor([fact({ sku: 'A', price: 100, off: 30 }), fact({ sku: 'B', price: 900, off: 0 })]);
    expect(chips.find((c) => c.key === 'under')).toMatchObject({ value: 500, label: 'Under ₹500' });
    expect(chips.find((c) => c.key === 'offers')).toMatchObject({ value: 30, label: 'Great offers' });
    expect(chips.find((c) => c.key === 'rating')?.label).toBe('Rating 4.0+');
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
  const shelf = [
    fact({ sku: 'CHEAP', price: 100, off: 25, checked: true, brand: 'ACC', days: 2 }),
    fact({ sku: 'DEAR', price: 900, off: 0, checked: false, brand: 'UltraTech', inStock: false, days: 9 }),
  ];
  const kept = (state: Partial<ShelfState>, you: Shopper = nobody, picked: ReadonlySet<string> = none) =>
    shelf.filter((f) => keeps(f, { ...EMPTY_SHELF, ...state }, you, picked)).map((f) => f.sku);

  it('is exclusive at the ceiling, so "Under ₹500" never shows a ₹500 item', () => {
    expect(keeps(fact({ sku: 'X', price: 500 }), { ...EMPTY_SHELF, under: 500 }, nobody, none)).toBe(false);
    expect(keeps(fact({ sku: 'X', price: 499 }), { ...EMPTY_SHELF, under: 500 }, nobody, none)).toBe(true);
  });

  it('drops an unpriced item from a price filter rather than treating it as free', () => {
    expect(keeps(fact({ sku: 'X', price: null }), { ...EMPTY_SHELF, under: 500 }, nobody, none)).toBe(false);
  });

  it('holds every catalogue chip to its own field', () => {
    expect(kept({ offers: 10 })).toEqual(['CHEAP']);
    expect(kept({ checked: true })).toEqual(['CHEAP']);
    expect(kept({ stock: true })).toEqual(['CHEAP']);
    expect(kept({ brands: ['UltraTech'] })).toEqual(['DEAR']);
    expect(kept({ by: 2 })).toEqual(['CHEAP']);
  });

  it('drops an item with no date from a Schedule filter', () => {
    expect(keeps(fact({ sku: 'X', days: null }), { ...EMPTY_SHELF, by: 30 }, nobody, none)).toBe(false);
  });

  it('combines filters with AND, not OR', () => {
    expect(kept({ offers: 10, brands: ['UltraTech'] })).toEqual([]);
  });

  /*
   * The four chips about the reader. On a device that has done nothing they keep nothing — which
   * is the true answer, and the reason none of this is seeded with invented data.
   */
  it('keeps nothing for a shopper who has never done anything', () => {
    for (const state of [{ rating: true }, { ordered: true }, { friends: true }, { picks: true }]) expect(kept(state)).toEqual([]);
  });

  it('keeps what this device rated at or above the bar the chip names', () => {
    expect(kept({ rating: true }, { ...nobody, rated: { CHEAP: RATING_MIN } })).toEqual(['CHEAP']);
    expect(kept({ rating: true }, { ...nobody, rated: { CHEAP: RATING_MIN - 1 } })).toEqual([]);
  });

  it('keeps what this device has ordered', () => {
    expect(kept({ ordered: true }, { ...nobody, ordered: { DEAR: 1 } })).toEqual(['DEAR']);
  });

  it('keeps what a friend loves, and only while somebody is named', () => {
    expect(kept({ friends: true }, { ...nobody, friends: { DEAR: ['Priya'] } })).toEqual(['DEAR']);
    expect(kept({ friends: true }, { ...nobody, friends: { DEAR: [] } })).toEqual([]);
  });

  /* The one chip that means the ABSENCE of a record, so it is the one an empty device answers
     with everything rather than with nothing. */
  it('reads "New to you" as what you have NOT opened', () => {
    expect(kept({ fresh: true })).toEqual(['CHEAP', 'DEAR']);
    expect(kept({ fresh: true }, { ...nobody, viewed: { CHEAP: 1 } })).toEqual(['DEAR']);
  });

  it('reads the estimate for "In my estimate"', () => {
    expect(kept({ picks: true }, nobody, new Set(['DEAR']))).toEqual(['DEAR']);
  });

  it('keeps everything when nothing is chosen', () => {
    expect(kept({})).toHaveLength(2);
    expect(isFiltering(EMPTY_SHELF)).toBe(false);
    for (const on of [{ sort: 'price_asc' as const }, { rating: true }, { by: 2 }, { offers: 5 }]) expect(isFiltering({ ...EMPTY_SHELF, ...on })).toBe(true);
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
    const state: ShelfState = {
      under: 500,
      offers: 12,
      by: 3,
      checked: false,
      stock: true,
      picks: true,
      rating: true,
      ordered: true,
      fresh: true,
      friends: true,
      brands: ['ACC', 'UltraTech'],
      sort: 'price_asc',
    };
    expect(decodeShelf(encodeShelf(state))).toEqual(state);
  });

  it('writes nothing at all when nothing is chosen', () => {
    expect(encodeShelf(EMPTY_SHELF).toString()).toBe('');
  });

  it('keeps the query it was given and replaces only its own keys', () => {
    const base = new URLSearchParams('q=cement&s_offers=9&page=2');
    const out = encodeShelf({ ...EMPTY_SHELF, stock: true }, base);
    expect(out.get('q')).toBe('cement');
    expect(out.get('page')).toBe('2');
    expect(out.get('s_offers')).toBeNull();
    expect(out.get('s_stock')).toBe('1');
  });

  it('reads the searchParams shape a server component is handed', () => {
    expect(decodeShelf({ s_under: '500', s_rating: '1', s_brand: 'ACC|Dahua', s_sort: 'saving' })).toEqual({
      ...EMPTY_SHELF,
      under: 500,
      rating: true,
      brands: ['ACC', 'Dahua'],
      sort: 'saving',
    });
  });

  it('ignores a hand-typed URL rather than trusting it', () => {
    expect(decodeShelf({ s_under: 'free', s_sort: 'cheapest', s_brand: '||', s_by: 'tomorrow' })).toEqual(EMPTY_SHELF);
    expect(decodeShelf({ s_under: '-9' }).under).toBeNull();
    /* A ceiling of zero would keep nothing and is never something a chip sets. */
    expect(decodeShelf({ s_under: '0' }).under).toBeNull();
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

  it.each([...byCategory.keys()])('draws the same row over the %s shelf', (category) => {
    const chips = chipsFor(factsOf(byCategory.get(category) ?? [], 2));
    for (const key of ['offers', 'rating', 'ordered', 'fresh', 'friends', 'schedule']) expect(chips.map((c) => c.key)).toContain(key);
  });

  /*
   * The chips whose numbers come off the shelf have to earn them there. The personal ones are
   * exempt by design: what they keep depends on the device, not on the catalogue.
   */
  it.each([...byCategory.keys()])('every computed number on the %s shelf narrows it', (category) => {
    const facts = factsOf(byCategory.get(category) ?? [], 2);
    for (const chip of chipsFor(facts)) {
      if (!['under', 'offers', 'checked', 'stock'].includes(chip.key)) continue;
      const state: ShelfState = { ...EMPTY_SHELF };
      if (chip.key === 'under') state.under = chip.value ?? 0;
      else if (chip.key === 'offers') state.offers = chip.value ?? 0;
      else state[chip.key as 'checked' | 'stock'] = true;
      const kept = facts.filter((f) => keeps(f, state, nobody, none)).length;
      expect(kept, `${chip.label} keeps nothing on ${category}`).toBeGreaterThan(0);
      /* "Great offers" is allowed to keep everything, and on the tiles and total-station shelves
         it does: all three carry the same discount, so all three ARE the offer. What it must
         never do is empty the shelf, which is the assertion above. */
      if (chip.key === 'offers') continue;
      expect(kept, `${chip.label} keeps everything on ${category}`).toBeLessThan(facts.length);
    }
  });
});
