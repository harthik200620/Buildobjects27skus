import { describe, expect, it } from 'vitest';
import {
  type AiPatch,
  applyAiPatch,
  buildSchedule,
  type CatalogPrices,
  compareQuote,
  type EstimateInputs,
  estimate,
  matchLabel,
  parseAiPatch,
  parseQuoteText,
  regretCurve,
  SCHEDULE,
} from '../src';

/**
 * TIME, TRUTH, the schedule and the AI boundary.
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
/* esbuild's transform of this file is happier with the newline named than inlined in an array join. */
const NL = String.fromCharCode(10);

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

/**
 * The store re-price. Every figure below is hand-checkable against the reference house:
 * 1,800 sqft BUA, Medium, Hyderabad.
 */
const shop: CatalogPrices = {
  'CEM-AMB-PLUS50': {
    sku_code: 'CEM-AMB-PLUS50',
    category: 'cement',
    name: 'Plus 50kg',
    brand: 'Ambuja',
    unit: 'bag',
    selling_price: 500,
    price_provenance: 'fetched',
  },
  'SOL-VIK-PARADEA-550': {
    sku_code: 'SOL-VIK-PARADEA-550',
    category: 'solar-panels',
    name: 'Paradea 550W',
    brand: 'Vikram',
    unit: 'panel',
    selling_price: 10000,
    price_provenance: 'fetched',
    wp: 550,
  },
};
const solarHouse: EstimateInputs = { ...base, addons: { solar: true, cctv: false, fireSafety: false } };
/* The reference `result` is built with no catalogue, so every one of its lines is a thumb rule
   and there is nothing on it the store could re-price. These blocks need the same house priced
   from the shelf. */
const shopped = estimate(base, shop);

describe('TRUTH — the same line, bought from the store', () => {
  it('takes the difference off a line the store sells, at the quote own quantity', () => {
    /* 720 bags at ₹600 is what the contractor is charging; the store sells the bag at ₹500. */
    const c = compareQuote(shopped, parseQuoteText('Cement 720 bags 600 4,32,000'), shop);
    const m = c.matches[0];
    expect(m.store).not.toBeNull();
    expect(m.store?.qty).toBe(720);
    expect(m.store?.qtySource).toBe('quote');
    expect(m.store?.quotedRate).toBe(600);
    expect(m.store?.storeRate).toBe(500);
    expect(m.store?.storeAmount).toBe(360000);
    expect(m.store?.saving).toBe(72000);
    expect(c.store.saved).toBe(72000);
    expect(c.store.lines).toBe(1);
  });

  it('does the same for a solar panel priced by the number', () => {
    const r = estimate(solarHouse, shop);
    /* Ten panels at ₹12,000 against a store price of ₹10,000. */
    const c = compareQuote(r, parseQuoteText('Solar panels 10 nos 12000 1,20,000'), shop);
    const m = c.matches[0];
    expect(m.store?.storeRate).toBe(10000);
    expect(m.store?.quotedRate).toBe(12000);
    expect(m.store?.saving).toBe(20000);
  });

  it('leaves alone every line the store has no price for', () => {
    /* Mason labour is a thumb rule, not a thing on a shelf. Nothing is claimed about it. */
    const c = compareQuote(shopped, parseQuoteText('Mestri labour 6,80,000\nCentering & shuttering 1,08,000'), shop);
    expect(c.matches.every((m) => m.store === null)).toBe(true);
    expect(c.store.saved).toBe(0);
    expect(c.store.lines).toBe(0);
  });

  it('falls back to this house own quantity, and says so, when the document states none', () => {
    const c = compareQuote(shopped, parseQuoteText('Cement 4,32,000'), shop);
    expect(c.matches[0].store?.qtySource).toBe('estimate');
    expect(c.matches[0].store?.quotedRate).toBeNull();
  });

  it('never claims a saving when the store is dearer — the sign is carried', () => {
    const c = compareQuote(shopped, parseQuoteText('Cement 720 bags 400 2,88,000'), shop);
    /* 720 × 500 = 3,60,000 against 2,88,000 quoted: the contractor is cheaper by 72,000. */
    expect(c.store.saved).toBe(-72000);
  });
});

describe('TRUTH — quantities that do not add up', () => {
  it('catches a material priced in a unit nobody sells it by', () => {
    const c = compareQuote(shopped, parseQuoteText('TMT steel 80 bags 92 7,360'), shop);
    const f = c.matches[0].flags.find((x) => x.kind === 'unit');
    expect(f).toBeTruthy();
    expect(f?.message).toContain('kilograms');
  });

  it('catches a quantity that is describing a different building', () => {
    /* 100 bags against the ~720 this house needs. */
    const c = compareQuote(shopped, parseQuoteText('Cement 100 bags 500 50,000'), shop);
    expect(c.matches[0].flags.some((x) => x.kind === 'quantity')).toBe(true);
  });

  it('catches steel and cement that disagree with each other', () => {
    const c = compareQuote(shopped, parseQuoteText('Cement 720 bags 500 3,60,000\nTMT steel 900 kg 92 82,800'), shop);
    expect(c.flags.some((x) => x.kind === 'ratio')).toBe(true);
  });

  it('says nothing when the two are in proportion', () => {
    const r = estimate(base);
    const cement = r.lines.find((l) => l.key === 'cement');
    const steel = r.lines.find((l) => l.key === 'steel');
    const c = compareQuote(shopped, parseQuoteText(`Cement ${Math.round(cement!.qty)} bags 500 1,000\nTMT steel ${Math.round(steel!.qty)} kg 92 1,000`), shop);
    expect(c.flags.some((x) => x.kind === 'ratio')).toBe(false);
  });
});

describe('TRUTH — reading a pasted row', () => {
  it('finds the quantity and its unit wherever they sit on the row', () => {
    const [a, b, c] = parseQuoteText('Cement 720 bags 2,88,000\n600x600 GVT tiles 1200 sqft 1,08,000\n20mm jelly 300 cft 45 13,500');
    expect([a.qty, a.unit]).toEqual([720, 'bag']);
    expect([b.qty, b.unit]).toEqual([1200, 'sqft']);
    expect([c.qty, c.unit, c.rate]).toEqual([300, 'cft', 45]);
  });

  it('takes the row own figures off the description, and leaves descriptive ones alone', () => {
    const rows = parseQuoteText(
      [
        'Cement 720 bags 600 4,32,000',
        'Solar panels 10 nos 12000 1,20,000',
        '600x600 GVT tiles 1200 sqft 1,08,000',
        'M20 concrete 45 cum 6,300',
        '720 bags 600 4,32,000',
      ].join(NL),
    );
    expect(rows.map((r) => r.label)).toEqual(['Cement', 'Solar panels', '600x600 GVT tiles', 'M20 concrete', '720 bags']);
  });

  it('refuses a rate off three numbers that do not multiply out', () => {
    expect(parseQuoteText('Extra work 3 items 500 90,000')[0].rate).toBeNull();
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
