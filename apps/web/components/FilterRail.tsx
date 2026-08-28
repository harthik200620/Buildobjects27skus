'use client';

import { type Facet, type FacetBand, type FacetConfig, type FilterState, formatNumber, formatRupees } from '@buildobjects/catalog';
import { usePathname, useRouter } from 'next/navigation';
import React from 'react';
import { appliedChips, SORTS, type SortKey, toQuery } from '@/lib/filters';
import { IconCheck, IconChevronDown, IconClose, IconFilter } from './icons';
import Scrim from './Scrim';
import { useDismiss, useScrollLock } from './useDismiss';

export interface RailProps {
  config: FacetConfig | null;
  state: FilterState & { q: string; page: number; category?: string };
  distribution: Record<string, Record<string, number>>;
  stats: Record<string, { min: number; max: number }>;
  total: number;
  categoryFacet?: { slug: string; name: string; count: number }[];
  /**
   * Rendered above the facets on desktop only. The category tree goes here: it belongs in the
   * same column and the same sticky block as the filters, and on a phone the horizontal
   * CategoryStrip already carries it, so the sheet must not repeat it.
   */
  /**
   * Secondary navigation for the rail — the category tree on a listing page.
   *
   * Rendered BELOW the facets. It used to be above them, which put thirty-seven category links
   * between the top of the rail and the first filter: on a category page the filters are the
   * tool you came for, and they were off-screen until you scrolled past the whole catalogue.
   */
  sideNav?: React.ReactNode;
}

