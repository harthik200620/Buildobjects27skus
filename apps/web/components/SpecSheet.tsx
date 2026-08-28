'use client';

import { formatSpecValue, type SpecJson } from '@buildobjects/catalog';
import React from 'react';
import { IconChevronDown, IconClose, IconSearch, SpecGroupIcon } from './icons';

/**
 * The full specification sheet: every figure the catalogue holds for one product, grouped by
 * heading, searchable, and honest about where each number came from. It is the most technical
 * surface in the store — where a site engineer checks a compressive strength against a drawing —
 * and three things were wrong with it:
 *
 *   1. Twenty-eight emoji as section marks, now SpecGroupIcon (components/icons.tsx), drawn in the
 *      row's own ink at the row's own stroke weight.
 *   2. A fabricated documents block — a "Technical Data Sheet · 1.4 MB PDF", an MSDS, a "BIS & MTC
 *      Quality Certificate", sizes invented to three significant figures, Download wired to
 *      window.print(). We hold none of those files. Deleted rather than restyled: a store that
 *      invents a safety datasheet for a fire extinguisher is not one anyone should buy from.
 *   3. Provenance hidden in a title attribute, which does not exist on a touch device. Every row
 *      now carries a visible marker, and the legend above says what the three of them mean.
 *
 * Roughly half these values come from the industry standard for the product class rather than the
 * manufacturer's datasheet, and the sheet never claims otherwise — there is no "verified" badge
 * over the table, because it would be a lie about half its own contents.
 */

/** What each provenance level actually means, in the words shown to a buyer. */
const PROV: Record<string, { label: string; detail: string }> = {
  fetched: { label: 'From the brand', detail: 'Read from the manufacturer’s own page or datasheet' },
  verified: { label: 'Cross-checked', detail: 'Confirmed against a second published source' },
  ai_filled: { label: 'Class standard', detail: 'Filled from the industry standard for this product class — not confirmed with the brand' },
};
const PROV_ORDER = ['verified', 'fetched', 'ai_filled'] as const;

/** Headings that describe how the catalogue is built, not what the product is. */
const HIDDEN_SEGMENTS = new Set(['seo', 'images', 'comparison', 'documents']);

/** Sections open on arrival. Enough to show the sheet is real, few enough to stay scannable. */
const OPEN_ON_LOAD = 3;
/** Sections rendered before "show more" — the rest are a click away, not a scroll away. */
const PAGE = 4;

