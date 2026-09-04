import type { SkuSearchDoc } from '@buildobjects/catalog';

/**
 * The filter chips over "On the shelf now", as pure functions — the state, which chips a given
 * shelf can honestly offer, and what each one keeps.
 *
 * WHY A CHIP HAS TO EARN ITS PLACE. Every chip here is computed from the shelf it sits above, and
 * one that would keep everything, or nothing, is not rendered at all. A row of chips that do not
 * change what you see is a row of decoration, and it teaches a shopper to ignore the row — which
 * is worse than not having it, because the chips that DO work are in the same row.
 *
 * WHY THESE CHIPS AND NOT THE OBVIOUS ONES. A rating filter, a "previously ordered" filter and a
 * "loved by friends" filter are what a food app puts here, and this store has no ratings, no order
 * history and no social graph. The nearest honest equivalents are what a builder actually asks:
 * what does it cost, what is discounted, and is the price a real quoted one or our estimate.
 * `price_provenance` is already on every card as a badge, so "Price checked" filters by something
 * the shopper can already see and verify on the product page.
 *
 * The one piece of personal state that IS real is the estimate — `lib/picks.ts` — so "In my
 * estimate" is offered when the reader has picks on this shelf, and only then.
 */
export type ShelfFact = {
  sku: string;
  name: string;
  brand: string;
  price: number | null;
  /** Whole per cent off the MRP; 0 when there is no MRP or no saving. */
  off: number;
  inStock: boolean;
  /** True when the price came from a live listing rather than our own estimate. */
  checked: boolean;
};

export type ShelfSort = 'default' | 'price_asc' | 'price_desc' | 'saving';

export type ShelfState = {
  /** Keep only items priced strictly below this. */
  under: number | null;
  offers: boolean;
  checked: boolean;
  stock: boolean;
  picks: boolean;
  brands: string[];
  sort: ShelfSort;
};

export const EMPTY_SHELF: ShelfState = { under: null, offers: false, checked: false, stock: false, picks: false, brands: [], sort: 'default' };

/** What counts as a saving worth a chip of its own. */
export const OFFER_MIN = 10;

export const SHELF_SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'default', label: 'Our order' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'saving', label: 'Biggest saving' },
];

export function factsOf(skus: SkuSearchDoc[]): ShelfFact[] {
  return skus.map((s) => ({
    sku: s.sku_code,
    name: s.name,
    brand: s.brand,
    price: typeof s.selling_price === 'number' ? s.selling_price : null,
    off: s.mrp && s.selling_price && s.mrp > s.selling_price ? Math.round((1 - s.selling_price / s.mrp) * 100) : 0,
    inStock: s.in_stock,
    checked: s.price_provenance === 'fetched',
  }));
}

/**
 * The multipliers a person would actually choose, in the order they feel round. 1 and 5 first —
 * "Under ₹500" is a decision, "Under ₹125" is a computation — and 1.25 last, kept only because
 * without it a shelf priced 1,160 to 1,350 has no round number inside it at all.
 */
const NICE = [1, 5, 2, 2.5, 1.5, 3, 4, 1.25, 7.5];

/**
 * A price ceiling that actually cuts this shelf in two.
 *
 * A fixed "Under ₹250" is meaningless on a shelf of total stations at four lakh, and on a shelf of
 * bulbs at sixty-five rupees it keeps everything — so the number comes from the shelf itself. Of
 * every round number that falls strictly inside the range, this picks the one that comes CLOSEST
 * TO KEEPING HALF, because a filter that keeps one of nine, or eight of nine, has not really
 * divided anything. Ties go to the rounder number.
 *
 * When no round number lands inside — cement runs 410 to 437, and every round number is either
 * below all of it or above all of it — a real price does the job instead, chosen the same way. It
 * is exact rather than tidy, which is the right trade: the chip still has to work.
 *
 * Returns null when every item costs the same, or nothing is priced: there is no cut to make.
 */
export function priceCeiling(prices: number[]): number | null {
  const sorted = prices.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (lo === hi) return null;

  const half = sorted.length / 2;
  /* `under` is exclusive, so a candidate must be above the cheapest to keep anything and at or
     below the dearest to exclude anything. */
  const kept = (n: number) => sorted.filter((p) => p < n).length;
  const best = (candidates: { value: number; round: number }[]): number | null => {
    let win: { value: number; round: number } | null = null;
    for (const c of candidates) {
      if (!(c.value > lo && c.value <= hi)) continue;
      if (!win) {
        win = c;
        continue;
      }
      const d = Math.abs(kept(c.value) - half) - Math.abs(kept(win.value) - half);
      if (d < 0 || (d === 0 && c.round < win.round)) win = c;
    }
    return win?.value ?? null;
  };

  const rounds: { value: number; round: number }[] = [];
  for (let e = 0; e <= 7; e++) for (const [rank, m] of NICE.entries()) rounds.push({ value: m * 10 ** e, round: rank });
  /* Every real price is equally "round" — none of them is — so the tie-break falls to the first,
     which the caller sees as the cheapest. */
  return best(rounds) ?? best(sorted.map((value) => ({ value, round: 0 })));
}

export type ChipKey = 'under' | 'offers' | 'checked' | 'stock' | 'picks';

