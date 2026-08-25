'use client';

import type { SkuSearchDoc } from '@buildobjects/catalog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { inr, mediaUrl } from '@/lib/media';
import Highlight from './Highlight';
import { CategoryIcon, IconClockCheck, IconClose, IconSearch } from './icons';

/**
 * The header search: scope select ("All" or a category) | input | brand-teal search button.
 * Instant search-as-you-type — debounced 80 ms, one round trip to /api/search/suggest, a
 * grouped dropdown (products with thumb + price, categories, brands), keyboard navigation,
 * recent searches in localStorage, `/` focuses it. Enter → /search?q= (scoped with &category=
 * when a category is chosen). Zero results never dead-end.
 * Contract kept for the pages and tests: role=combobox, aria-controls=search-listbox,
 * role=listbox / option, and `mark.hl` highlights from Meilisearch.
 */
type Suggest = {
  skus: SkuSearchDoc[];
  categories: { slug: string; name: string; nameTe: string | null }[];
  brands: { slug: string; name: string }[];
  ms: number;
};
type Row = {
  kind: 'sku' | 'category' | 'brand' | 'recent' | 'query';
  href: string;
  label: string;
  html?: string;
  sub?: string;
  thumb?: string | null;
  price?: string;
  icon?: string;
};
const RECENT_KEY = 'bo_recent_searches';
const ICON_BY_SLUG: Record<string, string> = {
  'fire-extinguishers': 'extinguisher',
  'solar-panels': 'solar',
  'total-stations': 'total-station',
  bulbs: 'bulb',
};

