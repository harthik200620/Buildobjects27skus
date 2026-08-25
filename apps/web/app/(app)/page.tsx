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
      <section className="page-head" style={{ paddingTop: 'var(--s-7)' }}>
        <p className="eyebrow">BO Environment · Andhra Pradesh & Telangana</p>
        <h1 className="display home-title mt-3">BO Store & Construction Hub</h1>
        <p className="page-sub max-w-[56ch]" style={{ fontSize: 14 }}>
          Engineering-grade construction materials with live GST-inclusive pricing, 1:1 true scale Live AR placement in your room, and the BO House Cost
          Calculator.
        </p>
      </section>

      {/* ── shop by category: the nine that sell, then the rest of the tree ─── */}
      <section className="sec" aria-labelledby="cats-h">
        <div className="sec-head">
          <div>
            <h2 id="cats-h" className="sec-title">
              Shop by category
            </h2>
            <p className="sec-sub">
              <span className="fig">{live.length}</span> categories stocked today, <span className="fig">{cats.length}</span> in the catalogue.
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
                  Arriving soon
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
            , filtered by the specs that matter, with datasheets and 3D AR view on every page.
          </span>
          <IconArrow size={20} className="dest-arrow" />
        </Link>
        <Link href="/estimate" className="dest lift">
          <IconEstimate size={26} className="dest-icon" />
          <span className="dest-kicker">BO Intelligence</span>
          <span className="display dest-title">BO Cost Calculator</span>
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
              Flagship products
            </h2>
            <p className="sec-sub">Every product carries its full specification sheet, the source of every figure, and a 1:1 room view.</p>
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
          <IconShield size={16} /> GST stated, per unit
        </span>
        <span>
          <IconClockCheck size={16} /> Price source and date on every page
        </span>
        <span>
          <IconRoom size={16} /> View any product in your room
        </span>
        <span>
          <IconPin size={16} /> Delivered to your pincode
        </span>
      </section>

      <footer className="foot">
        <span>Build Objects · Price Intelligence</span>
        <span className="flex gap-4">
          <Link href="/estimate">Cost calculator</Link>
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
      <p className="display">The shelves are being filled</p>
      <p>
        Run <code className="fig">pnpm registry:seed</code> and <code className="fig">pnpm pipeline run</code> — the categories appear here with live counts.
      </p>
    </div>
  );
}
