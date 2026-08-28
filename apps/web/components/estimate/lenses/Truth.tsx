'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { CatalogPrices, EstimateResult, QuoteComparison, QuotedLine } from '@buildobjects/estimator';
import { compareQuote, parseQuoteText } from '@buildobjects/estimator';
import Link from 'next/link';
import React from 'react';
import { IconCamera, IconCheck, IconClose } from '@/components/icons';
import type { QuoteReading } from '@/lib/quote-reader';

/**
 * Is the quote you were given fair — and what does it come to if you buy the material here?
 *
 * Three answers, and not the same kind of answer. WHERE EACH LINE SITS against a dated rate card,
 * an average a contractor can honestly disagree with — better material, harder access, work the
 * estimate excludes. WHAT THE STORE CHARGES for the same material, which is not an opinion but the
 * price on the shelf today; it speaks only for lines the store really sells, leaving labour,
 * centering and plastering alone, which makes it a floor. And WHETHER THE QUANTITIES HOLD TOGETHER
 * — a quote pricing steel by the bag, or listing a hundred bags of cement for an 1800 sqft house,
 * has counted something wrong, and none of that is visible reading the lines one at a time.
 *
 * Nothing runs until the reader asks: comparing as you type produced half a verdict from a
 * half-pasted quote, rewriting itself under the reader's hands. Typing clears the last answer
 * rather than amending it, because an answer to a document no longer in the box is worse than none.
 *
 * The rules are visible in the interface — never accuse anyone (a contractor can be dearer for a
 * dozen good reasons, so this gives the question to ask, not the answer); a line BELOW the range is
 * flagged harder than one above; unmatchable lines are listed rather than dropped; the house being
 * compared against is named every time, including whether it was read from a drawing. A quotation
 * is private commercial paper: pasted text never leaves the tab, a photograph is read and forgotten.
 */

export interface TruthProps {
  result: EstimateResult;
  catalog: CatalogPrices;
}

const SAMPLE = `Cement 720 bags 600 4,32,000
TMT steel 80 bags 92 7,360
Bricks 14400 nos 92,000
Centering & shuttering 1,08,000
Mestri labour 6,80,000
Plastering 1,20,000
Vaastu consultation 25,000`;

/**
 * "720 bag" and "10 panel". The engine names a unit in the singular because that is what a rate
 * is quoted in — ₹410 a bag — and only the count beside it needs the plural. Spelled out rather
 * than suffixed, because `sqft`, `cft` and `kg` take no `s` and `ton` does not take that one.
 */
const PLURAL: Record<string, string> = {
  bag: 'bags',
  panel: 'panels',
  door: 'doors',
  window: 'windows',
  point: 'points',
  coat: 'coats',
  ton: 'tonnes',
  litre: 'litres',
};
const units = (n: number, u: string) => (n === 1 ? u : (PLURAL[u] ?? u));

/**
 * A unit rate, to the paisa when there are paisa in it. A tile at ₹74.84 a square foot printed
 * as ₹75 makes the line beside it — 1,200 sqft = ₹89,808 — look like an arithmetic mistake, and
 * a figure the reader cannot multiply out is a figure they stop trusting.
 */
