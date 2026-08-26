import { describe, expect, it } from 'vitest';
import {
  type AiPatch,
  applyAiPatch,
  buildSchedule,
  compareQuote,
  type EstimateInputs,
  estimate,
  matchLabel,
  materialise,
  nextBestQuestion,
  parseAiPatch,
  parseQuoteText,
  regretCurve,
  SCHEDULE,
  sensitivity,
} from '../src';

/**
 * The three lenses, the schedule and the AI boundary.
 *
 * Same reference house as estimate.test.ts and v2.test.ts — Hyderabad, 30 × 40 ft, 75 % coverage,
 * G+1 → 1,800 sqft BUA, RCC framed, Medium, seed rates, grand total ₹34,16,796. Every figure
 * asserted below is hand-checkable against that house.
 */
const base: EstimateInputs = {
  state: 'TS',
  city: 'hyderabad',
  pincode: null,
  plot: { lengthFt: 30, widthFt: 40 },
  floors: 1,
  coverage: 0.75,
  constructionType: 'rcc_framed',
  parking: false,
  compoundWall: false,
  tier: 'medium',
  addons: { solar: false, cctv: false, fireSafety: false },
  builtUpOverrideSqft: null,
  picks: [],
};
const result = estimate(base);

describe('MATTER — the physical form of the money', () => {
  const piles = materialise(result);
  const pile = (k: string) => {
    const p = piles.find((x) => x.key === k);
    if (!p) throw new Error(`no pile ${k}`);
    return p;
  };

  it('materialises only lines that physically arrive on site', () => {
    const keys = piles.map((p) => p.key);
    expect(keys).toContain('cement');
    expect(keys).toContain('steel');
    expect(keys).toContain('sand');
    /* Labour, formwork hire and per-sqft services have no object to stand on the plot. */
    expect(keys).not.toContain('civil_labour');
    expect(keys).not.toContain('plumbing');
    expect(keys).not.toContain('formwork');
  });

  it('puts steel at its real density — 6,300 kg is a cube 0.93 m on a side', () => {
    const steel = pile('steel');
    /* 1,800 sqft × 3.5 kg/sqft = 6,300 kg. At 7,850 kg/m³ that is 0.802 m³. */
    expect(steel.kg).toBe(6300);
    expect(steel.cum).toBeCloseTo(0.802, 2);
    expect(steel.cubeSideM).toBeCloseTo(0.93, 1);
  });

  it('sizes sand in tipper loads a buyer will actually be quoted', () => {
    const sand = pile('sand');
    /* 1,800 × 1.2 = 2,160 cft. At 300 cft a tipper that is 7.2 loads. */
    expect(sand.qty).toBeCloseTo(2160, 0);
    expect(sand.tipperLoads).toBeCloseTo(7.2, 1);
    expect(sand.shape).toBe('heap');
    /* A heap is a cone at its angle of repose, so it is wider than it is tall. */
    expect(sand.heap!.radius).toBeGreaterThan(sand.heap!.height);
  });

  it('gives every stack an instancing grid rather than a piece list', () => {
    const bricks = pile('bricks');
    expect(bricks.pieces).toBe(14400);
    expect(bricks.grid).toBeTruthy();
    expect(bricks.grid!.rows * bricks.grid!.cols * bricks.grid!.layers).toBeGreaterThanOrEqual(14400);
    /* Site stacks do not go above 20 courses. */
    expect(bricks.grid!.layers).toBeLessThanOrEqual(20);
  });

  it('never exaggerates: cement volume is the bags, not a dramatic pile', () => {
    const cement = pile('cement');
    /* 1,800 × 0.4 = 720 bags at 0.072 m³ laid = 51.8 m³. */
    expect(cement.pieces).toBe(720);
    expect(cement.cum).toBeCloseTo(51.84, 1);
  });
});

describe('TIME — the calendar and the cash flow', () => {
  const sch = buildSchedule(result);

  it('derives a duration from area and curing, never below the floor', () => {
    /* 1,800 / 160 = 11.25 months + 2 slabs × 21 days = 1.4 → 13 months. */
    expect(sch.months).toBe(13);
    expect(sch.months).toBeGreaterThanOrEqual(SCHEDULE.min_months.value);
  });

  it('spreads the whole grand total across the months and no more', () => {
    const summed = sch.cashflow.reduce((a, m) => a + m.amount, 0);
    expect(summed).toBe(result.grandTotal);
    expect(sch.cashflow[sch.cashflow.length - 1].cumulative).toBe(result.grandTotal);
  });

  it('turns an impossible wall of money into a month a buyer can plan for', () => {
    expect(sch.peakMonth.amount).toBeLessThan(result.grandTotal / 3);
    for (const m of sch.cashflow) expect(m.amount).toBeGreaterThan(0);
  });

  it('orders the phases without gaps', () => {
    for (let i = 1; i < sch.phases.length; i += 1) {
      expect(sch.phases[i].startMonth).toBeCloseTo(sch.phases[i - 1].endMonth, 6);
    }
  });
});

