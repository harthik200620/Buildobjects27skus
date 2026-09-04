import type { SkuSearchDoc } from '@buildobjects/catalog';
import type { Shopper } from './shopper';

/**
 * The filter chips over "On the shelf now", as pure functions — the state, the chips, and what
 * each one keeps.
 *
 * TWO KINDS OF CHIP, AND THE DIFFERENCE MATTERS.
 *
 *   · Questions about the CATALOGUE — the price, the discount, whether the price was quoted to us
 *     or estimated by us, whether it is in stock. Their numbers are computed from the shelf they
 *     sit over, because a fixed "Under ₹250" keeps everything on a shelf of bulbs and nothing on a
 *     shelf of total stations.
 *
 *   · Questions about the SHOPPER — what you rated, what you ordered, what you have not seen yet,
 *     what your friends love. Nothing in the catalogue can answer these; `lib/shopper.ts` can,
 *     from what this device has recorded about its own owner. On a device that has never been used
 *     they keep nothing, which is the true answer and not a broken one — a shop cannot show you
 *     your past orders before you have made one.
 *
 * NOTHING IS INVENTED TO FILL A CHIP. There are no stars on a product until somebody sets them,
 * and no friend loves an item until a list is shared. That is why every one of these has a real
 * control behind it in the store rather than a number in a fixture.
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
  /** Working days until it can arrive here, or null when it cannot be promised at all. */
  days: number | null;
};

export type ShelfSort = 'default' | 'price_asc' | 'price_desc' | 'saving';

export type ShelfState = {
  /** Keep only items priced strictly below this. */
  under: number | null;
  /** Keep only items at or above this discount, in whole per cent. */
  offers: number | null;
  /** Keep only items that can arrive within this many working days. */
  by: number | null;
  checked: boolean;
  stock: boolean;
  picks: boolean;
  rating: boolean;
  ordered: boolean;
  fresh: boolean;
  friends: boolean;
  brands: string[];
  sort: ShelfSort;
};

export const EMPTY_SHELF: ShelfState = {
  under: null,
  offers: null,
  by: null,
  checked: false,
  stock: false,
  picks: false,
  rating: false,
  ordered: false,
  fresh: false,
  friends: false,
  brands: [],
  sort: 'default',
};

/** "Rating 4.0+" — the bar the chip names. */
export const RATING_MIN = 4;

/** No discount below this is ever called great, however the shelf is priced. */
export const OFFER_FLOOR = 5;

export const SHELF_SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'default', label: 'Our order' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'saving', label: 'Biggest saving' },
];

/**
 * How long each item takes to get here. It is the region's lead time for anything on the shelf;
 * something on pre-order takes a week longer, and something out of stock cannot be promised a
 * date at all — which is not the same as "eventually", so it is null rather than a large number.
 */
const PREORDER_EXTRA = 7;
export function arrivalDays(stock: SkuSearchDoc['stock'], regionDays: number | null): number | null {
  if (regionDays === null || !Number.isFinite(regionDays)) return null;
  if (stock === 'out_of_stock') return null;
  return stock === 'preorder' ? regionDays + PREORDER_EXTRA : regionDays;
}

export function factsOf(skus: SkuSearchDoc[], regionDays: number | null = null): ShelfFact[] {
  return skus.map((s) => ({
    sku: s.sku_code,
    name: s.name,
    brand: s.brand,
    price: typeof s.selling_price === 'number' ? s.selling_price : null,
    off: s.mrp && s.selling_price && s.mrp > s.selling_price ? Math.round((1 - s.selling_price / s.mrp) * 100) : 0,
    inStock: s.in_stock,
    checked: s.price_provenance === 'fetched',
    days: arrivalDays(s.stock, regionDays),
  }));
}

/**
 * The multipliers a person would actually choose, in the order they feel round. 1 and 5 first —
 * "Under ₹500" is a decision, "Under ₹125" is a computation — and 1.25 last, kept only because
 * without it a shelf priced 1,160 to 1,350 has no round number inside it at all.
 */
const NICE = [1, 5, 2, 2.5, 1.5, 3, 4, 1.25, 7.5];

