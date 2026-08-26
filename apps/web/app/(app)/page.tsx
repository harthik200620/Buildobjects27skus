import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import CountUp from '@/components/home/CountUp';
import { IconArrow, IconEstimate, IconStorefront } from '@/components/icons';
import Plate from '@/components/Plate';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCatalogueCategories } from '@/lib/data';

export const revalidate = 60;

/** Tiles above the fold on a desktop grid; these load eagerly, the rest do not. */
const EAGER = 4;

/**
 * The front door. Three moves and the footer, and the third one is the page.
 *
 * IT SHOWS CATEGORIES, AND IT SHOWS NOTHING AFTER THEM. There are thirty-five and
 * `WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx` is the authority — one sheet each, in this order.
 * Cement is not one of them: CONCRETING is, and cement is a product on that sheet, the same way
 * tiles are a product on FLOORING and glass on DOORS & WINDOWS.
 *
 * What used to sit below the grid — eight product cards, four promises and a closing call to
 * action — is gone. A front door is a place you pass through, and a page that keeps talking after
 * it has shown you the doors does not trust them. The promises live on the product pages, where
 * they answer a question somebody is actually asking; the shelf lives in search, one click away
 * and better presented there.
 *
 * AND IT CARRIES NO PRICES. Not on a tile, not in the hero, not in a strip. A price on the front
 * door commits the store to a number before the visitor has chosen anything, and "from ₹410" under
 * a category answers a question nobody has asked at that level — it is the cheapest kind of
 * shop-window promise and the first thing a buyer finds a reason to distrust. Every price in this
 * store sits beside the thing it is the price of, with its GST rate and its provenance next to it.
 */
export default async function Home() {
  const [cats, skus] = await Promise.all([loadCatalogueCategories(), loadFlagshipSkus()]);
  const liveCategories = cats.filter((c) => c.status === 'live').length;
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
           * The line is about DELIVERY, not about price.
           *
           * It read "Know what it costs before you order it." above forty-eight words of
           * everything the store can do. Knowing the price is a real thing this store fixes and
           * it is not the thing somebody arrives needing: a house is not built by buying
           * material, it is built by material ARRIVING. One house today means cement from one
           * dealer, tiles from another and wiring from a third — eight relationships, eight
           * phone calls, and eight delivery dates that never line up. That is the same loss for
           * a builder in a city and for a family adding a room in a village, which is why it is
           * the line that reaches every part of this market at once.
           *
           * The kicker above it — a pulsing dot reading "Andhra Pradesh & Telangana" — is gone.
           * It is the least load-bearing element on the page and the deliver-to strip six inches
           * below it already names the visitor's own pincode and their own lead time, which is
           * the specific answer rather than the general one.
           *
           * THE SECOND LINE NAMES ONLY WHAT IS ON THE SHELF. It used to lead with "Cement,
           * steel, ..." and there is no steel in this catalogue — nine of the thirty-seven
           * categories stock anything, and steel, sand, brick, paint and plumbing are all still
           * "on the way" on the grid directly below this hero. Seven of the nine are named here;
           * the two left out are epoxy and total stations, which are trade items rather than
           * things somebody building a home goes looking for.
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

      {/* ── the catalogue's top level, and the end of the page ─────────────── */}
      <section className="shell sec sec--last" aria-labelledby="cats-h">
        <div className="sec-head" data-reveal>
          <div>
            <p className="micro sec-eyebrow">The catalogue</p>
            <h2 id="cats-h" className="d2">
              Every category we carry
            </h2>
            <p className="lede sec-sub">
              <span className="fig">{liveCategories}</span> of <span className="fig">{cats.length}</span> are stocked today. The rest are shelves we are filling
              — open one and it will tell you plainly where it stands.
            </p>
          </div>
          <Link href="/search" className="sec-more">
            Browse everything <IconArrow size={16} />
          </Link>
        </div>

        {cats.length === 0 ? (
          <EmptyShelves />
        ) : (
          <ul className="cat-grid stagger">
            {cats.map((c, i) => (
              /* --i drives the stagger: four columns, so the modulo makes each row cascade
                 left-to-right rather than the whole row arriving at once. */
              <li key={c.slug} data-reveal="scale" style={{ '--i': i % 4 } as React.CSSProperties}>
                <CategoryTile
                  href={`/c/${c.slug}`}
                  name={c.name}
                  heroImageKey={c.heroImageKey}
                  soon={c.status !== 'live'}
                  priority={i < EAGER}
                  meta={c.skuCount > 0 ? `${c.skuCount} ${c.skuCount === 1 ? 'item' : 'items'}` : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
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
