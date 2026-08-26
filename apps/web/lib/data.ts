import 'server-only';
import { CATEGORIES, PRODUCT_CATEGORY } from '@buildobjects/catalog';
import { categories, getDb, products, regions as regionsTable } from '@buildobjects/db';
import { asc, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { Region } from '@/components/Welcome';
import { memoOnce } from '@/lib/cache';
import { SESSION_COOKIE, type SessionClaims, verifySession } from '@/lib/session';

/**
 * Reference-table reads shared by the shell and every page: which cities we serve, whether a
 * pincode is one of them, and who is asking. All three run on the critical path of every render,
 * so they are cached per process and degrade to a static answer rather than a 500 when the
 * database is not up yet (the front door has to render before `pnpm db:seed` has ever run).
 */

/** A serviceable city, as seeded. `deliveryDays` is the promise we print on cards and in the header. */
export interface ServiceRegion extends Region {
  serviceable: boolean;
  deliveryDays: number;
}

/**
 * Seeded fallback used only when the database is unreachable. These are the three cities the
 * welcome screen offers; the ranges match `packages/db/src/seed.ts`.
 */
const FALLBACK_REGIONS: ServiceRegion[] = [
  {
    region_id: 'hyd',
    name: 'Hyderabad',
    state_code: 'TS',
    pincode_from: '500001',
    pincode_to: '500113',
    default_pincode: '500001',
    serviceable: true,
    deliveryDays: 2,
  },
  {
    region_id: 'vij',
    name: 'Vijayawada',
    state_code: 'AP',
    pincode_from: '520001',
    pincode_to: '521456',
    default_pincode: '520001',
    serviceable: true,
    deliveryDays: 3,
  },
  {
    region_id: 'vizag',
    name: 'Visakhapatnam',
    state_code: 'AP',
    pincode_from: '530001',
    pincode_to: '531173',
    default_pincode: '530001',
    serviceable: true,
    deliveryDays: 3,
  },
];

/** Lead time for a pincode inside AP/TS that no seeded city range claims. */
const STATEWIDE_DELIVERY_DAYS = 5;

export const loadRegions = memoOnce(async (): Promise<ServiceRegion[]> => {
  try {
    const rows = await getDb().select().from(regionsTable).orderBy(asc(regionsTable.id));
    if (rows.length) {
      return rows.map((r) => ({
        region_id: r.regionId,
        name: r.name,
        state_code: r.stateCode,
        pincode_from: r.pincodeFrom,
        pincode_to: r.pincodeTo,
        default_pincode: r.defaultPincode,
        serviceable: r.serviceable,
        deliveryDays: r.deliveryDays,
      }));
    }
  } catch {
    // Before the first migration there is no table; the fallback keeps /welcome renderable.
  }
  return FALLBACK_REGIONS;
});

export interface Serviceability {
  serviceable: boolean;
  regionId: string | null;
  name: string;
  state: 'AP' | 'TS' | null;
  deliveryDays: number | null;
  note: string;
}

const OUT_OF_AREA: Serviceability = {
  serviceable: false,
  regionId: null,
  name: 'Outside AP / TS',
  state: null,
  deliveryDays: null,
  note: 'We do not deliver to this pincode yet — today we cover Andhra Pradesh and Telangana',
};

/**
 * A seeded city range wins; otherwise any Telangana (50xxxx) or Andhra Pradesh (51–53xxxx)
 * pincode gets the statewide lead time. Lead times and the serviceable flag come from the
 * `regions` row, so changing a city's promise is a seed change, not a code change.
 */
export async function serviceability(pincode: string): Promise<Serviceability> {
  const region = (await loadRegions()).find((r) => pincode >= r.pincode_from && pincode <= r.pincode_to);
  if (region) {
    if (!region.serviceable) return { ...OUT_OF_AREA, regionId: region.region_id, name: region.name, note: `We are not delivering to ${region.name} yet` };
    return {
      serviceable: true,
      regionId: region.region_id,
      name: region.name,
      state: region.state_code as 'AP' | 'TS',
      deliveryDays: region.deliveryDays,
      note: `Delivers to ${region.name} in ${region.deliveryDays} ${region.deliveryDays === 1 ? 'day' : 'days'}`,
    };
  }
  if (/^50\d{4}$/.test(pincode))
    return {
      serviceable: true,
      regionId: null,
      name: 'Telangana',
      state: 'TS',
      deliveryDays: STATEWIDE_DELIVERY_DAYS,
      note: 'Delivers across Telangana in 4–5 days',
    };
  if (/^5[1-3]\d{4}$/.test(pincode))
    return {
      serviceable: true,
      regionId: null,
      name: 'Andhra Pradesh',
      state: 'AP',
      deliveryDays: STATEWIDE_DELIVERY_DAYS,
      note: 'Delivers across Andhra Pradesh in 4–5 days',
    };
  return OUT_OF_AREA;
}

export async function loadSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** One of the thirty-five categories, with any products that sit inside it. */
export interface CategoryGroup {
  slug: string;
  name: string;
  /** The products in it — Cement inside Concreting. Empty for the twenty-six not stocked yet. */
  products: CategoryCard[];
  skuCount: number;
  brandCount: number;
  /** The lowest price in the category, so a tile can say "from ₹410" rather than "1 product". */
  fromPrice: number | null;
  /**
   * A category has no photograph of its own, so it borrows one from a product inside it — a real
   * picture of cement says "concreting" better than a drawing of the idea would. The twenty-six
   * with no products fall back to the art generated for their own row.
   */
  heroImageKey: string | null;
  status: 'live' | 'upcoming';
}

/**
 * The catalogue's top level: the thirty-five categories of `PRODUCTS LIST.xlsx`.
 *
 * Built by folding the `categories` table onto `CATEGORIES`. Twenty-six of those rows ARE a
 * category and pass straight through; nine are products and are filed under the category the
 * workbook puts them in; seven categories have no row at all and exist only here, because the
 * table was seeded before anyone noticed cement was not a category.
 *
 * No migration: the rows keep their slugs, their art and their SKUs, and this decides which of
 * the two levels each one is.
 */
/** The cheapest thing on a category's shelves, or null if nothing on them is priced. */
function minPrice(products: CategoryCard[]): number | null {
  const prices = products.map((c) => c.stats?.min_price).filter((n): n is number => typeof n === 'number' && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

export async function loadCatalogueCategories(): Promise<CategoryGroup[]> {
  const rows = await loadCategories();
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  return CATEGORIES.map(({ slug, name }) => {
    const own = bySlug.get(slug);
    const products = rows.filter((r) => PRODUCT_CATEGORY[r.slug] === slug);
    const live = products.some((c) => c.status === 'live') || (products.length === 0 && own?.status === 'live');
    /*
     * The CATEGORY's own art first, then a product's.
     *
     * This used to be the other way round, on the reasoning that a product's photograph is a real
     * one where a category's is generated. Both are generated — `category-art-gen.mts` shoots all
     * thirty-seven to one art direction — and the rule cost the grid its worst tile: Drafting &
     * Measurement borrowed Total Stations, whose frame is a product cut-out on PURE WHITE, so one
     * tile in thirty-five was a white rectangle among thirty-four dark photographs.
     *
     * Own-art-first is also simply the more correct answer. A category tile answers "what is sold
     * here", and the category art was drawn to answer exactly that; a product's frame answers
     * "what is this one item". Water Proofing gains from it too — its own picture is a roller
     * laying membrane on a slab, against the epoxy tins it had been borrowing.
     *
     * The seven categories with no row of their own — Concreting, Doors & Windows, Flooring,
     * Electricals, Fire System, Security Systems, Solar — still fall through to their product's
     * frame, and every one of those is a category-art generation in the house style.
     */
    const hero =
      own?.heroImageKey ??
      products.find((c) => c.status === 'live' && c.heroImageKey)?.heroImageKey ??
      products.find((c) => c.heroImageKey)?.heroImageKey ??
      null;
    return {
      slug,
      name,
      products,
      skuCount: products.reduce((n, c) => n + (c.stats?.sku_count ?? 0), 0),
      brandCount: products.reduce((n, c) => n + c.brandCount, 0),
      fromPrice: minPrice(products),
      heroImageKey: hero,
      status: live ? ('live' as const) : ('upcoming' as const),
    };
  });
}

/**
 * A ROW IN `categories` — which is either a category or a product, and the table cannot tell you
 * which.
 *
 * The tree is CATEGORY → PRODUCT → SKU, and `PRODUCTS LIST.xlsx` is the authority on the top of
 * it: thirty-five sheets, one per category. Cement is not among them — CONCRETING is, and cement
 * is a product on that sheet. Twenty-six rows in this table are categories, nine are products,
 * and `PRODUCT_CATEGORY` in @buildobjects/catalog is what separates them.
 *
 * Renaming the table is not worth a migration; deciding the level at load time is
 * (`loadCatalogueCategories`).
 */
export interface CategoryCard {
  slug: string;
  code: string;
  name: string;
  nameTe: string | null;
  nameHi: string | null;
  icon: string | null;
  heroImageKey: string | null;
  unit: string | null;
  department: string;
  status: 'live' | 'upcoming';
  /** Distinct brands stocked in the category — the homepage tile says "3 brands", not a price. */
  brandCount: number;
  stats: { sku_count: number; in_stock: number; min_price: number | null; max_price: number | null } | null;
}

/**
 * Every category in the tree — the nine that sell and the twenty-eight that do not yet.
 *
 * The brand count comes back in the same round trip as a grouped sub-select rather than a
 * query per tile: thirty-seven tiles used to mean thirty-seven counts, and the homepage is
 * the page a first-time buyer waits on.
 */
export async function loadCategories(): Promise<CategoryCard[]> {
  try {
    const db = getDb();
    const [rows, brandCounts] = await Promise.all([
      db.select().from(categories).orderBy(asc(categories.displayOrder)),
      db
        .select({ categoryId: products.categoryId, n: sql<number>`COUNT(DISTINCT ${products.brandId})` })
        .from(products)
        .groupBy(products.categoryId),
    ]);
    const byCategory = new Map(brandCounts.map((b) => [b.categoryId, Number(b.n)]));
    return rows.map((c) => ({
      slug: c.slug,
      code: c.code,
      name: c.name,
      nameTe: c.nameTe,
      nameHi: c.nameHi,
      icon: c.icon,
      heroImageKey: c.heroImageKey,
      unit: c.unit,
      department: c.department,
      status: c.status,
      brandCount: byCategory.get(c.id) ?? 0,
      stats: c.stats ? { sku_count: c.stats.sku_count, in_stock: c.stats.in_stock, min_price: c.stats.min_price, max_price: c.stats.max_price } : null,
    }));
  } catch {
    /* No database: serve the frozen catalogue rather than an empty store. See
       lib/static-catalogue.ts for why the snapshot exists at all. */
    const { staticCategories } = await import('./static-catalogue');
    return staticCategories;
  }
}

export async function loadCategory(slug: string): Promise<typeof categories.$inferSelect | null> {
  try {
    const [c] = await getDb().select().from(categories).where(eq(categories.slug, slug)).limit(1);
    if (c) return c;
    throw new Error('not in the database');
  } catch {
    const { staticCategories } = await import('./static-catalogue');
    const c = staticCategories.find((x) => x.slug === slug);
    /* The snapshot carries the card shape, not the table row; `id` is the only column the page
       never reads and the only one a frozen catalogue cannot supply. */
    return c ? ({ ...c, id: 0 } as unknown as typeof categories.$inferSelect) : null;
  }
}
