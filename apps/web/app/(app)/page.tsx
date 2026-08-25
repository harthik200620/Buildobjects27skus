import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import { IconArrow, IconClockCheck, IconEstimate, IconPin, IconRoom, IconShield, IconStorefront } from '@/components/icons';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadDepartments } from '@/lib/data';
import { inr } from '@/lib/media';

export const revalidate = 60;

/** Tiles above the fold on a desktop grid; these load eagerly, the rest do not. */
const EAGER = 4;

/**
 * The front door shows CATEGORIES. Only categories.
 *
 * The tree is the one the product workbook sets out in the first row of every sheet —
 * `CEMENT · Construction Materials · 3 brands` — which reads category, product, then the brands
 * underneath. So cement is not a category: it is a product inside Construction Materials, next to
 * bricks and steel. This page used to show all thirty-seven products as tiles and then a grid of
 * every SKU below them, which put the leaves of the tree on the page that exists to show its
 * branches.
 *
 * Thirteen tiles now. Each opens its category, and the products are in there.
 */
export default async function Home() {
  const [depts, skus] = await Promise.all([loadDepartments(), loadFlagshipSkus()]);
  const productCount = depts.reduce((n, d) => n + d.productCount, 0);
  const liveCategories = depts.filter((d) => d.status === 'live').length;

  return (
    <div className="page shell home">
      {/*
       * The hero. The advertisement is not a banner on top of the page — it is part of the field
       * the whole hero sits in: the teal wash, the construction grid and the glow are one
       * composition, and the slot is a defined area inside it. It carries no label. A box that
       * announces its own emptiness is worse than a considered space that simply holds its ground
       * until there is a creative to put in it.
       */}
      <section className="hero" aria-labelledby="home-h">
        <div className="hero-in">
          <div>
            <p className="hero-eyebrow">Building materials, delivered</p>
            <h1 id="home-h" className="hero-title">
              Everything your site needs, at a price you can check.
            </h1>
            <p className="hero-lede">
              Cement, steel, tiles, glass, lighting, solar and safety — from the brands your engineer already asks for. Every price is per unit with GST stated,
              and you can see any product standing in your own room before you order it.
            </p>
            <div className="hero-cta">
              <Link href="/search" className="btn-primary btn--lg">
                <IconStorefront size={16} /> Browse the store
              </Link>
              <Link href="/estimate" className="btn-secondary btn--lg">
                <IconEstimate size={16} /> What will my house cost?
              </Link>
            </div>
            <p className="hero-facts">
              <span>
                <b>{depts.length}</b> categories
              </span>
              <span>
                <b>{productCount}</b> products
              </span>
              <span>
                <b>{skus.length}</b> items on the shelf
              </span>
            </p>
          </div>
          <div className="hero-ad" aria-hidden />
        </div>
      </section>

      {/* ── the catalogue's top level: thirteen categories, nothing below them ── */}
      <section className="sec" aria-labelledby="cats-h">
        <div className="sec-head">
          <div>
            <h2 id="cats-h" className="sec-title">
              Shop by category
            </h2>
            <p className="sec-sub">
              <span className="fig">{liveCategories}</span> of <span className="fig">{depts.length}</span> stocked today. Open one to see the products in it —
              cement and steel are in Construction Materials, tiles and glass in Building Materials.
            </p>
          </div>
          <Link href="/search" className="sec-more">
            Browse everything <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
          </Link>
        </div>

        {depts.length === 0 ? (
          <EmptyShelves />
        ) : (
          <ul className="cat-grid">
            {depts.map((d, i) => (
              <li key={d.key}>
                <CategoryTile
                  href={`/c/${d.key}`}
                  name={d.name}
                  heroImageKey={d.heroImageKey}
                  soon={d.status !== 'live'}
                  priority={i < EAGER}
                  meta={
                    <>
                      <span className="fig">{d.productCount}</span> {d.productCount === 1 ? 'product' : 'products'}
                      {d.skuCount > 0 && (
                        <>
                          <span className="cat-dot" aria-hidden>
                            ·
                          </span>
                          <span className="fig">{d.skuCount}</span> on the shelf
                        </>
                      )}
                    </>
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
          <div className="sec-head">
            <div>
              <h2 id="stock-h" className="sec-title">
                On the shelf now
              </h2>
              <p className="sec-sub">
                Every one of the <span className="fig">{skus.length}</span> items we stock today, priced per unit with GST stated.
              </p>
            </div>
            <Link href="/search" className="sec-more">
              Open in search <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
            </Link>
          </div>
          <ul className="stock-strip">
            {skus.map((s) => (
              <li key={s.sku_code}>
                <Link href={`/p/${s.sku_code.toLowerCase()}`} className="stock-chip">
                  <span className="stock-chip-brand">{s.brand}</span>
                  <span className="stock-chip-name">{s.name}</span>
                  {s.selling_price !== null && <span className="stock-chip-price fig">{inr(s.selling_price)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── the compact trust bar ────────────────────────────────────────── */}
      <section className="trust-mini sec" aria-label="What every price carries">
        <span>
          <IconShield size={16} /> GST shown separately on every price
        </span>
        <span>
          <IconClockCheck size={16} /> You can see where each price came from
        </span>
        <span>
          <IconRoom size={16} /> See any product in your own room first
        </span>
        <span>
          <IconPin size={16} /> Delivered to your pincode
        </span>
      </section>

      <footer className="foot">
        <span>Build Objects</span>
        <span className="flex gap-4">
          <Link href="/estimate">BO Estimator</Link>
          <Link href="/search">All products</Link>
          <a href="/api/health">Status</a>
        </span>
      </footer>
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
