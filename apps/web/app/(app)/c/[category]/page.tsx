import type { SkuSearchDoc } from '@buildobjects/catalog';
import { categoryName, categoryOf, isProduct } from '@buildobjects/catalog';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import CategorySidebar from '@/components/CategorySidebar';
import CategoryStrip from '@/components/CategoryStrip';
import CategoryTile from '@/components/CategoryTile';
import FilterRail from '@/components/FilterRail';
import { CategoryIcon, IconArrow } from '@/components/icons';
import Pagination from '@/components/Pagination';
import Plate from '@/components/Plate';
import ProductCard from '@/components/ProductCard';
import { allCategories, loadFacetConfig, loadFlagshipSkus, searchSkus } from '@/lib/catalog';
import { type CategoryGroup, loadCatalogueCategories, loadCategory, loadSession, serviceability } from '@/lib/data';
import { deliverBy } from '@/lib/delivery';
import { parseFilters } from '@/lib/filters';
import { inr } from '@/lib/media';

/**
 * What to call a row from `categories`, given that the table and the workbook disagree.
 *
 * Seven of the thirty-five carry a different name in the database than on the sheet the store
 * takes its taxonomy from — "Steel & Reinforcement" against "Steel", "Paints & Coatings" against
 * "Painting", "Lifts & Elevators" against "Lift Elevators". The tiles, the nav, the rail and the
 * footer all read the registry, so a shopper clicked "Steel" on the home page and landed on a
 * page headed "Steel & Reinforcement".
 *
 * `PRODUCTS LIST.xlsx` is the authority for the thirty-five, so the registry wins for them. Rows
 * that are PRODUCTS — cement, tiles, glass — are not in the registry at all and keep their own
 * name, which is why this cannot simply be `categoryName(slug)`.
 */
function displayName(slug: string, fallback: string): string {
  return isProduct(slug) ? fallback : categoryName(slug);
}

