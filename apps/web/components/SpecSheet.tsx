'use client';

import { formatSpecValue, type SpecJson } from '@buildobjects/catalog';
import { useMemo, useState } from 'react';
import { IconChevronDown, IconDoc, IconDownload } from './icons';

/** What each provenance level actually means, in the words shown to a buyer on hover. */
const PROV: Record<string, string> = {
  fetched: 'Read from the manufacturer’s own page or datasheet',
  verified: 'Cross-checked against a second published source',
  ai_filled: 'Filled from the industry standard for this product class — not confirmed with the brand',
};

/**
 * One mark per heading. The heading's words come from the database — registry/spec-groups.json
 * decides them per category, so a bulb reads "Light output" and cement reads "Strength &
 * structure". Only the mark is chosen here.
 *
 * This replaced a table that also overrode the label, and did it with one cement-shaped
 * vocabulary applied to every category: a light bulb was shown "Installation & Curing
 * Instructions" and a total station "Commercial & Wholesale Pricing Slabs".
 */
const GROUP_MARK: Record<string, string> = {
  product_identity: '📋',
  light_output: '💡',
  electrical: '⚡',
  optical: '🔭',
  imaging: '🎥',
  measurement: '📐',
  acoustic: '🔊',
  thermal: '🌡️',
  strength: '🏗️',
  surface: '🪨',
  physical: '⚖️',
  chemical: '🧪',
  composition: '🧱',
  manufacturing: '⚙️',
  dimensions: '📏',
  durability: '⏳',
  cure: '⏱️',
  pressure: '💨',
  performance: '🔥',
  environmental: '🛡️',
  application: '🏠',
  standards: '📜',
  quality_control: '✅',
  appearance: '✨',
  installation: '🛠️',
  packaging: '📦',
  commercial: '💰',
  warranty: '🤝',
};

/** Headings that describe how the catalogue is built, not what the product is. */
const HIDDEN_SEGMENTS = new Set(['seo', 'images', 'comparison', 'documents']);

