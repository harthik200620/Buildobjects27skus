import 'server-only';
import {
  detectScript,
  type FacetConfig,
  type FilterState,
  imageKey,
  type KeySpec,
  SEARCH_INDEX,
  type SkuSearchDoc,
  type SpecJson,
} from '@buildobjects/catalog';
import { brands, categories, filterConfigs, getDb, num, products, skuDocuments, skuImages, skus } from '@buildobjects/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import { MeiliSearch } from 'meilisearch';
import { memo, memoOnce } from './cache';
import { esc, sortParam, toMeiliFilter } from './filters';

let client: MeiliSearch | null = null;
export function meili(): MeiliSearch {
  if (!client) client = new MeiliSearch({ host: process.env.MEILI_HOST ?? 'http://127.0.0.1:7700', apiKey: process.env.MEILI_MASTER_KEY });
  return client;
}

/* ── query normalisation: NFC, lowercase, Indic hints → Latin token appended ── */
const INDIC_HINTS: [RegExp, string][] = [
  [/సిమెంట్|सीमेंट/u, 'cement'],
  [/బల్బు|बल्ब|దీపం/u, 'bulb'],
  [/టైల్|टाइल/u, 'tiles'],
  [/గాజు|అద్దం|कांच|शीशा/u, 'glass'],
  [/కెమెరా|कैमरा|సీసీటీవీ|सीसीटीवी/u, 'cctv'],
  [/సోలార్|सोलर|सौर/u, 'solar panel'],
  [/అగ్నిమాపక|अग्निशामक/u, 'fire extinguisher'],
  [/ఎపాక్సీ|एपॉक्सी|रिसाव|వాటర్/u, 'epoxy'],
  [/టోటల్|टोटल|సర్వే|सर्वे/u, 'total station'],
];
export function normalizeQuery(q: string): string {
  let s = q.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (detectScript(s) !== 'latin') for (const [re, term] of INDIC_HINTS) if (re.test(s) && !s.includes(term)) s = `${s} ${term}`;
  return s;
}

export interface SearchResult {
  hits: SkuSearchDoc[];
  total: number;
  page: number;
  totalPages: number;
  facetDistribution: Record<string, Record<string, number>>;
  facetStats: Record<string, { min: number; max: number }>;
  processingTimeMs: number;
  query: string;
}

export async function searchSkus(opts: {
  state: FilterState & { q: string; page: number; category?: string };
  config: FacetConfig | null;
  fixedCategory?: string;
  hitsPerPage?: number;
  facets?: string[];
}): Promise<SearchResult> {
  const { state, config } = opts;
  const facets = opts.facets ?? [
    'category',
    'brand',
    'in_stock',
    ...(config?.facets ?? []).filter((f) => !['brand', 'price', 'stock'].includes(f.key)).map((f) => f.attr),
    'selling_price',
  ];
  try {
    const res = await meili()
      .index<SkuSearchDoc>(SEARCH_INDEX)
      .search(normalizeQuery(state.q), {
        filter: toMeiliFilter(state, config, opts.fixedCategory),
        facets: Array.from(new Set(facets)),
        sort: sortParam(state.sort),
        page: state.page,
        hitsPerPage: opts.hitsPerPage ?? 24,
        attributesToHighlight: ['name', 'brand'],
        highlightPreTag: '<mark class="hl">',
        highlightPostTag: '</mark>',
      });
    return {
      hits: res.hits,
      total: res.totalHits ?? res.hits.length,
      page: res.page ?? 1,
      totalPages: res.totalPages ?? 1,
      facetDistribution: (res.facetDistribution ?? {}) as Record<string, Record<string, number>>,
      facetStats: (res.facetStats ?? {}) as Record<string, { min: number; max: number }>,
      processingTimeMs: res.processingTimeMs,
      query: state.q,
    };
  } catch (e) {
    console.warn('[search] meilisearch unavailable:', (e as Error).message);
    return { hits: [], total: 0, page: 1, totalPages: 1, facetDistribution: {}, facetStats: {}, processingTimeMs: 0, query: state.q };
  }
}

