/**
 * MySQL 8 schema — "EAV registry for writes, filters and admin; JSON read-model for renders."
 *
 * A PDP render is one `skus` row (spec_json + key_specs + images). Faceting never touches
 * MySQL (Meilisearch). `sku_attribute_values` is the source of truth that regenerates both.
 * Every id is BIGINT auto-inc; every list endpoint paginates by keyset (`WHERE id > ? LIMIT n`).
 */

import type { ImageJudgement, KeySpec, SpecJson } from '@buildobjects/catalog';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  decimal,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

const id = () => bigint('id', { mode: 'number' }).autoincrement().primaryKey();
const createdAt = () => timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () => timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow();

export const categories = mysqlTable(
  'categories',
  {
    id: id(),
    slug: varchar('slug', { length: 64 }).notNull(),
    code: varchar('code', { length: 8 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    nameTe: varchar('name_te', { length: 160 }),
    nameHi: varchar('name_hi', { length: 160 }),
    icon: varchar('icon', { length: 48 }),
    heroImageKey: varchar('hero_image_key', { length: 255 }),
    /** Department the category sits under in the nav — column A of the specification workbook. */
    department: varchar('department', { length: 64 }).notNull().default('construction-materials'),
    /**
     * `live` = the catalogue sells it today; `upcoming` = it is in the taxonomy with no products.
     * The storefront shows all thirty-seven either way — an upcoming category is a promise the
     * buyer can see, not a dead link — so the difference has to be a column and not an absence.
     */
    status: mysqlEnum('status', ['live', 'upcoming']).notNull().default('upcoming'),
    displayOrder: int('display_order').notNull().default(0),
    unit: varchar('unit', { length: 24 }),
    specTemplateVersion: int('spec_template_version').notNull().default(1),
    /**
     * Read-model maintained by the indexer: { sku_count, in_stock, min_price, max_price } — never computed at request time.
     * Images v2 adds `hero_sku` / `hero_image_key`: the best in-stock hero of the category (quality_score DESC) — a real photo
     * (cut-out card when one exists) for the category tile; both null when no SKU in the category has a photo yet.
     */
    stats: json('stats').$type<{
      sku_count: number;
      in_stock: number;
      min_price: number | null;
      max_price: number | null;
      computed_at: string;
      hero_sku?: string | null;
      hero_image_key?: string | null;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('categories_slug_uq').on(t.slug),
    index('categories_order_idx').on(t.displayOrder),
    index('categories_dept_idx').on(t.department, t.displayOrder),
  ],
);

export const brands = mysqlTable(
  'brands',
  {
    id: id(),
    slug: varchar('slug', { length: 64 }).notNull(),
    code: varchar('code', { length: 8 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    logoKey: varchar('logo_key', { length: 255 }),
    officialDomains: json('official_domains').$type<string[]>().notNull().default([]),
    /** DAY-1 brand-intelligence block; every leaf {value, provenance, source_url}. */
    intel: json('intel').$type<Record<string, { value: unknown; provenance: string; source_url: string | null }>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('brands_slug_uq').on(t.slug)],
);

export const products = mysqlTable(
  'products',
  {
    id: id(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => categories.id),
    brandId: bigint('brand_id', { mode: 'number' })
      .notNull()
      .references(() => brands.id),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    modelNo: varchar('model_no', { length: 120 }),
    status: mysqlEnum('status', ['active', 'draft', 'retired']).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('products_slug_uq').on(t.slug), index('products_cat_brand_idx').on(t.categoryId, t.brandId)],
);

export const skus = mysqlTable(
  'skus',
  {
    id: id(),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    /** Denormalised from products so a category listing is one covering index range (category_id, id) — never a join + sort at 400k rows. */
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    skuCode: varchar('sku_code', { length: 32 }).notNull(),
    variantLabel: varchar('variant_label', { length: 120 }).notNull().default(''),
    mrp: decimal('mrp', { precision: 12, scale: 2 }),
    sellingPrice: decimal('selling_price', { precision: 12, scale: 2 }),
    priceProvenance: mysqlEnum('price_provenance', ['fetched', 'verified', 'estimated']).notNull().default('estimated'),
    priceSourceUrl: text('price_source_url'),
    priceNote: varchar('price_note', { length: 255 }),
    priceFetchedAt: datetime('price_fetched_at'),
    /** When the price stage last checked the price against the web (fetched or not). `ensureRows` keeps the stage's result over the curated price while this is newer than the curated fetched_at. */
    priceCheckedAt: datetime('price_checked_at'),
    gstRate: decimal('gst_rate', { precision: 5, scale: 2 }).notNull().default('18.00'),
    gstNeedsVerification: boolean('gst_needs_verification').notNull().default(false),
    unit: varchar('unit', { length: 24 }).notNull().default('piece'),
    packQty: decimal('pack_qty', { precision: 10, scale: 3 }).notNull().default('1'),
    stockStatus: mysqlEnum('stock_status', ['in_stock', 'low', 'out_of_stock', 'preorder']).notNull().default('in_stock'),
    shortDescription: varchar('short_description', { length: 200 }).notNull().default(''),
    longDescription: mediumtext('long_description'),
    keySpecs: json('key_specs').$type<KeySpec[]>().notNull().default([]),
    /** The FULL denormalised spec tree by group — regenerated on every write. Reads never touch EAV. */
    specJson: json('spec_json').$type<SpecJson>(),
    seo: json('seo').$type<{ title?: string; meta_description?: string; keywords?: string[]; keywords_te?: string[]; keywords_hi?: string[] }>(),
    heroImageKey: varchar('hero_image_key', { length: 255 }),
    blurhash: varchar('blurhash', { length: 64 }),
    ratingPlaceholder: decimal('rating_placeholder', { precision: 2, scale: 1 }).notNull().default('4.3'),
    officialUrl: text('official_url'),
    /**
     * Stable per-SKU ingest summary: % filled by provenance, image count, brochure flag. Images v2: `real_images` (never a
     * placeholder — `placeholders` stays for old readers and is always 0), `hero_px` (long edge of the stored hero source,
     * null without a photo), `cutouts` (alpha cut-outs written).
     */
    coverage: json('coverage').$type<{
      filled: number;
      total: number;
      by_provenance: Record<string, number>;
      images: number;
      placeholders: number;
      brochures: number;
      computed_at: string;
      real_images?: number;
      hero_px?: number | null;
      cutouts?: number;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('skus_code_uq').on(t.skuCode),
    index('skus_product_idx').on(t.productId),
    index('skus_cat_id_idx').on(t.categoryId, t.id),
    index('skus_cat_stock_id_idx').on(t.categoryId, t.stockStatus, t.id),
    index('skus_price_idx').on(t.sellingPrice),
  ],
);

export const attributeGroups = mysqlTable(
  'attribute_groups',
  {
    id: id(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => categories.id),
    key: varchar('key', { length: 48 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    displayOrder: int('display_order').notNull().default(0),
    importance: tinyint('importance').notNull().default(3),
  },
  (t) => [uniqueIndex('attr_groups_cat_key_uq').on(t.categoryId, t.key)],
);

export const attributes = mysqlTable(
  'attributes',
  {
    id: id(),
    groupId: bigint('group_id', { mode: 'number' })
      .notNull()
      .references(() => attributeGroups.id),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => categories.id),
    key: varchar('key', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    dataType: mysqlEnum('data_type', ['text', 'number', 'boolean', 'enum']).notNull().default('text'),
    unit: varchar('unit', { length: 24 }),
    enumValues: json('enum_values').$type<string[]>(),
    isFilterable: boolean('is_filterable').notNull().default(false),
    filterWidget: mysqlEnum('filter_widget', ['checkbox', 'range', 'toggle', 'chips']),
    filterOrder: int('filter_order').notNull().default(100),
    importanceRank: tinyint('importance_rank').notNull().default(3),
    showInKeySpecs: boolean('show_in_key_specs').notNull().default(false),
    showOnCard: boolean('show_on_card').notNull().default(false),
    compare: boolean('compare').notNull().default(false),
    synonyms: json('synonyms').$type<string[]>().notNull().default([]),
    displayOrder: int('display_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('attributes_cat_key_uq').on(t.categoryId, t.key),
    index('attributes_cat_filterable_idx').on(t.categoryId, t.isFilterable),
    index('attributes_group_idx').on(t.groupId),
  ],
);

export const skuAttributeValues = mysqlTable(
  'sku_attribute_values',
  {
    skuId: bigint('sku_id', { mode: 'number' })
      .notNull()
      .references(() => skus.id),
    attributeId: bigint('attribute_id', { mode: 'number' })
      .notNull()
      .references(() => attributes.id),
    valueText: varchar('value_text', { length: 1024 }),
    valueNumber: decimal('value_number', { precision: 18, scale: 6 }),
    valueBool: boolean('value_bool'),
    unitOverride: varchar('unit_override', { length: 24 }),
    provenance: mysqlEnum('provenance', ['fetched', 'verified', 'ai_filled', 'derived']).notNull().default('ai_filled'),
    confidence: decimal('confidence', { precision: 3, scale: 2 }),
    sourceUrl: text('source_url'),
    fetchedAt: datetime('fetched_at'),
    /** Canonicalisation / coercion / AI-fill basis — why the stored value differs from what the source said. */
    note: varchar('note', { length: 512 }),
  },
  (t) => [
    primaryKey({ columns: [t.skuId, t.attributeId] }),
    index('sav_attr_number_idx').on(t.attributeId, t.valueNumber),
    // (attribute_id, value_text(64)) prefix index is created in migrate.ts — drizzle has no prefix-length syntax.
    index('sav_provenance_idx').on(t.provenance),
  ],
);

export const skuImages = mysqlTable(
  'sku_images',
  {
    id: id(),
    skuId: bigint('sku_id', { mode: 'number' })
      .notNull()
      .references(() => skus.id),
    position: tinyint('position').notNull(),
    role: mysqlEnum('role', ['hero', 'angle', 'in_context', 'detail', 'pack_or_dimensions']).notNull(),
    alt: varchar('alt', { length: 255 }).notNull().default(''),
    sourceUrl: text('source_url'),
    width: int('width'),
    height: int('height'),
    blurhash: varchar('blurhash', { length: 64 }),
    storageKeyOriginal: varchar('storage_key_original', { length: 255 }).notNull(),
    /** Always false since images v2 — no placeholder is ever written; kept for old readers. */
    placeholder: boolean('placeholder').notNull().default(false),
    /** Images v2: where the photo came from (shown in the UI for distributor images). */
    sourceKind: mysqlEnum('source_kind', ['curated', 'official_page', 'official_pdf', 'distributor', 'unknown']).notNull().default('unknown'),
    /** Deterministic judge score 0–1 (see @buildobjects/catalog ImageJudgement). */
    qualityScore: decimal('quality_score', { precision: 3, scale: 2 }),
    judgeJson: json('judge_json').$type<ImageJudgement>(),
    /** `{pos}-cutout-card.webp` when an alpha cut-out passed QA; the 1024-px PNG is the same key with size `cutout`. */
    cutoutKey: varchar('cutout_key', { length: 255 }),
    /** Source long edge < 1600 px — served as-is (withoutEnlargement), the lens is hidden under this. */
    soft: boolean('soft').notNull().default(false),
    /** 64-bit dHash as 16 hex chars — near-duplicate detection across runs. */
    phash: varchar('phash', { length: 16 }),
    /** sha1 of the source bytes — judge cache key and exact-duplicate detection. */
    sourceSha1: varchar('source_sha1', { length: 40 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sku_images_pos_uq').on(t.skuId, t.position), index('sku_images_quality_idx').on(t.qualityScore)],
);

export const skuDocuments = mysqlTable(
  'sku_documents',
  {
    id: id(),
    skuId: bigint('sku_id', { mode: 'number' })
      .notNull()
      .references(() => skus.id),
    type: mysqlEnum('type', ['brochure', 'datasheet', 'manual', 'warranty_card', 'certificate']).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    sourceUrl: text('source_url'),
    pages: int('pages'),
    sizeKb: int('size_kb'),
    createdAt: createdAt(),
  },
  (t) => [index('sku_documents_sku_idx').on(t.skuId)],
);

export const filterConfigs = mysqlTable('filter_configs', {
  categoryId: bigint('category_id', { mode: 'number' })
    .primaryKey()
    .references(() => categories.id),
  config: json('config').notNull(),
  computedAt: datetime('computed_at').notNull(),
});

export const ingestRuns = mysqlTable('ingest_runs', {
  id: id(),
  startedAt: datetime('started_at').notNull(),
  finishedAt: datetime('finished_at'),
  status: mysqlEnum('status', ['running', 'done', 'failed', 'aborted']).notNull().default('running'),
  scope: json('scope').$type<{ category?: string; sku?: string; stage?: string; resume?: boolean; driver?: string }>().notNull().default({}),
  summary: json('summary'),
});

export const ingestItems = mysqlTable(
  'ingest_items',
  {
    id: id(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => ingestRuns.id),
    skuCode: varchar('sku_code', { length: 32 }).notNull(),
    stage: varchar('stage', { length: 24 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'done', 'failed', 'skipped']).notNull().default('queued'),
    attempts: int('attempts').notNull().default(0),
    error: text('error'),
    startedAt: datetime('started_at'),
    finishedAt: datetime('finished_at'),
    durationMs: int('duration_ms'),
    meta: json('meta'),
  },
  (t) => [index('ingest_items_run_sku_idx').on(t.runId, t.skuCode), index('ingest_items_sku_stage_idx').on(t.skuCode, t.stage)],
);

export const estimates = mysqlTable(
  'estimates',
  {
    id: id(),
    publicId: varchar('public_id', { length: 16 }).notNull(),
    inputs: json('inputs').notNull(),
    outputs: json('outputs').notNull(),
    tier: varchar('tier', { length: 12 }).notNull(),
    city: varchar('city', { length: 48 }).notNull(),
    grandTotal: decimal('grand_total', { precision: 14, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('estimates_public_uq').on(t.publicId)],
);

export const searchSynonyms = mysqlTable(
  'search_synonyms',
  {
    id: id(),
    term: varchar('term', { length: 120 }).notNull(),
    synonyms: json('synonyms').$type<string[]>().notNull(),
    lang: varchar('lang', { length: 8 }).notNull().default('en'),
    categorySlug: varchar('category_slug', { length: 64 }),
  },
  (t) => [index('search_synonyms_term_idx').on(t.term)],
);

export const gstRates = mysqlTable(
  'gst_rates',
  {
    id: id(),
    categorySlug: varchar('category_slug', { length: 64 }).notNull(),
    hsn: varchar('hsn', { length: 16 }).notNull(),
    rate: decimal('rate', { precision: 5, scale: 2 }).notNull(),
    source: varchar('source', { length: 255 }),
    verifiedAt: datetime('verified_at'),
    needsVerification: boolean('needs_verification').notNull().default(true),
  },
  (t) => [uniqueIndex('gst_rates_cat_uq').on(t.categorySlug)],
);

export const regions = mysqlTable(
  'regions',
  {
    id: id(),
    regionId: varchar('region_id', { length: 24 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    stateCode: varchar('state_code', { length: 4 }).notNull(),
    pincodeFrom: varchar('pincode_from', { length: 6 }).notNull(),
    pincodeTo: varchar('pincode_to', { length: 6 }).notNull(),
    defaultPincode: varchar('default_pincode', { length: 6 }).notNull(),
    serviceable: boolean('serviceable').notNull().default(true),
    deliveryDays: tinyint('delivery_days').notNull().default(3),
  },
  (t) => [uniqueIndex('regions_region_uq').on(t.regionId)],
);

export const users = mysqlTable(
  'users',
  {
    id: id(),
    phone: varchar('phone', { length: 16 }).notNull(),
    createdAt: createdAt(),
    lastLoginAt: datetime('last_login_at'),
  },
  (t) => [uniqueIndex('users_phone_uq').on(t.phone)],
);

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    regionId: varchar('region_id', { length: 24 }),
    pincode: varchar('pincode', { length: 6 }),
    createdAt: createdAt(),
    expiresAt: datetime('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const otpChallenges = mysqlTable(
  'otp_challenges',
  {
    id: id(),
    phone: varchar('phone', { length: 16 }).notNull(),
    code: varchar('code', { length: 8 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    consumed: boolean('consumed').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('otp_phone_idx').on(t.phone)],
);

export type Category = typeof categories.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Sku = typeof skus.$inferSelect;
export type Attribute = typeof attributes.$inferSelect;
export type AttributeGroup = typeof attributeGroups.$inferSelect;
export type SkuAttributeValue = typeof skuAttributeValues.$inferSelect;
export type SkuImage = typeof skuImages.$inferSelect;
export type SkuDocument = typeof skuDocuments.$inferSelect;
export type Region = typeof regions.$inferSelect;