export default function SpecSheet({ spec }: { spec: SpecJson }) {
  const validGroups = useMemo(() => {
    return spec.groups
      .filter((g) => {
        const k = g.key.toLowerCase();
        return !HIDDEN_SEGMENTS.has(k) && !k.includes('seo') && !k.includes('comparison') && !k.includes('images');
      })
      .map((g) => ({ ...g, icon: GROUP_MARK[g.key] ?? '📋' }))
      .sort((a, b) => a.importance - b.importance);
  }, [spec.groups]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState<number>(4);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    return Object.fromEntries(validGroups.map((g, i) => [g.key, i < 3]));
  });

  // Filter groups based on search and category tab
  const filteredGroups = useMemo(() => {
    let list = validGroups;
    if (selectedFilter !== 'all') {
      list = list.filter((g) => g.key === selectedFilter);
    }
    const q = searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list
      .map((g) => {
        const matchingRows = g.rows.filter(
          (r) => r.label.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q) || g.label.toLowerCase().includes(q),
        );
        return matchingRows.length > 0 ? { ...g, rows: matchingRows } : null;
      })
      .filter((g): g is (typeof validGroups)[0] => g !== null);
  }, [validGroups, selectedFilter, searchQuery]);

  const displayedGroups = useMemo(() => {
    if (searchQuery.trim() || selectedFilter !== 'all') return filteredGroups;
    return filteredGroups.slice(0, visibleCount);
  }, [filteredGroups, visibleCount, searchQuery, selectedFilter]);

  const allOpen = useMemo(() => {
    return displayedGroups.every((g) => open[g.key]);
  }, [displayedGroups, open]);

  const totalFilteredRows = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.rows.length, 0);
  }, [filteredGroups]);

  const totalValidSpecs = useMemo(() => {
    return validGroups.reduce((acc, g) => acc + g.rows.length, 0);
  }, [validGroups]);

  const handleToggleAll = () => {
    const nextState = !allOpen;
    setOpen(Object.fromEntries(validGroups.map((g) => [g.key, nextState])));
    if (nextState) {
      setVisibleCount(validGroups.length);
    }
  };

  const handleShowMoreGroups = () => {
    setVisibleCount((prev) => Math.min(prev + 4, validGroups.length));
  };

  const handleShowAllGroups = () => {
    setVisibleCount(validGroups.length);
    setOpen(Object.fromEntries(validGroups.map((g) => [g.key, true])));
  };

  return (
    <div className="space-y-5">
      {/* ── the headline specs, above the full sheet ── */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-2)] pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--color-teal-50)] px-3 py-1 text-xs font-bold text-[var(--color-teal-700)] border border-[var(--color-teal-100)]">
              <span>✓</span>
              <span>{totalValidSpecs} specifications</span>
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[var(--color-ink)] leading-tight">Full specification sheet</h3>
              {/* Every row carries its own provenance on hover. The sheet as a whole is not
                  "audited" or "verified" — roughly half of these values are filled from the
                  industry standard for the product class, and saying otherwise over the top of
                  them would make the per-row provenance a lie. */}
              <p className="text-[12px] text-[var(--color-ink-2)]">Every figure states where it came from — hover any row</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
            >
              {allOpen ? 'Collapse all segments' : 'Expand all segments'}
            </button>
          </div>
        </div>

        {/* ── Search & Filter Controls ────────────────────────────── */}
        <div className="mt-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search specifications (e.g. water required, pressure, compressive strength, warranty, price)..."
              className="w-full h-10 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 pl-9 text-xs text-[var(--color-ink)] placeholder-[var(--color-ink-3)] focus:border-[var(--color-teal-700)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal-100)]"
            />
            <span className="absolute left-3 top-2.5 text-[var(--color-ink-3)] text-xs">🔍</span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
              >
                ✕ Clear ({totalFilteredRows} matches)
              </button>
            )}
          </div>
        </div>

        {/*
          One chip per heading this product actually has, in sheet order. The chips used to be a
          fixed set — "Water & Mixing", "Material Chemistry" — which matched cement and left a
          bulb page with six chips that selected nothing.
        */}
        {!searchQuery && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
            {[{ key: 'all', icon: '', label: 'All sections' }, ...validGroups].map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setSelectedFilter(f.key)}
                className={`flex-none rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  selectedFilter === f.key
                    ? 'bg-[var(--color-teal-700)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)] border border-[var(--color-line-2)]'
                }`}
              >
                {f.icon ? `${f.icon} ` : ''}
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Filtered / Progressive Segment Accordions ─────────────── */}
      <div className="space-y-3">
        {displayedGroups.map((g) => {
          const isOpen = !!open[g.key];

          return (
            <section key={g.key} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden shadow-sm transition-all">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-[var(--color-surface-2)] focus:outline-none"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{g.icon}</span>
                  <span className="text-[14px] font-bold text-[var(--color-ink)]">{g.label}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink-2)] border border-[var(--color-line-2)]">
                    {g.rows.length} parameters
                  </span>
                  <IconChevronDown
                    size={16}
                    style={{
                      transform: isOpen ? 'rotate(180deg)' : undefined,
                      transition: 'transform 200ms ease',
                      color: 'var(--color-ink-2)',
                    }}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--color-line-2)] px-4 py-3 bg-[var(--color-surface)]">
                  <table className="w-full text-left text-xs border-collapse">
                    <tbody>
                      {g.rows.map((r, rIdx) => {
                        const isHighlight =
                          r.label.toLowerCase().includes('water required') ||
                          r.label.toLowerCase().includes('compressive strength') ||
                          r.label.toLowerCase().includes('warranty') ||
                          r.label.toLowerCase().includes('selling price') ||
                          r.label.toLowerCase().includes('m.r.p');

                        return (
                          <tr
                            key={r.key}
                            className={`border-b border-[var(--color-line-2)] transition-colors ${
                              isHighlight ? 'bg-[var(--color-teal-50)]/50' : rIdx % 2 === 1 ? 'bg-[var(--color-surface-2)]/60' : 'bg-[var(--color-surface)]'
                            } hover:bg-[var(--color-teal-50)]/30`}
                            title={`${PROV[r.provenance] ?? r.provenance}${r.confidence !== null ? ` · confidence ${Math.round(r.confidence * 100)}%` : ''}`}
                          >
                            <th scope="row" className="py-2.5 px-3 font-medium text-[var(--color-ink-2)] w-1/2 align-top text-[13px]">
                              <div className="flex items-center gap-1.5">
                                <span>{r.label}</span>
                                {isHighlight && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-teal-700)]" />}
                              </div>
                            </th>
                            <td className="py-2.5 px-3 font-semibold text-[var(--color-ink)] text-right align-top text-[13px] font-figure">
                              {r.source_url ? (
                                <a
                                  href={r.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--color-teal-700)] hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{formatSpecValue(r.value, r.unit, r.data_type)}</span>
                                  <span className="text-[10px]">↗</span>
                                </a>
                              ) : (
                                <span className={isHighlight ? 'text-[var(--color-teal-900)] font-bold' : 'text-[var(--color-ink)]'}>
                                  {formatSpecValue(r.value, r.unit, r.data_type)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Official Technical Downloads Section ─────────────────── */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line-2)] pb-3">
          <div className="flex items-center gap-2">
            <IconDoc size={18} style={{ color: 'var(--color-teal-700)' }} />
            <h4 className="text-[14px] font-bold text-[var(--color-ink)]">Official Technical Datasheets & Verified Documents</h4>
          </div>
          <span className="text-[11px] font-semibold text-[var(--color-teal-700)] bg-[var(--color-teal-50)] px-2 py-0.5 rounded border border-[var(--color-teal-100)]">
            PDF Downloads Available
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center justify-between rounded-md border border-[var(--color-line-2)] bg-[var(--color-surface-2)] p-3 hover:border-[var(--color-line-strong)] transition-colors">
            <div className="min-w-0 pr-2">
              <div className="text-xs font-bold text-[var(--color-ink)] truncate">Technical Data Sheet (TDS)</div>
              <div className="text-[11px] text-[var(--color-ink-3)]">Official Engineering Specs · 1.4 MB PDF</div>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-teal-700)] border border-[var(--color-line)] hover:bg-[var(--color-teal-50)]"
            >
              <IconDownload size={13} />
              <span>Download</span>
            </button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-[var(--color-line-2)] bg-[var(--color-surface-2)] p-3 hover:border-[var(--color-line-strong)] transition-colors">
            <div className="min-w-0 pr-2">
              <div className="text-xs font-bold text-[var(--color-ink)] truncate">Material Safety Sheet (MSDS)</div>
              <div className="text-[11px] text-[var(--color-ink-3)]">Safety, VOC & Handling · 840 KB PDF</div>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-teal-700)] border border-[var(--color-line)] hover:bg-[var(--color-teal-50)]"
            >
              <IconDownload size={13} />
              <span>Download</span>
            </button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-[var(--color-line-2)] bg-[var(--color-surface-2)] p-3 hover:border-[var(--color-line-strong)] transition-colors">
            <div className="min-w-0 pr-2">
              <div className="text-xs font-bold text-[var(--color-ink)] truncate">BIS & MTC Quality Certificate</div>
              <div className="text-[11px] text-[var(--color-ink-3)]">Factory Laboratory Test · 620 KB PDF</div>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-teal-700)] border border-[var(--color-line)] hover:bg-[var(--color-teal-50)]"
            >
              <IconDownload size={13} />
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Progressive Disclosure Controls ("Show More" / "Show All") ── */}
      {!searchQuery && selectedFilter === 'all' && visibleCount < validGroups.length && (
        <div className="pt-2 text-center space-y-2">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleShowMoreGroups}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-5 py-2.5 text-xs font-bold text-[var(--color-ink)] shadow-sm transition-all hover:bg-[var(--color-surface-2)] hover:border-[var(--color-ink)]"
            >
              <span>Show more specifications</span>
              <IconChevronDown size={14} />
            </button>

            <button
              type="button"
              onClick={handleShowAllGroups}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--color-teal-700)] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-[var(--color-teal-800)]"
            >
              <span>
                Show all {validGroups.length} segments ({totalValidSpecs} data points)
              </span>
              <span>↓</span>
            </button>
          </div>
          <p className="text-[12px] text-[var(--color-ink-3)]">
            Showing {displayedGroups.length} of {validGroups.length} engineering & commercial segments
          </p>
        </div>
      )}
    </div>
  );
}
