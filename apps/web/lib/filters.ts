/**
 * Filter state lives in the URL — shareable, back-button-safe — and is translated into a
 * Meilisearch filter string here. Isomorphic: the rail (client) and the page (server) share it.
 *
 *   ?q=…&brand=A|B&price=100-500&stock=1&f_wattage=5-15&f_base_type=B22|E27&sort=price_asc&page=2
 */
import { type Facet, type FacetConfig, type FilterState, formatRupees } from '@buildobjects/catalog';

export type SortKey = NonNullable<FilterState['sort']>;
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'newest', label: 'Newest' },
];

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function parseRange(s: string): [number | null, number | null] | null {
  const m = s.match(/^(-?[\d.]*)-(-?[\d.]*)$/);
  if (!m) return null;
  const a = m[1] === '' ? null : Number(m[1]),
    b = m[2] === '' ? null : Number(m[2]);
  if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b))) return null;
  return [a, b];
}

export function parseFilters(params: Params): FilterState & { q: string; page: number; category?: string } {
  const state: FilterState & { q: string; page: number; category?: string } = {
    attrs: {},
    q: first(params.q).trim(),
    page: Math.max(1, Number(first(params.page)) || 1),
  };
  const brand = first(params.brand);
  if (brand) state.brand = brand.split('|').filter(Boolean);
  const price = first(params.price);
  const pr = price ? parseRange(price) : null;
  if (pr) state.price = pr;
  if (first(params.stock) === '1') state.stock = true;
  const sort = first(params.sort) as SortKey;
  if (SORTS.some((s) => s.key === sort)) state.sort = sort;
  const cat = first(params.category);
  if (cat) state.category = cat;
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith('f_')) continue;
    const key = k.slice(2);
    const val = first(v);
    if (!val) continue;
    if (val === '1' || val === 'true') state.attrs[key] = true;
    else {
      const r = parseRange(val);
      state.attrs[key] = r && /^-?[\d.]*-(-?[\d.]*)$/.test(val) && !val.includes('|') ? r : val.split('|').filter(Boolean);
    }
  }
  return state;
}

