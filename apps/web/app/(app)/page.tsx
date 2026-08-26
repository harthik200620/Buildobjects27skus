import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import CountUp from '@/components/home/CountUp';
import PriceBoard, { type BoardItem } from '@/components/home/PriceBoard';
import RateTicker, { type Rate } from '@/components/home/RateTicker';
import { IconArrow, IconClockCheck, IconEstimate, IconPin, IconRoom, IconShield, IconStorefront } from '@/components/icons';
import Plate from '@/components/Plate';
import ProductCard from '@/components/ProductCard';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCatalogueCategories } from '@/lib/data';
import { skuTitle } from '@/lib/label';
import { inr, mediaUrl } from '@/lib/media';

export const revalidate = 60;

/** Tiles above the fold on a desktop grid; these load eagerly, the rest do not. */
const EAGER = 4;
/** How many stocked items rotate through the hero panel. Enough to feel deep, not a slideshow. */
const BOARD = 6;
/** How many go in the ticker. Six is one screen's worth at a readable speed. */
const TICKER = 6;
/** Two rows of the shelf. The rest are one click away in search. */
const SHELF = 8;

/**
 * The front door.
 *
 * Eight moves: a hero over a photograph of a finished house, the live rate strip, the three
 * counters a project passes through, the thirty-five categories, what is on the shelf, the four
 * promises, one invitation, and the footer.
 *
 * IT LEADS WITH CATEGORIES AND IT STILL DOES. There are thirty-five of them and
 * `PRODUCTS LIST.xlsx` is the authority — one sheet each, in this order. Cement is not one of
 * them: CONCRETING is, and cement is a product on that sheet, the same way tiles are a product on
 * FLOORING and glass on DOORS & WINDOWS. The shelf section below the grid is eight cards and a
 * link, not a second catalogue: the tree's top level is the page, and the shelf is evidence that
 * the shelves have things on them.
 */
