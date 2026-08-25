/**
 * Read-model regeneration: spec_json (the full sheet by group), key_specs (the 8 rows a buyer
 * checks first), card specs, coverage, the Meilisearch document, and category stats.
 * Reads EAV once per SKU; everything a page renders comes out of here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatSpecValue, type KeySpec, type Provenance, type SkuSearchDoc, type SpecGroup, type SpecJson, type SpecRow } from '@buildobjects/catalog';
import { attributeGroups, attributes, brands, categories, getDb, num, products, skuAttributeValues, skuDocuments, skuImages, skus } from '@buildobjects/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { ASSETS_3D_DIR } from './config';

/** Argument order kept for the pipeline's call sites; the rule itself lives in @buildobjects/catalog. */
export const formatValue = (value: string | number | boolean, dataType: string, unit: string | null): string => formatSpecValue(value, unit, dataType);

let manifestCache: Record<string, unknown> | null = null;
function arAvailable(skuCode: string): boolean {
  if (!manifestCache) {
    try {
      manifestCache = JSON.parse(fs.readFileSync(path.join(ASSETS_3D_DIR, 'manifest.json'), 'utf8')).assets ?? {};
    } catch {
      manifestCache = {};
    }
  }
  return !!manifestCache![skuCode];
}
export function resetManifestCache() {
  manifestCache = null;
}

export interface RebuiltSku {
  doc: SkuSearchDoc;
  specJson: SpecJson;
  keySpecs: KeySpec[];
}

