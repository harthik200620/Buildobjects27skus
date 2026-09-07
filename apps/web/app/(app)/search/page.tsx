import type { Metadata } from 'next';
import Link from 'next/link';
import CategoryDirectory from '@/components/CategoryDirectory';
import CategoryStrip from '@/components/CategoryStrip';
import FilterRail from '@/components/FilterRail';
import { IconSearch } from '@/components/icons';
import Pagination from '@/components/Pagination';
import Plate from '@/components/Plate';
import ProductCard from '@/components/ProductCard';
import ResultsSection from '@/components/ResultsSection';
import { allCategories, loadFacetConfig, loadFlagshipSkus, searchSkus } from '@/lib/catalog';
import { loadCatalogueCategories, loadSession, serviceability } from '@/lib/data';
import { deliverBy } from '@/lib/delivery';
import { isBrowsing, parseFilters } from '@/lib/filters';

type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '';
  return { title: q ? `“${q}”` : 'The catalogue' };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const state = parseFilters(sp);

  /*
   * THE CATALOGUE OPENS ON CATEGORIES, NOT ON A PRODUCT LIST.
   *
   * This page used to answer "Catalogue" with all twenty-eight products in one flat grid beside a
   * text sidebar, which is the store's own taxonomy — CATEGORY → PRODUCT → SKU — contradicted by
   * the page whose whole job is to present it. A first-time buyer looking for tiles was handed
   * cement, bulbs, fire extinguishers and a solar panel in the first row.
   *
   * So: nothing asked for means the directory. A query, a category, a facet, a sort or an
   * explicit `?all=1` all mean the shopper HAS asked something, and the results grid answers.
   * `?all=1` is what "see everything in one list" links to, so the flat view is never more than
   * one click away — it is no longer the thing you get for not having asked.
   */
  if (isBrowsing(state, sp)) return <CataloguePage />;

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
      <header className="page-head page-head--plate">
        <Plate name="catalogue-aisle" position="50% 46%" />
        <div className="page-head-in">
          <div>
            <h1 className="page-title">
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
                  <span className="fig">{result.total}</span> items, priced per unit with GST included. Every one carries its full specification, the source of
                  each figure, and a view of it standing in your own room.
                </>
              )}
            </p>
          </div>
        </div>
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
        <ResultsSection>
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
                {/* ProductCard is the grid item itself — it carries its own `data-reveal`, and
                    `.stagger` sets `--i` from nth-child in theme.css. It used to be wrapped in a
                    plain <div> repeating both, and that wrapper is what broke the row: the grid
                    stretched the WRAPPER to the tallest card and the card inside kept its own
                    height, so a two-line title and a three-line title in the same row put their
                    prices twenty-two pixels apart. */}
                {result.hits.map((h, i) => (
                  <ProductCard key={h.id} sku={h} priority={i < 4} highlight={!!state.q} deliverBy={eta} />
                ))}
              </div>
              <Pagination pathname="/search" state={state} page={result.page} totalPages={result.totalPages} />
            </>
          )}
        </ResultsSection>
      </div>
    </div>
  );
}

/**
 * The catalogue's front page: every category the store has, stocked ones first.
 *
 * It shares `CategoryDirectory` with the home page, so the two cannot disagree about what is on
 * the shelf — which is exactly how they came to disagree in the first place.
 */
async function CataloguePage() {
  const [cats, skus] = await Promise.all([loadCatalogueCategories(), loadFlagshipSkus()]);
  const stocked = cats.filter((c) => c.status === 'live').length;

  return (
    <div className="page page--dir">
      <header className="shell page-head page-head--plate">
        <Plate name="catalogue-aisle" position="50% 46%" />
        <div className="page-head-in">
          <div>
            <h1 className="page-title">The catalogue</h1>
            <p className="page-sub">
              <span className="fig">{cats.length}</span> categories. <span className="fig">{stocked}</span> of them are stocked today, holding{' '}
              <span className="fig">{skus.length}</span> items — priced per unit with GST included, each carrying the source of every figure.
            </p>
          </div>
        </div>
      </header>

      <CategoryDirectory
        categories={cats}
        itemCount={skus.length}
        headingId="cat-dir"
        eyebrow="On the shelf"
        title="What we stock today"
        sub={
          <>
            <span className="fig">{stocked}</span> categories, <span className="fig">{skus.length}</span> items, delivered across Andhra Pradesh and Telangana.
          </>
        }
        flatHref="/search?all=1"
        flatLabel={`See all ${skus.length} items in one list`}
      />
    </div>
  );
}