describe('TIME — the regret curve', () => {
  const addBedroom = {
    id: 'floors',
    label: 'Add a floor',
    to: { ...base, floors: 2 },
  };
  const curve = regretCurve(result, addBedroom);

  it('is flat and cheap before the ground is broken', () => {
    const before = curve[0];
    expect(before.phaseLabel).toBe('Before work starts');
    expect(before.terms.rework).toBe(0);
    expect(before.terms.demolition).toBe(0);
    expect(before.terms.slip).toBe(0);
    /* At the start, changing your mind costs exactly what the change costs. */
    expect(before.likely).toBe(before.terms.baseDelta);
    expect(before.low).toBe(before.likely);
    expect(before.high).toBe(before.likely);
  });

  it('rises monotonically as the build passes each phase', () => {
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].likely).toBeGreaterThanOrEqual(curve[i - 1].likely);
    }
    /* And the last point costs materially more than deciding on paper. */
    expect(curve[curve.length - 1].likely).toBeGreaterThan(curve[0].likely * 1.05);
  });

  it('breaks real cubic metres once something has been cast', () => {
    const atFinishing = curve[curve.length - 1];
    expect(atFinishing.terms.brokenCum).toBeGreaterThan(0);
    expect(atFinishing.terms.demolition).toBeGreaterThan(0);
    expect(atFinishing.terms.slipMonths).toBeGreaterThan(0);
  });

  it('reports a band on the uncertain terms and never a bare number', () => {
    const late = curve[curve.length - 1];
    expect(late.low).toBeLessThan(late.likely);
    expect(late.high).toBeGreaterThan(late.likely);
    /* The band is on the penalty terms only — baseDelta is the engine and is not widened. */
    const extra = late.likely - late.terms.baseDelta;
    expect(late.high - late.likely).toBeCloseTo(extra * SCHEDULE.change_band_pct.value, -1);
    expect(late.needsVerification.length).toBeGreaterThan(3);
  });

  it('prices a decision that costs nothing as costing nothing, at every phase', () => {
    const noop = { id: 'noop', label: 'No change', to: { ...base } };
    for (const p of regretCurve(result, noop)) {
      expect(p.terms.baseDelta).toBe(0);
      expect(p.terms.rework).toBe(0);
      expect(p.terms.demolition).toBe(0);
    }
  });
});

describe('Sensitivity — what to ask, and in what order', () => {
  const rows = sensitivity(base);

  it('orders by what actually moves this house, not by a written-down list', () => {
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].spread).toBeLessThanOrEqual(rows[i - 1].spread);
    expect(rows[0].spread).toBeGreaterThan(0);
  });

  it('prices every consequence against this house', () => {
    for (const r of rows) {
      expect(r.high).toBeGreaterThanOrEqual(r.low);
      expect(r.consequence.length).toBeGreaterThan(10);
      expect(r.spreadShare).toBeGreaterThanOrEqual(0);
    }
  });

  it('knows the next best question and stops offering it once answered', () => {
    const first = nextBestQuestion(rows);
    expect(first).toBeTruthy();
    const answered = sensitivity({ ...base, rooms: { bedrooms: 3, bathrooms: 3, kitchens: 1 } });
    expect(nextBestQuestion(answered)?.id).not.toBe('rooms');
  });
});