export async function loadFacetConfig(categorySlug: string): Promise<FacetConfig | null> {
  try {
    const [row] = await getDb()
      .select({ config: filterConfigs.config })
      .from(filterConfigs)
      .innerJoin(categories, eq(filterConfigs.categoryId, categories.id))
      .where(eq(categories.slug, categorySlug));
    return (row?.config as FacetConfig) ?? null;
  } catch {
    return null;
  }
}

export interface SkuImageView {
  position: number;
  role: string;
  alt: string;
  placeholder: boolean;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  thumb: string;
  card: string;
  gallery: string;
  zoom: string;
}
export interface SkuPageData {
  sku: {
    id: number;
    code: string;
    variant: string;
    mrp: number | null;
    price: number | null;
    priceProvenance: string;
    priceSourceUrl: string | null;
    priceNote: string | null;
    priceFetchedAt: Date | null;
    gstRate: number;
    gstNeedsVerification: boolean;
    unit: string;
    packQty: number;
    stock: string;
    short: string;
    long: string;
    keySpecs: KeySpec[];
    specJson: SpecJson | null;
    rating: number;
    officialUrl: string | null;
    coverage: Record<string, unknown> | null;
    seo: Record<string, unknown> | null;
  };
  product: { name: string; slug: string; modelNo: string | null };
  brand: {
    slug: string;
    name: string;
    logoKey: string | null;
    domains: string[];
    intel: Record<string, { value: unknown; provenance: string; source_url: string | null }>;
  };
  category: { slug: string; name: string; nameTe: string | null; nameHi: string | null; icon: string | null; unit: string | null };
  images: SkuImageView[];
  documents: { id: number; type: string; title: string; key: string; pages: number | null; sizeKb: number | null; sourceUrl: string | null }[];
  dims: { w: number; h: number; d: number } | null;
}

/**
 * One read serves `generateMetadata` and the page body of the same request, and every other
 * request for that SKU inside the TTL. Keyed on the upper-cased code so `/p/cem-ult-ppc50` and
 * `/p/CEM-ULT-PPC50` share an entry.
 */
const skuPage = memo((code: string) => loadSkuPageUncached(code), { max: 5_000 });
export const loadSkuPage = (code: string): Promise<SkuPageData | null> => skuPage(code.toUpperCase());

