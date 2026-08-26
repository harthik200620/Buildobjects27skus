'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { EstimateResult, QuoteComparison, QuotedLine } from '@buildobjects/estimator';
import { compareQuote, parseQuoteText } from '@buildobjects/estimator';
import React from 'react';
import { IconCamera, IconClose } from '@/components/icons';
import type { QuoteReading } from '@/lib/quote-reader';

/**
 * Is the quote you were given fair?
 *
 * ── WHY THIS IS THE HOOK ────────────────────────────────────────────────────────────────────
 * Almost everybody building a house has two or three contractor quotes on their phone and no way
 * on earth to judge them. There is no published rate for "brickwork in Guntur in August". Today
 * the options are to trust the contractor, or to ask an uncle who built ten years ago.
 *
 * ── TWO WAYS IN, AND THE FREE ONE IS FIRST ──────────────────────────────────────────────────
 * Typing or pasting runs `parseQuoteText` — offline, instant, no key, no cost. Photographing runs
 * the reader in `lib/quote-reader.ts`, which is how people actually hold a quotation: a page on a
 * letterhead, shot on a phone. The reader also writes a plain assessment of each line.
 *
 * ── AND BOTH READS ARE SHOWN ────────────────────────────────────────────────────────────────
 * The engine's own range against the dated rate card is printed beside whatever the model said,
 * so a reader can see the two and disagree with either. Neither is hidden behind the other.
 *
 * ── THE RULES, VISIBLE IN THE INTERFACE ─────────────────────────────────────────────────────
 *  · Never accuse anyone. A contractor can be dearer for a dozen good reasons and the buyer knows
 *    which — this gives them the question to ask, not the answer.
 *  · A line BELOW the range is flagged harder than one above, and coloured as a warning. An
 *    over-quote costs money; an under-quote is how a build stalls at month nine.
 *  · Unmatchable lines are listed. Dropping what we cannot place would make it a lie by omission.
 *
 * ── AND IT IS THEIR DOCUMENT ────────────────────────────────────────────────────────────────
 * A quotation is private commercial paper. The pasted text never leaves the tab; a photograph is
 * read and forgotten, never stored. The interface says so beside the box.
 */

export interface TruthProps {
  result: EstimateResult;
}

const SAMPLE = `Cement 720 bags 2,88,000
TMT steel 6300 kg 92 5,79,600
Bricks 14400 nos 92,000
Centering & shuttering 1,08,000
Mestri labour 6,80,000
Plastering 1,20,000
Vaastu consultation 25,000`;

