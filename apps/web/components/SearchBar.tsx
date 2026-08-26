'use client';

import type { SkuSearchDoc } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React from 'react';
import { inr, mediaUrl } from '@/lib/media';
import Highlight from './Highlight';
import { CategoryIcon, IconClockCheck, IconClose, IconSearch } from './icons';

/**
 * Search, as a command palette.
 *
 * It used to be an 860 px field welded into the header, and that field is the whole reason the
 * header was two rows and 104 px tall: Audiowide is a very wide face, the lockup measured 392 px
 * at a 30 px cap, and a lockup and a usable search field could not share one row. So the mark
 * spent months at 22 px — the brand, illegible, to protect a control most visitors use once.
 *
 * Moving search into an overlay settles that argument in search's favour rather than against it.
 * The bar keeps a 250 px affordance with the keycaps printed on it, which is *more* discoverable
 * than a bare field because it advertises the shortcut. Opening it gives search the full width of
 * the viewport instead of the leftovers of a header row, a 20 px input instead of a 14 px one, and
 * room for the scope chips that were previously a cramped <select>. The header gets its 28 px
 * back and the mark goes to 44 px.
 *
 * Everything behind it is unchanged: 80 ms debounce, one round trip to /api/search/suggest, the
 * grouped listbox, recent searches in localStorage, and `mark.hl` highlighting from Meilisearch.
 * The ARIA contract is kept as it was — role=combobox on the input, aria-controls=search-listbox,
 * role=listbox/option on the results — because it was correct.
 *
 * Shortcuts: ⌘K / Ctrl-K toggles. `/` opens, as it always did. Escape closes.
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
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  /*
   * The query is read from the URL after mount, not through `useSearchParams`.
   *
   * `useSearchParams` suspends, which forced the header to wrap this in a <Suspense> boundary,
   * and on a prerendered page that boundary never completed: the deployed store served an empty
   * div where the search field should be, with the real one parked in a `<div hidden id="S:0">`
   * at the end of <body> waiting for a swap script that never ran.
   */
  const [q, setQ] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [data, setData] = React.useState<Suggest | null>(null);
  const [sel, setSel] = React.useState(-1);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [mac, setMac] = React.useState(false);
  const ref = React.useRef<HTMLInputElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get('q') ?? '');
    setScope(p.get('category') ?? '');
    setMac(/Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent));
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'));
    } catch {
      /* no recents */
    }
  }, []);

  /* A route change means the palette did its job. Closing on `pathname` rather than in the click
     handler also covers a result opened with the keyboard, and the browser's back button. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Focus the input and hold the page still behind the scrim. Restoring the exact padding rather
     than clearing it matters on Windows, where the scrollbar takes real width and clearing it
     would shift the page under the overlay. */
  React.useEffect(() => {
    if (!open) return;
    const { body } = document;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const overflow = body.style.overflow;
    const pad = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      body.style.overflow = overflow;
      body.style.paddingRight = pad;
    };
  }, [open]);

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
      setSel((s) => Math.min(rows.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(-1, s - 1));
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
  const scopeName = scope ? (categories.find((c) => c.slug === scope)?.name ?? null) : null;

  return (
    <>
      {/* The affordance. A button, not a field — it opens something rather than accepting text,
          and typing into a box that then throws your keystrokes at a different box is a trick. */}
      <button type="button" className="search-cue" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <IconSearch size={18} />
        <span className="search-cue-text">{scopeName ? `Search in ${scopeName}` : 'Search the catalogue'}</span>
        <kbd className="search-keys">
          <span>{mac ? '⌘' : 'Ctrl'}</span>
          <span>K</span>
        </kbd>
      </button>

      {open && (
        <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
          {/* The scrim is a sibling button so dismissing works with a pointer and with a screen
              reader's own close affordance, without a click handler on a <div>. */}
          <button type="button" className="palette-scrim" aria-label="Close search" onClick={() => setOpen(false)} />
          <div className="palette-panel">
            <form
              role="search"
              className="palette-field"
              onSubmit={(e) => {
                e.preventDefault();
                go(q);
              }}
            >
              <IconSearch size={22} />
              <input
                ref={ref}
                value={q}
                className="palette-input"
                onChange={(e) => {
                  setQ(e.target.value);
                  fetchSuggest(e.target.value);
                }}
                onKeyDown={onKeyDown}
                placeholder="Cement, bulbs, tiles, solar, CCTV…"
                aria-label="Search products"
                role="combobox"
                aria-haspopup="listbox"
                aria-autocomplete="list"
                aria-expanded={rows.length > 0}
                aria-controls="search-listbox"
                autoComplete="off"
                enterKeyHint="search"
              />
              {q && (
                <button
                  type="button"
                  className="palette-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQ('');
                    setData(null);
                    ref.current?.focus();
                  }}
                >
                  <IconClose size={18} />
                </button>
              )}
              <kbd className="search-keys">
                <span>esc</span>
              </kbd>
            </form>

            {/* Scope. A row of chips rather than the old <select>, because a select hides every
                option but one and the whole point of the overlay is that there is room. */}
            <div className="palette-scopes" role="group" aria-label="Search in">
              <button type="button" className="scope-chip" aria-pressed={scope === ''} onClick={() => setScope('')}>
                Everything
              </button>
              {categories.slice(0, 8).map((c) => (
                <button key={c.slug} type="button" className="scope-chip" aria-pressed={scope === c.slug} onClick={() => setScope(c.slug)}>
                  {c.name}
                </button>
              ))}
            </div>

            <div className="palette-results" id="search-listbox" role="listbox" aria-label="Suggestions">
              {zero && (
                <div className="palette-empty">
                  <p className="h4">No products for “{q.trim()}”.</p>
                  <p className="meta">Try a product name, a brand, or a specification.</p>
                </div>
              )}
              {!q.trim() && rows.length === 0 && <p className="palette-empty meta">Fifteen thousand items, priced this morning. Start typing.</p>}
              {rows.map((r, i) => {
                const groupStart = i === 0 || rows[i - 1].kind !== r.kind;
                return (
                  <React.Fragment key={`${r.kind}-${r.href}`}>
                    {groupStart && groupLabel(r.kind) && <p className="palette-group micro">{groupLabel(r.kind)}</p>}
                    <Link
                      href={r.href}
                      role="option"
                      aria-selected={sel === i}
                      className="palette-row"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => {
                        if (r.kind === 'query' || r.kind === 'recent') remember(r.kind === 'recent' ? r.label : q.trim());
                      }}
                    >
                      {r.kind === 'sku' ? (
                        <span className="palette-thumb">{r.thumb ? <img src={r.thumb} alt="" loading="lazy" width={44} height={44} /> : null}</span>
                      ) : r.kind === 'category' ? (
                        <span className="palette-thumb palette-thumb--icon">
                          <CategoryIcon icon={r.icon ?? 'cement'} size={22} />
                        </span>
                      ) : r.kind === 'recent' ? (
                        <span className="palette-thumb palette-thumb--icon">
                          <IconClockCheck size={20} />
                        </span>
                      ) : (
                        <span className="palette-thumb palette-thumb--icon">
                          <IconSearch size={20} />
                        </span>
                      )}
                      <span className="palette-main">
                        <span className="block truncate">
                          <Highlight formatted={r.html} fallback={r.label} />
                        </span>
                        {r.sub && <span className="palette-sub block truncate">{r.sub}</span>}
                      </span>
                      {r.price && <span className="palette-price fig">{r.price}</span>}
                    </Link>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