/** Rebuild one SKU's read-model rows and return its search document. */
export async function rebuildSku(skuId: number): Promise<RebuiltSku> {
  const db = getDb();
  const [row] = await db
    .select({
      sku: skus,
      product: products,
      brand: brands,
      category: categories,
    })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(skus.id, skuId));
  if (!row) throw new Error(`sku ${skuId} not found`);
  const groups = await db.select().from(attributeGroups).where(eq(attributeGroups.categoryId, row.category.id)).orderBy(asc(attributeGroups.displayOrder));
  const attrs = await db.select().from(attributes).where(eq(attributes.categoryId, row.category.id)).orderBy(asc(attributes.displayOrder));
  const vals = await db.select().from(skuAttributeValues).where(eq(skuAttributeValues.skuId, skuId));
  const valByAttr = new Map(vals.map((v) => [v.attributeId, v]));

  const rowsByGroup = new Map<number, SpecRow[]>();
  const byProv: Record<Provenance, number> = { fetched: 0, verified: 0, ai_filled: 0, derived: 0 };
  const valueByKey = new Map<string, { value: string | number | boolean; unit: string | null; dataType: string; label: string; raw: SpecRow }>();
  for (const a of attrs) {
    const v = valByAttr.get(a.id);
    if (!v) continue;
    const value: string | number | boolean | null =
      a.dataType === 'number' ? (v.valueNumber !== null ? num(v.valueNumber) : v.valueText) : a.dataType === 'boolean' ? v.valueBool : v.valueText;
    if (value === null || value === undefined || value === '') continue;
    const unit = v.unitOverride ?? a.unit;
    const r: SpecRow = {
      key: a.key,
      label: a.label,
      value,
      unit,
      data_type: a.dataType,
      provenance: v.provenance,
      confidence: v.confidence !== null ? num(v.confidence) : null,
      source_url: v.sourceUrl,
      compare: a.compare,
    };
    byProv[v.provenance]++;
    (rowsByGroup.get(a.groupId) ?? rowsByGroup.set(a.groupId, []).get(a.groupId)!).push(r);
    valueByKey.set(a.key, { value, unit, dataType: a.dataType, label: a.label, raw: r });
  }
  const specGroups: SpecGroup[] = groups
    .filter((g) => rowsByGroup.has(g.id))
    .map((g) => ({
      key: g.key,
      label: g.label,
      importance: g.importance,
      rows: rowsByGroup
        .get(g.id)!
        .sort((x, y) => (attrs.find((a) => a.key === x.key)?.importanceRank ?? 5) - (attrs.find((a) => a.key === y.key)?.importanceRank ?? 5)),
    }));
  const specJson: SpecJson = { groups: specGroups, filled: valueByKey.size, total: attrs.length, by_provenance: byProv };

  // key specs: registry order first (show_in_key_specs by importance), then the seo.key_specs_order hint, then fill to 8 by importance
  const seoOrder = (row.sku.seo as { key_specs_order?: string[] } | null)?.key_specs_order ?? [];
  const ranked = [...attrs].sort((a, b) => a.importanceRank - b.importanceRank || a.displayOrder - b.displayOrder);
  const keyOrder: string[] = [];
  for (const k of [...ranked.filter((a) => a.showInKeySpecs).map((a) => a.key), ...seoOrder, ...ranked.map((a) => a.key)])
    if (valueByKey.has(k) && !keyOrder.includes(k)) keyOrder.push(k);
  const keySpecs: KeySpec[] = keyOrder.slice(0, 8).map((k) => {
    const v = valueByKey.get(k)!;
    return { key: k, label: v.label, value: formatValue(v.value, v.dataType, v.unit), unit: v.unit };
  });
  const cardSpecs = ranked
    .filter((a) => a.showOnCard && valueByKey.has(a.key))
    .slice(0, 3)
    .map((a) => {
      const v = valueByKey.get(a.key)!;
      return { label: a.label, value: formatValue(v.value, v.dataType, v.unit) };
    });

  const imgs = await db.select({ placeholder: skuImages.placeholder }).from(skuImages).where(eq(skuImages.skuId, skuId));
  const docs = await db.select({ id: skuDocuments.id }).from(skuDocuments).where(eq(skuDocuments.skuId, skuId));
  const coverage = {
    filled: valueByKey.size,
    total: attrs.length,
    by_provenance: byProv,
    images: imgs.length,
    placeholders: imgs.filter((i) => i.placeholder).length,
    brochures: docs.length,
    computed_at: new Date().toISOString(),
  };
  await db.update(skus).set({ specJson, keySpecs, coverage }).where(eq(skus.id, skuId));

  const ar = arAvailable(row.sku.skuCode);
  const doc: SkuSearchDoc = {
    id: row.sku.id,
    sku_code: row.sku.skuCode,
    slug: row.sku.skuCode.toLowerCase(),
    name: `${row.product.name}${row.sku.variantLabel ? ` ${row.sku.variantLabel}` : ''}`.trim(),
    brand: row.brand.name,
    brand_slug: row.brand.slug,
    category: row.category.slug,
    category_name: row.category.name,
    category_name_te: row.category.nameTe ?? '',
    category_name_hi: row.category.nameHi ?? '',
    model_no: row.product.modelNo ?? '',
    variant_label: row.sku.variantLabel,
    short_description: row.sku.shortDescription,
    synonyms: [
      ...((row.sku.seo as { keywords?: string[] } | null)?.keywords ?? []),
      ...((row.sku.seo as { keywords_te?: string[] } | null)?.keywords_te ?? []),
      ...((row.sku.seo as { keywords_hi?: string[] } | null)?.keywords_hi ?? []),
    ].slice(0, 40),
    spec_text: keySpecs.map((k) => k.value),
    selling_price: num(row.sku.sellingPrice),
    mrp: num(row.sku.mrp),
    price_provenance: row.sku.priceProvenance,
    unit: row.sku.unit,
    pack_qty: num(row.sku.packQty) ?? 1,
    stock: row.sku.stockStatus,
    in_stock: row.sku.stockStatus !== 'out_of_stock',
    hero_image_key: row.sku.heroImageKey,
    blurhash: row.sku.blurhash,
    cutout_key: null,
    brand_logo_key: row.brand.logoKey ?? null,
    image_count: imgs.filter((i) => !i.placeholder).length,
    card_specs: cardSpecs,
    ar,
    created_at: Math.floor(new Date(row.sku.createdAt).getTime() / 1000),
  };
  for (const a of attrs) {
    if (!a.isFilterable) continue;
    const v = valueByKey.get(a.key);
    if (!v) continue;
    doc[`attr_${a.key}`] = v.value as never;
  }
  /* Price freshness facet (facets/build.ts): epoch seconds the price was last checked, filterable as `price_fetched_at >= now − 7 d`. */
  (doc as unknown as Record<string, unknown>).price_fetched_at = row.sku.priceFetchedAt ? Math.floor(new Date(row.sku.priceFetchedAt).getTime() / 1000) : null;
  return { doc, specJson, keySpecs };
}

/** Category stats read-model: counts and price band — never computed at request time. */
export async function rebuildCategoryStats(categoryId: number) {
  const db = getDb();
  const [r] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      inStock: sql<number>`SUM(CASE WHEN ${skus.stockStatus} <> 'out_of_stock' THEN 1 ELSE 0 END)`,
      min: sql<number | null>`MIN(${skus.sellingPrice})`,
      max: sql<number | null>`MAX(${skus.sellingPrice})`,
    })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .where(eq(products.categoryId, categoryId));
  await db
    .update(categories)
    .set({
      stats: {
        sku_count: Number(r?.count ?? 0),
        in_stock: Number(r?.inStock ?? 0),
        min_price: r?.min !== null && r?.min !== undefined ? Number(r.min) : null,
        max_price: r?.max !== null && r?.max !== undefined ? Number(r.max) : null,
        computed_at: new Date().toISOString(),
      },
    })
    .where(eq(categories.id, categoryId));
}

export async function skuIdsForScope(scope: { category?: string; skuCodes?: string[] }): Promise<{ id: number; categoryId: number; code: string }[]> {
  const db = getDb();
  const q = db
    .select({ id: skus.id, categoryId: products.categoryId, code: skus.skuCode })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id));
  if (scope.skuCodes?.length) return q.where(inArray(skus.skuCode, scope.skuCodes));
  if (scope.category) return q.where(eq(categories.slug, scope.category));
  return q;
}
