import 'server-only';
import type { SpecJson } from '@buildobjects/catalog';
import { brands, categories, getDb, num, products, skus } from '@buildobjects/db';
import { CATALOG_MAP, type CatalogPrice, type CatalogPrices } from '@buildobjects/estimator';
import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';

/**
 * The store ↔ calculator bridge (server side). Loads ONLY the SKUs the calculator can use —
 * the explicitly mapped codes, the cheapest / dearest / mid-priced SKU per mapped category,
 * and any codes the buyer picked — so the snapshot stays a handful of rows at 400k SKUs.
 * Every query is a unique-index lookup or an indexed `ORDER BY selling_price LIMIT 1`.
 */
const cols = {
  code: skus.skuCode,
  name: products.name,
  variant: skus.variantLabel,
  brand: brands.name,
  category: categories.slug,
  price: skus.sellingPrice,
  prov: skus.priceProvenance,
  unit: skus.unit,
  packQty: skus.packQty,
  stock: skus.stockStatus,
  spec: skus.specJson,
};
type Row = {
  code: string;
  name: string;
  variant: string;
  brand: string;
  category: string;
  price: unknown;
  prov: string;
  unit: string;
  packQty: unknown;
  stock: string;
  spec: unknown;
};

/** Throws when there is no database; every caller is wrapped and falls back to the rate card. */
function base() {
  return getDb()
    .select(cols)
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id));
}

function attrOf(spec: SpecJson | null, key: string): string | number | boolean | null {
  for (const g of spec?.groups ?? []) for (const r of g.rows) if (r.key === key) return r.value;
  return null;
}
const numAttr = (spec: SpecJson | null, key: string) => {
  const v = attrOf(spec, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function toCatalogPrice(r: Row): CatalogPrice {
  const spec = (r.spec ?? null) as SpecJson | null;
  const price = num(r.price);
  const packQty = num(r.packQty) ?? 1;
  let per_sqft: number | null = null;
  if (r.category === 'tiles' && price) {
    const cov =
      numAttr(spec, 'coverage_per_box_sqft') ??
      (numAttr(spec, 'coverage_per_box_sqm') !== null ? (numAttr(spec, 'coverage_per_box_sqm') as number) * 10.7639 : null);
    if (cov && cov > 0) per_sqft = price / cov;
    else {
      const direct = numAttr(spec, 'price_per_sqft');
      if (direct) per_sqft = direct;
    }
  }
  if (r.category === 'glass' && price) per_sqft = r.unit === 'sqft' ? price / packQty : (numAttr(spec, 'price_per_sqft') ?? null);
  const wp = r.category === 'solar-panels' ? numAttr(spec, 'rated_power_wp') : null;
  // product names usually start with the brand ("UltraTech PPC Cement") — the engine prefixes the brand itself
  const brandWords = r.brand.replace(/\s*\(.*\)\s*$/, '').trim();
  const bare = r.name
    .replace(new RegExp(`^${brandWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '')
    .replace(new RegExp(`^${r.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '');
  return {
    sku_code: r.code,
    category: r.category,
    name: `${bare}${r.variant ? ` — ${r.variant}` : ''}`,
    brand: r.brand,
    unit: r.unit,
    selling_price: price,
    price_provenance: r.prov,
    per_sqft,
    wp,
    in_stock: r.stock !== 'out_of_stock',
  };
}

export async function loadCalculatorCatalog(extraCodes: string[] = []): Promise<CatalogPrices> {
  const out: CatalogPrices = {};
  try {
    const codes = new Set(extraCodes.filter((c) => /^[A-Z0-9-]{3,32}$/.test(c)));
    for (const e of Object.values(CATALOG_MAP)) for (const c of Object.values(e.codes ?? {})) if (c) codes.add(c);
    if (codes.size) for (const r of await base().where(inArray(skus.skuCode, [...codes]))) out[r.code] = toCatalogPrice(r as Row);
    // Rank fallbacks per mapped category: cheapest, dearest, and the first SKU at or above the price midpoint.
    for (const e of Object.values(CATALOG_MAP)) {
      const where = and(eq(categories.slug, e.category), isNotNull(skus.sellingPrice));
      const [lo] = await base().where(where).orderBy(asc(skus.sellingPrice)).limit(1);
      const [hi] = await base().where(where).orderBy(desc(skus.sellingPrice)).limit(1);
      if (!lo || !hi) continue;
      out[lo.code] = toCatalogPrice(lo as Row);
      out[hi.code] = toCatalogPrice(hi as Row);
      const mid = ((num(lo.price) ?? 0) + (num(hi.price) ?? 0)) / 2;
      const [md] = await base()
        .where(and(where, gte(skus.sellingPrice, String(mid))))
        .orderBy(asc(skus.sellingPrice))
        .limit(1);
      if (md) out[md.code] = toCatalogPrice(md as Row);
    }
  } catch (e) {
    console.warn('[estimator] catalogue snapshot unavailable, seed rates apply:', (e as Error).message);
  }
  return out;
}
