import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import CountUp from '@/components/home/CountUp';
import PriceBoard, { type BoardItem } from '@/components/home/PriceBoard';
import { IconArrow, IconClockCheck, IconEstimate, IconPin, IconRoom, IconShield, IconStorefront } from '@/components/icons';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCatalogueCategories } from '@/lib/data';
import { skuTitle, skuVariant } from '@/lib/label';
import { inr, mediaUrl } from '@/lib/media';

export const revalidate = 60;

/** Tiles above the fold on a desktop grid; these load eagerly, the rest do not. */
const EAGER = 4;
/** How many stocked items rotate through the hero panel. Enough to feel deep, not a slideshow. */
const BOARD = 6;

/**
 * The front door shows CATEGORIES. Only categories.
 *
 * There are thirty-five of them and `PRODUCTS LIST.xlsx` is the authority — one sheet each, in
 * this order. Cement is not one of them: CONCRETING is, and cement is a product on that sheet,
 * the same way tiles are a product on FLOORING and glass on DOORS & WINDOWS.
 *
 * The page is four moves and then the footer: a hero that states the offer and shows live stock
 * beside it, the thirty-five tiles, everything on the shelf as one line each, and what every
 * price on the site carries. Nothing on it is filler and nothing on it is a placeholder.
 */
export default async function Home() {
  const [cats, skus] = await Promise.all([loadCatalogueCategories(), loadFlagshipSkus()]);
  const liveCategories = cats.filter((c) => c.status === 'live').length;
  const brands = new Set(skus.map((s) => s.brand)).size;

  /* The hero panel takes the priced items, one per category, so six swaps show six different
     parts of the shop rather than three cements in a row. */
  const board: BoardItem[] = [];
  const seenCategory = new Set<string>();
  for (const s of skus) {
    if (board.length >= BOARD) break;
    if (s.selling_price === null || seenCategory.has(s.category)) continue;
    seenCategory.add(s.category);
    board.push({
      sku: s.sku_code,
      brand: s.brand,
      name: skuTitle(s.name, s.brand, s.variant_label),
      price: s.selling_price,
      unit: s.unit,
      image: s.hero_image_key ? mediaUrl(s.hero_image_key) : null,
      blurhash: s.blurhash,
      categoryName: s.category_name,
    });
  }

  return (
    <div className="page shell home">
      {/*
       * The hero. The teal wash, the construction grid and the glow are one field, and the
       * headline, the promise and the stock panel all sit inside it — the panel is part of the
       * composition rather than a banner dropped on top of it.
       */}
      <section className="hero" aria-labelledby="home-h">
        <div className="hero-in">
          <div className="hero-say">
            <p className="hero-eyebrow">Andhra Pradesh &amp; Telangana</p>
            <h1 id="home-h" className="hero-title">
              Know what it costs before you order it.
            </h1>
            <p className="hero-lede">
              Cement, steel, tiles, glass, lighting, solar and safety, from the brands your engineer already writes into the specification. Every price is the
              tax-paid price per unit, landed at your pincode — and you can stand any item in your own room at its true size before you commit to it.
            </p>
            <div className="hero-cta">
              <Link href="/search" className="btn btn-primary btn--lg">
                <IconStorefront size={16} /> Browse the catalogue
              </Link>
              <Link href="/estimate" className="btn btn-secondary btn--lg">
                <IconEstimate size={16} /> Cost a whole house
              </Link>
            </div>
            <dl className="hero-facts">
              <div>
                <dt>Categories</dt>
                <dd>
                  <CountUp to={cats.length} />
                </dd>
              </div>
              <div>
                <dt>Priced today</dt>
                <dd>
                  <CountUp to={skus.length} />
                </dd>
              </div>
              <div>
                <dt>Brands</dt>
                <dd>
                  <CountUp to={brands} />
                </dd>
              </div>
            </dl>
          </div>

          <div className="hero-board">
            <PriceBoard items={board} />
          </div>
        </div>
      </section>

      {/* ── the catalogue's top level: thirty-five categories, nothing below them ── */}
      <section className="sec" aria-labelledby="cats-h">
        <div className="sec-head" data-reveal>
          <div>
            <h2 id="cats-h" className="sec-title">
              Every category we carry
            </h2>
            <p className="sec-sub">
              <span className="fig">{liveCategories}</span> of <span className="fig">{cats.length}</span> are stocked today. The rest are shelves we are filling
              — open one and it will tell you plainly where it stands.
            </p>
          </div>
          <Link href="/search" className="sec-more">
            Browse everything <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
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

      {/*
       * Everything on the shelf right now, as one line each.
       *
       * Not product cards, and not a second grid. This page is the top of the tree; a wall of
       * photographs below the categories would put the leaves back on it. A name and a price says
       * "this exists and it costs this" — the card, the specification and the room view all live
       * on the item's own page.
       */}
      {skus.length > 0 && (
        <section className="sec" aria-labelledby="stock-h">
          <div className="sec-head" data-reveal>
            <div>
              <h2 id="stock-h" className="sec-title">
                On the shelf now
              </h2>
              <p className="sec-sub">
                All <span className="fig">{skus.length}</span> items we can price today, from <span className="fig">{brands}</span> brands. Each price is per
                unit and includes GST.
              </p>
            </div>
            <Link href="/search" className="sec-more">
              Open in search <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
            </Link>
          </div>
          <ul className="stock-strip stagger">
            {skus.map((s, i) => (
              <li key={s.sku_code} data-reveal style={{ '--i': i % 4 } as React.CSSProperties}>
                <Link href={`/p/${s.sku_code.toLowerCase()}`} className="stock-chip" title={s.name}>
                  <span className="stock-chip-top">
                    <span className="stock-chip-brand">{s.brand}</span>
                    {s.selling_price !== null && <span className="stock-chip-price fig">{inr(s.selling_price)}</span>}
                  </span>
                  <span className="stock-chip-name">{skuTitle(s.name, s.brand, s.variant_label)}</span>
                  {skuVariant(s.variant_label) && <span className="stock-chip-variant">{skuVariant(s.variant_label)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── what every price on the site carries ─────────────────────────────
          Four promises, each one a thing the store actually does rather than a virtue it claims
          to have. "Trusted brands" and "quality materials" used to sit here; they say nothing a
          competitor could not also say, which means they say nothing. */}
      <section className="sec promises" aria-labelledby="promise-h">
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
              body: 'Set the pincode once in the header and every price on the site becomes the delivered price, not the yard price.',
            },
          ].map(({ Icon, head, body }, i) => (
            <li key={head} data-reveal style={{ '--i': i } as React.CSSProperties}>
              <Icon size={20} />
              <h3>{head}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function EmptyShelves() {
  return (
    <div className="empty glass-card" style={{ borderRadius: 'var(--radius-glass)' }}>
      <p className="kicker">Catalogue</p>
      <p className="display">The shelves are still being filled</p>
      <p>
        Run <code className="fig">pnpm registry:seed</code> and <code className="fig">pnpm pipeline run</code> — the categories appear here with live counts.
      </p>
    </div>
  );
}
