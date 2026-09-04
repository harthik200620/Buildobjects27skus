'use client';

import React from 'react';
import { IconChevronDown, IconClose, IconFilter } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';
import { readPicks } from '@/lib/picks';
import {
  brandsOf,
  type Chip,
  chipsFor,
  decodeShelf,
  EMPTY_SHELF,
  encodeShelf,
  isFiltering,
  keeps,
  order,
  SHELF_SORTS,
  type ShelfFact,
  type ShelfSort,
  type ShelfState,
} from '@/lib/shelf';

/**
 * The filter row over "On the shelf now": chips for the two or three questions a shopper actually
 * asks, and a panel behind "Filters" for brand and order. It replaces a "Filter and compare" link
 * that sent the reader to the search page to do here what it would not let them do here.
 *
 * THE CARDS ARE NOT RE-RENDERED, THEY ARE HIDDEN. `children` is the server-rendered grid of
 * ProductCards, passed straight through untouched — so the product card stays a server component,
 * none of it is shipped to the browser twice, and the whole shelf is in the HTML for a reader with
 * no JavaScript and for a crawler. This component only sets `hidden` and `order` on the wrapper
 * around each card, addressed by `data-sku`. That is also why filtering is instant: nothing is
 * fetched, nothing re-renders, and the compositor does the rest.
 *
 * THE STATE IS IN THE URL, WRITTEN WITH replaceState. A filtered shelf is a link somebody can
 * send, and the back button behaves. A router push would be wrong twice over: it would re-fetch a
 * shelf the browser is already holding, and it would put the loading overlay over a change that
 * has not left the page.
 */
