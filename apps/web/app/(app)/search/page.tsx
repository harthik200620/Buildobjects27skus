import type { Metadata } from 'next';
import Link from 'next/link';
import CategorySidebar from '@/components/CategorySidebar';
import CategoryStrip from '@/components/CategoryStrip';
import FilterRail from '@/components/FilterRail';
import Pagination from '@/components/Pagination';
import ProductCard from '@/components/ProductCard';
import { allCategories, loadFacetConfig, searchSkus } from '@/lib/catalog';
import { loadSession, serviceability } from '@/lib/data';
import { deliverBy } from '@/lib/delivery';
import { parseFilters } from '@/lib/filters';

type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '';
  return { title: q ? `“${q}”` : 'All products' };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const state = parseFilters(sp);
  const [cats, session] = await Promise.all([allCategories(), loadSession()]);
  const config = state.category ? await loadFacetConfig(state.category) : null;
  const result = await searchSkus({ state, config });
  // The delivery promise is the session's, so it is the same on every card on the page.
  const eta = session ? deliverBy((await serviceability(session.pincode)).deliveryDays) : null;
  const categoryFacet = cats
    .map((c) => ({ slug: c.slug, name: c.name, count: result.facetDistribution.category?.[c.slug] ?? 0 }))
    .filter((c) => c.count > 0 || c.slug === state.category);
  const zero = result.hits.length === 0;
  const nearest = zero
    ? cats
        .filter(
          (c) =>
            state.q &&
            (c.name.toLowerCase().includes(state.q.toLowerCase().slice(0, 3)) ||
              (c.nameTe && state.q.includes(c.nameTe)) ||
              (c.nameHi && state.q.includes(c.nameHi))),
        )
        .slice(0, 3)
    : [];

  return (
    <div className="page shell">
      <header className="page-head">
        <p className="kicker">{state.q ? 'BO Search' : 'BO Store'}</p>
        <h1 className="display page-title">
          {state.q ? (
            <>
              Results for <span style={{ color: 'var(--accent)' }}>{state.q}</span>
            </>
          ) : (
            'All BO Products'
          )}
        </h1>
        <p className="page-sub">
          {state.q ? (
            <>
              <span className="fig">{result.total}</span> {result.total === 1 ? 'product found' : 'products found'}.
            </>
          ) : (
            'Browse verified construction materials with full technical specifications, stated sources and 3D Live AR.'
          )}
        </p>
      </header>
      {!state.q && <CategoryStrip categories={cats} current={state.category} />}
      <div className="plp">
        <FilterRail
          config={config}
          state={state}
          distribution={result.facetDistribution}
          stats={result.facetStats}
          total={result.total}
          categoryFacet={categoryFacet}
          aboveFacets={<CategorySidebar categories={cats} current={state.category} />}
        />
        <section aria-label="Results">
          {zero ? (
            <div className="empty glass-card" style={{ borderRadius: 'var(--radius-glass)' }}>
              <p className="kicker">No results</p>
              <p className="display">Nothing matched “{state.q}”</p>
              <p>Try fewer words, a brand name, or one of these categories.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {(nearest.length ? nearest : cats.slice(0, 4)).map((c) => (
                  <Link key={c.slug} href={`/c/${c.slug}`} className="chip">
                    {c.name}
                  </Link>
                ))}
              </div>
              <Link href="/search" className="btn-ghost h-10 px-4 text-[13px] flex items-center mt-2">
                Browse everything
              </Link>
            </div>
          ) : (
            <>
              <div className="prod-grid prod-grid--rail">
                {result.hits.map((h, i) => (
                  <ProductCard key={h.id} sku={h} priority={i < 4} highlight={!!state.q} deliverBy={eta} />
                ))}
              </div>
              <Pagination pathname="/search" state={state} page={result.page} totalPages={result.totalPages} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
