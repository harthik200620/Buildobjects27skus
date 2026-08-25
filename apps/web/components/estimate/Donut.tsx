'use client';

import type { GroupAmount } from '@buildobjects/estimator';
import { PATINA } from '@buildobjects/ui/tokens';
import { inr } from '@/lib/media';

/**
 * The circle. Drawn, not charted: one SVG ring per material group, accent + derived hues from
 * the token palette only, animated sweep on every change (stroke-dasharray transitions).
 */
export const seriesColor = (i: number) => PATINA.series[i % PATINA.series.length];

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
      <circle cx="110" cy="110" r={r} fill="none" stroke="var(--fill)" strokeWidth="24" />
      {groups.map((g, i) => {
        const len = Math.max(0, g.share) * c;
        const el = (
          <circle
            key={g.key}
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={active === g.key ? 30 : 24}
            strokeLinecap="butt"
            strokeDasharray={`${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 110 110)"
            style={{
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
        fill="var(--ink)"
        fontSize="21"
        style={{ fontFamily: 'var(--font-figure)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
      >
        {big}
      </text>
      <text x="110" y="126" textAnchor="middle" fill="var(--ink-3)" fontSize="9" letterSpacing="2.2">
        {active ? (groups.find((g) => g.key === active)?.label ?? '').toUpperCase().slice(0, 28) : 'GRAND TOTAL'}
      </text>
      {active && (
        <text x="110" y="142" textAnchor="middle" fill="var(--accent)" fontSize="12" style={{ fontFamily: 'var(--font-figure)' }}>
          {Math.round((groups.find((g) => g.key === active)?.share ?? 0) * 100)}%
        </text>
      )}
    </svg>
  );
}