export default async function Home() {
  const [cats, skus] = await Promise.all([loadCatalogueCategories(), loadFlagshipSkus()]);
  const liveCategories = cats.filter((c) => c.status === 'live').length;
  const brands = new Set(skus.map((s) => s.brand)).size;
  const priced = skus.filter((s) => s.selling_price !== null);

  /* The hero panel takes the priced items, one per category, so six swaps show six different
     parts of the shop rather than three cements in a row. */
  const board: BoardItem[] = [];
  const seenCategory = new Set<string>();
  for (const s of priced) {
    if (board.length >= BOARD) break;
    if (seenCategory.has(s.category)) continue;
    seenCategory.add(s.category);
    board.push({
      sku: s.sku_code,
      brand: s.brand,
      name: skuTitle(s.name, s.brand, s.variant_label),
      price: s.selling_price as number,
      unit: s.unit,
      image: s.hero_image_key ? mediaUrl(s.hero_image_key) : null,
      blurhash: s.blurhash,
      categoryName: s.category_name,
    });
  }

  /* The ticker takes the same spread — see components/home/RateTicker.tsx for what it carries
     and, more to the point, what it deliberately does not. */
  const rates: Rate[] = board.slice(0, TICKER).map((b) => ({ sku: b.sku, name: b.name, brand: b.brand, price: b.price, unit: b.unit }));

  return (
    <div className="home">
      {/*
       * The hero, in four layers: the photograph, the drafting grid, the copy, and the live
       * stock panel. The photograph is a dusk G+1 house with a parapet, a mumty, chajjas over
       * every window and a compound wall — a building this store's customers are actually
       * putting up, not a glass tower.
       */}
      <section className="hero" aria-labelledby="home-h">
        <Plate name="home-hero" priority className="hero-plate" />
        <span className="hero-grid" aria-hidden="true" />
        <div className="shell hero-in">
          <div className="hero-say">
            <p className="micro micro--live" data-reveal>
              Andhra Pradesh &amp; Telangana · priced this morning
            </p>
            <h1 id="home-h" className="d1 hero-title" data-reveal style={{ '--reveal-delay': '80ms' } as React.CSSProperties}>
              Know what it costs before you order it.
            </h1>
            <p className="lede hero-lede" data-reveal style={{ '--reveal-delay': '160ms' } as React.CSSProperties}>
              Cement, steel, tiles, glass, lighting, solar and safety, from the brands your engineer already writes into the specification. Every price is the
              tax-paid price per unit, landed at your pincode — and you can stand any item in your own room at its true size before you commit to it.
            </p>
            <div className="hero-cta" data-reveal style={{ '--reveal-delay': '240ms' } as React.CSSProperties}>
              <Link href="/search" className="btn btn-primary btn--lg">
                <IconStorefront size={18} /> Browse the catalogue
              </Link>
              <Link href="/estimate" className="btn btn-secondary btn--lg">
                <IconEstimate size={18} /> Cost a whole house
              </Link>
            </div>
            <dl className="hero-facts" data-reveal style={{ '--reveal-delay': '320ms' } as React.CSSProperties}>
              <div>
                <dt className="micro">Categories</dt>
                <dd className="fig">
                  <CountUp to={cats.length} />
                </dd>
              </div>
              <div>
                <dt className="micro">Priced today</dt>
                <dd className="fig">
                  <CountUp to={priced.length} />
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

          <div className="hero-board" data-reveal style={{ '--reveal-delay': '400ms' } as React.CSSProperties}>
            <PriceBoard items={board} />
          </div>
        </div>
      </section>

      <RateTicker rates={rates} />

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

      {/* ── the catalogue's top level: thirty-five categories, nothing below them ── */}
      <section className="shell sec" aria-labelledby="cats-h">
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
                  meta={
                    c.skuCount > 0 ? (
                      <>
                        <span className="fig">{c.skuCount}</span> {c.skuCount === 1 ? 'item' : 'items'}
                        {c.fromPrice !== null && (
                          <>
                            {' · from '}
                            <span className="fig">{inr(c.fromPrice)}</span>
                          </>
                        )}
                      </>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── what is on the shelf right now ───────────────────────────────────
          Eight cards and a link, not a second catalogue. This page is the top of the tree and the
          grid above it is the page; this section is the evidence that the shelves have things on
          them, which is a different claim and needs photographs to make it. */}
      {skus.length > 0 && (
        <section className="shell sec" aria-labelledby="stock-h">
          <div className="sec-head" data-reveal>
            <div>
              <p className="micro micro--live sec-eyebrow">Priced today</p>
              <h2 id="stock-h" className="d2">
                On the shelf now
              </h2>
              <p className="lede sec-sub">
                <span className="fig">{priced.length}</span> items we can price today, from <span className="fig">{brands}</span> brands. Every figure is per
                unit and includes GST.
              </p>
            </div>
            <Link href="/search" className="sec-more">
              Open in search <IconArrow size={16} />
            </Link>
          </div>
          <ul className="shelf-rail stagger">
            {skus.slice(0, SHELF).map((s, i) => (
              <li key={s.sku_code} data-reveal style={{ '--i': i % 4 } as React.CSSProperties}>
                <ProductCard sku={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── what every price on the site carries ─────────────────────────────
          Four promises, each one a thing the store actually does rather than a virtue it claims
          to have. "Trusted brands" and "quality materials" used to sit here; they say nothing a
          competitor could not also say, which means they say nothing. */}
      <section className="shell sec promises" aria-labelledby="promise-h">
        <h2 id="promise-h" className="visually-hidden">
          What every price on this site carries
        </h2>
        <ul className="promise-grid stagger">
          {[
            {
              Icon: IconShield,
              head: 'The price is the price',
              body: 'What you see per unit is the tax-paid figure, and the GST rate inside it is printed next to it. Nothing is added at the end.',
            },
            {
              Icon: IconClockCheck,
              head: 'Every figure says where it came from',
              body: 'Read from the brand, cross-checked, or filled from the class standard — each row on a specification tells you which.',
            },
            {
              Icon: IconRoom,
              head: 'See it in the room first',
              body: 'Point your camera at the wall or the floor and the item stands there at true size, before you have spent anything.',
            },
            {
              Icon: IconPin,
              head: 'Landed at your pincode',
              body: 'Set the pincode once under the header and every price on the site becomes the delivered price, not the yard price.',
            },
          ].map(({ Icon, head, body }, i) => (
            <li key={head} data-reveal style={{ '--i': i } as React.CSSProperties}>
              <Icon size={24} />
              <h3 className="h4">{head}</h3>
              <p className="meta">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── the invitation ───────────────────────────────────────────────────
          One band, two doors, and the honest span of what a house costs. It repeats the hero's
          two calls to action deliberately: this is the bottom of a long page, and a reader who
          has come this far should not have to scroll back up to act on it. */}
      <section className="shell sec">
        <div className="band" data-reveal>
          <div className="band-say">
            <p className="micro sec-eyebrow">Start anywhere</p>
            <h2 className="d2">Price a bag of cement, or price the whole house.</h2>
            <p className="lede">
              The estimator works from plot size, floors and finish level and gives you a floor, a likely figure and a ceiling — with every line traceable to a
              rate you can check.
            </p>
          </div>
          <div className="band-do">
            <Link href="/estimate" className="btn btn-primary btn--lg">
              <IconEstimate size={18} /> Cost a whole house
            </Link>
            <Link href="/search" className="btn btn-secondary btn--lg">
              <IconStorefront size={18} /> Browse the catalogue
            </Link>
          </div>
        </div>
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
