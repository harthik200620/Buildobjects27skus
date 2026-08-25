import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CategorySidebar from '@/components/CategorySidebar';
import CategoryStrip from '@/components/CategoryStrip';
import FilterRail from '@/components/FilterRail';
import { CategoryIcon } from '@/components/icons';
import Pagination from '@/components/Pagination';
import ProductCard from '@/components/ProductCard';
import { allCategories, loadFacetConfig, searchSkus } from '@/lib/catalog';
import { loadCategory, loadSession, serviceability } from '@/lib/data';
import { deliverBy } from '@/lib/delivery';
import { parseFilters } from '@/lib/filters';
import { inr } from '@/lib/media';

type Params = { category: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const cat = await loadCategory(category);
  return {
    title: cat ? `${cat.name}` : 'Category',
    description: cat ? `${cat.name} from the brands engineers specify — GST-stated prices, datasheets, and every product viewable in your room.` : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { category } = await params;
  const sp = await searchParams;
  const cat = await loadCategory(category);
  if (!cat) notFound();
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
        <Link href="/search">Products</Link>
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
