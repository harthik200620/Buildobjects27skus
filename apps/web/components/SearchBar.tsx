'use client';

import type { SkuSearchDoc } from '@buildobjects/catalog';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React from 'react';
import { inr, mediaUrl } from '@/lib/media';
import Highlight from './Highlight';
import { CategoryIcon, IconClockCheck, IconClose, IconSearch } from './icons';

/**
 * ONE SEARCH BAR. The one in the header. It is the field you type into.
 *
 * ── WHAT THIS REPLACES, AND WHY ─────────────────────────────────────────────────────────────
 * The header used to carry a BUTTON dressed as a search field — an icon, grey placeholder text,
 * a ⌘K keycap, a border, the lot — and pressing it opened a full-screen command palette with a
 * SECOND, real field in it. Two search bars, and the one you pressed was not the one you typed
 * into. The reported symptom was exactly that: "when I click search bar it is opening some other
 * search bar."
 *
 * The palette was not a bad idea. It was a good answer to a layout problem — Audiowide is a very
 * wide face, and a lockup plus a usable field could not share a 46px header row, so search moved
 * out and the mark got its size back. But it solved that by making the visible search bar a lie,
 * and a control that looks like a field and refuses your keystrokes is a trick played on the
 * reader every single time.
 *
 * The layout problem is gone anyway: --search-w is 560px at rest now, not 250. There is room for
 * a real field, so there is a real field.
 *
 * ── THE SHAPE IT TAKES INSTEAD ──────────────────────────────────────────────────────────────
 * A combobox. One input in the header; suggestions drop UNDER it, anchored to it, the way every
 * search field a person has ever used behaves. The page keeps scrolling behind them because a
 * dropdown is not a modal, so there is no scroll lock to get wrong and no scrim to mis-position.
 *
 * Three whole classes of bug leave with the overlay: `position: fixed` resolving against the
 * header's backdrop-filter instead of the screen, the header's z-index clamping the palette's,
 * and two scroll locks fighting over the reader's place. None of them can happen to a dropdown.
 *
 * ⌘K and `/` now FOCUS the field rather than opening anything, which is what those shortcuts
 * mean when the field is already on screen. Escape closes the suggestions and keeps the text.
 *
 * ── NARROW SCREENS ──────────────────────────────────────────────────────────────────────────
 * Under 720px the header cannot hold a 560px field, so the bar collapses to its icon — and
 * focusing it expands it across the header row IN PLACE. Still one field, still the same one,
 * still the same input element receiving the keystrokes.
 *
 * Everything behind it is unchanged: 80ms debounce, one round trip to /api/search/suggest, the
 * grouped listbox, recent searches in localStorage, `mark.hl` highlighting from Meilisearch, and
 * the ARIA contract — role=combobox on the input, aria-controls=search-listbox, role=listbox and
 * role=option on the results — because that part was correct.
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
  /* `open` means the suggestions are showing, not that a modal exists. There is nothing to
     scroll-lock: a dropdown lets the page behind it scroll, like every other dropdown. */
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

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

  /* The shortcuts FOCUS the field. When the field is already on the screen, that is what ⌘K has
     always meant — there is nothing left for it to open. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      if (((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        ref.current?.focus({ preventScroll: true });
        ref.current?.select();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Anywhere outside the bar closes the suggestions, and leaves what was typed alone. */
  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
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
    <div className="search" ref={wrap} data-open={open ? 'true' : undefined}>
      <form
        role="search"
        className="search-field"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <IconSearch size={18} />
        <input
          ref={ref}
          className="search-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            fetchSuggest(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={scopeName ? `Search in ${scopeName}` : 'Search the catalogue'}
          aria-label="Search products"
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-expanded={open && rows.length > 0}
          aria-controls="search-listbox"
          autoComplete="off"
          enterKeyHint="search"
        />
        {q ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQ('');
              setData(null);
              ref.current?.focus({ preventScroll: true });
            }}
          >
            <IconClose size={16} />
          </button>
        ) : (
          <kbd className="search-keys">
            <span>{mac ? '⌘' : 'Ctrl'}</span>
            <span>K</span>
          </kbd>
        )}
      </form>

      {/* The suggestions hang off the field, not off the viewport. Absolute inside a relative
          wrapper — so the header's backdrop-filter, which would have captured a fixed overlay,
          is irrelevant to it. */}
      {open && (
        <div className="search-drop">
          {categories.length > 0 && (
            <div className="search-scopes" role="group" aria-label="Search in">
              <button type="button" className="scope-chip" aria-pressed={scope === ''} onClick={() => setScope('')}>
                Everything
              </button>
              {categories.slice(0, 6).map((c) => (
                <button key={c.slug} type="button" className="scope-chip" aria-pressed={scope === c.slug} onClick={() => setScope(c.slug)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <div className="search-results" id="search-listbox" role="listbox" aria-label="Suggestions">
            {zero && (
              <div className="search-empty">
                <p className="h4">No products for “{q.trim()}”.</p>
                <p className="meta">Try a product name, a brand, or a specification.</p>
              </div>
            )}
            {!q.trim() && rows.length === 0 && <p className="search-empty meta">Start typing — every price here was checked this morning.</p>}
            {rows.map((r, i) => {
              const groupStart = i === 0 || rows[i - 1].kind !== r.kind;
              return (
                <React.Fragment key={`${r.kind}-${r.href}`}>
                  {groupStart && groupLabel(r.kind) && <p className="search-group micro">{groupLabel(r.kind)}</p>}
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
                      <span className="search-thumb search-thumb--icon">
                        <CategoryIcon icon={r.icon ?? 'cement'} size={20} />
                      </span>
                    ) : r.kind === 'recent' ? (
                      <span className="search-thumb search-thumb--icon">
                        <IconClockCheck size={18} />
                      </span>
                    ) : (
                      <span className="search-thumb search-thumb--icon">
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
        </div>
      )}
    </div>
  );
}