export default function SpecSheet({ spec }: { spec: SpecJson }) {
  const groups = React.useMemo(
    () =>
      spec.groups
        .filter((g) => {
          const k = g.key.toLowerCase();
          return !HIDDEN_SEGMENTS.has(k) && !k.includes('seo') && !k.includes('comparison') && !k.includes('images');
        })
        .sort((a, b) => a.importance - b.importance),
    [spec.groups],
  );

  const [query, setQuery] = React.useState('');
  const [shown, setShown] = React.useState(PAGE);
  const [open, setOpen] = React.useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g, i) => [g.key, i < OPEN_ON_LOAD])));

  const totalRows = React.useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);

  /* How many of those figures came from each source. Stated once, above the sheet, so the
     reader can weigh the whole table before reading any single row of it. */
  const provCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of groups) for (const r of g.rows) counts[r.provenance] = (counts[r.provenance] ?? 0) + 1;
    return counts;
  }, [groups]);

  /* Searching opens everything it matched: a hit inside a collapsed section is a hit the reader
     cannot see, which reads as the search being broken. */
  const searching = query.trim().length > 0;
  const matched = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        if (g.label.toLowerCase().includes(q)) return g;
        const rows = g.rows.filter((r) => r.label.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q));
        return rows.length ? { ...g, rows } : null;
      })
      .filter((g): g is (typeof groups)[number] => g !== null);
  }, [groups, query]);

  const visible = searching ? matched : matched.slice(0, shown);
  const hits = React.useMemo(() => matched.reduce((n, g) => n + g.rows.length, 0), [matched]);
  const allOpen = visible.length > 0 && visible.every((g) => searching || open[g.key]);

  const toggleAll = () => {
    const next = !allOpen;
    setOpen(Object.fromEntries(groups.map((g) => [g.key, next])));
    if (next) setShown(groups.length);
  };

  return (
    <section className="spec" aria-label="Full specification sheet">
      {/* ── the masthead: what this sheet is, and how much of it to trust ── */}
      <header className="spec-head">
        <div className="spec-head-row">
          <div>
            <h3 className="spec-title">Full specification</h3>
            <p className="spec-sub">
              <span className="fig">{totalRows}</span> figures across <span className="fig">{groups.length}</span> sections.
            </p>
          </div>
          <button type="button" onClick={toggleAll} className="btn btn-secondary btn--sm">
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {/* The legend. Not decoration — it is the key to the marker on every row below. */}
        <ul className="spec-legend">
          {PROV_ORDER.filter((k) => provCounts[k]).map((k) => (
            <li key={k} title={PROV[k].detail}>
              <span className={`spec-dot spec-dot--${k}`} aria-hidden />
              <span className="spec-legend-label">{PROV[k].label}</span>
              <span className="fig spec-legend-count">{provCounts[k]}</span>
            </li>
          ))}
        </ul>

        <div className="spec-search">
          <IconSearch size={16} className="spec-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a figure — compressive strength, warranty, IP rating"
            aria-label="Search this specification sheet"
            className="input spec-search-input"
          />
          {searching && (
            <button type="button" onClick={() => setQuery('')} className="spec-search-clear" aria-label="Clear search">
              <IconClose size={14} />
            </button>
          )}
        </div>
        {searching && (
          <p className="spec-hits" role="status">
            {hits === 0 ? (
              <>
                Nothing in this sheet matches <b>{query}</b>.
              </>
            ) : (
              <>
                <span className="fig">{hits}</span> {hits === 1 ? 'figure' : 'figures'} in <span className="fig">{matched.length}</span>{' '}
                {matched.length === 1 ? 'section' : 'sections'}.
              </>
            )}
          </p>
        )}
      </header>

      {/* ── the sheet ─────────────────────────────────────────────────────── */}
      <div className="spec-groups stagger">
        {visible.map((g, i) => {
          const isOpen = searching || !!open[g.key];
          return (
            <section key={g.key} className="spec-group" style={{ '--i': i } as React.CSSProperties} data-reveal>
              <h4 className="spec-group-h">
                <button type="button" className="spec-group-btn" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                  <SpecGroupIcon group={g.key} size={18} className="spec-group-icon" />
                  <span className="spec-group-name">{g.label}</span>
                  <span className="spec-group-count fig">{g.rows.length}</span>
                  <IconChevronDown size={16} className="spec-group-chevron" />
                </button>
              </h4>

              {/* 0fr → 1fr on a grid row: the one way to animate a height the browser measures
                  for you. `hidden` on the inner element keeps the collapsed rows out of the
                  accessibility tree and out of the tab order. */}
              <div className="spec-group-body" data-open={isOpen ? '' : undefined}>
                <div className="spec-group-clip" hidden={!isOpen}>
                  <table className="spec-table">
                    <tbody>
                      {g.rows.map((r) => {
                        const prov = PROV[r.provenance];
                        return (
                          <tr key={r.key}>
                            <th scope="row">
                              {/* The flex lives here, one level in — a `th` that is itself a flex box
                                  leaves the table's formatting context and takes the row with it. */}
                              <span className="spec-label">
                                <span className={`spec-dot spec-dot--${r.provenance}`} aria-hidden />
                                {r.label}
                              </span>
                            </th>
                            <td>
                              {r.source_url ? (
                                <a href={r.source_url} target="_blank" rel="noreferrer" className="link">
                                  {formatSpecValue(r.value, r.unit, r.data_type)}
                                </a>
                              ) : (
                                formatSpecValue(r.value, r.unit, r.data_type)
                              )}
                              <span className="visually-hidden">
                                {' — '}
                                {prov?.detail ?? r.provenance}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {!searching && shown < groups.length && (
        <button type="button" onClick={() => setShown((n) => Math.min(n + PAGE, groups.length))} className="btn btn-secondary spec-more">
          Show {Math.min(PAGE, groups.length - shown)} more {groups.length - shown === 1 ? 'section' : 'sections'}
          <IconChevronDown size={14} />
        </button>
      )}
    </section>
  );
}
