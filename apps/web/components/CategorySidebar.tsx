import { CATEGORIES, categoryOf, isProduct } from '@buildobjects/catalog';
import Link from 'next/link';
import type { CategoryRef } from '@/lib/catalog';
import { CategoryIcon } from './icons';

/**
 * The whole catalogue tree beside the results, the way a trade counter is laid out: the thirty-
 * five categories of `PRODUCTS LIST.xlsx`, the nine that stock something first with the products
 * named under them, then the rest — so a buyer can see the shop is bigger than the shelves that
 * are full today.
 *
 * Empty categories are links, not dead text — the page they land on says plainly that the shelf
 * is being filled, which is more use than a name you cannot click.
 */
export default function CategorySidebar({ categories, current }: { categories: CategoryRef[]; current?: string }) {
  const products = categories.filter((c) => isProduct(c.slug));
  const groups = CATEGORIES.map((d) => ({ ...d, products: products.filter((c) => categoryOf(c.slug) === d.slug) }));
  const stocked = groups.filter((g) => g.products.some((c) => c.status === 'live'));
  const rest = groups.filter((g) => !g.products.some((c) => c.status === 'live'));
  /* `current` may be a category slug or a product slug; either marks its own row. */
  const inHere = (slug: string) => slug === current;

  return (
    <nav className="cat-rail" aria-label="All categories">
      <h2 className="cat-rail-head">Categories</h2>
      {/* Capped and scrollable: thirty-five links is taller than most viewports, and an
          uncapped list is what used to push every filter off the bottom of the rail. */}
      <div className="cat-rail-scroll">
        <ul className="cat-rail-list">
          {stocked.map((g) => (
            <li key={g.slug}>
              <Link href={`/c/${g.slug}`} className={`cat-rail-link${inHere(g.slug) ? ' is-current' : ''}`} aria-current={inHere(g.slug) ? 'page' : undefined}>
                <CategoryIcon icon={g.products[0]?.icon ?? g.slug} size={16} className="cat-rail-icon" />
                <span>{g.name}</span>
              </Link>
              {/* The products inside it — this rail sits on a product page, so the sibling it is
                  showing you is the one you are looking at. */}
              <ul className="cat-rail-list cat-rail-sub">
                {g.products.map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`/c/${c.slug}`}
                      className={`cat-rail-link cat-rail-child${inHere(c.slug) ? ' is-current' : ''}`}
                      aria-current={inHere(c.slug) ? 'page' : undefined}
                    >
                      <span>{c.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <div className="cat-rail-dept">
          <h3 className="cat-rail-dept-name">On the way</h3>
          <ul className="cat-rail-list">
            {rest.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/c/${g.slug}`}
                  className={`cat-rail-link is-soon${inHere(g.slug) ? ' is-current' : ''}`}
                  aria-current={inHere(g.slug) ? 'page' : undefined}
                >
                  <CategoryIcon icon={g.slug} size={16} className="cat-rail-icon" />
                  <span>{g.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
