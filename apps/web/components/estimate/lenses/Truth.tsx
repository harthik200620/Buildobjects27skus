'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { EstimateResult, QuoteComparison, QuotedLine } from '@buildobjects/estimator';
import { compareQuote, parseQuoteText } from '@buildobjects/estimator';
import React from 'react';

/**
 * TRUTH — is the quote you were given fair?
 *
 * ── WHY THIS IS THE HOOK ────────────────────────────────────────────────────────────────────
 * Almost everybody building a house has two or three contractor quotes on their phone and no way
 * on earth to judge them. There is no published rate for "brickwork in Guntur in August". Today
 * the options are to trust the contractor or to ask an uncle who built ten years ago.
 *
 * ── THE RULES, VISIBLE IN THE INTERFACE ─────────────────────────────────────────────────────
 *
 *  · NEVER ACCUSE ANYONE. Every verdict is "22 % above our rate for Hyderabad, Aug 2026", with
 *    the rate card cited. A contractor can be dearer for a dozen good reasons and the buyer is
 *    the one who knows which — this gives them the question to ask, not the answer.
 *  · A LINE BELOW THE RANGE IS FLAGGED HARDER THAN ONE ABOVE, and it is coloured as a warning
 *    rather than as good news. Underquoting is how a build stalls at month nine with the slab
 *    cast and the money gone. An over-quote costs money; an under-quote costs the house.
 *  · UNMATCHABLE LINES ARE LISTED. Dropping what we cannot understand would make the comparison
 *    a lie by omission, and the totals compared are matched-lines-only for the same reason.
 *
 * ── AND IT IS THEIR DOCUMENT ────────────────────────────────────────────────────────────────
 * A quotation is private commercial paper. It lives in this component's state for as long as the
 * tab is open and goes nowhere else — no upload, no request, no storage — and the interface says
 * so beside the box rather than in a policy nobody opens.
 */

export interface TruthProps {
  result: EstimateResult;
}

/**
 * The sample is a REAL-SHAPED quote, not a flattering one.
 *
 * An all-within sample would demonstrate nothing — the point of this lens is the two lines that
 * are not. So the steel is quoted high, the brickwork low, and there is a line nobody's rate card
 * can place, which is exactly what a quotation off a Guntur contractor's pad looks like.
 */
const SAMPLE = `Cement 720 bags — 2,88,000
TMT steel 6300 kg 92 5,79,600
Bricks 14400 nos 92,000
Centering & shuttering 1,08,000
Mestri labour 6,80,000
Plastering 1,20,000
Vaastu consultation 25,000`;

export default function Truth({ result }: TruthProps) {
  const [text, setText] = React.useState('');
  const [comparison, setComparison] = React.useState<QuoteComparison | null>(null);
  const [parsed, setParsed] = React.useState<QuotedLine[] | null>(null);

  const run = React.useCallback(
    (raw: string) => {
      const lines = parseQuoteText(raw);
      setParsed(lines);
      setComparison(lines.length ? compareQuote(result, lines) : null);
    },
    [result],
  );

  /* A quote already on screen re-compares when the house changes underneath it — otherwise the
     buyer edits a floor count and is left reading a verdict against a house that no longer exists. */
  React.useEffect(() => {
    if (text.trim()) run(text);
  }, [text, run]);

  return (
    <div className="lens-truth">
      <div className="truth-in">
        <label className="truth-label" htmlFor="truth-paste">
          <span className="h4">Paste the quote you were given</span>
          <span className="truth-hint">
            One line each, with the amount at the end. Straight out of WhatsApp is fine — it reads ₹, commas and Indian grouping.
          </span>
        </label>
        <textarea
          id="truth-paste"
          className="truth-paste"
          rows={7}
          value={text}
          placeholder={SAMPLE}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="truth-actions">
          <button type="button" className="btn btn-secondary btn--sm" onClick={() => setText(SAMPLE)}>
            Try it with a sample quote
          </button>
          {text && (
            <button
              type="button"
              className="btn btn-ghost btn--sm"
              onClick={() => {
                setText('');
                setComparison(null);
                setParsed(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
        <p className="truth-privacy micro">This stays in your browser. It is not uploaded, not saved and not sent anywhere — close the tab and it is gone.</p>
      </div>

      {parsed && parsed.length === 0 && (
        <p className="truth-empty">
          Nothing read as a priced line. Each line needs a description and an amount — <span className="fig">Cement 720 bags 2,88,000</span>.
        </p>
      )}

      {comparison && (
        <div className="truth-out">
          <div className="truth-summary">
            <Count n={comparison.counts.within} label="inside our range" tone="ok" />
            <Count n={comparison.counts.above} label="above it" tone="over" />
            <Count n={comparison.counts.below} label="below it" tone="under" />
            <Count n={comparison.counts.unmatchable} label="we cannot place" tone="none" />
          </div>

          <p className="truth-totals">
            On the lines we could match, the quote comes to <span className="fig">{formatRupees(comparison.matchedQuotedTotal)}</span> against our{' '}
            <span className="fig">{formatRupees(comparison.matchedEstimateTotal)}</span>. Unmatched lines are excluded from both sides — comparing them would be
            comparing different things.
          </p>

          <ul className="truth-lines">
            {comparison.matches.map((m) => (
              <li key={m.quoted.line} className={`truth-line truth-line--${m.verdict}`}>
                <div className="truth-line-head">
                  <span className="truth-line-label">{m.quoted.label}</span>
                  <span className="truth-line-amt fig">{formatRupees(m.quoted.amount)}</span>
                </div>
                {m.range ? (
                  <>
                    <Bar quoted={m.quoted.amount} low={m.range.low} likely={m.range.likely} high={m.range.high} />
                    <p className="truth-line-range micro">
                      our range for {m.lineLabel}: <span className="fig">{formatRupees(m.range.low)}</span> –{' '}
                      <span className="fig">{formatRupees(m.range.high)}</span>
                      {m.matchedOn && <span className="truth-matched"> · matched on “{m.matchedOn}”</span>}
                    </p>
                  </>
                ) : null}
                <p className="truth-line-note">{m.note}</p>
              </li>
            ))}
          </ul>

          <p className="truth-cite micro">
            Compared against rate card <span className="fig">{comparison.citation.version}</span> for <span className="fig">{comparison.citation.city}</span>{' '}
            (city index <span className="fig">{comparison.citation.cityIndex.toFixed(2)}</span>) at the {comparison.citation.tier} finish level. Argue with any
            of it — that is what the citation is for.
          </p>
        </div>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`truth-count truth-count--${tone}`}>
      <span className="truth-count-n fig">{n}</span>
      <span className="truth-count-l">{label}</span>
    </div>
  );
}

/**
 * One line against the range, as a bar.
 *
 * The range is drawn as the band and the quoted figure as a marker on it, so "22 % above" is a
 * position rather than a sentence. The bar's own scale is the range padded by half its width
 * either side, which keeps an outlier visible instead of pinning it silently to the end.
 */
function Bar({ quoted, low, likely, high }: { quoted: number; low: number; likely: number; high: number }) {
  const pad = Math.max((high - low) * 0.6, high * 0.15);
  const min = Math.max(0, low - pad);
  const max = Math.max(high + pad, quoted * 1.05);
  const at = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="truth-bar" aria-hidden="true">
      <span className="truth-bar-range" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      <span className="truth-bar-likely" style={{ left: at(likely) }} />
      <span className="truth-bar-quoted" style={{ left: at(quoted) }} />
    </div>
  );
}
