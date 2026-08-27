'use client';

import type { GroupAmount } from '@buildobjects/estimator';
import { inr } from '@/lib/media';

/**
 * The circle. Drawn, not charted: one SVG ring per material group, animated sweep on every
 * change (stroke-dasharray transitions).
 *
 * The colour comes from `--series-N` in theme.css — the same custom properties the legend
 * swatches read, so a slice and its row cannot disagree. They used to come from a TypeScript
 * copy of the palette that had gone stale against the stylesheet: its ramp was picked to clear
 * 3:1 on WHITE, and this chart is painted on #0e2a33, where nine of its twelve colours fell
 * under 3:1 and the second one landed at 1.01:1 — a slice drawn in the card's own colour.
 */
export const SERIES_COUNT = 12;
export const seriesColor = (i: number) => `var(--series-${(i % SERIES_COUNT) + 1})`;

export default function Donut({
  groups,
  total,
  active,
  onActive,
}: {
  groups: GroupAmount[];
  total: number;
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const r = 78,
    c = 2 * Math.PI * r;
  let offset = 0;
  const big = total >= 1e7 ? `₹${(total / 1e7).toFixed(2)} Cr` : total >= 1e5 ? `₹${(total / 1e5).toFixed(1)} L` : inr(total);
  return (
    <svg viewBox="0 0 220 220" className="donut" role="img" aria-label={`Cost share by material group, total ${inr(total)}`}>
      <circle cx="110" cy="110" r={r} fill="none" stroke="var(--surf-3)" strokeWidth="24" />
      {groups.map((g, i) => {
        const len = Math.max(0, g.share) * c;
        const el = (
          <circle
            key={g.key}
            cx="110"
            cy="110"
            r={r}
            fill="none"
            strokeWidth={active === g.key ? 30 : 24}
            strokeLinecap="butt"
            strokeDasharray={`${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 110 110)"
            /* `stroke` goes through `style`, not the presentation attribute: a `var()` in an SVG
               attribute is not resolved, it is treated as the literal string and the slice
               renders black. */
            style={{
              stroke: seriesColor(i),
              transition: 'stroke-dasharray .55s cubic-bezier(.2,.7,.2,1), stroke-dashoffset .55s cubic-bezier(.2,.7,.2,1), stroke-width .15s',
              cursor: 'pointer',
              opacity: active && active !== g.key ? 0.45 : 1,
            }}
            onMouseEnter={() => onActive(g.key)}
            onMouseLeave={() => onActive(null)}
            onClick={() => onActive(active === g.key ? null : g.key)}
          >
            <title>{`${g.label}: ${Math.round(g.share * 100)}% · ${inr(g.amount)}`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      <text
        x="110"
        y="106"
        textAnchor="middle"
        fill="var(--ink-1)"
        fontSize="21"
        style={{ fontFamily: 'var(--font-figure)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
      >
        {big}
      </text>
      <text x="110" y="126" textAnchor="middle" fill="var(--ink-3)" fontSize="9" letterSpacing="2.2">
        {active ? (groups.find((g) => g.key === active)?.label ?? '').toUpperCase().slice(0, 28) : 'GRAND TOTAL'}
      </text>
      {active && (
        <text x="110" y="142" textAnchor="middle" fill="var(--color-brand)" fontSize="12" style={{ fontFamily: 'var(--font-figure)' }}>
          {Math.round((groups.find((g) => g.key === active)?.share ?? 0) * 100)}%
        </text>
      )}
    </svg>
  );
}