type Params = { category: string };
type Search = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const cat = await loadCategory(category);
  if (cat) {
    const title = displayName(cat.slug, cat.name);
    return {
      title,
      description: `${title} from the brands engineers specify — prices per unit with GST included, datasheets, and every product viewable at true size in your room.`,
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
  if (group && group.products.length > 0) return <CategoryLanding group={group} {...(await landingData(group))} />;

  const cat = await loadCategory(category);
  if (!cat) {
    if (group) return <CategoryLanding group={group} skus={[]} eta={null} />;
    notFound();
  }
  const state = parseFilters(sp);
  const [config, cats, session] = await Promise.all([loadFacetConfig(category), allCategories(), loadSession()]);
  const result = await searchSkus({ state, config, fixedCategory: category });
  const stats = cat.stats;
  const upcoming = cat.status !== 'live';
  // The delivery promise is the session's, so it is the same on every card on the page.
  const eta = session ? deliverBy((await serviceability(session.pincode)).deliveryDays) : null;

  /*
   * The rest of the department, for a shelf too short to fill the page. See the section below for
   * why. `loadFlagshipSkus` is the whole stocked catalogue and is already cached, so this is a
   * filter over something the process is holding rather than another round trip — and it is only
   * asked for when the grid has room under it.
   */
  const department = cats.find((c) => c.slug === category)?.department ?? null;
  const inDepartment = new Set(cats.filter((c) => c.department === department && c.slug !== category && c.status === 'live').map((c) => c.slug));
  /*
   * The department first, the rest of the catalogue after it. Nine categories are live in total
   * and several of them — bulbs among them — are the only live shelf in their department, so
   * department-only would show nothing on exactly the pages that are emptiest.
   */
  const elsewhere = new Set(cats.filter((c) => c.slug !== category && c.status === 'live').map((c) => c.slug));
  const pool = inDepartment.size > 0 ? inDepartment : elsewhere;
  const departmentName = inDepartment.size > 0 && department ? department.replace(/-/g, ' ') : 'the catalogue';
  const nearby =
    result.hits.length > 0 && result.hits.length < 4 && pool.size > 0 ? (await loadFlagshipSkus()).filter((d) => pool.has(d.category)).slice(0, 4) : [];

  return (
    <div className="page shell">
      <Breadcrumbs
        trail={[
          { label: 'Home', href: '/' },
          { label: categoryName(categoryOf(cat.slug)), href: `/c/${categoryOf(cat.slug)}` },
          { label: displayName(cat.slug, cat.name) },
        ]}
      />
      <header className="page-head page-head--plate">
        <Plate name="catalogue-aisle" position="50% 46%" />
        <div className="page-head-in">
          <span className="cat-head-icon">
            <CategoryIcon icon={cat.icon ?? 'cement'} size={26} />
          </span>
          <div>
            <h1 className="page-title">{displayName(cat.slug, cat.name)}</h1>
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
            {displayName(cat.slug, cat.name)} is on its way
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
            {/* A heading, not just a label. Product titles are h3, and on a phone the facet rail —
          whose section headings are the h2s — is behind a sheet and not in the document, so
          the outline went h1 straight to h3. `aria-label` names a landmark but does not put a
          rung on the ladder; a heading does both, and this one is for screen readers only
          because the count above it already says it on screen. */}
            <h2 className="visually-hidden">Results</h2>
            {result.hits.length === 0 ? (
              <div className="empty glass-card" style={{ borderRadius: 'var(--r-2)' }}>
                <p className="kicker">{displayName(cat.slug, cat.name)}</p>
                <p className="display">{(stats?.sku_count ?? 0) === 0 ? 'Nothing on this shelf yet' : 'No products match those filters'}</p>
                <p>
                  {(stats?.sku_count ?? 0) === 0
                    ? `We are still adding ${displayName(cat.slug, cat.name).toLowerCase()} — try another category in the meantime.`
                    : 'Loosen a filter or clear them all — every value we struck through has no product behind it right now.'}
                </p>
                <Link href={`/c/${category}`} className="btn-ghost h-10 px-4 text-[13px] flex items-center">
                  Clear filters
                </Link>
              </div>
            ) : (
              <>
                {config?.lead_note && <p className="text-[13px] mb-3 text-[var(--color-ink-2)]">{config.lead_note}</p>}
                <div className="prod-grid prod-grid--rail stagger">
                  {result.hits.map((h, i) => (
                    <ProductCard key={h.id} sku={h} priority={i < 4} deliverBy={eta} />
                  ))}
                </div>
                <Pagination pathname={`/c/${category}`} state={state} page={result.page} totalPages={result.totalPages} />
                {/*
                 * KEEP LOOKING — but only when there is room to.
                 *
                 * Most shelves in this catalogue hold three products. On a desktop that is one row
                 * in a three-column grid and then six hundred pixels of nothing before the footer:
                 * the page reads as the end of the store rather than the end of one shelf. This
                 * puts the rest of the department under it, which is the question somebody with
                 * three bulbs in front of them is actually about to ask.
                 *
                 * Gated on a short result set, so a full page is never padded, and on the
                 * department having something else live to show.
                 */}
                {nearby.length > 0 && (
                  <section className="sec mt-8" aria-labelledby="nearby-h">
                    <div className="sec-head">
                      <h2 id="nearby-h" className="sec-title">
                        More in {departmentName}
                      </h2>
                      <Link href="/search" className="sec-more">
                        Everything in the catalogue <IconArrow size={15} />
                      </Link>
                    </div>
                    <div className="prod-grid prod-grid--rail stagger mt-3">
                      {nearby.map((s) => (
                        <ProductCard key={s.id} sku={s} deliverBy={eta} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Everything a category landing page needs beyond the group itself: the items on its shelves,
 * and the delivery date this session's pincode earns.
 *
 * The SKUs come from the flagship set rather than from a search call per product, because the
 * whole stocked catalogue is twenty-eight documents and is already cached — a category holding
 * two products would otherwise cost two round trips to answer a question one filter answers.
 */
async function landingData(group: CategoryGroup): Promise<{ skus: SkuSearchDoc[]; eta: string | null }> {
  const slugs = new Set(group.products.map((c) => c.slug));
  const [all, session] = await Promise.all([loadFlagshipSkus(), loadSession()]);
  const skus = all.filter((s) => slugs.has(s.category));
  const eta = session ? deliverBy((await serviceability(session.pincode)).deliveryDays) : null;
  return { skus, eta };
}

/**
 * A category: one of the thirty-five sheets in `PRODUCTS LIST.xlsx`.
 *
 * It has no filters and no price rail because a category does not have specifications — its
 * products do. What it owes the buyer is the answer to "what is in here": the products, and when
 * any of them are stocked, a way straight through to the shelf. Twenty-six of the thirty-five
 * have nothing in them yet and say so rather than pretending otherwise.
 */
function CategoryLanding({ group, skus, eta }: { group: CategoryGroup; skus: SkuSearchDoc[]; eta: string | null }) {
  const live = group.products.filter((c) => c.status === 'live');
  const prices = skus.map((s) => s.selling_price).filter((n): n is number => typeof n === 'number');
  /*
   * Count what this page is about to draw, not what the categories table remembers.
   *
   * `group.skuCount` comes from `categories.stats`, a snapshot the pipeline writes; the cards
   * come from the search index. When Ambuja Kawach was added to the index and the snapshot was
   * not re-run, the header read "ON THE SHELF 3" directly above four cards. A page contradicting
   * itself in its own first two inches is worse than a page whose figure is a day stale, so the
   * live set wins wherever there is one.
   */
  const onShelf = skus.length || group.skuCount;
  const brandCount = new Set(skus.map((s) => s.brand)).size || group.brandCount;

  return (
    <div className="page shell">
      <Breadcrumbs trail={[{ label: 'Home', href: '/' }, { label: group.name }]} />

      {/* The header states what is on the shelf, not how the catalogue files it. It used to
          open with "1 product ·" on every one of these pages — a fact about the tree, not about
          anything you can buy. */}
      <header className="page-head page-head--plate cat-land-head" data-reveal="left">
        <Plate name="catalogue-aisle" position="50% 46%" />
        <div className="page-head-in">
          <div>
            <h1 className="page-title">{group.name}</h1>
            {onShelf > 0 ? (
              <dl className="cat-land-facts">
                <div>
                  <dt>On the shelf</dt>
                  <dd className="fig">{onShelf}</dd>
                </div>
                <div>
                  <dt>Brands</dt>
                  <dd className="fig">{brandCount}</dd>
                </div>
                {prices.length > 0 && (
                  <div>
                    <dt>From</dt>
                    <dd className="fig">{inr(Math.min(...prices))}</dd>
                  </div>
                )}
                {eta && (
                  <div>
                    <dt>Delivered by</dt>
                    <dd className="cat-land-eta">{eta}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="page-sub">Nothing on this shelf yet — the catalogue reaches it before the stock does.</p>
            )}
          </div>
        </div>
      </header>

      {group.products.length > 1 && (
        <section className="sec" aria-labelledby="in-h">
          <div className="sec-head" data-reveal>
            <h2 id="in-h" className="sec-title">
              What we carry in {group.name}
            </h2>
          </div>
          <ul className="cat-grid stagger">
            {group.products.map((c, i) => (
              <li key={c.slug} data-reveal="scale" style={{ '--i': i % 4 } as React.CSSProperties}>
                <CategoryTile
                  href={`/c/${c.slug}`}
                  name={c.name}
                  heroImageKey={c.heroImageKey}
                  soon={c.status !== 'live'}
                  priority={i < 4}
                  meta={
                    c.status === 'live' ? (
                      <>
                        <span className="fig">{c.stats?.sku_count ?? 0}</span> {(c.stats?.sku_count ?? 0) === 1 ? 'item' : 'items'}
                        {c.stats?.min_price ? (
                          <>
                            {' · from '}
                            <span className="fig">{inr(c.stats.min_price)}</span>
                          </>
                        ) : null}
                      </>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
       * The items themselves.
       *
       * This page used to be a heading, one tile in a four-column grid and a link — three
       * quarters of a row of empty space under a category that has stock in it. A category page
       * whose whole job is to get you to the thing you came for should show the things.
       */}
      {skus.length > 0 && (
        <section className="sec" aria-labelledby="stock-h">
          <div className="sec-head" data-reveal>
            <div>
              <h2 id="stock-h" className="sec-title">
                On the shelf now
              </h2>
              <p className="sec-sub">Every price is per unit and includes GST — the rate is on each product page.</p>
            </div>
            {live.length > 0 && (
              <Link href={`/search?category=${live[0].slug}`} className="sec-more">
                Filter and compare <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
              </Link>
            )}
          </div>
          <div className="prod-grid stagger">
            {/* Direct grid children, so the row stretches them — see the note in search/page.tsx. */}
            {skus.map((sku, i) => (
              <ProductCard key={sku.sku_code} sku={sku} deliverBy={eta} priority={i < 4} />
            ))}
          </div>
        </section>
      )}

      {/* A category we have not stocked yet is a dead end unless it points somewhere. */}
      {onShelf === 0 && (
        <section className="soon-panel" aria-labelledby="soon-h">
          <h2 id="soon-h" className="soon-title">
            {group.name} is on its way
          </h2>
          <p className="soon-body">
            This category is in the catalogue but not yet stocked. Every product we list carries its full specification sheet, the source of every figure and a
            1:1 room view — which takes time to do properly, so the shelves fill one at a time.
          </p>
        </section>
      )}
    </div>
  );
}
