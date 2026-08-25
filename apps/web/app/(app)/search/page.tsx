import type { Metadata } from 'next';
import Link from 'next/link';
import CategoryStrip from '@/components/CategoryStrip';
import FilterRail from '@/components/FilterRail';
import { IconSearch } from '@/components/icons';
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
      {/*
       * The heading used to read "BO Store" over "All BO Products", and the line under it claimed
       * "verified construction materials". Two problems. The prefix is a tic — a shopper does not
       * call it the BO Store, and putting the initials in front of every noun on the site does not
       * make it a brand. And "verified" is a claim this very store refuses to make one page later:
       * the specification sheet says plainly that most figures on it are class standards rather
       * than measured facts, and a landing line that overrides that in the shopper's mind is worse
       * than saying nothing.
       */}
      <header className="page-head">
        <h1 className="display page-title">
          {state.q ? (
            <>
              Results for <span className="search-q">{state.q}</span>
            </>
          ) : (
            'Everything we stock'
          )}
        </h1>
        <p className="page-sub">
          {state.q ? (
            <>
              <span className="fig">{result.total}</span> {result.total === 1 ? 'match' : 'matches'} in the catalogue.
            </>
          ) : (
            <>
              <span className="fig">{result.total}</span> items, priced per unit with GST included. Every one carries its full specification, the source of each
              figure, and a view of it standing in your own room.
            </>
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
        />
        <section aria-label="Results">
          {zero ? (
            <div className="cart-state">
              <span className="cart-state-mark">
                <IconSearch size={26} />
              </span>
              <h2 className="cart-state-h">Nothing matched “{state.q}”</h2>
              <p className="cart-state-p">
                We stock <span className="fig">{cats.filter((c) => c.status === 'live').length}</span> lines today, so the catalogue is still narrow. Try a
                brand name, or start from one of these.
              </p>
              <div className="cart-state-cta">
                {(nearest.length ? nearest : cats.filter((c) => c.status === 'live').slice(0, 4)).map((c) => (
                  <Link key={c.slug} href={`/c/${c.slug}`} className="chip">
                    {c.name}
                  </Link>
                ))}
              </div>
              <Link href="/search" className="btn btn-secondary cart-to-estimate">
                Browse everything
              </Link>
            </div>
          ) : (
            <>
              <div className="prod-grid prod-grid--rail stagger">
                {result.hits.map((h, i) => (
                  <div key={h.id} data-reveal style={{ '--i': i % 4 } as React.CSSProperties}>
                    <ProductCard sku={h} priority={i < 4} highlight={!!state.q} deliverBy={eta} />
                  </div>
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
