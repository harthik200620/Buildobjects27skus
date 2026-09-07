import Link from 'next/link';
import CategoryDirectory from '@/components/CategoryDirectory';
import CountUp from '@/components/home/CountUp';
import { IconEstimate, IconStorefront } from '@/components/icons';
import Plate from '@/components/Plate';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCatalogueCategories } from '@/lib/data';

export const revalidate = 60;

/**
 * The front door: the hero, the spine, the categories, and nothing after them.
 *
 * IT SHOWS CATEGORIES. There are thirty-six, and `WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx` is
 * the authority — one sheet each, in this order. Cement is not one of them: CONCRETING is, and
 * cement is a product on that sheet, as tiles are on FLOORING and glass on DOORS & WINDOWS.
 *
 * AND IT CARRIES NO PRICES — not on a tile, not in the hero, not in a strip. "From Rs 410" under a
 * category answers a question nobody has asked at that level. Every price in this store sits beside
 * the thing it is the price of, with its GST rate and provenance next to it.
 */
export default async function Home() {
  const [cats, skus] = await Promise.all([loadCatalogueCategories(), loadFlagshipSkus()]);
  const stocked = cats.filter((c) => c.status === 'live');
  const brands = new Set(skus.map((s) => s.brand)).size;

  return (
    <div className="home">
      {/*
       * The hero: the photograph, the drafting grid over it, and the copy at its full width. It
       * held a rotating stock panel on the right, and that panel was a price.
       *
       * The photograph is a dusk G+1 house with a parapet, a mumty, chajjas over every window and
       * a compound wall — a building this store's customers are actually putting up.
       */}
      <section className="hero" aria-labelledby="home-h">
        <Plate name="home-hero" priority className="hero-plate" />
        <span className="hero-grid" aria-hidden="true" />
        <div className="shell hero-in">
          {/*
           * THE LINE IS ABOUT DELIVERY, NOT PRICE. A house is not built by buying material, it is
           * built by material ARRIVING: one house today means cement from one dealer, tiles from
           * another and wiring from a third — eight relationships and eight delivery dates that
           * never line up. That is the same loss for a builder in a city and a family adding a
           * room in a village, which is why it reaches the whole of this market at once.
           *
           * THE SECOND LINE NAMES ONLY WHAT IS ON THE SHELF. Seven of the nine stocked categories
           * are here; steel, sand, brick, paint and plumbing are all still "on the way" on the
           * grid directly below, so naming them would be a promise this page cannot keep. Epoxy
           * and total stations are left out as trade items rather than things somebody building
           * a home goes looking for.
           */}
          <h1 id="home-h" className="d1 hero-title" data-reveal>
            Everything your home needs, in one order.
          </h1>
          <p className="lede hero-lede" data-reveal style={{ '--reveal-delay': '80ms' } as React.CSSProperties}>
            Cement, tiles, glass, lighting, solar, cameras and safety — delivered to one address, instead of eight dealers and eight phone calls.
          </p>
          <div className="hero-cta" data-reveal style={{ '--reveal-delay': '160ms' } as React.CSSProperties}>
            <Link href="/search" className="btn btn-primary btn--lg">
              <IconStorefront size={18} /> Browse the catalogue
            </Link>
            {/* "Price", not "Cost". Cost as a verb is trade jargon; price is unmissable. */}
            <Link href="/estimate" className="btn btn-secondary btn--lg">
              <IconEstimate size={18} /> Price a whole house
            </Link>
          </div>
          <dl className="hero-facts" data-reveal style={{ '--reveal-delay': '240ms' } as React.CSSProperties}>
            <div>
              <dt className="micro">Categories</dt>
              <dd className="fig">
                <CountUp to={cats.length} />
              </dd>
            </div>
            <div>
              <dt className="micro">On the shelf</dt>
              <dd className="fig">
                <CountUp to={skus.length} />
              </dd>
            </div>
            <div>
              <dt className="micro">Brands</dt>
              <dd className="fig">
                <CountUp to={brands} />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── the spine: what the store is for ─────────────────────────────────
          Three counters, one project. It is the only place on the page that explains the business
          rather than showing it, so it is three sentences and no more. */}
      <section className="shell sec" aria-labelledby="spine-h">
        <div className="sec-head" data-reveal>
          <div>
            <p className="micro sec-eyebrow">One project, three counters</p>
            <h2 id="spine-h" className="d2">
              The drawing already knows what your house costs.
            </h2>
          </div>
          <p className="lede sec-aside">
            Every wall implies bricks. Every room implies lights. Design it once here and the bill of materials, the cart and the contract all come from the
            same file.
          </p>
        </div>
        <ol className="spine stagger" data-reveal>
          {[
            { n: '01', h: 'Design', p: 'Plot dimensions, family, budget and Vastu in. Compliant, costed, sanction-grade drawings out.' },
            { n: '02', h: 'Buy', p: 'One tap turns the takeoff into a staged cart — every bag, tile and fitting, priced and editable.' },
            { n: '03', h: 'Build', p: 'The same drawing becomes the scope of work: milestones, escrow, and a site you can watch rise.' },
          ].map((s, i) => (
            <li key={s.n} style={{ '--i': i } as React.CSSProperties}>
              <p className="spine-n">{s.n}</p>
              <h3 className="h3">{s.h}</h3>
              <p className="meta">{s.p}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── the catalogue's top level, and the end of the page ───────────────
          Two grids, not one, and the split is the whole point. Nine of the thirty-six categories
          have something on the shelf; twenty-six do not yet. Drawn at the same size and shuffled
          together — which is what this was — the front door opened onto four dimmed "Arriving
          soon" tiles and read as a store with the lights off. What sells leads, at full size. What
          is coming still appears, all of it, under its own heading and at the weight of a list. */}
      {cats.length === 0 ? (
        <section className="shell sec sec--last">
          <EmptyShelves />
        </section>
      ) : (
        /* The same directory the catalogue page draws — see components/CategoryDirectory.tsx.
           It lived here in full and `/search` drew a flat product grid instead, which is how the
           two surfaces came to disagree about what this store sells. */
        <CategoryDirectory
          categories={cats}
          itemCount={skus.length}
          headingId="cats-h"
          eyebrow="The catalogue"
          title="On the shelf today"
          sub={
            <>
              <span className="fig">{stocked.length}</span> categories, <span className="fig">{skus.length}</span> items, delivered across Andhra Pradesh and
              Telangana.
            </>
          }
          moreHref="/search"
          moreLabel="Browse the catalogue"
        />
      )}
    </div>
  );
}

function EmptyShelves() {
  return (
    <div className="empty glass-card" style={{ borderRadius: 'var(--r-3)' }}>
      <p className="micro">Catalogue</p>
      <p className="d3">The shelves are still being filled</p>
      <p className="meta">
        Run <code className="fig">pnpm registry:seed</code> and <code className="fig">pnpm pipeline run</code> — the categories appear here with live counts.
      </p>
    </div>
  );
}