/** Of the candidates inside the shelf, the one keeping closest to half; ties go to the rounder. */
function bestSplit(candidates: { value: number; round: number }[], kept: (n: number) => number, half: number, inside: (n: number) => boolean): number | null {
  let win: { value: number; round: number } | null = null;
  for (const c of candidates) {
    if (!inside(c.value)) continue;
    if (!win) {
      win = c;
      continue;
    }
    const d = Math.abs(kept(c.value) - half) - Math.abs(kept(win.value) - half);
    if (d < 0 || (d === 0 && c.round < win.round)) win = c;
  }
  return win?.value ?? null;
}

/**
 * A price ceiling that actually cuts this shelf in two.
 *
 * Of every round number that falls strictly inside the range, this picks the one that comes
 * CLOSEST TO KEEPING HALF, because a filter that keeps one of nine, or eight of nine, has not
 * really divided anything. Ties go to the rounder number.
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
  /* `under` is exclusive, so a candidate must be above the cheapest to keep anything and at or
     below the dearest to exclude anything. */
  const inside = (n: number) => n > lo && n <= hi;
  const kept = (n: number) => sorted.filter((p) => p < n).length;
  const half = sorted.length / 2;
  const rounds: { value: number; round: number }[] = [];
  for (let e = 0; e <= 7; e++) for (const [rank, m] of NICE.entries()) rounds.push({ value: m * 10 ** e, round: rank });
  /* Every real price is equally "round" — none of them is — so a tie falls to the cheapest. */
  return (
    bestSplit(rounds, kept, half, inside) ??
    bestSplit(
      sorted.map((value) => ({ value, round: 0 })),
      kept,
      half,
      inside,
    )
  );
}

/**
 * What counts as a great offer ON THIS SHELF, never below OFFER_FLOOR.
 *
 * A fixed bar is wrong in both directions: at 10 % nothing in cement qualifies and the chip empties
 * the shelf, at 5 % everything does and the chip changes nothing. So the bar is the discount that
 * best halves what is here — 6 % on a shelf discounted 5, 6 and 6 — with a floor that stops it
 * calling a one per cent saving great. Null when nothing reaches the floor.
 */
export function offerBar(offs: number[]): number | null {
  const eligible = offs.filter((n) => Number.isFinite(n) && n >= OFFER_FLOOR);
  if (!eligible.length) return null;
  const bars = [...new Set(eligible)].sort((a, b) => a - b);
  const kept = (n: number) => offs.filter((o) => o >= n).length;
  const half = offs.length / 2;
  let win = bars[0];
  for (const bar of bars) if (Math.abs(kept(bar) - half) < Math.abs(kept(win) - half)) win = bar;
  return win;
}

export type ChipKey = 'under' | 'offers' | 'rating' | 'ordered' | 'fresh' | 'friends' | 'schedule' | 'checked' | 'stock' | 'picks';

/** `value` carries the number behind a numeric chip, so nothing has to read it back out of a label. */
export type Chip = { key: ChipKey; label: string; value?: number };

/**
 * The chips this shelf shows, in order.
 *
 * The first six are always here. They are the row a shopper learns once and then expects, and a
 * row that changes shape between two shelves is a row nobody trusts — so "Previously ordered" is
 * offered on a device that has never ordered anything, and answers honestly by keeping nothing.
 *
 * The last two are extras this catalogue happens to support, and they appear only when they split
 * the shelf, because unlike the others they are pure facts about the stock: "In stock" over a
 * shelf where everything is in stock is a chip that can only ever do nothing.
 */
export function chipsFor(facts: ShelfFact[]): Chip[] {
  const out: Chip[] = [];
  const ceiling = priceCeiling(facts.map((f) => f.price ?? Number.NaN));
  const bar = offerBar(facts.map((f) => f.off));
  if (ceiling !== null) out.push({ key: 'under', label: `Under ₹${ceiling.toLocaleString('en-IN')}`, value: ceiling });
  out.push(bar === null ? { key: 'offers', label: 'Great offers' } : { key: 'offers', label: 'Great offers', value: bar });
  out.push({ key: 'rating', label: `Rating ${RATING_MIN.toFixed(1)}+` });
  out.push({ key: 'ordered', label: 'Previously ordered' });
  out.push({ key: 'fresh', label: 'New to you' });
  out.push({ key: 'friends', label: 'Loved by friends' });
  if (arrivals(facts).length) out.push({ key: 'schedule', label: 'Schedule' });

  const splits = (keep: (f: ShelfFact) => boolean) => {
    const n = facts.filter(keep).length;
    return n > 0 && n < facts.length;
  };
  if (splits((f) => f.checked)) out.push({ key: 'checked', label: 'Price checked' });
  if (splits((f) => f.inStock)) out.push({ key: 'stock', label: 'In stock' });
  return out;
}

