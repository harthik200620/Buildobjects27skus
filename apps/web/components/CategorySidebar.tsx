import { DEPARTMENTS } from '@buildobjects/catalog';
import Link from 'next/link';
import type { CategoryRef } from '@/lib/catalog';
import { CategoryIcon } from './icons';

/**
 * The whole catalogue tree beside the results, the way a trade counter is laid out: what we
 * stock first, then everything else grouped by department so a buyer can see the shop is
 * bigger than the nine shelves that are full today.
 *
 * Upcoming categories are links, not dead text — the page they land on says plainly that the
 * shelf is being filled, which is more use than a name you cannot click.
 */
export default function CategorySidebar({ categories, current }: { categories: CategoryRef[]; current?: string }) {
  const live = categories.filter((c) => c.status === 'live');
  const soon = categories.filter((c) => c.status !== 'live');
  const byDepartment = DEPARTMENTS.map((d) => ({ ...d, categories: soon.filter((c) => c.department === d.key) })).filter((d) => d.categories.length > 0);

  return (
    <nav className="cat-rail" aria-label="All categories">
      <h2 className="cat-rail-head">Categories</h2>
      {/* Capped and scrollable: thirty-seven links is taller than most viewports, and an
          uncapped list is what used to push every filter off the bottom of the rail. */}
      <div className="cat-rail-scroll">
        <ul className="cat-rail-list">
          {live.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/c/${c.slug}`}
                className={`cat-rail-link${c.slug === current ? ' is-current' : ''}`}
                aria-current={c.slug === current ? 'page' : undefined}
              >
                <CategoryIcon icon={c.icon ?? 'cement'} size={16} className="cat-rail-icon" />
                <span>{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>

        {byDepartment.map((d) => (
          <div key={d.key} className="cat-rail-dept">
            <h3 className="cat-rail-dept-name">{d.name}</h3>
            <ul className="cat-rail-list">
              {d.categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/c/${c.slug}`}
                    className={`cat-rail-link is-soon${c.slug === current ? ' is-current' : ''}`}
                    aria-current={c.slug === current ? 'page' : undefined}
                  >
                    <CategoryIcon icon={c.icon ?? 'cement'} size={16} className="cat-rail-icon" />
                    <span>{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
