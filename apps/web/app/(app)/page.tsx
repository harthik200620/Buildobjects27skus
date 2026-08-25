import { DEPARTMENTS } from '@buildobjects/catalog';
import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import { IconArrow, IconClockCheck, IconEstimate, IconPin, IconRoom, IconShield, IconStorefront } from '@/components/icons';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCategories } from '@/lib/data';
import { inr } from '@/lib/media';

export const revalidate = 60;

/** Tiles above the fold on a desktop grid; these load eagerly, the other thirty-three do not. */
const EAGER = 4;

export default async function Home() {
  const [cats, skus] = await Promise.all([loadCategories(), loadFlagshipSkus()]);
  const live = cats.filter((c) => c.status === 'live');
  const soon = cats.filter((c) => c.status !== 'live');
  const products = live.reduce((n, c) => n + (c.stats?.sku_count ?? 0), 0);

  // Upcoming categories are grouped under their department, in the nav's order, so someone
  // scanning twenty-eight tiles reads a structure rather than an alphabet.
  const byDepartment = DEPARTMENTS.map((d) => ({ ...d, categories: soon.filter((c) => c.department === d.key) })).filter((d) => d.categories.length > 0);

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
                <b>{live.length}</b> categories stocked
              </span>
              <span>
                <b>{products}</b> products
              </span>
              <span>
                <b>{cats.length}</b> in the full catalogue
              </span>
            </p>
          </div>
          <div className="hero-ad" aria-hidden />
        </div>
      </section>

      {/* ── the catalogue, as a taxonomy: all thirty-seven, one card, one grid ── */}
      <section className="sec" aria-labelledby="cats-h">
        <div className="sec-head">
          <div>
            <h2 id="cats-h" className="sec-title">
              Shop by category
            </h2>
            <p className="sec-sub">
              <span className="fig">{live.length}</span> stocked today. The other <span className="fig">{soon.length}</span> are on the way.
            </p>
          </div>
          <Link href="/search" className="sec-more">
            Browse everything <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
          </Link>
        </div>

        {cats.length === 0 ? (
          <EmptyShelves />
        ) : (
          <>
            <ul className="cat-grid">
              {live.map((c, i) => (
                <li key={c.slug}>
                  <CategoryTile category={c} priority={i < EAGER} />
                </li>
              ))}
            </ul>

            {byDepartment.length > 0 && (
              <div className="dept-block">
                <h3 className="dept-head">
                  On the way
                  <span className="dept-count">
                    <span className="fig">{soon.length}</span> more categories
                  </span>
                </h3>
                {byDepartment.map((d) => (
                  <section key={d.key} className="dept" aria-labelledby={`dept-${d.key}`}>
                    <h4 id={`dept-${d.key}`} className="dept-name">
                      {d.name}
                    </h4>
                    <ul className="cat-grid">
                      {d.categories.map((c) => (
                        <li key={c.slug}>
                          <CategoryTile category={c} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/*
       * Everything on the shelf right now, as one line each.
       *
       * Not product cards. This page is the taxonomy — a grid of photographs and prices below it
       * would put the store's twenty-seven products in front of its thirty-seven categories and
       * bury the thing the page is for. A name and a price is enough to say "this exists and it
       * costs this"; the card, the specification and the room view live on the product page.
       */}
      {skus.length > 0 && (
        <section className="sec" aria-labelledby="stock-h">
          <div className="sec-head">
            <div>
              <h2 id="stock-h" className="sec-title">
                On the shelf now
              </h2>
              <p className="sec-sub">
                Every one of the <span className="fig">{skus.length}</span> products we stock today, priced per unit with GST stated.
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