export default function Truth({ result }: TruthProps) {
  const [text, setText] = React.useState('');
  const [reading, setReading] = React.useState<QuoteReading | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  /* Lines come from whichever route produced them; the engine does not care which. */
  const lines: QuotedLine[] = React.useMemo(() => (reading ? reading.lines : text.trim() ? parseQuoteText(text) : []), [reading, text]);
  const comparison: QuoteComparison | null = React.useMemo(() => (lines.length ? compareQuote(result, lines) : null), [lines, result]);
  /* The model's per-line words, keyed by line number so a row can print both reads. */
  const said = React.useMemo(() => new Map((reading?.lines ?? []).map((l) => [l.line, l.assessment])), [reading]);

  const onFile = React.useCallback(async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', f);
      const res = await fetch('/api/estimate/quote', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not read that quotation');
      if (!data.lines?.length) throw new Error(data.notes || 'No priced lines could be read from that page');
      setReading(data as QuoteReading);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = () => {
    setText('');
    setReading(null);
    setError(null);
  };

  return (
    <div className="lens-truth">
      {/*
       * ONE ROW, AT THE HEIGHT OF A CONTROL.
       * This used to open as a full-width textarea seven rows tall with a heading above it and
       * nothing beside it until you pasted something — most of a card, blank, on a page that is
       * otherwise dense. The box and its two buttons share a row now, and the results take the
       * card when there are results.
       */}
      <div className="truth-in">
        <textarea
          className="truth-paste"
          rows={3}
          value={text}
          placeholder={'Paste the quote — one line each, amount at the end.\nCement 720 bags 2,88,000'}
          onChange={(e) => {
            setText(e.target.value);
            setReading(null);
          }}
          aria-label="Paste a contractor's quote"
          spellCheck={false}
        />
        <div className="truth-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn btn-secondary btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconCamera size={14} /> {busy ? 'Reading…' : 'Photograph it'}
          </button>
          {!text && !reading && (
            <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={() => setText(SAMPLE)}>
              Try a sample
            </button>
          )}
          {(text || reading) && (
            <button type="button" className="btn-ghost h-8 px-3 text-[12px]" onClick={clear}>
              <IconClose size={12} /> Clear
            </button>
          )}
        </div>
      </div>
      <p className="truth-privacy micro">Stays in your browser. A photograph is read and forgotten — never stored.</p>

      {error && <p className="truth-empty">{error}</p>}
      {reading && (
        <p className="truth-reading">
          Read {reading.lines.length} lines{reading.contractor ? ` from ${reading.contractor}` : ''}
          {reading.statedTotal ? ` · the page totals ${formatRupees(reading.statedTotal)}` : ''}
          {reading.confidence > 0 ? ` · confidence ${Math.round(reading.confidence * 100)}%` : ''}
        </p>
      )}
      {text.trim() && !reading && lines.length === 0 && (
        <p className="truth-empty">
          Nothing read as a priced line — each needs a description and an amount, like <span className="fig">Cement 720 bags 2,88,000</span>.
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
            On the lines we could match: <span className="fig">{formatRupees(comparison.matchedQuotedTotal)}</span> quoted against our{' '}
            <span className="fig">{formatRupees(comparison.matchedEstimateTotal)}</span>. Unmatched lines are excluded from both sides.
          </p>

          <ul className="truth-lines">
            {comparison.matches.map((m) => (
              <li key={m.quoted.line} className={`truth-line truth-line--${m.verdict}`}>
                <div className="truth-line-head">
                  <span className="truth-line-label">{m.quoted.label}</span>
                  <span className="truth-line-amt fig">{formatRupees(m.quoted.amount)}</span>
                </div>
                {m.range && (
                  <>
                    <Bar quoted={m.quoted.amount} low={m.range.low} likely={m.range.likely} high={m.range.high} />
                    <p className="truth-line-range micro">
                      our range: <span className="fig">{formatRupees(m.range.low)}</span> – <span className="fig">{formatRupees(m.range.high)}</span>
                      {m.matchedOn && <span className="truth-matched"> · matched on “{m.matchedOn}”</span>}
                    </p>
                  </>
                )}
                <p className="truth-line-note">{m.note}</p>
                {/* What the model made of it, kept visibly separate from what the card says. */}
                {said.get(m.quoted.line) && <p className="truth-ai">Reader: {said.get(m.quoted.line)}</p>}
              </li>
            ))}
          </ul>

          {reading?.summary && (
            <details className="regret-basis">
              <summary className="micro">What the reader made of the whole quotation</summary>
              <p>{reading.summary}</p>
              {reading.notes && <p>{reading.notes}</p>}
            </details>
          )}

          <p className="truth-cite micro">
            Compared against rate card <span className="fig">{comparison.citation.version}</span> for <span className="fig">{comparison.citation.city}</span> at
            the {comparison.citation.tier} finish level.
          </p>
        </div>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) return null;
  return (
    <div className={`truth-count truth-count--${tone}`}>
      <span className="truth-count-n fig">{n}</span>
      <span className="truth-count-l">{label}</span>
    </div>
  );
}

/**
 * One line against the range, as a bar. The range is the band and the quoted figure is a marker
 * on it, so "22 % above" is a position rather than a sentence. The scale is padded either side so
 * an outlier stays visible instead of pinning silently to the end.
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
