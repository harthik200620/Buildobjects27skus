'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { CatalogPrices, EstimateInputs, EstimateResult } from '@buildobjects/estimator';
import { nextBestQuestion, sensitivity } from '@buildobjects/estimator';
import React from 'react';

/**
 * What to ask next, and what answering it is worth.
 *
 * ── THE FORM'S JOB, NOT THE BUYER'S ─────────────────────────────────────────────────────────
 * Twenty inputs at one visual weight makes the person decide what matters. That is the product's
 * job. Every row here is ordered by how much the answer actually MOVES this house's number —
 * computed by running the engine at each input's extremes, not by a list somebody wrote down
 * once. When a rate changes, the order changes with it, which is the only way an ordering stays
 * honest.
 *
 * ── AND IT PRICES ITS OWN CONSEQUENCE ───────────────────────────────────────────────────────
 * Not "Soil type" but "Soil type — decides the foundation, ±₹2.4L on this house", with the figure
 * computed for THIS house. An input that states what it is worth before you touch it turns a form
 * into a shop: the buyer is not filling fields, they are buying certainty, and this is the shelf
 * with the prices on it.
 */

export interface SensitivityPanelProps {
  inputs: EstimateInputs;
  result: EstimateResult;
  catalog: CatalogPrices;
  /** Scrolls the matching control into view and opens its group. */
  onGo: (id: string) => void;
}

export default function SensitivityPanel({ inputs, result, catalog, onGo }: SensitivityPanelProps) {
  /*
   * ~28 engine runs, each a few hundred microseconds of pure arithmetic with no I/O. That is why
   * this can be recomputed on every edit instead of cached — a cached ordering is a stale
   * ordering, and a stale ordering is worse than no ordering because nobody notices it is wrong.
   */
  const rows = React.useMemo(() => sensitivity(inputs, catalog, result), [inputs, catalog, result]);
  const next = nextBestQuestion(rows);
  const unanswered = rows.filter((r) => r.unanswered && r.accuracyPoints > 0);

  return (
    <div className="sens">
      <div className="sens-meter">
        <Meter pct={result.accuracy.pct} />
        <div>
          <p className="micro">How sure this is</p>
          <p className="sens-pct fig">{result.accuracy.pct}%</p>
          <p className="sens-note">{result.accuracy.note}</p>
        </div>
      </div>

      {next && (
        <button type="button" className="sens-next" onClick={() => onGo(next.id)}>
          <span className="micro">Worth answering next</span>
          <span className="sens-next-label">{next.label}</span>
          <span className="sens-next-why">{next.consequence}</span>
          <span className="sens-next-worth fig">
            ±{formatRupees(Math.round(next.spread / 2))} on this house · +{next.accuracyPoints} points of certainty
          </span>
        </button>
      )}

      <ol className="sens-list">
        {rows
          .filter((r) => r.spread > 0)
          .slice(0, 8)
          .map((r) => (
            <li key={r.id} className={`sens-row${r.unanswered ? ' is-open' : ''}`}>
              <button type="button" className="sens-row-btn" onClick={() => onGo(r.id)}>
                <span className="sens-row-label">{r.label}</span>
                <span className="sens-row-why">{r.consequence}</span>
                <span className="sens-row-spread fig">±{formatRupees(Math.round(r.spread / 2))}</span>
                {/* The bar is a measurement, so it is cyan. The figure beside it is money and is
                    amber. The two never trade places anywhere on this page. */}
                <span className="sens-row-bar" style={{ '--w': `${Math.min(100, r.spreadShare * 240)}%` } as React.CSSProperties} aria-hidden="true" />
              </button>
            </li>
          ))}
      </ol>
      {unanswered.length === 0 && <p className="sens-done">Every question that moves this number has an answer. What is left is the rate card itself.</p>}
    </div>
  );
}

/**
 * The accuracy meter: an arc that fills as questions are answered.
 *
 * This is the page's progress bar and its reward loop at once. It is drawn as a stroked arc with
 * `stroke-dashoffset` so the fill animates on the compositor and the figure inside it can be read
 * while it moves.
 */
function Meter({ pct }: { pct: number }) {
  const R = 30;
  const C = Math.PI * R; /* a half-circle */
  return (
    <svg className="sens-arc" viewBox="0 0 76 44" role="img" aria-label={`Accuracy ${pct} per cent`}>
      <title>{`Accuracy ${pct}%`}</title>
      <path d={`M 8 38 A ${R} ${R} 0 0 1 68 38`} className="sens-arc-track" />
      <path
        d={`M 8 38 A ${R} ${R} 0 0 1 68 38`}
        className="sens-arc-fill"
        style={{ strokeDasharray: C, strokeDashoffset: C * (1 - Math.min(100, Math.max(0, pct)) / 100) }}
      />
    </svg>
  );
}