/** The distinct arrival times on this shelf, soonest first, with how many land on each. */
export function arrivals(facts: ShelfFact[]): { days: number; count: number }[] {
  const byDay = new Map<number, number>();
  for (const f of facts) if (f.days !== null) byDay.set(f.days, (byDay.get(f.days) ?? 0) + 1);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([days, count]) => ({ days, count }));
}

/** Brands on this shelf, alphabetical, only when there is more than one to choose between. */
export function brandsOf(facts: ShelfFact[]): string[] {
  const names = [...new Set(facts.map((f) => f.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return names.length > 1 ? names : [];
}

/** Does one item survive the current state? `you` is this device's own record. */
export function keeps(fact: ShelfFact, state: ShelfState, you: Shopper, picked: ReadonlySet<string>): boolean {
  if (state.under !== null && !(fact.price !== null && fact.price < state.under)) return false;
  if (state.offers !== null && fact.off < state.offers) return false;
  if (state.by !== null && (fact.days === null || fact.days > state.by)) return false;
  if (state.checked && !fact.checked) return false;
  if (state.stock && !fact.inStock) return false;
  if (state.picks && !picked.has(fact.sku)) return false;
  if (state.rating && !((you.rated[fact.sku] ?? 0) >= RATING_MIN)) return false;
  if (state.ordered && !you.ordered[fact.sku]) return false;
  /* "New to you" is the one chip that means the ABSENCE of a record. */
  if (state.fresh && you.viewed[fact.sku]) return false;
  if (state.friends && !((you.friends[fact.sku]?.length ?? 0) > 0)) return false;
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
  s.under !== null ||
  s.offers !== null ||
  s.by !== null ||
  s.checked ||
  s.stock ||
  s.picks ||
  s.rating ||
  s.ordered ||
  s.fresh ||
  s.friends ||
  s.brands.length > 0 ||
  s.sort !== 'default';

/* ── the URL ──────────────────────────────────────────────────────────────────
   Written with history.replaceState rather than a router push: a chip is a change of view, not a
   change of page, and a push would send the reader through the loading overlay to re-fetch a
   shelf the browser is already holding. Reading it back is what makes a filtered shelf a link
   somebody can send, and what makes a reload keep what you chose.

   THE TRADE, STATED: replaceState means a chip press is not a history entry, so Back leaves the
   page rather than undoing the last chip. That is the right way round for a row you tap four
   times in a row — the alternative is four presses of Back to leave a page you glanced at — and
   Clear is right there. Back still restores whatever filters the entry it lands on carried.

   The shopper's own chips are booleans in the URL and mean nothing on anybody else's device: a
   link carrying `s_ordered=1` shows the person who opens it what THEY have ordered, which is the
   only thing it could honestly mean. */

const SHELF_PREFIX = 's_';
const FLAGS = ['checked', 'stock', 'picks', 'rating', 'ordered', 'fresh', 'friends'] as const;
const NUMBERS = ['under', 'offers', 'by'] as const;

export function encodeShelf(state: ShelfState, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of [...p.keys()]) if (k.startsWith(SHELF_PREFIX)) p.delete(k);
  for (const n of NUMBERS) {
    const v = state[n];
    if (v !== null) p.set(`${SHELF_PREFIX}${n}`, String(v));
  }
  for (const f of FLAGS) if (state[f]) p.set(`${SHELF_PREFIX}${f}`, '1');
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
  const num = (k: string): number | null => {
    const raw = get(k);
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const sort = get('sort') as ShelfSort;
  const state: ShelfState = {
    ...EMPTY_SHELF,
    under: num('under'),
    offers: num('offers'),
    by: num('by'),
    brands: get('brand').split('|').filter(Boolean),
    sort: SHELF_SORTS.some((s) => s.key === sort) ? sort : 'default',
  };
  /* A ceiling of zero would keep nothing and is never something a chip sets: treat it as absent. */
  if (state.under === 0) state.under = null;
  for (const f of FLAGS) state[f] = get(f) === '1';
  return state;
}
