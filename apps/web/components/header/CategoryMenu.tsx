'use client';

import { CATEGORIES, categoryOf, isProduct } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import { createPortal } from 'react-dom';
import { CategoryIcon, IconClose, IconMenu } from '@/components/icons';
import Scrim from '@/components/Scrim';
import { useDismiss } from '@/components/useDismiss';
import type { NavCategory } from './types';

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
  const panel = React.useRef<HTMLDivElement | null>(null);
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

  useDismiss(open, () => setOpen(false), { panel: [panel, wrap], trigger: btn });

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
  /* The thirty-five categories of PRODUCTS LIST.xlsx. The nine that stock something lead, each
     naming the products inside it; the rest follow as places the catalogue will reach. */
  const products = categories.filter((c) => isProduct(c.slug));
  const groups = CATEGORIES.map((d) => ({ key: d.slug, name: d.name, categories: products.filter((c) => categoryOf(c.slug) === d.slug) }));
  const live = groups.filter((g) => g.categories.some((c) => c.status === 'live'));
  const byDepartment = groups.filter((g) => !g.categories.some((c) => c.status === 'live'));
  return (
    <div className="cat-menu-wrap" ref={wrap}>
      {variant === 'all' ? (
        /* .navlink, the same class the two tool links beside it carry. It used to be its own
           `.nav-all` — 32px tall, pure white, a 6px radius — sitting next to 40px links in
           --ink-2 with a 9px radius, which is one control drawn twice by two different hands.
           "Catalogue" rather than "All": it opens the catalogue tree, and "All" only answered
           a question the strip above it used to be asking. */
        <button
          ref={btn}
          type="button"
          className="navlink"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="dialog"
        >
          <IconMenu size={17} />
          <span>Catalogue</span>
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
      {open &&
        /*
         * THE PANEL DOES NOT LIVE IN THE HEADER. It is `position: fixed` at coordinates measured
         * off the trigger in VIEWPORT space, and the header carries a backdrop-filter — which
         * makes it a containing block for fixed descendants exactly the way a transform does.
         * So the menu was being laid out against the bar's padding box rather than the screen,
         * and when the bar was inset it opened twenty pixels low and a gutter to the right of
         * the button that opened it.
         *
         * The header also sets z-index: 40 and therefore a stacking context, which clamped this
         * panel's z-index: 70 to the header's 40 — so any overlay on the page between the two
         * (the filter sheet's scrim is 60) painted OVER the catalogue menu.
         *
         * Both go away by rendering it where it belongs: at the top of the document.
         */
        createPortal(
          <>
            <Scrim className="cat-menu-scrim" onDismiss={close} />
            <div ref={panel} id={panelId} className="popover cat-menu fade-in" style={pos ?? undefined} role="dialog" aria-label="Shop by category">
              <div className="cat-menu-head">
                <span>Shop by category</span>
                <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
                  <IconClose size={20} />
                </button>
              </div>
              <div className="cat-menu-scroll">
                <ul className="cat-menu-list">
                  {live.map((g, i) => (
                    <li key={g.key}>
                      <Link
                        ref={i === 0 ? first : undefined}
                        href={`/c/${g.key}`}
                        className="cat-menu-row"
                        aria-current={pathname === `/c/${g.key}` ? 'page' : undefined}
                        onClick={close}
                      >
                        <CategoryIcon icon={g.categories[0]?.icon ?? 'cement'} size={22} />
                        <span className="cat-menu-name">{g.name}</span>
                        <span className="cat-menu-in">{g.categories.map((c) => c.name).join(', ')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="cat-menu-dept">
                  <h3 className="cat-menu-dept-name">On the way</h3>
                  <ul className="cat-menu-list">
                    {byDepartment.map((g) => (
                      <li key={g.key}>
                        <Link
                          href={`/c/${g.key}`}
                          className="cat-menu-row is-soon"
                          aria-current={pathname === `/c/${g.key}` ? 'page' : undefined}
                          onClick={close}
                        >
                          <CategoryIcon icon={g.key} size={20} />
                          <span className="cat-menu-name">{g.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="cat-menu-foot">
                <Link href="/search" className="link" onClick={close}>
                  All products
                </Link>
                <Link href="/estimate" className="link" onClick={close}>
                  BO Estimator
                </Link>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
