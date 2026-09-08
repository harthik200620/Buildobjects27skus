'use client';

import React from 'react';
import { IconChevronDown, IconClose, IconFilter } from '@/components/icons';
import ShareLoves from '@/components/shelf/ShareLoves';
import { useDismiss } from '@/components/useDismiss';
import { useEdgeFade } from '@/components/useEdgeFade';
import { deliverBy } from '@/lib/delivery';
import { readPicks } from '@/lib/picks';
import {
  arrivals,
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
import { EMPTY_SHOPPER, readShopper, SHOPPER_EVENT, type Shopper } from '@/lib/shopper';

/**
 * The filter row over "On the shelf now": the chips, a panel behind "Filters" for brand and
 * order, and a small calendar behind "Schedule". It replaced a "Filter and compare" link that
 * sent the reader to the search page to do here what it would not let them do here.
 *
 * THE CARDS ARE NOT RE-RENDERED, THEY ARE HIDDEN. `children` is the server-rendered grid of
 * ProductCards, passed straight through untouched — so the product card stays a server component,
 * none of it is shipped to the browser twice, and the whole shelf is in the HTML for a reader with
 * no JavaScript and for a crawler. This component only sets `hidden` and `order` on each card,
 * addressed by the `data-sku` the card already carries. That is also why filtering is instant:
 * nothing is fetched, nothing re-renders, and the compositor does the rest.
 *
 * FOUR OF THE CHIPS ARE ABOUT THE READER, not the shelf — what they rated, ordered, have not seen,
 * and what their friends love. Those are answered from `lib/shopper.ts`, this device's own record,
 * which is never sent anywhere. They are shown on a device that has none of it yet and keep
 * nothing until it does: a shop cannot show you your past orders before you have made one, and
 * the alternative to an honest empty answer is an invented one.
 */
export default function ShelfBar({ facts, initial, children }: { facts: ShelfFact[]; initial: ShelfState; children: React.ReactNode }) {
  const [state, setState] = React.useState<ShelfState>(initial);
  const [open, setOpen] = React.useState<'filters' | 'schedule' | null>(null);
  /* Empty until the browser has been asked. The first client render must match the server's, and
     the server cannot know what is on this device. */
  const [you, setYou] = React.useState<Shopper>(EMPTY_SHOPPER);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const gridRef = React.useRef<HTMLDivElement>(null);
  const filtersRef = React.useRef<HTMLDivElement>(null);
  const scheduleRef = React.useRef<HTMLDivElement>(null);

  const chips = React.useMemo(() => chipsFor(facts), [facts]);
  const brands = React.useMemo(() => brandsOf(facts), [facts]);
  const dates = React.useMemo(() => arrivals(facts), [facts]);

  useDismiss(open !== null, () => setOpen(null), { panel: [filtersRef, scheduleRef] });

  /* This device's record, and the estimate, kept in step: a card on this very shelf can add a
     pick or a love while the row is on screen. */
  React.useEffect(() => {
    const read = () => {
      setYou(readShopper());
      setPicked(new Set(readPicks().map((p) => p.sku_code)));
    };
    read();
    for (const e of [SHOPPER_EVENT, 'bo-picks', 'storage']) window.addEventListener(e, read);
    return () => {
      for (const e of [SHOPPER_EVENT, 'bo-picks', 'storage']) window.removeEventListener(e, read);
    };
  }, []);

  const onShelf = React.useMemo(() => facts.filter((f) => picked.has(f.sku)).length, [facts, picked]);
  const kept = React.useMemo(() => facts.filter((f) => keeps(f, state, you, picked)), [facts, state, you, picked]);

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
    const q = encodeShelf(state, new URLSearchParams(window.location.search)).toString();
    const next = `${window.location.pathname}${q ? `?${q}` : ''}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, '', next);
  }, [state]);

  /* Someone pressed back or forward, or opened a link into this page. */
  React.useEffect(() => {
    const pop = () => setState(decodeShelf(new URLSearchParams(window.location.search)));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const isPressed = (c: Chip): boolean => {
    if (c.key === 'under') return state.under !== null;
    if (c.key === 'offers') return state.offers !== null;
    if (c.key === 'schedule') return state.by !== null;
    return state[c.key as 'checked' | 'stock' | 'rating' | 'ordered' | 'fresh' | 'friends'];
  };

  const press = (c: Chip) => {
    if (c.key === 'schedule') {
      setOpen((o) => (o === 'schedule' ? null : 'schedule'));
      return;
    }
    setState((s) => {
      if (c.key === 'under') return { ...s, under: s.under === null ? (c.value ?? null) : null };
      if (c.key === 'offers') return { ...s, offers: s.offers === null ? (c.value ?? null) : null };
      const k = c.key as 'checked' | 'stock' | 'rating' | 'ordered' | 'fresh' | 'friends';
      return { ...s, [k]: !s[k] };
    });
  };

  /** What this chip would keep on its own, so its effect is visible before it is pressed. */
  const wouldKeep = (c: Chip): number => {
    const only: ShelfState = { ...EMPTY_SHELF };
    if (c.key === 'under') only.under = c.value ?? null;
    else if (c.key === 'offers') only.offers = c.value ?? null;
    else if (c.key === 'schedule') only.by = dates[0]?.days ?? null;
    else only[c.key as 'checked' | 'stock' | 'rating' | 'ordered' | 'fresh' | 'friends'] = true;
    return facts.filter((f) => keeps(f, only, you, picked)).length;
  };

  const toggleBrand = (name: string) => setState((s) => ({ ...s, brands: s.brands.includes(name) ? s.brands.filter((b) => b !== name) : [...s.brands, name] }));

  const active = isFiltering(state);
  const panelCount = state.brands.length + (state.sort === 'default' ? 0 : 1);
  const clear = () => {
    setState({ ...EMPTY_SHELF });
    setOpen(null);
  };

  /* The chip row is wider than a phone; the fade says which side it continues on. */
  const chipRow = useEdgeFade<HTMLDivElement>();

  return (
    <>
      <div className="shelf-bar">
        <div className="shelf-pop-wrap" ref={filtersRef}>
          <button
            type="button"
            className="shelf-chip shelf-chip--filters"
            aria-expanded={open === 'filters'}
            aria-pressed={panelCount > 0}
            onClick={() => setOpen((o) => (o === 'filters' ? null : 'filters'))}
          >
            <IconFilter size={15} />
            Filters
            {panelCount > 0 && <span className="shelf-chip-n fig">{panelCount}</span>}
            <IconChevronDown size={13} className="shelf-chip-caret" />
          </button>

          {open === 'filters' && (
            <div className="shelf-panel" role="dialog" aria-label="Filter and sort this shelf">
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
              <ShareLoves />
              <div className="shelf-panel-foot">
                <button type="button" className="btn btn-secondary btn--sm" onClick={clear} disabled={!active}>
                  Clear all
                </button>
                <button type="button" className="btn btn-primary btn--sm" onClick={() => setOpen(null)}>
                  Show {kept.length}
                </button>
              </div>
            </div>
          )}
        </div>

        <div ref={chipRow} className="shelf-chips edge-fade" role="group" aria-label="Filter this shelf">
          {chips.map((c) =>
            c.key === 'schedule' ? (
              <div className="shelf-pop-wrap" key={c.key} ref={scheduleRef}>
                <button type="button" className="shelf-chip" aria-expanded={open === 'schedule'} aria-pressed={state.by !== null} onClick={() => press(c)}>
                  {state.by === null ? 'Schedule' : `By ${deliverBy(state.by)}`}
                  <IconChevronDown size={13} className="shelf-chip-caret" />
                </button>
                {open === 'schedule' && (
                  <div className="shelf-panel shelf-panel--dates" role="dialog" aria-label="When it should arrive">
                    <fieldset className="shelf-field">
                      <legend className="shelf-legend">Arrives by</legend>
                      <label className="shelf-opt">
                        <input type="radio" name="shelf-by" checked={state.by === null} onChange={() => setState((s) => ({ ...s, by: null }))} />
                        <span>Any time</span>
                        <span className="shelf-opt-n fig">{facts.length}</span>
                      </label>
                      {dates.map((d) => (
                        <label key={d.days} className="shelf-opt">
                          <input type="radio" name="shelf-by" checked={state.by === d.days} onChange={() => setState((s) => ({ ...s, by: d.days }))} />
                          <span>{deliverBy(d.days)}</span>
                          <span className="shelf-opt-n fig">{facts.filter((f) => f.days !== null && f.days <= d.days).length}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="shelf-panel-foot">
                      <span className="shelf-note">To your pincode. Sundays are not delivery days.</span>
                      <button type="button" className="btn btn-primary btn--sm" onClick={() => setOpen(null)}>
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button key={c.key} type="button" className="shelf-chip" aria-pressed={isPressed(c)} onClick={() => press(c)}>
                {c.label}
                {/* What it would keep, so a chip's effect is visible before it is pressed — and so
                    one that can only empty the shelf says so rather than surprising you. */}
                {!isPressed(c) && <span className="shelf-chip-n fig">{wouldKeep(c)}</span>}
              </button>
            ),
          )}

          {/* Only when the reader has something from THIS shelf in their estimate. */}
          {onShelf > 0 && (
            <button type="button" className="shelf-chip" aria-pressed={state.picks} onClick={() => setState((s) => ({ ...s, picks: !s.picks }))}>
              In my estimate <span className="shelf-chip-n fig">{onShelf}</span>
            </button>
          )}

          {active && (
            <button type="button" className="shelf-chip shelf-chip--clear" onClick={clear}>
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
        <div className="shelf-empty">
          <p>Nothing on this shelf matches.</p>
          {/* The chips about the reader are the ones that surprise people, so when one of them is
              why the shelf is empty, say which and why rather than leaving them to guess. */}
          {state.rating && <p className="shelf-empty-why">You have not rated anything here four or more — the stars are on each product page.</p>}
          {state.ordered && <p className="shelf-empty-why">Nothing here has been ordered on this device yet.</p>}
          {state.fresh && <p className="shelf-empty-why">You have already opened every product on this shelf.</p>}
          {state.friends && <p className="shelf-empty-why">No list a friend has shared with you covers anything here.</p>}
          <button type="button" className="btn btn-secondary btn--sm" onClick={clear}>
            Clear the filters
          </button>
        </div>
      )}
    </>
  );
}
