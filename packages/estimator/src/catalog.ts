/**
 * Store ↔ calculator bridge. The calculator never carries its own product prices: a line that
 * maps to a store category takes the live store SKU (tier-mapped by code, else by price rank)
 * and inherits that SKU's price provenance. Store prices are real quoted prices and are never
 * multiplied by the city index; only seed thumb-rule rates are.
 */
import type { CatalogMapEntry } from '../rates/2026-08/catalog-map';
import type { CatalogPrice, CatalogPrices, Tier } from './types';

/** Resolve the store SKU that prices a tier: explicit code first, then rank inside the category. */
export function resolveStoreSku(entry: CatalogMapEntry, tier: Tier, catalog: CatalogPrices): CatalogPrice | null {
  const usable = (s: CatalogPrice | undefined) => !!s && s.selling_price !== null && s.selling_price > 0 && s.in_stock !== false;
  if (entry.resolve === 'codes_then_rank') {
    const code = entry.codes?.[tier];
    if (code && usable(catalog[code])) return catalog[code];
  }
  const inCategory = Object.values(catalog)
    .filter((s) => s.category === entry.category && usable(s))
    .sort((a, b) => a.selling_price! - b.selling_price!);
  if (!inCategory.length) return null;
  const i = tier === 'basic' ? 0 : tier === 'premium' ? inCategory.length - 1 : Math.floor((inCategory.length - 1) / 2);
  return inCategory[i];
}

/** ₹ per sqft for a tile / glass SKU, if the loader could derive it. */
export function perSqft(s: CatalogPrice | null): number | null {
  if (!s) return null;
  if (typeof s.per_sqft === 'number' && s.per_sqft > 0) return s.per_sqft;
  if (s.unit === 'sqft' && s.selling_price) return s.selling_price;
  return null;
}

/**
 * Fold a price response into the snapshot the calculator is holding.
 *
 * IT RETURNS `prev` UNCHANGED WHEN THE ANSWER ADDS NOTHING, and that is the whole point rather
 * than an optimisation. The caller is a React effect that merges into state the effect itself
 * reads; written as `{ ...prev, ...incoming }` it allocates a new object every time, so the state
 * identity always changes, so the effect always runs again. While every asked-for code comes back
 * that terminates on the second pass. When one does not — /api/estimate/catalog answers 200 with
 * `{}` if it cannot reach the database, and the deployment has none — the same code is missing
 * every pass, and the page fetches forever.
 *
 * Returning the previous object makes a no-op response a no-op state update, which React drops.
 * A merge that cannot change identity cannot drive a loop, whoever writes the next effect.
 */
export function mergeCatalog(prev: CatalogPrices, incoming: CatalogPrices): CatalogPrices {
  const gained = Object.keys(incoming).some((code) => !(code in prev));
  return gained ? { ...prev, ...incoming } : prev;
}
