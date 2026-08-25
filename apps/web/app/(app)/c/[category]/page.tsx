import { categoryName, categoryOf } from '@buildobjects/catalog';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CategorySidebar from '@/components/CategorySidebar';
import CategoryStrip from '@/components/CategoryStrip';
import CategoryTile from '@/components/CategoryTile';
import FilterRail from '@/components/FilterRail';
import { CategoryIcon, IconArrow } from '@/components/icons';
import Pagination from '@/components/Pagination';
import ProductCard from '@/components/ProductCard';
import { allCategories, loadFacetConfig, searchSkus } from '@/lib/catalog';
import { type CategoryGroup, loadCatalogueCategories, loadCategory, loadSession, serviceability } from '@/lib/data';
import { deliverBy } from '@/lib/delivery';
import { parseFilters } from '@/lib/filters';
import { inr } from '@/lib/media';

type Params = { category: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const cat = await loadCategory(category);
  if (cat) {
    return {
      title: cat.name,
      description: `${cat.name} from the brands engineers specify — GST-stated prices, datasheets, and every product viewable in your room.`,
    };
  }
  const group = (await loadCatalogueCategories()).find((g) => g.slug === category);
  return group
    ? { title: group.name, description: `${group.products.length} products in ${group.name} — ${group.products.map((c) => c.name).join(', ')}.` }
    : { title: 'Category' };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { category } = await params;
  const sp = await searchParams;
  /*
   * One route, two levels of the tree.
   *
   * `/c/concreting` is a category and lists the products in it; `/c/cement` is a product and
   * lists the items. A slug that names a category holding products always resolves as the
   * category — `waterproofing` and `drafting-measurement` are rows in the table AND categories
   * with a product filed under them, and the category is the level above.
   */
  const group = (await loadCatalogueCategories()).find((g) => g.slug === category);
  if (group && group.products.length > 0) return <CategoryLanding group={group} />;

  const cat = await loadCategory(category);
  if (!cat) {
    if (group) return <CategoryLanding group={group} />;
    notFound();
  }
  const state = parseFilters(sp);
  const [config, cats, session] = await Promise.all([loadFacetConfig(category), allCategories(), loadSession()]);
  const result = await searchSkus({ state, config, fixedCategory: category });
  const stats = cat.stats;
  const upcoming = cat.status !== 'live';
  // The delivery promise is the session's, so it is the same on every card on the page.
  const eta = session ? deliverBy((await serviceability(session.pincode)).deliveryDays) : null;

  return (
    <div className="page shell">
      <nav className="crumbs text-[12px] mt-5" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span className="mx-2" style={{ color: 'var(--ink-3)' }}>
          /
        </span>
        <Link href={`/c/${categoryOf(cat.slug)}`}>{categoryName(categoryOf(cat.slug))}</Link>
        <span className="mx-2" style={{ color: 'var(--ink-3)' }}>
          /
        </span>
        <span aria-current="page">{cat.name}</span>
      </nav>
      <header className="page-head flex items-center gap-4" style={{ paddingBottom: 'var(--s-3)' }}>
        <span className="cat-head-icon">
          <CategoryIcon icon={cat.icon ?? 'cement'} size={26} />
        </span>
        <div>
          <h1 className="display page-title">{cat.name}</h1>
          <p className="page-sub">
            {upcoming ? (
              'Arriving soon'
            ) : (
              <>
                <span className="fig">{stats?.sku_count ?? result.total}</span> {(stats?.sku_count ?? result.total) === 1 ? 'product' : 'products'}
                {stats?.min_price ? (
                  <>
                    {' '}
                    · from <span className="fig">{inr(stats.min_price)}</span>/{cat.unit}
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
      </header>
      <CategoryStrip categories={cats} current={category} />

      {/*
        A category with no products has nothing to sort, filter or paginate. Offering the
        toolbar anyway — "0 products · In stock only · Sort by: Relevance" over an empty grid,
        with a "Clear filters" button and no filters set — is worse than saying plainly that
        the shelf is being stocked and pointing at the ones that are.
      */}
      {upcoming ? (
        <section className="soon-panel" aria-labelledby="soon-h">
          <h2 id="soon-h" className="soon-title">
            {cat.name} is on its way
          </h2>
          <p className="soon-body">
            This category is in the catalogue but not yet stocked. Every product we list carries its full specification sheet, the source of every figure and a
            1:1 room view — which takes time to do properly, so the shelves fill one at a time.
          </p>
          <p className="soon-label">Stocked today</p>
          <ul className="soon-links">
            {cats
              .filter((c) => c.status === 'live')
              .map((c) => (
                <li key={c.slug}>
                  <Link href={`/c/${c.slug}`} className="chip">
                    <CategoryIcon icon={c.icon ?? 'cement'} size={16} /> {c.name}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : (
        <div className="plp">
          <FilterRail
            config={config}
            state={state}
            distribution={result.facetDistribution}
            stats={result.facetStats}
            total={result.total}
            sideNav={<CategorySidebar categories={cats} current={category} />}
          />
          <section aria-label="Results">
            {result.hits.length === 0 ? (
              <div className="empty glass-card" style={{ borderRadius: 'var(--radius-glass)' }}>
                <p className="kicker">{cat.name}</p>
                <p className="display">{(stats?.sku_count ?? 0) === 0 ? 'Nothing on this shelf yet' : 'No products match those filters'}</p>
                <p>
                  {(stats?.sku_count ?? 0) === 0
                    ? `We are still adding ${cat.name.toLowerCase()} — try another category in the meantime.`
                    : 'Loosen a filter or clear them all — every value we struck through has no product behind it right now.'}
                </p>
                <Link href={`/c/${category}`} className="btn-ghost h-10 px-4 text-[13px] flex items-center">
                  Clear filters
                </Link>
              </div>
            ) : (
              <>
                {config?.lead_note && <p className="text-[13px] mb-3 text-[var(--color-ink-2)]">{config.lead_note}</p>}
                <div className="prod-grid prod-grid--rail">
                  {result.hits.map((h, i) => (
                    <ProductCard key={h.id} sku={h} priority={i < 4} deliverBy={eta} />
                  ))}
                </div>
                <Pagination pathname={`/c/${category}`} state={state} page={result.page} totalPages={result.totalPages} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * A category: one of the thirty-five sheets in `PRODUCTS LIST.xlsx`.
 *
 * It has no filters and no price rail because a category does not have specifications — its
 * products do. What it owes the buyer is the answer to "what is in here": the products, and when
 * any of them are stocked, a way straight through to the shelf. Twenty-six of the thirty-five
 * have nothing in them yet and say so rather than pretending otherwise.
 */
function CategoryLanding({ group }: { group: CategoryGroup }) {
  const live = group.products.filter((c) => c.status === 'live');

  return (
    <div className="page shell">
      <nav className="crumbs text-[12px] mt-5" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span className="mx-2" style={{ color: 'var(--ink-3)' }}>
          /
        </span>
        <span aria-current="page">{group.name}</span>
      </nav>
      <header className="page-head" style={{ paddingBottom: 'var(--s-3)' }}>
        <h1 className="display page-title">{group.name}</h1>
        <p className="page-sub">
          {group.products.length === 0 ? (
            'Arriving soon — nothing on the shelf in this category yet.'
          ) : (
            <>
              <span className="fig">{group.products.length}</span> {group.products.length === 1 ? 'product' : 'products'}
              {group.skuCount > 0 && (
                <>
                  {' · '}
                  <span className="fig">{group.skuCount}</span> {group.skuCount === 1 ? 'item' : 'items'} on the shelf from{' '}
                  <span className="fig">{group.brandCount}</span> {group.brandCount === 1 ? 'brand' : 'brands'}
                </>
              )}
            </>
          )}
        </p>
      </header>

      {group.products.length > 0 && (
        <ul className="cat-grid" style={{ marginTop: 'var(--s-4)' }}>
          {group.products.map((c, i) => (
            <li key={c.slug}>
              <CategoryTile
                href={`/c/${c.slug}`}
                name={c.name}
                heroImageKey={c.heroImageKey}
                soon={c.status !== 'live'}
                priority={i < 4}
                meta={
                  c.status === 'live' ? (
                    <>
                      <span className="fig">{c.brandCount}</span> {c.brandCount === 1 ? 'brand' : 'brands'}
                      <span className="cat-dot" aria-hidden>
                        ·
                      </span>
                      <span className="fig">{c.stats?.sku_count ?? 0}</span> {(c.stats?.sku_count ?? 0) === 1 ? 'item' : 'items'}
                    </>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      {live.length > 0 && (
        <p className="sec" style={{ marginTop: 'var(--s-6)' }}>
          <Link href={`/search?category=${live[0].slug}`} className="sec-more">
            See everything stocked in {group.name} <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
          </Link>
        </p>
      )}
    </div>
  );
}
