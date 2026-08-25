'use client';

import { DEPARTMENTS } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { CategoryIcon, IconClose, IconMenu } from '@/components/icons';
import Scrim from '@/components/Scrim';
import { useDismiss } from '@/components/useDismiss';
import { AR_DEMO_HREF, type NavCategory } from './types';

/**
 * "≡ All" → the whole catalogue, grouped by department: the categories that stock something
 * first, then the rest of the tree marked as arriving. A popover pinned under the trigger at
 * ≥ 768 px (fixed, so the scrolling nav strip cannot clip it; closes on scroll), a left drawer
 * with a scrim below. Rendered twice — the phone header's ≡ and the nav strip's "All" — only
 * one trigger is ever visible.
 */
export default function CategoryMenu({ categories, variant }: { categories: NavCategory[]; variant: 'all' | 'icon' }) {
  const pathname = usePathname();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const wrap = React.useRef<HTMLDivElement | null>(null);
  const btn = React.useRef<HTMLButtonElement | null>(null);
  const first = React.useRef<HTMLAnchorElement | null>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btn.current?.getBoundingClientRect();
    const wide = window.matchMedia('(min-width: 768px)').matches;
    setPos(wide && r ? { top: Math.round(r.bottom + 4), left: Math.max(8, Math.round(r.left)) } : null);
    setOpen(true);
  };

  useDismiss(open, () => setOpen(false), { panel: wrap, trigger: btn });

  React.useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  /* The panel is absolutely positioned against the trigger, so any scroll or resize moves it
     out from under the button. Closing is cheaper and less jarring than re-measuring. */
  React.useEffect(() => {
    if (!open || !pos) return;
    const reposition = () => setOpen(false);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }, [open, pos]);

  // Navigating closes the menu.
  React.useEffect(() => {
    setOpen(false);
  }, []);

  const close = () => setOpen(false);
  const panelId = `${id}-panel`;
  const live = categories.filter((c) => c.status === 'live');
  const byDepartment = DEPARTMENTS.map((d) => ({
    ...d,
    categories: categories.filter((c) => c.department === d.key && c.status !== 'live'),
  })).filter((d) => d.categories.length > 0);
  return (
    <div className="cat-menu-wrap" ref={wrap}>
      {variant === 'all' ? (
        <button
          ref={btn}
          type="button"
          className="nav-all"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
        >
          <IconMenu size={20} /> All
        </button>
      ) : (
        <button
          ref={btn}
          type="button"
          className="header-menu"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
          aria-label="Shop by category"
        >
          <IconMenu size={24} />
        </button>
      )}
      {open && (
        <>
          <Scrim className="cat-menu-scrim" onDismiss={close} />
          <div id={panelId} className="popover cat-menu fade-in" style={pos ?? undefined} role="dialog" aria-label="Shop by category">
            <div className="cat-menu-head">
              <span>Shop by category</span>
              <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
                <IconClose size={20} />
              </button>
            </div>
            <div className="cat-menu-scroll">
              <ul className="cat-menu-list">
                {live.map((c, i) => (
                  <li key={c.slug}>
                    <Link
                      ref={i === 0 ? first : undefined}
                      href={`/c/${c.slug}`}
                      className="cat-menu-row"
                      aria-current={pathname === `/c/${c.slug}` ? 'page' : undefined}
                      onClick={close}
                    >
                      <CategoryIcon icon={c.icon ?? 'cement'} size={22} />
                      <span className="cat-menu-name">{c.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {byDepartment.map((d) => (
                <div key={d.key} className="cat-menu-dept">
                  <h3 className="cat-menu-dept-name">
                    {/* The heading is the category itself — cement lives inside this, not beside it. */}
                    <Link href={`/c/${d.key}`} onClick={close}>
                      {d.name}
                    </Link>
                  </h3>
                  <ul className="cat-menu-list">
                    {d.categories.map((c) => (
                      <li key={c.slug}>
                        <Link
                          href={`/c/${c.slug}`}
                          className="cat-menu-row is-soon"
                          aria-current={pathname === `/c/${c.slug}` ? 'page' : undefined}
                          onClick={close}
                        >
                          <CategoryIcon icon={c.icon ?? 'cement'} size={20} />
                          <span className="cat-menu-name">{c.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="cat-menu-foot">
              <Link href="/search" className="link" onClick={close}>
                All products
              </Link>
              <Link href="/estimate" className="link" onClick={close}>
                BO Estimator
              </Link>
              <Link href={AR_DEMO_HREF} className="link" onClick={close}>
                View in your room
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