export default function SearchBar({ categories = [] }: { categories?: { slug: string; name: string }[] }) {
  const router = useRouter();
  /*
   * The query is read from the URL after mount, not through `useSearchParams`.
   *
   * `useSearchParams` suspends, which forced the header to wrap this in a <Suspense> boundary,
   * and on a prerendered page that boundary never completed: the deployed store served an empty
   * 326 × 40 div where the search field should be, with the real one parked in a `<div hidden
   * id="S:0">` at the end of <body> waiting for a swap script that never ran. The store's
   * most-used control has not been on screen in production.
   *
   * Both values only ever seeded initial state — `useState` ignores its initial value after the
   * first render, so this was always a mount-time read — which means an effect does the same job
   * with no boundary, no fallback and nothing to go wrong between the server and the client.
   */
  const [q, setQ] = React.useState('');
  const [scope, setScope] = React.useState('');

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get('q') ?? '');
    setScope(p.get('category') ?? '');
  }, []);
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Suggest | null>(null);
  const [sel, setSel] = React.useState(-1);
  const [recent, setRecent] = React.useState<string[]>([]);
  const ref = React.useRef<HTMLInputElement | null>(null);
  const box = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'));
    } catch {
      /* no recents */
    }
  }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, []);

  const fetchSuggest = React.useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setData(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const id = ++seq.current;
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(value)}`);
        const j = (await res.json()) as Suggest;
        if (id === seq.current) {
          setData(j);
          setSel(-1);
        }
      } catch {
        /* keep the last result */
      }
    }, 80);
  }, []);

  const remember = (value: string) => {
    const next = [value, ...recent.filter((r) => r !== value)].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const searchHref = (value: string) => `/search?q=${encodeURIComponent(value)}${scope ? `&category=${encodeURIComponent(scope)}` : ''}`;
  const go = (value: string) => {
    const v = value.trim();
    if (!v) {
      if (scope) router.push(`/c/${scope}`);
      return;
    }
    remember(v);
    setOpen(false);
    router.push(searchHref(v));
  };

  const rows: Row[] = [];
  if (q.trim() && data) {
    for (const s of data.skus) {
      const html = (s as SkuSearchDoc & { _formatted?: { name?: string } })._formatted?.name;
      rows.push({
        kind: 'sku',
        href: `/p/${s.sku_code.toLowerCase()}`,
        label: s.name,
        html,
        sub: `${s.brand} · ${s.category_name}`,
        thumb: s.hero_image_key ? mediaUrl(s.hero_image_key) : null,
        price: inr(s.selling_price),
      });
    }
    for (const c of data.categories)
      rows.push({ kind: 'category', href: `/c/${c.slug}`, label: c.name, sub: 'Category', icon: ICON_BY_SLUG[c.slug] ?? c.slug });
    for (const b of data.brands) rows.push({ kind: 'brand', href: `/search?brand=${encodeURIComponent(b.name)}`, label: b.name, sub: 'Brand' });
    rows.push({
      kind: 'query',
      href: searchHref(q.trim()),
      label: `Search for “${q.trim()}”`,
      sub: data.skus.length ? `${data.skus.length}+ results` : 'See all',
    });
  } else if (!q.trim()) {
    for (const r of recent) rows.push({ kind: 'recent', href: searchHref(r), label: r, sub: 'Recent' });
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setSel((s) => Math.min(rows.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(-1, s - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      ref.current?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0 && rows[sel]) {
        const r = rows[sel];
        if (r.kind === 'recent') go(r.label);
        else if (r.kind === 'query') go(q);
        else {
          setOpen(false);
          router.push(r.href);
        }
      } else go(q);
    }
  };

  const zero = q.trim().length > 1 && data && data.skus.length === 0 && data.categories.length === 0 && data.brands.length === 0;
  const groupLabel = (k: Row['kind']) =>
    k === 'sku' ? 'Products' : k === 'category' ? 'Categories' : k === 'brand' ? 'Brands' : k === 'recent' ? 'Recent searches' : '';

  return (
    <div className="search" ref={box}>
      <form
        role="search"
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <select className="search-scope" aria-label="Search in" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          ref={ref}
          value={q}
          className="search-input"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            fetchSuggest(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search cement, bulbs, tiles, solar, CCTV…"
          aria-label="Search products"
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-expanded={open && rows.length > 0}
          aria-controls="search-listbox"
          autoComplete="off"
          enterKeyHint="search"
        />
        {q && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQ('');
              setData(null);
              ref.current?.focus();
            }}
          >
            <IconClose size={16} />
          </button>
        )}
        <button type="submit" className="btn-brand search-btn" aria-label="Search">
          <IconSearch size={22} strokeWidth={2} />
        </button>
      </form>
      {open && (rows.length > 0 || zero) && (
        <div className="popover search-pop fade-in" id="search-listbox" role="listbox" aria-label="Suggestions">
          {zero && (
            <div className="search-empty">
              <div>No products for “{q.trim()}”.</div>
              <div className="caption" style={{ marginTop: 4 }}>
                Try searching by product name, brand, or specifications.
              </div>
            </div>
          )}
          {rows.map((r, i) => {
            const groupStart = i === 0 || rows[i - 1].kind !== r.kind;
            return (
              <React.Fragment key={`${r.kind}-${r.href}`}>
                {groupStart && groupLabel(r.kind) && <div className="search-group">{groupLabel(r.kind)}</div>}
                <Link
                  href={r.href}
                  role="option"
                  aria-selected={sel === i}
                  className="search-row"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    if (r.kind === 'query' || r.kind === 'recent') remember(r.kind === 'recent' ? r.label : q.trim());
                    setOpen(false);
                  }}
                >
                  {r.kind === 'sku' ? (
                    <span className="search-thumb">{r.thumb ? <img src={r.thumb} alt="" loading="lazy" width={40} height={40} /> : null}</span>
                  ) : r.kind === 'category' ? (
                    <span className="search-thumb">
                      <CategoryIcon icon={r.icon ?? 'cement'} size={20} />
                    </span>
                  ) : r.kind === 'recent' ? (
                    <span className="search-thumb search-thumb--muted">
                      <IconClockCheck size={18} />
                    </span>
                  ) : (
                    <span className="search-thumb search-thumb--muted">
                      <IconSearch size={18} />
                    </span>
                  )}
                  <span className="search-main">
                    <span className="block truncate">
                      <Highlight formatted={r.html} fallback={r.label} />
                    </span>
                    {r.sub && <span className="search-sub block truncate">{r.sub}</span>}
                  </span>
                  {r.price && <span className="search-price fig">{r.price}</span>}
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
