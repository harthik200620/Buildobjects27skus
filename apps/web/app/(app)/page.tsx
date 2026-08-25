import { DEPARTMENTS } from '@buildobjects/catalog';
import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import { IconArrow, IconClockCheck, IconEstimate, IconPin, IconRoom, IconShield, IconStorefront } from '@/components/icons';
import ProductCard from '@/components/ProductCard';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCategories } from '@/lib/data';

export const revalidate = 60;

export default async function Home() {
  const [cats, skus] = await Promise.all([loadCategories(), loadFlagshipSkus()]);
  const live = cats.filter((c) => c.status === 'live');
  const soon = cats.filter((c) => c.status !== 'live');
  const products = live.reduce((n, c) => n + (c.stats?.sku_count ?? 0), 0);

  // Upcoming categories are grouped under their department, in the nav's order, so a buyer
  // scanning twenty-eight tiles reads a structure rather than an alphabet.
  const byDepartment = DEPARTMENTS.map((d) => ({ ...d, categories: soon.filter((c) => c.department === d.key) })).filter((d) => d.categories.length > 0);

  return (
    <div className="page shell home">
      {/*
       * The hero. The advertisement is not a banner on top of the page — it is part of the
       * field the whole hero sits in: the teal wash, the construction grid and the glow are
       * one composition, and the slot is a defined area inside it. It is empty today and says
       * so in the corner, because a placeholder pretending to be a creative is worse than a
       * considered space that is honest about waiting for one.
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
                Start shopping <IconArrow size={16} />
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
          <aside className="hero-ad" aria-label="Advertisement space">
            <span className="hero-ad-note">Advertising space — available</span>
          </aside>
        </div>
      </section>

      {/* ── shop by category: the nine that sell, then the rest of the tree ─── */}
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
            <ul className="cat-grid mt-4">
              {live.map((c) => (
                <li key={c.slug}>
                  <CategoryTile category={c} />
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
                    <ul className="cat-grid cat-grid--sm">
                      {d.categories.map((c) => (
                        <li key={c.slug}>
                          <CategoryTile category={c} size="sm" />
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

      {/* ── the two destinations ─────────────────────────────────────────── */}
      <section className="dest-grid" aria-label="Start here">
        <Link href="/search" className="dest lift">
          <IconStorefront size={26} className="dest-icon" />
          <span className="dest-kicker">BO Marketplace</span>
          <span className="display dest-title">BO Store Products</span>
          <span className="dest-body">
            {products > 0 ? (
              <>
                <span className="fig">{products}</span> products across <span className="fig">{live.length}</span> live categories
              </>
            ) : (
              'Nine live categories'
            )}
            . Filter by the specifications that actually matter, read the datasheet, and see it in your room before you buy.
          </span>
          <IconArrow size={20} className="dest-arrow" />
        </Link>
        <Link href="/estimate" className="dest lift">
          <IconEstimate size={26} className="dest-icon" />
          <span className="dest-kicker">BO Intelligence</span>
          <span className="display dest-title">BO Estimator</span>
          <span className="dest-body">
            A house-construction estimate for any city in AP and Telangana — civil structure and interior finishes ledgered separately at three quality tiers.
          </span>
          <IconArrow size={20} className="dest-arrow" />
        </Link>
      </section>

      {/* ── the flagship catalogue ───────────────────────────────────────── */}
      <section className="sec" aria-labelledby="prods-h">
        <div className="sec-head">
          <div>
            <h2 id="prods-h" className="sec-title">
              Popular right now
            </h2>
            <p className="sec-sub">Every one carries its full specification sheet, the source of every figure, and a true-size view in your own room.</p>
          </div>
          <Link href="/search" className="sec-more">
            View all in search <IconArrow size={14} style={{ display: 'inline', verticalAlign: -1 }} />
          </Link>
        </div>

        {skus.length === 0 ? (
          <div className="empty glass-card mt-4" style={{ borderRadius: 'var(--radius-glass)' }}>
            <p className="kicker">Products</p>
            <p className="display">Ingesting flagship catalog</p>
            <p>
              Run <code className="fig">pnpm pipeline run</code> to populate product details and pricing.
            </p>
          </div>
        ) : (
          <div className="prod-grid mt-4">
            {skus.map((sku) => (
              <ProductCard key={sku.sku_code} sku={sku} />
            ))}
          </div>
        )}
      </section>

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
