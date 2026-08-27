'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { ChangeCostPoint, Decision, EstimateResult } from '@buildobjects/estimator';
import { buildSchedule, regretCurve } from '@buildobjects/estimator';
import React from 'react';

/**
 * TIME — when the money leaves, and what changing your mind costs.
 *
 * ── TWO THINGS ON ONE TIMELINE ──────────────────────────────────────────────────────────────
 *
 * THE CASH FLOW. A ₹34L house is an impossible wall of money. The same house at ₹2.6L in month
 * one is a plan. Nothing about the total changed; the framing did, and the framing is what
 * decides whether somebody starts.
 *
 * THE REGRET CURVE, which is the part nobody has built. For any decision on the form, this prices
 * what changing it LATER costs — flat while the decision is still upstream of the work it
 * touches, then a hard step at the phase boundary where that work gets executed. Adding a floor
 * before the footing is a drawing revision. Adding it after the slab is cast is breaking the slab.
 *
 * Mid-build changes are the number one way an Indian home budget explodes. Every contractor
 * prices them after the fact. Nobody has ever shown the buyer the curve in advance.
 *
 * ── AND IT ARRIVES AS A BAND ────────────────────────────────────────────────────────────────
 * Three of the four terms behind a change cost are thumb values that compound, so the curve is
 * drawn as a band and the terms are itemised underneath it. A single confident number here would
 * be a lie with a decimal point in it, and this page's only real asset is that it does not do
 * that.
 */

export interface TimeProps {
  result: EstimateResult;
  /** The decisions worth asking "what if I change this later" about. */
  decisions: Decision[];
}

/* Sized for the full-width band it now sits in. A 720 x 200 viewBox stretched across 1,300px
   resolves to 360px of mostly-empty chart; 1200 x 240 lands at about a third of that. */
const W = 1200;
const H = 170;
const PAD = { l: 72, r: 24, t: 18, b: 34 };