/** `value` carries the number behind a numeric chip, so nothing has to read it back out of a label. */
export type Chip = { key: ChipKey; label: string; value?: number };

/**
 * The chips this shelf can offer, in the order they are shown. `picks` is not here: it depends on
 * what the reader has saved, which is known only in the browser — see components/shelf/ShelfBar.
 */
export function chipsFor(facts: ShelfFact[]): Chip[] {
  const out: Chip[] = [];
  const splits = (keep: (f: ShelfFact) => boolean) => {
    const n = facts.filter(keep).length;
    return n > 0 && n < facts.length;
  };
  const ceiling = priceCeiling(facts.map((f) => f.price ?? Number.NaN));
  if (ceiling !== null) out.push({ key: 'under', label: `Under ₹${ceiling.toLocaleString('en-IN')}`, value: ceiling });
  if (splits((f) => f.off >= OFFER_MIN)) out.push({ key: 'offers', label: 'Great offers' });
  if (splits((f) => f.checked)) out.push({ key: 'checked', label: 'Price checked' });
  if (splits((f) => f.inStock)) out.push({ key: 'stock', label: 'In stock' });
  return out;
}

/** Brands on this shelf, alphabetical, only when there is more than one to choose between. */
export function brandsOf(facts: ShelfFact[]): string[] {
  const names = [...new Set(facts.map((f) => f.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return names.length > 1 ? names : [];
}

/** Does one item survive the current state? `picked` is the reader's estimate, passed in. */
export function keeps(fact: ShelfFact, state: ShelfState, picked: ReadonlySet<string>): boolean {
  if (state.under !== null && !(fact.price !== null && fact.price < state.under)) return false;
  if (state.offers && fact.off < OFFER_MIN) return false;
  if (state.checked && !fact.checked) return false;
  if (state.stock && !fact.inStock) return false;
  if (state.picks && !picked.has(fact.sku)) return false;
  if (state.brands.length && !state.brands.includes(fact.brand)) return false;
  return true;
}

/**
 * The order to draw them in, as a rank per SKU. Unpriced items sort last in both price
 * directions — an item with no price is not cheap, it is unknown.
 */
export function order(facts: ShelfFact[], sort: ShelfSort): Map<string, number> {
  const rank = new Map<string, number>();
  if (sort === 'default') {
    facts.forEach((f, i) => {
      rank.set(f.sku, i);
    });
    return rank;
  }
  const by = [...facts];
  const price = (f: ShelfFact) => (f.price === null ? Number.POSITIVE_INFINITY : f.price);
  if (sort === 'price_asc') by.sort((a, b) => price(a) - price(b));
  if (sort === 'price_desc') by.sort((a, b) => (b.price === null ? -1 : a.price === null ? 1 : b.price - a.price));
  if (sort === 'saving') by.sort((a, b) => b.off - a.off);
  by.forEach((f, i) => {
    rank.set(f.sku, i);
  });
  return rank;
}

export const isFiltering = (s: ShelfState): boolean =>
  s.under !== null || s.offers || s.checked || s.stock || s.picks || s.brands.length > 0 || s.sort !== 'default';

/* ── the URL ──────────────────────────────────────────────────────────────────
   Written with history.replaceState rather than a router push: a chip is a change of view, not a
   change of page, and a push would send the reader through the loading overlay to re-fetch a
   shelf the browser is already holding. Reading it back is what makes a filtered shelf a link
   somebody can send, and what makes a reload keep what you chose.

   THE TRADE, STATED: replaceState means a chip press is not a history entry, so Back leaves the
   page rather than undoing the last chip. That is the right way round for a row you tap four
   times in a row — the alternative is four presses of Back to leave a page you glanced at — and
   Clear is right there. Back still restores whatever filters the entry it lands on carried. */

const SHELF_PREFIX = 's_';

export function encodeShelf(state: ShelfState, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of [...p.keys()]) if (k.startsWith(SHELF_PREFIX)) p.delete(k);
  if (state.under !== null) p.set(`${SHELF_PREFIX}under`, String(state.under));
  if (state.offers) p.set(`${SHELF_PREFIX}offers`, '1');
  if (state.checked) p.set(`${SHELF_PREFIX}checked`, '1');
  if (state.stock) p.set(`${SHELF_PREFIX}stock`, '1');
  if (state.picks) p.set(`${SHELF_PREFIX}picks`, '1');
  if (state.brands.length) p.set(`${SHELF_PREFIX}brand`, state.brands.join('|'));
  if (state.sort !== 'default') p.set(`${SHELF_PREFIX}sort`, state.sort);
  return p;
}

export function decodeShelf(params: URLSearchParams | Record<string, string | string[] | undefined>): ShelfState {
  const get = (k: string): string => {
    if (params instanceof URLSearchParams) return params.get(`${SHELF_PREFIX}${k}`) ?? '';
    const v = params[`${SHELF_PREFIX}${k}`];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const under = Number(get('under'));
  const sort = get('sort') as ShelfSort;
  return {
    under: Number.isFinite(under) && under > 0 ? under : null,
    offers: get('offers') === '1',
    checked: get('checked') === '1',
    stock: get('stock') === '1',
    picks: get('picks') === '1',
    brands: get('brand').split('|').filter(Boolean),
    sort: SHELF_SORTS.some((s) => s.key === sort) ? sort : 'default',
  };
}
