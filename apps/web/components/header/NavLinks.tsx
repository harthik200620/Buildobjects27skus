'use client';

import { CATEGORIES, categoryOf, isProduct } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { CategoryIcon, IconChevronDown, IconEstimate, IconRoom } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { AR_DEMO_HREF, type NavCategory } from './types';

/**
 * The category strip under the header, and the products each one drops.
 *
 * These are the categories of `PRODUCTS LIST.xlsx` — Concreting over Cement, Flooring over
 * Tiles — so the strip reads the same tree the home page does. Only the ones that stock
 * something get a place here; the other twenty-six live behind "All" and on their own pages,
 * where an empty shelf is stated rather than dressed up as a destination.
 */
export default function NavLinks({ categories, arHref = AR_DEMO_HREF }: { categories: NavCategory[]; arHref?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState<string | null>(null);
  /* .nav-in scrolls sideways, so an absolutely positioned panel is clipped by it. The panel
     is fixed and measured off its own button, which means a scroll or resize moves it out
     from under the trigger — closing is cheaper and less jarring than re-measuring. */
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const wrap = React.useRef<HTMLDivElement>(null);

  useDismiss(!!open, () => setOpen(null), { panel: wrap });

  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const strip = wrap.current;
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    strip?.addEventListener('mouseleave', close);
    return () => {
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
      strip?.removeEventListener('mouseleave', close);
    };
  }, [open]);

  const show = (key: string, el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect();
    setPos(r ? { top: Math.round(r.bottom), left: Math.round(r.left) } : null);
    setOpen(key);
  };

  /**
   * Departments that stock something, each dropping its whole subcategory list — what is on
   * the shelf first, then what is coming to the same shelf. Showing only the live ones meant
   * seven of the eight departments had a single item and no menu at all, which is not a tree.
   */
  const departments = React.useMemo(
    () =>
      CATEGORIES.map((d) => {
        const mine = categories.filter((c) => isProduct(c.slug) && categoryOf(c.slug) === d.slug);
        return { key: d.slug, name: d.name, categories: [...mine.filter((c) => c.status === 'live'), ...mine.filter((c) => c.status !== 'live')] };
      }).filter((d) => d.categories.some((c) => c.status === 'live')),
    [categories],
  );

  // A route change must close the panel; the click that caused it is on the link inside it.
  React.useEffect(() => setOpen(null), []);

  return (
    <div className="nav-depts" ref={wrap}>
      {departments.map((d) => {
        const expanded = open === d.key;
        const here = d.categories.some((c) => pathname === `/c/${c.slug}`);
        // A category holding one product is a link to the category, not a menu of one.
        if (d.categories.length === 1) {
          return (
            <Link key={d.key} href={`/c/${d.key}`} className="nav-link" aria-current={here ? 'page' : undefined}>
              {d.name}
            </Link>
          );
        }
        return (
          <div key={d.key} className="nav-dept">
            <button
              type="button"
              className={`nav-link nav-dept-btn${here ? ' is-here' : ''}`}
              aria-expanded={expanded}
              onClick={(e) => (expanded ? setOpen(null) : show(d.key, e.currentTarget))}
              onMouseEnter={(e) => show(d.key, e.currentTarget)}
            >
              {d.name}
              <IconChevronDown size={14} className={`nav-dept-caret${expanded ? ' is-open' : ''}`} />
            </button>
            {expanded && (
              <div className="nav-dept-panel fade-in" style={pos ?? undefined}>
                <ul>
                  {/* The category itself, above the products in it. */}
                  <li>
                    <Link href={`/c/${d.key}`} className="nav-dept-row nav-dept-all" onClick={() => setOpen(null)}>
                      <span>All of {d.name}</span>
                    </Link>
                  </li>
                  {d.categories.map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/c/${c.slug}`}
                        className={`nav-dept-row${c.status === 'live' ? '' : ' is-soon'}`}
                        aria-current={pathname === `/c/${c.slug}` ? 'page' : undefined}
                        onClick={() => setOpen(null)}
                      >
                        <CategoryIcon icon={c.icon ?? 'cement'} size={18} />
                        <span>{c.name}</span>
                        {c.status !== 'live' && <span className="nav-dept-soon">soon</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      <span className="nav-spacer" aria-hidden="true" />
      <Link href="/estimate" className="nav-link nav-tool" aria-current={pathname.startsWith('/estimate') ? 'page' : undefined}>
        <IconEstimate size={16} /> BO Estimator
      </Link>
      <Link href={arHref} className="nav-link nav-tool" aria-current={pathname.startsWith('/ar/') ? 'page' : undefined}>
        <IconRoom size={16} /> View in your room
      </Link>
    </div>
  );
}