export default function Time({ result, decisions }: TimeProps) {
  const schedule = React.useMemo(() => buildSchedule(result), [result]);
  const [decisionId, setDecisionId] = React.useState<string>(decisions[0]?.id ?? '');
  const [month, setMonth] = React.useState(0);

  /*
   * EVERY decision is priced, not just the open one.
   *
   * The old version costed one curve at a time and the picks were bare labels, so the question a
   * reader actually arrives with — WHICH of these is the expensive one to get wrong — could only be
   * answered by clicking all four and remembering. Four curves is four engine runs, memoised on the
   * result, and it turns the picker into the answer.
   */
  const curves = React.useMemo(() => decisions.map((d) => ({ d, curve: regretCurve(result, d) })), [result, decisions]);

  const peak = schedule.peakMonth;
  const maxMonth = schedule.months;
  const maxAmount = Math.max(...schedule.cashflow.map((m) => m.amount));

  /* Where the scrubber is, in phases — which is what the regret curve is indexed by. */
  const phaseAt = React.useMemo(() => {
    const p = schedule.phases.find((x) => month >= x.startMonth && month < x.endMonth);
    return p ?? schedule.phases[schedule.phases.length - 1];
  }, [schedule, month]);
  /* Where on any curve the scrubber is standing. Shared by the picker and the detail below it, so
     the figure on a button and the figure under the chart can never disagree. */
  const pointOn = React.useCallback(
    (curve: ChangeCostPoint[]): ChangeCostPoint | null => {
      if (!curve.length) return null;
      if (month <= 0) return curve[0];
      const idx = schedule.phases.findIndex((x) => x.key === phaseAt?.key);
      return curve[idx + 1] ?? curve[curve.length - 1];
    },
    [month, schedule, phaseAt],
  );

  /* Falls back to the first rather than to nothing: this section has no meaning with no decision
     open, and the old toggle-off left the reader looking at a heading and a blank. */
  const selected = curves.find((c) => c.d.id === decisionId) ?? curves[0] ?? null;
  const curve = selected?.curve ?? [];
  const pointAt = pointOn(curve);

  return (
    <div className="lens-time">
      {/* ── the build, and the money, on one axis ─────────────────────────── */}
      <div className="time-head">
        {/* The total leads. A section called "when the money leaves" that never says how much
            money there is asks the reader to hold the figure in their head from another card. */}
        <div>
          <p className="micro">In all</p>
          <p className="time-total fig">{formatRupees(result.grandTotal)}</p>
          {/* Not "across N months" — the stat beside this one already says N months. The average
              is the thing a reader is actually working out in their head from the two. */}
          <p className="time-sub">{formatRupees(Math.round(result.grandTotal / Math.max(1, schedule.months)))} a month on average</p>
        </div>
        <div>
          <p className="micro">This house takes</p>
          <p className="time-months fig">{schedule.months} months</p>
          <p className="time-sub">start to handover</p>
        </div>
        <div>
          <p className="micro">Heaviest month</p>
          <p className="time-peak fig">{formatRupees(peak.amount)}</p>
          <p className="time-sub">month {peak.month}</p>
        </div>
      </div>

      <div className="time-bars" role="img" aria-label={schedule.cashflow.map((m) => `Month ${m.month}: ${formatRupees(m.amount)}`).join('. ')}>
        {schedule.cashflow.map((m) => (
          <button
            key={m.month}
            type="button"
            className={`time-bar${month >= m.month - 1 && month < m.month ? ' is-at' : ''}`}
            style={{ '--h': `${(m.amount / maxAmount) * 100}%` } as React.CSSProperties}
            onClick={() => setMonth(m.month - 0.5)}
            aria-label={`Month ${m.month}, ${formatRupees(m.amount)}`}
          >
            <span className="time-bar-fill" />
            <span className="time-bar-n micro">{m.month}</span>
          </button>
        ))}
      </div>

      <label className="time-scrub">
        <span className="micro">Scrub the build</span>
        <input type="range" min={0} max={maxMonth} step={0.25} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
        <span className="time-scrub-at fig">{month <= 0 ? 'Before work starts' : `Month ${Math.ceil(month)} — ${phaseAt?.label ?? ''}`}</span>
      </label>

      {/* ── the regret curve ──────────────────────────────────────────────── */}
      {decisions.length > 0 && (
        <section className="regret" aria-labelledby="regret-h">
          <h3 id="regret-h" className="h4">
            Changing your mind
          </h3>
          <p className="regret-lede">The same change, priced at each point in the build.</p>
          {/*
           * A RADIO GROUP, and one of them is always on.
           *
           * These used to be toggles that could all be off, which left the heading standing over an
           * empty box — a section called "changing your mind" showing nothing at all. There is no
           * reading of this feature in which no decision selected is a useful state.
           *
           * Each one carries its own price at the month the scrubber is standing on, and the
           * multiple against deciding it on paper. That multiple is the whole point of the feature:
           * the same bedroom is one number today and another number in month nine, and until you
           * put the two side by side nobody believes it.
           */}
          <div className="regret-picks" role="radiogroup" aria-label="Price a decision">
            {curves.map(({ d, curve: c }) => {
              const here = pointOn(c);
              const paper = c[0]?.likely ?? 0;
              const mult = paper > 0 && here ? here.likely / paper : 1;
              const on = selected?.d.id === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`regret-pick${on ? ' is-on' : ''}`}
                  onClick={() => setDecisionId(d.id)}
                >
                  <span className="regret-pick-label">{d.label}</span>
                  <span className="regret-pick-fig fig">{here ? formatRupees(here.likely) : '—'}</span>
                  {/* Only once it is meaningfully worse than the paper price — "×1.0 vs on paper"
                      is noise on every button before the ground is broken. */}
                  {mult >= 1.05 && <span className="regret-pick-mult">{mult.toFixed(1)}× vs on paper</span>}
                </button>
              );
            })}
          </div>

          {curve.length > 0 && <RegretChart curve={curve} atMonth={month} months={maxMonth} />}

          {pointAt && (
            <div className="regret-now">
              <p className="micro">{pointAt.phaseLabel}</p>
              <p className="regret-figure fig">{formatRupees(pointAt.likely)}</p>
              {/* What the buyer is actually being quoted. "Add a bedroom" is not self-explanatory —
                  it is 450 sqft of house, and a figure that size needs to say so. */}
              {selected && <p className="regret-detail">{selected.d.detail}</p>}
              {pointAt.low !== pointAt.high && (
                <p className="regret-band fig">
                  {formatRupees(pointAt.low)} – {formatRupees(pointAt.high)}
                </p>
              )}
              {/* Before anything is built the only term IS the change itself, and printing it
                  under a figure identical to it says nothing twice. */}
              <dl className="regret-terms" hidden={pointAt.likely === pointAt.terms.baseDelta}>
                <Term label="The change itself" value={pointAt.terms.baseDelta} />
                <Term label="Work already done, undone and redone" value={pointAt.terms.rework} />
                <Term
                  label="Breaking and carting away"
                  value={pointAt.terms.demolition}
                  sub={pointAt.terms.brokenCum > 0 ? `${pointAt.terms.brokenCum} m³ broken out` : undefined}
                />
                <Term
                  label="The site staying open longer"
                  value={pointAt.terms.slip}
                  sub={pointAt.terms.slipMonths > 0 ? `${pointAt.terms.slipMonths} months` : undefined}
                />
              </dl>
              <details className="regret-basis">
                <summary className="micro">What these numbers rest on</summary>
                <ul>
                  {pointAt.needsVerification.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <p>
                  The change itself is the engine re-run with the decision applied, so it is as accurate as any other figure here. The other three are thumb
                  values that compound, which is why this is a band and not a number.
                </p>
              </details>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Term({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (value === 0) return null;
  return (
    <div className="regret-term">
      <dt>
        {label}
        {sub && <span className="regret-term-sub"> · {sub}</span>}
      </dt>
      <dd className="fig">{formatRupees(value)}</dd>
    </div>
  );
}

/**
 * The curve itself.
 *
 * Drawn as a BAND rather than a line — the fill is low-to-high and the stroke is the likely
 * figure through the middle of it. A line would claim a precision the model does not have, and
 * the width of the band widening as the build goes on is itself the honest message: the later you
 * decide, the less anybody can tell you exactly what it will cost.
 */
function RegretChart({ curve, atMonth, months }: { curve: ChangeCostPoint[]; atMonth: number; months: number }) {
  const maxY = Math.max(...curve.map((p) => p.high), 1);
  const x = (m: number) => PAD.l + (m / Math.max(months, 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);

  const pts = curve.map((p) => ({ x: x(p.month), lo: y(p.low), hi: y(p.high), mid: y(p.likely), p }));
  const band = `${pts.map((q) => `${q.x},${q.hi}`).join(' ')} ${[...pts]
    .reverse()
    .map((q) => `${q.x},${q.lo}`)
    .join(' ')}`;
  const line = pts.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x} ${q.mid}`).join(' ');

  return (
    <svg className="regret-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={curve.map((p) => `${p.phaseLabel}: ${formatRupees(p.likely)}`).join('. ')}>
      <title>What this decision costs at each point in the build</title>
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className="regret-axis" />
      <polygon points={band} className="regret-band-fill" />
      <path d={line} className="regret-line" />
      {pts.map((q) => (
        <g key={q.p.phaseLabel}>
          <circle cx={q.x} cy={q.mid} r={3} className="regret-dot" />
        </g>
      ))}
      {/* Where the scrubber is standing. */}
      <line x1={x(atMonth)} y1={PAD.t} x2={x(atMonth)} y2={H - PAD.b} className="regret-now-line" />
      <text x={PAD.l} y={H - 10} className="regret-tick">
        on paper
      </text>
      <text x={W - PAD.r} y={H - 10} textAnchor="end" className="regret-tick">
        month {months}
      </text>
      <text x={PAD.l - 8} y={y(maxY) + 4} textAnchor="end" className="regret-tick fig">
        {short(maxY)}
      </text>
    </svg>
  );
}

/** Lakh and crore, because that is how the number will be said out loud. */
function short(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return formatRupees(n);
}
