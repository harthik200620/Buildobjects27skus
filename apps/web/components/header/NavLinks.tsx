'use client';

import { DEPARTMENTS } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { CategoryIcon, IconChevronDown, IconEstimate, IconRoom } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { AR_DEMO_HREF, type NavCategory } from './types';

/**
 * The department strip under the header, and the panel of categories each one drops.
 *
 * The strip used to list all nine categories flat, which worked at nine and stops working at
 * thirty-seven. Departments are the level the specification workbook already organised the
 * catalogue by — Electrical Items over Bulbs, Surveying Equipment over Total Stations — so a
 * buyer reads eight words instead of thirty-seven, and the products are one hover away.
 *
 * Only departments that stock something today get a place in the strip; the rest of the tree
 * lives behind "All" and on the category pages, where an empty shelf is stated rather than
 * dressed up as a destination.
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
      DEPARTMENTS.map((d) => {
        const mine = categories.filter((c) => c.department === d.key);
        return { ...d, categories: [...mine.filter((c) => c.status === 'live'), ...mine.filter((c) => c.status !== 'live')] };
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
        // A department with one category and nothing coming is a link, not a menu of one.
        if (d.categories.length === 1) {
          const only = d.categories[0];
          return (
            <Link key={d.key} href={`/c/${only.slug}`} className="nav-link" aria-current={here ? 'page' : undefined}>
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
        <IconEstimate size={16} /> Cost Calculator
      </Link>
      <Link href={arHref} className="nav-link nav-tool" aria-current={pathname.startsWith('/ar/') ? 'page' : undefined}>
        <IconRoom size={16} /> View in your room
      </Link>
    </div>
  );
}
