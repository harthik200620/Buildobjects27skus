'use client';

import type { Decision, EstimateResult } from '@buildobjects/estimator';
import React from 'react';
import Matter from './lenses/Matter';
import Time from './lenses/Time';
import Truth from './lenses/Truth';

/**
 * Three lenses on one house.
 *
 *   MATTER  what your money physically is
 *   TIME    when it leaves, and what changing your mind costs
 *   TRUTH   whether the quote you were given is fair
 *
 * ── ONE CONTROL, THREE STATES, AND NEVER A PAGE SWAP ────────────────────────────────────────
 * All three are computed off the same `EstimateResult` and all three are MOUNTED at once, hidden
 * with `visibility` rather than unmounted. That is the whole reason a lens change can be a
 * transform instead of a load: there is nothing to fetch, nothing to build, and no frame where
 * the reader is looking at a spinner. Switching costs one class change.
 *
 * The cost of keeping three subtrees alive is a few hundred DOM nodes. The cost of NOT doing it
 * is a loading state between two views of the same house, which would undo the point.
 *
 * ── WHICH ONE OPENS ─────────────────────────────────────────────────────────────────────────
 * MATTER for a first-time visitor, because it is the one that makes an abstract number into a
 * thing. TIME once they have edited the estimate more than twice, because by then they are
 * planning rather than exploring. TRUTH when they arrived to check a quote.
 */

export type LensKey = 'matter' | 'time' | 'truth';

const LENSES: { key: LensKey; label: string; question: string }[] = [
  { key: 'matter', label: 'Matter', question: 'What your money physically is' },
  { key: 'time', label: 'Time', question: 'When it leaves, and what changing your mind costs' },
  { key: 'truth', label: 'Truth', question: 'Is the quote you were given fair' },
];

export interface LensesProps {
  result: EstimateResult;
  decisions: Decision[];
  /** How many times the buyer has edited the estimate — decides the opening lens. */
  edits: number;
  /** Set when they arrived from a "check my quote" entry point. */
  arrivedForQuote?: boolean;
}

export default function Lenses({ result, decisions, edits, arrivedForQuote = false }: LensesProps) {
  const [lens, setLens] = React.useState<LensKey>(() => (arrivedForQuote ? 'truth' : edits > 2 ? 'time' : 'matter'));
  const [active, setActive] = React.useState<string | null>(null);
  const current = LENSES.find((l) => l.key === lens) ?? LENSES[0];

  return (
    <section className="lenses" aria-labelledby="lenses-h" data-lens={lens}>
      <header className="lenses-head">
        {/* `.h4`, not `.h3`: the page already sets that size and one section heading is not
            worth a new step on the type scale. */}
        <h2 id="lenses-h" className="h4">
          Three ways to look at it
        </h2>
        <div className="lenses-switch" role="tablist" aria-label="Lens">
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              id={`lens-tab-${l.key}`}
              aria-selected={lens === l.key}
              aria-controls={`lens-panel-${l.key}`}
              className={`lens-tab${lens === l.key ? ' is-on' : ''}`}
              onClick={() => setLens(l.key)}
            >
              {l.label}
            </button>
          ))}
          {/* One rule that slides between the three, so the change reads as a movement rather
              than as two separate things switching on and off. */}
          <span className="lenses-rule" aria-hidden="true" />
        </div>
        <p className="lenses-question" key={current.key}>
          {current.question}
        </p>
      </header>

      {/*
       * All three stay mounted. `visibility: hidden` keeps them out of the accessibility tree and
       * out of the tab order while leaving their layout computed, so a switch is a paint and not
       * a build. `inert` is what stops a hidden panel's controls being reachable by keyboard.
       */}
      <div className="lenses-stage">
        {LENSES.map((l) => (
          <div
            key={l.key}
            id={`lens-panel-${l.key}`}
            role="tabpanel"
            aria-labelledby={`lens-tab-${l.key}`}
            className={`lens-panel${lens === l.key ? ' is-on' : ''}`}
            {...(lens === l.key ? {} : { inert: '' as unknown as boolean })}
          >
            {l.key === 'matter' && <Matter result={result} active={active} onActive={setActive} />}
            {l.key === 'time' && <Time result={result} decisions={decisions} />}
            {l.key === 'truth' && <Truth result={result} />}
          </div>
        ))}
      </div>
    </section>
  );
}