const rate = (n: number) => (Number.isInteger(n) ? formatRupees(n) : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * A catalogue name is written to be searched, not read in a sentence: "Vikram Solar Paradea
 * VSMDH.72.550.05 550 Wp Bifacial Glass-Glass Module — 550 Wp · 144 half-cut cells" is seven
 * words of identity and twenty of specification. The specification goes; the whole name is on
 * the product page this links to, and in the tooltip.
 */
const shortSku = (s: string) => {
  const head = s.split(/\s+[—·]\s+/)[0].trim();
  if (head.length <= 44) return head;
  const cut = head.slice(0, 44);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

export default function Truth({ result, catalog }: TruthProps) {
  const [text, setText] = React.useState('');
  const [reading, setReading] = React.useState<QuoteReading | null>(null);
  /* The document as it was when the reader last pressed the button — not as it is now. */
  const [submitted, setSubmitted] = React.useState<QuotedLine[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const comparison: QuoteComparison | null = React.useMemo(
    () => (submitted?.length ? compareQuote(result, submitted, catalog) : null),
    [submitted, result, catalog],
  );
  /* The model's per-line words, keyed by line number so a row can print both reads. */
  const said = React.useMemo(() => new Map((reading?.lines ?? []).map((l) => [l.line, l.assessment])), [reading]);

  const edit = (v: string) => {
    setText(v);
    setReading(null);
    setSubmitted(null);
    setError(null);
  };

  const check = () => {
    const lines = parseQuoteText(text);
    setError(lines.length ? null : 'Nothing read as a priced line — each needs a description and an amount.');
    setSubmitted(lines.length ? lines : null);
  };

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
      /* Choosing the file WAS the button press; making them press a second one would be rude. */
      setSubmitted((data as QuoteReading).lines);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = () => {
    setText('');
    setReading(null);
    setSubmitted(null);
    setError(null);
  };

  const d = result.derived;
  const house = `${d.floorsLabel} · ${Math.round(d.builtUpSqft).toLocaleString('en-IN')} sqft built-up · ${result.inputs.tier} finish · ${d.cityName}`;

  return (
    <div className="lens-truth">
      <div className="truth-in">
        <textarea
          className="truth-paste"
          rows={4}
          value={text}
          placeholder={'Paste the quote — one line each, amount at the end.\nCement 720 bags 600 4,32,000'}
          onChange={(e) => edit(e.target.value)}
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
          <button type="button" className="btn btn-primary" onClick={check} disabled={!text.trim() || busy}>
            <IconCheck size={14} /> Check the truth
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <IconCamera size={14} /> {busy ? 'Reading…' : 'Photograph it'}
          </button>
          {!text && !reading ? (
            <button type="button" className="btn-ghost truth-ghost" onClick={() => edit(SAMPLE)}>
              Try a sample
            </button>
          ) : (
            <button type="button" className="btn-ghost truth-ghost" onClick={clear}>
              <IconClose size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Which house this is measured against, and where that house came from. A comparison
          against the wrong building is confident nonsense, so it is never left implied. */}
      <p className="truth-against micro">
        Against {house} — {d.fromDrawing ? 'read from your drawing' : 'as you set it above'}. Stays in your browser; a photograph is read and forgotten.
      </p>

      {error && <p className="truth-empty">{error}</p>}
      {reading && (
        <p className="truth-reading">
          Read {reading.lines.length} lines{reading.contractor ? ` from ${reading.contractor}` : ''}
          {reading.statedTotal ? ` · the page totals ${formatRupees(reading.statedTotal)}` : ''}
          {reading.confidence > 0 ? ` · confidence ${Math.round(reading.confidence * 100)}%` : ''}
        </p>
      )}

      {/*
       * WHAT THE READER STILL NEEDS.
       *
       * A quotation is half a conversation, and the absent half is where the money goes: four
       * lines on the test document are lump sums with no quantity behind them, and no comparison
       * against any rate card can tell you whether 4.2 lakh of brickwork is fair without knowing
       * the wall area it covers.
       *
       * Above the comparison on purpose. These are the questions to put to the contractor before
       * signing, so they are worth more than the arithmetic underneath them — and burying the one
       * genuinely actionable thing on the card under a table would be the wrong way round.
       */}
      {reading && reading.questions.length > 0 && (
        <section className="truth-ask" aria-labelledby="truth-ask-h">
          <h4 id="truth-ask-h" className="micro">
            Ask before you sign
          </h4>
          <ol className="truth-ask-list">
            {reading.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </section>
      )}

      {comparison && (
        <div className="truth-out">
          {/* ── what the material comes to here ─────────────────────────────
              The headline, because it is the only figure on this card the reader can act on
              today. It says how many lines it speaks for in the same breath, so it can never be
              mistaken for a verdict on the whole quotation. */}
          {comparison.store.lines > 0 && (
            <div className={`truth-save${comparison.store.saved > 0 ? ' is-cheaper' : ''}`}>
              <p className="micro">Buying the material here</p>
              <p className="truth-save-fig fig">
                {comparison.store.saved > 0
                  ? `${formatRupees(comparison.store.saved)} less`
                  : comparison.store.saved < 0
                    ? `${formatRupees(-comparison.store.saved)} more`
                    : 'The same'}
              </p>
              <p className="truth-save-sub">
                on {comparison.store.lines} of {comparison.matches.length} lines — the ones we sell. {formatRupees(comparison.store.quotedTotal)} quoted against{' '}
                {formatRupees(comparison.store.storeTotal)} here. Labour and site work are not priced by us and are left exactly as quoted.
              </p>
            </div>
          )}

          <div className="truth-summary">
            <Count n={comparison.counts.within} label="inside our range" tone="ok" />
            <Count n={comparison.counts.above} label="above it" tone="over" />
            <Count n={comparison.counts.below} label="below it" tone="under" />
            <Count n={comparison.counts.unmatchable} label="we cannot place" tone="none" />
          </div>

          {/* Checks that need more than one line to make. */}
          {comparison.flags.map((f) => (
            <p key={f.message} className="truth-flag">
              {f.message}
            </p>
          ))}

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

                {/* The shelf price, and what the same line comes to at it. */}
                {m.store && (
                  <p className="truth-store">
                    <Link href={`/p/${m.store.sku_code.toLowerCase()}`} className="truth-store-sku" title={m.store.skuName}>
                      {shortSku(m.store.skuName)}
                    </Link>{' '}
                    <span className="fig">{rate(m.store.storeRate)}</span> a {m.store.unit} here
                    {m.store.quotedRate !== null && (
                      <>
                        {' '}
                        against <span className="fig">{rate(m.store.quotedRate)}</span> on the quote
                      </>
                    )}{' '}
                    · {m.store.qty.toLocaleString('en-IN', { maximumFractionDigits: 1 })} {units(m.store.qty, m.store.unit)}
                    {m.store.qtySource === 'estimate' && <span className="truth-store-qty"> (this house’s quantity — the document states none)</span>} ={' '}
                    <span className="fig">{formatRupees(m.store.storeAmount)}</span>
                    {m.store.saving !== 0 && (
                      <span className={`truth-store-save${m.store.saving > 0 ? ' is-less' : ''}`}>
                        {m.store.saving > 0 ? '−' : '+'}
                        {formatRupees(Math.abs(m.store.saving))}
                      </span>
                    )}
                  </p>
                )}

                {m.flags.map((f) => (
                  <p key={f.message} className="truth-flag">
                    {f.message}
                  </p>
                ))}

                {/* What the model made of it, kept visibly separate from what the card says. */}
                {said.get(m.quoted.line) && <p className="truth-ai">Reader: {said.get(m.quoted.line)}</p>}
              </li>
            ))}
          </ul>

          <p className="truth-totals">
            On the lines we could match: <span className="fig">{formatRupees(comparison.matchedQuotedTotal)}</span> quoted against our{' '}
            <span className="fig">{formatRupees(comparison.matchedEstimateTotal)}</span>. Unmatched lines are excluded from both sides.
          </p>

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