async function loadSkuPageUncached(code: string): Promise<SkuPageData | null> {
  const db = getDb();
  const [row] = await db
    .select({ sku: skus, product: products, brand: brands, category: categories })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(skus.skuCode, code.toUpperCase()))
    .limit(1);
  if (!row) return null;
  const [imgs, docs] = await Promise.all([
    db.select().from(skuImages).where(eq(skuImages.skuId, row.sku.id)).orderBy(asc(skuImages.position)),
    db.select().from(skuDocuments).where(eq(skuDocuments.skuId, row.sku.id)),
  ]);
  const spec = row.sku.specJson as SpecJson | null;
  const dimOf = (k: string) => {
    for (const g of spec?.groups ?? []) for (const r of g.rows) if (r.key === k && typeof r.value === 'number') return r.value;
    return null;
  };
  const w = dimOf('dim_w_mm'),
    h = dimOf('dim_h_mm'),
    d = dimOf('dim_d_mm');
  return {
    sku: {
      id: row.sku.id,
      code: row.sku.skuCode,
      variant: row.sku.variantLabel,
      mrp: num(row.sku.mrp),
      price: num(row.sku.sellingPrice),
      priceProvenance: row.sku.priceProvenance,
      priceSourceUrl: row.sku.priceSourceUrl,
      priceNote: row.sku.priceNote,
      priceFetchedAt: row.sku.priceFetchedAt,
      gstRate: num(row.sku.gstRate) ?? 18,
      gstNeedsVerification: row.sku.gstNeedsVerification,
      unit: row.sku.unit,
      packQty: num(row.sku.packQty) ?? 1,
      stock: row.sku.stockStatus,
      short: row.sku.shortDescription,
      long: row.sku.longDescription ?? '',
      keySpecs: (row.sku.keySpecs ?? []) as KeySpec[],
      specJson: spec,
      rating: num(row.sku.ratingPlaceholder) ?? 4.3,
      officialUrl: row.sku.officialUrl,
      coverage: row.sku.coverage as Record<string, unknown> | null,
      seo: row.sku.seo as Record<string, unknown> | null,
    },
    product: { name: row.product.name, slug: row.product.slug, modelNo: row.product.modelNo },
    brand: {
      slug: row.brand.slug,
      name: row.brand.name,
      logoKey: row.brand.logoKey,
      domains: row.brand.officialDomains ?? [],
      intel: (row.brand.intel ?? {}) as SkuPageData['brand']['intel'],
    },
    category: {
      slug: row.category.slug,
      name: row.category.name,
      nameTe: row.category.nameTe,
      nameHi: row.category.nameHi,
      icon: row.category.icon,
      unit: row.category.unit,
    },
    images: imgs.map((i) => ({
      position: i.position,
      role: i.role,
      alt: i.alt,
      placeholder: i.placeholder,
      width: i.width,
      height: i.height,
      blurhash: i.blurhash,
      thumb: imageKey(row.sku.skuCode, i.position, 'thumb'),
      card: imageKey(row.sku.skuCode, i.position, 'card'),
      gallery: imageKey(row.sku.skuCode, i.position, 'gallery'),
      zoom: imageKey(row.sku.skuCode, i.position, 'zoom'),
    })),
    documents: docs.map((d) => ({ id: d.id, type: d.type, title: d.title, key: d.storageKey, pages: d.pages, sizeKb: d.sizeKb, sourceUrl: d.sourceUrl })),
    dims: w && h && d ? { w, h, d } : null,
  };
}

/** Other brands in the same category, in card shape — the 'similar products' row on a PDP. */
const similar = memo(
  async (key: string): Promise<SkuSearchDoc[]> => {
    const [categorySlug, brandSlug, limit] = JSON.parse(key) as [string, string, number];
    try {
      const res = await meili()
        .index<SkuSearchDoc>(SEARCH_INDEX)
        .search('', {
          filter: [`category = ${esc(categorySlug)}`, `brand_slug != ${esc(brandSlug)}`],
          limit,
        });
      return res.hits;
    } catch {
      return [];
    }
  },
  { max: 5_000 },
);

export function similarSkus(categorySlug: string, brandSlug: string, limit = 8): Promise<SkuSearchDoc[]> {
  return similar(JSON.stringify([categorySlug, brandSlug, limit]));
}

export async function skuDocsByCodes(codes: string[]): Promise<SkuSearchDoc[]> {
  if (!codes.length) return [];
  try {
    const res = await meili()
      .index<SkuSearchDoc>(SEARCH_INDEX)
      .search('', { filter: [`sku_code IN [${codes.map(esc).join(', ')}]`], limit: codes.length });
    return res.hits;
  } catch {
    return [];
  }
}