export default function FilterRail(props: RailProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const { config, state } = props;

  useDismiss(open, () => setOpen(false), { panel: sheetRef });
  useScrollLock(open);

  const push = React.useCallback(
    (next: Partial<FilterState & { q: string; category?: string }>) => {
      const merged = { ...state, ...next, page: 1 };
      router.push(`${pathname}${toQuery(merged)}`, { scroll: false });
    },
    [router, pathname, state],
  );

  const chips = appliedChips(state, config);
  const hasAny = chips.length > 0 || !!state.category;

  /*
   * A dependent facet (say "colour temperature", which only applies to tunable bulbs) shows
   * only once its parent selection allows it. Unknown or unparsable parent state shows the
   * facet: hiding a filter the shopper cannot see how to unhide is the worse failure.
   */
  const isVisible = (f: Facet) => {
    if (!f.depends_on) return true;
    const parentKey = f.depends_on.key;
    const parentVal = state.attrs[parentKey];
    if (f.depends_on.values && f.depends_on.values.length > 0) {
      if (Array.isArray(parentVal)) {
        return parentVal.some((v) => typeof v === 'string' && f.depends_on!.values!.includes(v));
      }
      return typeof parentVal === 'string' && f.depends_on.values.includes(parentVal);
    }
    if (f.depends_on.min !== undefined || f.depends_on.max !== undefined) {
      if (Array.isArray(parentVal) && parentVal.length === 2) {
        const [lo, hi] = parentVal;
        const loNum = typeof lo === 'number' ? lo : null;
        const hiNum = typeof hi === 'number' ? hi : null;
        if (f.depends_on.min !== undefined && (loNum === null || loNum < f.depends_on.min)) return false;
        if (f.depends_on.max !== undefined && (hiNum === null || hiNum > f.depends_on.max)) return false;
        return true;
      }
    }
    return true;
  };

  /* primary: always open · more: behind a fold · toolbar: hoisted next to the result count */
  const allFacets = config?.facets ?? [];
  const primaryFacets = allFacets.filter((f) => f.visibility !== 'more' && f.visibility !== 'toolbar' && isVisible(f));
  const moreFacets = allFacets.filter((f) => f.visibility === 'more' && isVisible(f));
  const toolbarStockFacet = allFacets.find((f) => f.key === 'stock' || f.visibility === 'toolbar');

  const renderFacetItem = (f: Facet) => {
    const dist = props.distribution[f.attr] ?? {};
    if (f.key === 'brand') {
      // Brands come from the facet config when the category declares them, and from whatever
      // the current result set contains when it does not.
      const brandValues =
        'values' in f && f.values?.length ? f.values : Object.entries(props.distribution.brand ?? {}).map(([value, count]) => ({ value, count }));
      return (
        <FacetSection key="brand" title="Brand">
          <FacetValueList
            values={brandValues.map((v) => ({
              value: v.value,
              label: (v as { label?: string }).label ?? v.value,
              count: v.count,
              liveCount: props.distribution.brand?.[v.value] ?? 0,
            }))}
            selected={state.brand ?? []}
            onToggle={(val) => {
              const current = state.brand ?? [];
              const next = current.includes(val) ? current.filter((x) => x !== val) : [...current, val];
              push({ brand: next.length ? next : undefined });
            }}
          />
        </FacetSection>
      );
    }

    if (f.key === 'price') {
      const min = props.stats.selling_price?.min ?? (f.kind === 'range' ? f.min : 0);
      const max = props.stats.selling_price?.max ?? (f.kind === 'range' ? f.max : 0);
      const bands = f.kind === 'range' && f.bands ? f.bands : undefined;
      return (
        <FacetSection key="price" title={f.label || 'Price'}>
          {bands && bands.length > 0 ? (
            <BandList
              bands={bands}
              currentRange={state.price ?? [null, null]}
              onSelectBand={(lo, hi) => {
                const isSelected = state.price && state.price[0] === lo && state.price[1] === hi;
                push({ price: isSelected ? undefined : [lo, hi] });
              }}
            />
          ) : null}
          <RangeInputs
            unit="₹"
            min={min}
            max={max}
            value={state.price ?? [null, null]}
            onChange={(v) => push({ price: v[0] === null && v[1] === null ? undefined : v })}
          />
        </FacetSection>
      );
    }

    if (f.kind === 'range') {
      const cur = state.attrs[f.key];
      const val: [number | null, number | null] =
        Array.isArray(cur) && cur.length === 2 && (typeof cur[0] === 'number' || cur[0] === null) ? (cur as [number | null, number | null]) : [null, null];

      return (
        <FacetSection key={f.key} title={f.label + (f.unit ? ` (${f.unit})` : '')}>
          {f.bands && f.bands.length > 0 ? (
            <BandList
              bands={f.bands}
              currentRange={val}
              onSelectBand={(lo, hi) => {
                const attrs = { ...state.attrs };
                const isSelected = val[0] === lo && val[1] === hi;
                if (isSelected) delete attrs[f.key];
                else attrs[f.key] = [lo, hi];
                push({ attrs });
              }}
            />
          ) : null}
          <RangeInputs
            unit={f.unit ?? ''}
            min={f.min}
            max={f.max}
            step={f.step}
            value={val}
            onChange={(v) => {
              const attrs = { ...state.attrs };
              if (v[0] === null && v[1] === null) delete attrs[f.key];
              else attrs[f.key] = v;
              push({ attrs });
            }}
          />
        </FacetSection>
      );
    }

    if (f.kind === 'toggle') {
      const checked = state.attrs[f.key] === true;
      const count = dist.true ?? f.true_count;
      return (
        <FacetSection key={f.key} title={f.label}>
          <label className="facet-option">
            <input
              type="checkbox"
              className="check facet-checkbox"
              checked={checked}
              onChange={(e) => {
                const attrs = { ...state.attrs };
                if (e.target.checked) attrs[f.key] = true;
                else delete attrs[f.key];
                push({ attrs });
              }}
            />
            <span className="facet-option-label">{f.true_label ?? 'Yes'}</span>
            <span className="facet-count fig">({count})</span>
          </label>
        </FacetSection>
      );
    }

    /* Everything else is a list of values with counts. */
    const selected = (Array.isArray(state.attrs[f.key]) ? (state.attrs[f.key] as string[]) : []) as string[];
    return (
      <FacetSection key={f.key} title={f.label}>
        <FacetValueList
          values={f.values.map((v) => ({
            value: v.value,
            label: v.label ?? v.value,
            count: v.count,
            liveCount: dist[v.value] ?? 0,
            sublabel: f.sublabel?.[v.value],
            swatch: f.swatch?.[v.value],
          }))}
          selected={selected}
          onToggle={(val) => {
            const attrs = { ...state.attrs };
            const next = selected.includes(val) ? selected.filter((x) => x !== val) : [...selected, val];
            if (next.length) attrs[f.key] = next;
            else delete attrs[f.key];
            push({ attrs });
          }}
        />
      </FacetSection>
    );
  };

  const renderContent = () => (
    <div className="filter-rail-body">
      {/*
        Category, as a filter rather than as navigation.

        The search page used to render this AND the full thirty-five-category tree underneath it,
        so the same nine names appeared twice in one 300 px column — once with a count that
        narrowed the results in place, once as a link that threw the other filters away. This one
        stays because it is the one that filters; the tree is still one click away in the header's
        All menu, the strip under it and the footer, and it is what the home page is entirely made
        of. The category PAGES keep the tree, because there the rail has no category facet at all.
      */}
      {props.categoryFacet && props.categoryFacet.length > 0 && (
        <FacetSection title="Category">
          <ul className="facet-list">
            {props.categoryFacet.map((c) => {
              const active = state.category === c.slug;
              return (
                <li key={c.slug}>
                  <button
                    type="button"
                    className={`facet-link ${active ? 'facet-link--active' : ''}`}
                    onClick={() => push({ category: active ? undefined : c.slug, attrs: {} })}
                  >
                    <span className="facet-option-label">{c.name}</span>
                    <span className="facet-count fig">({c.count})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FacetSection>
      )}

      {/* Certification or Lead Notes */}
      {config?.certification_note && (
        <div className="facet-note">
          <IconCheck size={14} className="facet-note-icon" />
          <span>{config.certification_note.text}</span>
        </div>
      )}

      {/* Primary Facets */}
      {primaryFacets.map(renderFacetItem)}

      {/* Collapsible 'More Filters' fold */}
      {moreFacets.length > 0 && (
        <details className="facet-fold">
          <summary className="facet-fold-summary">
            <span>More filters ({moreFacets.length})</span>
            <IconChevronDown size={14} className="facet-fold-chevron" />
          </summary>
          <div className="facet-fold-body">{moreFacets.map(renderFacetItem)}</div>
        </details>
      )}
    </div>
  );

  const clearAll = () => router.push(`${pathname}${toQuery({ q: state.q })}`, { scroll: false });

  return (
    <>
      {/* ── Results Toolbar + Stock switch + Mobile trigger ───────────────── */}
      <div className="results-head">
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="btn btn-secondary btn--sm flex items-center gap-2 lg:hidden" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <IconFilter size={16} /> Filters{chips.length ? ` (${chips.length})` : ''}
          </button>
          <span className="results-count">
            <span className="fig">{formatNumber(props.total)}</span> {props.total === 1 ? 'product' : 'products'}
          </span>

          {/* In-stock toggle in Toolbar */}
          {toolbarStockFacet && (
            <label className="toolbar-stock-toggle">
              <input
                type="checkbox"
                className="check facet-checkbox"
                checked={!!state.stock}
                onChange={(e) => push({ stock: e.target.checked ? true : undefined })}
              />
              <span>In stock only</span>
              {props.distribution.in_stock?.true !== undefined && <span className="facet-count fig">({props.distribution.in_stock.true})</span>}
            </label>
          )}
        </div>

        {/*
          The sort control carried `bg-white` — a Tailwind utility, which by this project's own
          layering rule beats anything in the components layer. On a store whose ink is #eaf2f3
          that put near-white text on a white box: a measured contrast ratio of 1.09:1, on the
          control every listing page uses to reorder its results. It was invisible, and the
          contrast gate could not see it because the gate reads stylesheets and this was a class
          name in a component. `.input` is the select contract and already carries the chevron,
          the focus ring and the dark ground.
        */}
        <label className="sort-by">
          <span className="hidden sm:inline">Sort by:</span>
          <span className="relative">
            <select
              className="input input--sm sort-select"
              value={state.sort ?? 'relevance'}
              onChange={(e) => push({ sort: e.target.value as SortKey })}
              aria-label="Sort results"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <IconChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </span>
        </label>
      </div>

      {/* ── Applied Chips Row ─────────────────────────────────────────────── */}
      {hasAny && (
        <div className="applied" role="list" aria-label="Applied filters">
          {state.category && props.categoryFacet && (
            <button type="button" className="chip anim" aria-pressed="true" onClick={() => push({ category: undefined, attrs: {} })}>
              {props.categoryFacet.find((c) => c.slug === state.category)?.name ?? state.category}
              <IconClose size={12} />
            </button>
          )}
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip anim" aria-pressed="true" onClick={() => push(c.remove)}>
              {c.label}
              <IconClose size={12} />
            </button>
          ))}
          <button
            type="button"
            className="text-[12px] font-medium px-2 hover:underline cursor-pointer"
            style={{ color: 'var(--color-teal-700)' }}
            onClick={clearAll}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Desktop: a plain sticky column of lists — no cards, no boxes. */}
      <aside className="hidden lg:block rail-sticky filter-rail" aria-label="Filters" data-rail>
        {renderContent()}
        {props.sideNav}
      </aside>

      {/* ── Mobile: the same lists in a bottom sheet, applied on dismiss ───── */}
      {open && (
        <>
          <Scrim className="sheet-scrim lg:hidden" onDismiss={() => setOpen(false)} />
          <div ref={sheetRef} className="sheet lg:hidden fade-up" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="sheet-grip" />
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line-2)]">
              <span className="font-bold text-[16px] text-[var(--color-ink)]">Filters</span>
              <button type="button" className="icon-btn" aria-label="Close filters" onClick={() => setOpen(false)}>
                <IconClose size={18} />
              </button>
            </div>
            <div className="sheet-scrollable-body py-2">{renderContent()}</div>
            <div className="sheet-foot">
              <button type="button" className="btn-ghost h-11 flex-1 text-[13px]" onClick={clearAll}>
                Clear all
              </button>
              <button type="button" className="btn-primary h-11 flex-1 text-[13px]" onClick={() => setOpen(false)}>
                Show {formatNumber(props.total)} {props.total === 1 ? 'result' : 'results'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="facet">
      {/* h2, not h3: the rail sits directly under the page's h1 and nothing comes between them, so
          h3 skipped a level in the outline. The class keeps the size — the tag carries the
          structure, and the two do not have to agree. */}
      <h2 className="facet-title">{title}</h2>
      {children}
    </section>
  );
}

interface FacetValueItem {
  value: string;
  label: string;
  count: number;
  liveCount: number;
  sublabel?: string;
  swatch?: string;
}

/**
 * WHAT YOU CAN ACTUALLY NARROW TO COMES FIRST.
 *
 * A shelf of three bulbs offered four brightness bands, and three of them read "(0)". The rail
 * was showing the shape of the schema rather than the shape of the shelf: three of its first
 * four rows could not be clicked to any effect, and the one that could was buried among them.
 *
 * Nothing is removed — an empty band is a true fact about the catalogue, and a rail whose rows
 * appear and vanish as you filter is worse than one with a dim row in it. They are ordered, so
 * the five that fit above the fold are the five worth having, and the empties fall under
 * "See more" on their own.
 *
 * A SELECTED value always stays at the top, whatever its live count: the option you have already
 * ticked is the one you most need to be able to reach, and filtering to it is often exactly what
 * takes its own count to zero.
 */
function rankByUsefulness(values: FacetValueItem[], selected: string[]): FacetValueItem[] {
  const rank = (v: FacetValueItem) => (selected.includes(v.value) ? 0 : v.liveCount > 0 ? 1 : 2);
  /* index breaks ties, so the builder's own order survives inside each group. */
  return values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map(({ v }) => v);
}

function FacetValueList({ values, selected, onToggle }: { values: FacetValueItem[]; selected: string[]; onToggle: (val: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const limit = 5;
  const ordered = React.useMemo(() => rankByUsefulness(values, selected), [values, selected]);
  const showMore = ordered.length > limit;
  const displayed = showMore && !expanded ? ordered.slice(0, limit) : ordered;

  return (
    <div className="facet-list">
      {displayed.map((v) => {
        const on = selected.includes(v.value);
        const disabled = !on && v.liveCount === 0;
        return (
          <label key={v.value} className="facet-option">
            <input type="checkbox" className="check facet-checkbox" checked={on} onChange={() => onToggle(v.value)} />
            {v.swatch && <span className="facet-swatch" style={{ background: v.swatch }} aria-hidden="true" />}
            <div className="facet-option-body">
              <span className={`facet-option-label ${disabled ? 'facet-option-label--empty' : ''}`}>{v.label}</span>
              {v.sublabel && <span className="facet-option-note">{v.sublabel}</span>}
            </div>
            <span className="facet-count fig">({on ? v.count : v.liveCount})</span>
          </label>
        );
      })}

      {showMore && (
        <button type="button" className="facet-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? '− See less' : `+ See more (${ordered.length - limit})`}
        </button>
      )}
    </div>
  );
}

/** Band labels arrive from the facet builder with their unit already in the text. */
function BandList({
  bands,
  currentRange,
  onSelectBand,
}: {
  bands: FacetBand[];
  currentRange: [number | null, number | null];
  onSelectBand: (lo: number | null, hi: number | null) => void;
}) {
  return (
    <div className="facet-bands">
      {bands.map((b) => {
        const active = currentRange[0] === b.lo && currentRange[1] === b.hi;
        /* A band with nothing in it is still shown — it says something true about the shelf — but
           it is not offered as a thing to press. Clicking "Under 500 lm (0)" on a page of three
           bulbs emptied the grid and taught the reader the filters were broken. */
        const empty = b.count === 0 && !active;
        return (
          <button
            key={`${b.lo}-${b.hi}`}
            type="button"
            className={`facet-band ${active ? 'facet-band--active' : ''}${empty ? ' facet-band--empty' : ''}`}
            disabled={empty}
            onClick={() => onSelectBand(b.lo, b.hi)}
          >
            {b.swatch && <span className="facet-swatch" style={{ background: b.swatch }} aria-hidden="true" />}
            <span className="facet-band-label">{b.label}</span>
            {b.count !== undefined && <span className="facet-count fig">({b.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

function RangeInputs({
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  unit: string;
  min: number;
  max: number;
  step?: number;
  value: [number | null, number | null];
  onChange: (v: [number | null, number | null]) => void;
}) {
  const [lo, setLo] = React.useState(value[0]?.toString() ?? '');
  const [hi, setHi] = React.useState(value[1]?.toString() ?? '');

  React.useEffect(() => {
    setLo(value[0]?.toString() ?? '');
    setHi(value[1]?.toString() ?? '');
  }, [value]);

  const commit = () => {
    const a = lo.trim() === '' ? null : Number(lo);
    const b = hi.trim() === '' ? null : Number(hi);
    onChange([a !== null && Number.isFinite(a) ? a : null, b !== null && Number.isFinite(b) ? b : null]);
  };

  return (
    <div className="facet-range">
      <div className="facet-range-row">
        <div className="facet-range-field">
          {unit === '₹' && <span className="facet-range-prefix">₹</span>}
          <input
            className="facet-range-input fig"
            inputMode="numeric"
            placeholder={`${min}`}
            value={lo}
            onChange={(e) => setLo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            aria-label={`Minimum ${unit}`}
          />
        </div>
        <span className="facet-range-sep">–</span>
        <div className="facet-range-field">
          {unit === '₹' && <span className="facet-range-prefix">₹</span>}
          <input
            className="facet-range-input fig"
            inputMode="numeric"
            placeholder={`${max}`}
            value={hi}
            onChange={(e) => setHi(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            aria-label={`Maximum ${unit}`}
          />
        </div>
        <button type="button" className="facet-range-go" onClick={commit} aria-label="Apply range filter">
          Go
        </button>
      </div>
      <p className="facet-range-hint fig">
        {unit === '₹' ? `${formatRupees(min)} – ${formatRupees(max)}` : `${min} – ${max}${unit ? ` ${unit}` : ''}${step ? ` · steps of ${step}` : ''}`}
      </p>
    </div>
  );
}