describe('TRUTH — comparing a real quotation', () => {
  it('reads the trade words a contractor actually writes', () => {
    expect(matchLabel('Centering & shuttering charges')?.key).toBe('formwork');
    expect(matchLabel('20mm jelly')?.key).toBe('aggregate');
    expect(matchLabel('TMT rods Fe500')?.key).toBe('steel');
    expect(matchLabel('Mestri labour')?.key).toBe('civil_labour');
    expect(matchLabel('Consultancy retainer')).toBeNull();
  });

  it('parses a pasted quote with Indian digit grouping', () => {
    const lines = parseQuoteText(
      ['Cement 720 bags — ₹2,88,000', 'TMT steel  6300  68  4,28,400', 'Site visit charges', 'Bricks 14400 nos 1,44,000'].join('\n'),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0].amount).toBe(288000);
    expect(lines[1].qty).toBe(6300);
    expect(lines[1].rate).toBe(68);
    /* The document's own line numbers, kept: two identical labels are normal on a quote. */
    expect(lines.map((l) => l.line)).toEqual([1, 2, 4]);
  });

  it('places each line against a range and never accuses anyone', () => {
    const c = compareQuote(result, [
      { line: 1, label: 'Cement', amount: 288000 },
      { line: 2, label: 'TMT steel', amount: 900000 },
      { line: 3, label: 'Brickwork', amount: 40000 },
      { line: 4, label: 'Vaastu consultation', amount: 25000 },
    ]);
    expect(c.matches[0].verdict).toBe('within');
    expect(c.matches[1].verdict).toBe('above');
    expect(c.matches[2].verdict).toBe('below');
    expect(c.matches[3].verdict).toBe('unmatchable');
    for (const m of c.matches) {
      expect(m.note.toLowerCase()).not.toMatch(/cheat|fraud|scam|dishonest|rip/);
    }
  });

  it('flags an under-quote harder than an over-quote', () => {
    const c = compareQuote(result, [{ line: 1, label: 'Brickwork', amount: 40000 }]);
    expect(c.matches[0].note).toMatch(/stops halfway|seriously/i);
  });

  it('lists unmatchable lines rather than dropping them', () => {
    const c = compareQuote(result, [{ line: 1, label: 'Temple pooja expenses', amount: 15000 }]);
    expect(c.matches).toHaveLength(1);
    expect(c.counts.unmatchable).toBe(1);
    /* And they are excluded from the totals that are compared, so the comparison stays honest. */
    expect(c.matchedQuotedTotal).toBe(0);
  });

  it('cites the rate pack version and city on every comparison', () => {
    const c = compareQuote(result, [{ line: 1, label: 'Cement', amount: 288000 }]);
    expect(c.citation.version).toBe(result.version);
    expect(c.citation.city).toBe('Hyderabad');
    expect(c.citation.cityIndex).toBe(1);
  });
});

describe('The AI boundary', () => {
  it('cannot represent a total: a model returning one changes nothing', () => {
    const evil = { kind: 'inputs', patch: { grandTotal: 9_900_000, perSqft: 5500, floors: 2 }, fieldConfidence: { floors: 0.95 } };
    const parsed = parseAiPatch(evil);
    expect(parsed).toBeTruthy();
    expect(parsed!.kind).toBe('inputs');
    const patch = (parsed as Extract<AiPatch, { kind: 'inputs' }>).patch as Record<string, unknown>;
    expect(patch.grandTotal).toBeUndefined();
    expect(patch.perSqft).toBeUndefined();
    expect(patch.floors).toBe(2);

    const { inputs: next } = applyAiPatch(base, parsed!);
    /* The only thing that moved is the input, and the engine recomputed the total itself. */
    const after = estimate(next);
    expect(after.grandTotal).not.toBe(9_900_000);
    expect(after.grandTotal).toBe(estimate({ ...base, floors: 2 }).grandTotal);
  });

  it('rejects a response that is not one of the three shapes', () => {
    expect(parseAiPatch({ grandTotal: 5_000_000 })).toBeNull();
    expect(parseAiPatch({ kind: 'total', value: 42 })).toBeNull();
    expect(parseAiPatch('₹42,00,000')).toBeNull();
    expect(parseAiPatch(null)).toBeNull();
  });

  it('clamps every numeric field it does accept to its declared range', () => {
    const p = parseAiPatch({ kind: 'inputs', patch: { floors: 99, coverage: 5, floorHeightFt: 400 }, fieldConfidence: {} });
    const patch = (p as Extract<AiPatch, { kind: 'inputs' }>).patch;
    expect(patch.floors).toBeLessThanOrEqual(4);
    expect(patch.coverage).toBeLessThanOrEqual(1);
    expect(patch.floorHeightFt).toBeLessThanOrEqual(16);
  });

  it('refuses an adjustment with no citation', () => {
    expect(parseAiPatch({ kind: 'adjustments', adjustments: [{ line_key: 'steel', rate: 80, reason: 'market is up', source_url: null }] })).toBeNull();
    const ok = parseAiPatch({
      kind: 'adjustments',
      adjustments: [{ line_key: 'steel', rate: 80, reason: 'market is up', source_url: 'https://example.com/steel' }],
    });
    expect(ok?.kind).toBe('adjustments');
  });

  it('holds a low-confidence field instead of applying it silently', () => {
    const p = parseAiPatch({ kind: 'inputs', patch: { floors: 3, soil: 'black_cotton' }, fieldConfidence: { floors: 0.4, soil: 0.9 } })!;
    const { inputs: next, applied, held } = applyAiPatch(base, p);
    expect(applied).toContain('soil');
    expect(held.map((h) => h.field)).toContain('floors');
    expect(next.floors).toBe(base.floors);
    expect(next.soil).toBe('black_cotton');
  });

  it('lets prose through and lets it set nothing', () => {
    const p = parseAiPatch({ kind: 'explanation', text: 'Steel is 3.5 kg per sqft for a framed structure.' })!;
    const { inputs: next, applied } = applyAiPatch(base, p);
    expect(applied).toHaveLength(0);
    expect(next).toEqual(base);
  });
});