export default function ShelfBar({ facts, initial, children }: { facts: ShelfFact[]; initial: ShelfState; children: React.ReactNode }) {
  const [state, setState] = React.useState<ShelfState>(initial);
  const [open, setOpen] = React.useState(false);
  /* Empty until the browser has been asked. The first client render must match the server's, and
     the server cannot know what is on this device. */
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const gridRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const chips = React.useMemo(() => chipsFor(facts), [facts]);
  const brands = React.useMemo(() => brandsOf(facts), [facts]);
  const ceiling = React.useMemo(() => chips.find((c) => c.key === 'under'), [chips]);

  useDismiss(open, () => setOpen(false), { panel: panelRef });

  /* What the reader has already put in the estimate, and kept in step with it: the same tab can
     add a pick from a card on this very shelf. */
  React.useEffect(() => {
    const read = () => setPicked(new Set(readPicks().map((p) => p.sku_code)));
    read();
    window.addEventListener('bo-picks', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('bo-picks', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const onShelf = React.useMemo(() => facts.filter((f) => picked.has(f.sku)).length, [facts, picked]);
  const kept = React.useMemo(() => facts.filter((f) => keeps(f, state, picked)), [facts, state, picked]);

  /* Apply the decision to the DOM the server drew. */
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const rank = order(facts, state.sort);
    const alive = new Set(kept.map((f) => f.sku));
    for (const el of grid.querySelectorAll<HTMLElement>('[data-sku]')) {
      const sku = el.dataset.sku ?? '';
      el.hidden = !alive.has(sku);
      el.style.order = String(rank.get(sku) ?? 0);
    }
  }, [facts, state.sort, kept]);

  /* And to the URL, without navigating. */
  React.useEffect(() => {
    const p = encodeShelf(state, new URLSearchParams(window.location.search));
    const q = p.toString();
    const next = `${window.location.pathname}${q ? `?${q}` : ''}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [state]);

  /* Someone pressed back or forward, or shared a link into this page. */
  React.useEffect(() => {
    const pop = () => setState(decodeShelf(new URLSearchParams(window.location.search)));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const toggle = (key: Chip['key'] | 'picks') =>
    setState((s) => {
      if (key === 'under') return { ...s, under: s.under === null ? (ceiling?.value ?? null) : null };
      return { ...s, [key]: !s[key as 'offers' | 'checked' | 'stock' | 'picks'] };
    });

  const toggleBrand = (name: string) => setState((s) => ({ ...s, brands: s.brands.includes(name) ? s.brands.filter((b) => b !== name) : [...s.brands, name] }));

  const active = isFiltering(state);
  const panelCount = state.brands.length + (state.sort === 'default' ? 0 : 1);

  return (
    <>
      <div className="shelf-bar">
        <div className="shelf-filters-wrap">
          <button
            type="button"
            className="shelf-chip shelf-chip--filters"
            aria-expanded={open}
            aria-pressed={panelCount > 0}
            onClick={() => setOpen((o) => !o)}
          >
            <IconFilter size={15} />
            Filters
            {panelCount > 0 && <span className="shelf-chip-n fig">{panelCount}</span>}
            <IconChevronDown size={13} className="shelf-chip-caret" />
          </button>

          {open && (
            <div className="shelf-panel" ref={panelRef} role="dialog" aria-label="Filter and sort this shelf">
              {brands.length > 0 && (
                <fieldset className="shelf-field">
                  <legend className="shelf-legend">Brand</legend>
                  {brands.map((b) => (
                    <label key={b} className="shelf-opt">
                      <input type="checkbox" checked={state.brands.includes(b)} onChange={() => toggleBrand(b)} />
                      <span>{b}</span>
                      <span className="shelf-opt-n fig">{facts.filter((f) => f.brand === b).length}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset className="shelf-field">
                <legend className="shelf-legend">Order</legend>
                {SHELF_SORTS.map((s) => (
                  <label key={s.key} className="shelf-opt">
                    <input
                      type="radio"
                      name="shelf-sort"
                      checked={state.sort === s.key}
                      onChange={() => setState((v) => ({ ...v, sort: s.key as ShelfSort }))}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="shelf-panel-foot">
                <button type="button" className="btn btn-secondary btn--sm" onClick={() => setState({ ...EMPTY_SHELF })} disabled={!active}>
                  Clear all
                </button>
                <button type="button" className="btn btn-primary btn--sm" onClick={() => setOpen(false)}>
                  Show {kept.length}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="shelf-chips" role="group" aria-label="Filter this shelf">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="shelf-chip"
              aria-pressed={c.key === 'under' ? state.under !== null : state[c.key as 'offers' | 'checked' | 'stock']}
              onClick={() => toggle(c.key)}
            >
              {c.label}
            </button>
          ))}

          {/* Only when the reader has something on THIS shelf in their estimate — a chip that
              could only ever keep nothing is not offered. */}
          {onShelf > 0 && (
            <button type="button" className="shelf-chip" aria-pressed={state.picks} onClick={() => toggle('picks')}>
              In my estimate <span className="shelf-chip-n fig">{onShelf}</span>
            </button>
          )}

          {active && (
            <button type="button" className="shelf-chip shelf-chip--clear" onClick={() => setState({ ...EMPTY_SHELF })}>
              <IconClose size={13} />
              Clear
            </button>
          )}
        </div>

        {/* Said once, politely, and only when it is news. aria-live so a screen reader hears the
            shelf change — the chips are buttons whose effect is somewhere else on the page. */}
        <p className="shelf-count" aria-live="polite">
          {active ? (
            <>
              <span className="fig">{kept.length}</span> of <span className="fig">{facts.length}</span>
            </>
          ) : (
            <>
              <span className="fig">{facts.length}</span> {facts.length === 1 ? 'item' : 'items'}
            </>
          )}
        </p>
      </div>

      <div ref={gridRef} className="shelf-grid-wrap">
        {children}
      </div>

      {kept.length === 0 && (
        <p className="shelf-empty">
          Nothing on this shelf matches.{' '}
          <button type="button" className="shelf-link" onClick={() => setState({ ...EMPTY_SHELF })}>
            Clear the filters
          </button>{' '}
          to see all <span className="fig">{facts.length}</span>.
        </p>
      )}
    </>
  );
}