/** Instant-search suggestions: SKUs + categories + brands, one multi-search round trip. */
export async function suggest(q: string): Promise<{
  skus: SkuSearchDoc[];
  categories: { slug: string; name: string; nameTe: string | null }[];
  brands: { slug: string; name: string }[];
  ms: number;
}> {
  const nq = normalizeQuery(q);
  const t0 = Date.now();
  const [res, cats, brs] = await Promise.all([
    meili()
      .index<SkuSearchDoc>(SEARCH_INDEX)
      .search(nq, { limit: 6, attributesToHighlight: ['name', 'brand'], highlightPreTag: '<mark class="hl">', highlightPostTag: '</mark>' })
      .catch(() => ({ hits: [] as SkuSearchDoc[] })),
    allCategories(),
    allBrands(),
  ]);
  const tokens = nq.split(' ').filter(Boolean);
  const matchName = (s: string) => tokens.some((t) => t.length >= 2 && s.toLowerCase().includes(t));
  const hitCats = new Set(res.hits.map((h) => h.category));
  const categoriesOut = cats
    .filter((c) => hitCats.has(c.slug) || matchName(c.name) || (c.nameTe && nq.includes(c.nameTe)) || (c.nameHi && nq.includes(c.nameHi)))
    .slice(0, 3);
  const hitBrands = new Set(res.hits.map((h) => h.brand_slug));
  const brandsOut = brs.filter((b) => hitBrands.has(b.slug) || matchName(b.name)).slice(0, 3);
  return { skus: res.hits, categories: categoriesOut.map((c) => ({ slug: c.slug, name: c.name, nameTe: c.nameTe })), brands: brandsOut, ms: Date.now() - t0 };
}

const categoryIdOf = memo(
  async (slug: string): Promise<number | null> => {
    try {
      const [c] = await getDb().select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
      return c?.id ?? null;
    } catch {
      return null;
    }
  },
  { max: 500 },
);

export interface CategoryRef {
  slug: string;
  name: string;
  nameTe: string | null;
  nameHi: string | null;
  icon: string | null;
  department: string;
  status: 'live' | 'upcoming';
}

/** Nav, footer and suggestion lists all want the same small list — one read per TTL serves them. */
export const allCategories = memoOnce(async (): Promise<CategoryRef[]> => {
  try {
    return await getDb()
      .select({
        slug: categories.slug,
        name: categories.name,
        nameTe: categories.nameTe,
        nameHi: categories.nameHi,
        icon: categories.icon,
        department: categories.department,
        status: categories.status,
      })
      .from(categories)
      .orderBy(asc(categories.displayOrder));
  } catch {
    return [];
  }
});

export const allBrands = memoOnce(async (): Promise<{ slug: string; name: string }[]> => {
  try {
    return await getDb().select({ slug: brands.slug, name: brands.name }).from(brands).orderBy(asc(brands.name));
  } catch {
    return [];
  }
});

/** Keyset-paginated SKU list straight from MySQL (the scale-proof API): WHERE id > ? LIMIT n. */
export async function listSkusKeyset(opts: { category?: string; after?: number; limit?: number }) {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 200);
  const conds = [gt(skus.id, opts.after ?? 0)];
  if (opts.category) {
    const catId = await categoryIdOf(opts.category);
    if (catId === null) return { items: [], next: null };
    conds.push(eq(skus.categoryId, catId));
  }
  const rows = await db
    .select({
      id: skus.id,
      sku_code: skus.skuCode,
      name: products.name,
      variant: skus.variantLabel,
      brand: brands.name,
      brand_slug: brands.slug,
      category: categories.slug,
      selling_price: skus.sellingPrice,
      mrp: skus.mrp,
      unit: skus.unit,
      stock: skus.stockStatus,
      hero_image_key: skus.heroImageKey,
      blurhash: skus.blurhash,
      key_specs: skus.keySpecs,
    })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conds))
    .orderBy(asc(skus.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({ ...r, selling_price: num(r.selling_price), mrp: num(r.mrp) }));
  return { items, next: hasMore ? items[items.length - 1].id : null };
}

/** The home page showcase grid: an unfiltered slice of the index, in index (relevance) order. */
export async function loadFlagshipSkus(limit = 36): Promise<SkuSearchDoc[]> {
  try {
    const res = await meili().index<SkuSearchDoc>(SEARCH_INDEX).search('', { limit });
    return res.hits;
  } catch (e) {
    console.warn('[catalog] meilisearch unavailable, home grid empty:', (e as Error).message);
    return [];
  }
}
