import 'server-only';
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