export function toQuery(state: Partial<FilterState & { q: string; page: number; category?: string }>): string {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category) p.set('category', state.category);
  if (state.brand?.length) p.set('brand', state.brand.join('|'));
  if (state.price && (state.price[0] !== null || state.price[1] !== null)) p.set('price', `${state.price[0] ?? ''}-${state.price[1] ?? ''}`);
  if (state.stock) p.set('stock', '1');
  if (state.sort && state.sort !== 'relevance') p.set('sort', state.sort);
  for (const [k, v] of Object.entries(state.attrs ?? {})) {
    if (v === true) p.set(`f_${k}`, '1');
    else if (Array.isArray(v) && v.length === 2 && (typeof v[0] === 'number' || v[0] === null) && (typeof v[1] === 'number' || v[1] === null)) {
      if (v[0] !== null || v[1] !== null) p.set(`f_${k}`, `${v[0] ?? ''}-${v[1] ?? ''}`);
    } else if (Array.isArray(v) && v.length) p.set(`f_${k}`, (v as string[]).join('|'));
  }
  if (state.page && state.page > 1) p.set('page', String(state.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Quotes a value for a Meilisearch filter expression. Every string that reaches a filter goes
 * through this — slugs and SKU codes come from the database, but "it is trusted today" is not a
 * reason to hand-build a query string.
 */
export const esc = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Meilisearch filter expression for a state, scoped to a category when given. */
export function toMeiliFilter(state: FilterState & { category?: string }, config: FacetConfig | null, fixedCategory?: string): string[] {
  const out: string[] = [];
  const cat = fixedCategory ?? state.category;
  if (cat) out.push(`category = ${esc(cat)}`);
  if (state.brand?.length) out.push(`brand IN [${state.brand.map(esc).join(', ')}]`);
  if (state.price) {
    const [a, b] = state.price;
    if (a !== null) out.push(`selling_price >= ${a}`);
    if (b !== null) out.push(`selling_price <= ${b}`);
  }
  if (state.stock) out.push('in_stock = true');
  const byKey = new Map((config?.facets ?? []).map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(state.attrs)) {
    const f = byKey.get(k);
    const attr = f?.attr ?? `attr_${k}`;
    if (v === true) out.push(`${attr} = true`);
    else if (
      Array.isArray(v) &&
      v.length === 2 &&
      (typeof v[0] === 'number' || v[0] === null) &&
      (typeof v[1] === 'number' || v[1] === null) &&
      (f?.kind === 'range' || !f)
    ) {
      if (v[0] !== null) out.push(`${attr} >= ${v[0]}`);
      if (v[1] !== null) out.push(`${attr} <= ${v[1]}`);
    } else if (Array.isArray(v) && v.length) out.push(`${attr} IN [${(v as string[]).map(esc).join(', ')}]`);
  }
  return out;
}

export function sortParam(sort: SortKey | undefined): string[] | undefined {
  if (sort === 'price_asc') return ['selling_price:asc'];
  if (sort === 'price_desc') return ['selling_price:desc'];
  if (sort === 'newest') return ['created_at:desc'];
  return undefined;
}

export function appliedChips(state: FilterState, config: FacetConfig | null): { key: string; label: string; remove: Partial<FilterState> }[] {
  const chips: { key: string; label: string; remove: Partial<FilterState> }[] = [];
  const byKey = new Map((config?.facets ?? []).map((f) => [f.key, f]));
  const unitOf = (f?: Facet) => (f && 'unit' in f && f.unit && f.unit !== '₹' ? ` ${f.unit}` : '');

  for (const b of state.brand ?? []) {
    chips.push({ key: `brand:${b}`, label: b, remove: { brand: (state.brand ?? []).filter((x) => x !== b) } });
  }

  if (state.price) {
    const [a, b] = state.price;
    let priceLabel = 'Price';
    if (a === null && b !== null) priceLabel = `Under ${formatRupees(b)}`;
    else if (a !== null && b === null) priceLabel = `${formatRupees(a)} and above`;
    else if (a !== null && b !== null) priceLabel = `${formatRupees(a)} – ${formatRupees(b)}`;
    chips.push({ key: 'price', label: priceLabel, remove: { price: undefined } });
  }

  if (state.stock) {
    chips.push({ key: 'stock', label: 'In stock', remove: { stock: undefined } });
  }

  for (const [k, v] of Object.entries(state.attrs)) {
    const f = byKey.get(k);
    const label = f?.label ?? k;
    const rest = { ...state.attrs };
    delete rest[k];

    if (v === true) {
      chips.push({ key: `a:${k}`, label: f && 'true_label' in f && f.true_label ? f.true_label : label, remove: { attrs: rest } });
    } else if (
      Array.isArray(v) &&
      v.length === 2 &&
      (typeof v[0] === 'number' || v[0] === null) &&
      (typeof v[1] === 'number' || v[1] === null) &&
      f?.kind === 'range'
    ) {
      const [lo, hi] = v;
      let rangeLabel = label;
      if (lo === null && hi !== null) rangeLabel = `${label}: Under ${hi}${unitOf(f)}`;
      else if (lo !== null && hi === null) rangeLabel = `${label}: ${lo}${unitOf(f)} and above`;
      else if (lo !== null && hi !== null) rangeLabel = `${label}: ${lo}–${hi}${unitOf(f)}`;
      chips.push({ key: `a:${k}`, label: rangeLabel, remove: { attrs: rest } });
    } else if (Array.isArray(v) && v.length) {
      for (const val of v as string[]) {
        const valLabel = f && 'values' in f ? (f.values.find((fv) => fv.value === val)?.label ?? val) : val;
        chips.push({
          key: `a:${k}:${val}`,
          label: `${label}: ${valLabel}`,
          remove: {
            attrs: {
              ...rest,
              ...((v as string[]).length > 1 ? { [k]: (v as string[]).filter((x) => x !== val) } : {}),
            },
          },
        });
      }
    }
  }
  return chips;
}
