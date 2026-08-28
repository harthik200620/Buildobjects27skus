/**
 * When the money leaves, and what changing your mind costs.
 *
 * `buildSchedule()` spreads the estimate over the calendar — a Rs 42L house is an impossible wall
 * of money until you see it as Rs 3L in month one. `regretCurve()` prices changing a decision
 * LATER: flat while the decision is upstream of the work it touches, then a hard step at the
 * phase boundary where that work gets executed. Adding a bedroom in month two is a drawing
 * revision; in month seven it means breaking a cast slab.
 *
 *   changeCost = baseDelta + rework + demolitionAndDisposal + scheduleSlip
 *
 *   baseDelta   the engine re-run with the decision applied — same provenance as any other figure
 *   rework      executed work the change disturbs, rebuilt out of sequence. Its SHAPE comes from
 *               STRUCTURAL_SPLIT and the phase model; only the disturbed share and the
 *               out-of-sequence premium are thumb values.
 *   demolition  the same disturbed work in cubic metres, broken and carted at a real rate
 *   slip        months added x the contractor's monthly overhead
 *
 * Three of the four are uncertain and they compound, so this returns a BAND, wider than the
 * estimate's own, with every term reported separately. A single confident number here would be a
 * lie with a decimal point in it.
 */
import { buildMonths, QUANTITIES, SCHEDULE, STRUCTURAL_SPLIT } from '../rates/2026-08';
import { estimate } from './estimate';
import { materialise } from './materials';
import type { CatalogPrices, EstimateInputs, EstimateResult, LineItem, PhaseKey, Tier } from './types';

/* ═══════════════════════════════════════════════════════════════════════════
   THE CALENDAR
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScheduledPhase {
  key: PhaseKey;
  label: string;
  amount: number;
  /** Month this phase starts and ends, in fractional months from zero. */
  startMonth: number;
  endMonth: number;
  months: number;
}

export interface ScheduleMonth {
  /** 1-based, the way a person counts months of a build. */
  month: number;
  /** Money billed in this month across every phase overlapping it. */
  amount: number;
  /** Money billed up to and including this month. */
  cumulative: number;
  /** Which phases are running, for the label. */
  phases: PhaseKey[];
}

export interface BuildSchedule {
  months: number;
  phases: ScheduledPhase[];
  cashflow: ScheduleMonth[];
  /** The heaviest single month — the one a buyer has to arrange money for. */
  peakMonth: ScheduleMonth;
  basis: string;
}

/** Duration share for each phase key the engine emits, slabs split equally. */
function phaseShares(result: EstimateResult): Map<PhaseKey, number> {
  const s = SCHEDULE.phase_share;
  const slabs = result.phases.filter((p) => p.key.startsWith('slab_'));
  const out = new Map<PhaseKey, number>();
  out.set('footing', s.footing.value);
  out.set('plinth', s.plinth.value);
  for (const p of slabs) out.set(p.key, s.slabs.value / Math.max(1, slabs.length));
  out.set('brickwork', s.brickwork.value);
  out.set('services', s.services.value);
  out.set('finishing', s.finishing.value);
  return out;
}

export function buildSchedule(result: EstimateResult): BuildSchedule {
  const months = buildMonths(result.derived.builtUpSqft, result.inputs.floors);
  const shares = phaseShares(result);
  const total = [...shares.values()].reduce((a, b) => a + b, 0);

  let cursor = 0;
  const phases: ScheduledPhase[] = result.phases.map((p) => {
    const m = (months * (shares.get(p.key) ?? 0)) / total;
    const start = cursor;
    cursor += m;
    return { key: p.key, label: p.label, amount: p.amount, startMonth: start, endMonth: cursor, months: m };
  });

  /* Money accrues evenly inside a phase, which is how progress billing actually works: the
     contractor is paid against work done, not against a calendar. */
  const cashflow: ScheduleMonth[] = [];
  let cumulative = 0;
  for (let i = 0; i < months; i += 1) {
    const from = i;
    const to = i + 1;
    let amount = 0;
    const running: PhaseKey[] = [];
    for (const p of phases) {
      const overlap = Math.max(0, Math.min(to, p.endMonth) - Math.max(from, p.startMonth));
      if (overlap <= 0) continue;
      running.push(p.key);
      amount += (p.amount * overlap) / Math.max(p.months, 1e-6);
    }
    amount = Math.round(amount);
    cumulative += amount;
    cashflow.push({ month: i + 1, amount, cumulative, phases: running });
  }
  /* Rounding inside the loop leaves a few rupees on the table; the last month absorbs them so
     the cash flow sums to the grand total exactly. */
  const drift = result.grandTotal - cumulative;
  if (cashflow.length > 0 && drift !== 0) {
    const last = cashflow[cashflow.length - 1];
    last.amount += drift;
    last.cumulative += drift;
  }

  const peakMonth = cashflow.reduce((a, b) => (b.amount > a.amount ? b : a), cashflow[0]);
  return {
    months,
    phases,
    cashflow,
    peakMonth,
    basis: `${SCHEDULE.sqft_per_month.value} sqft/month + ${SCHEDULE.cure_days_per_slab.value} days curing per slab`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REGRET CURVE
   ═══════════════════════════════════════════════════════════════════════════ */

/** The ordered phase keys of a build, which is the x-axis of every curve here. */
export function phaseOrder(result: EstimateResult): PhaseKey[] {
  return result.phases.map((p) => p.key);
}

/**
 * How much of one line's money has been billed by the end of a given phase.
 *
 * Structural lines are the whole reason this is not just "has the phase happened": cement and
 * steel bill across footing, plinth and every slab, so a change at slab two has already consumed
 * a third of the steel and none of the finishing.
 */
export function billedFraction(line: LineItem, throughPhaseIdx: number, order: PhaseKey[]): number {
  if (throughPhaseIdx < 0) return 0;
  const idxOf = (k: PhaseKey) => order.indexOf(k);
  if (line.phase === 'structural') {
    const slabKeys = order.filter((k) => k.startsWith('slab_'));
    let f = 0;
    if (throughPhaseIdx >= idxOf('footing')) f += STRUCTURAL_SPLIT.footing;
    if (throughPhaseIdx >= idxOf('plinth')) f += STRUCTURAL_SPLIT.plinth;
    const perSlab = STRUCTURAL_SPLIT.slabs / Math.max(1, slabKeys.length);
    for (const k of slabKeys) if (throughPhaseIdx >= idxOf(k)) f += perSlab;
    return Math.min(1, f);
  }
  const own = idxOf(line.phase as PhaseKey);
  return own >= 0 && throughPhaseIdx >= own ? 1 : 0;
}

/**
 * A decision a buyer might revisit. A PATCH, not a finished set of inputs.
 *
 * "Add a bedroom" once reported MINUS 780 rupees on a 30x40 G+1 — adding a bedroom appeared to
 * make the house cheaper — and nothing in the arithmetic was broken. The engine prices a house two
 * ways: with no room counts it DERIVES them from area and bills plumbing as one spread line; given
 * explicit counts it bills per room and itemises every fixture. Both are reasonable and they are
 * not the same model. Handing the engine explicit counts for the first time made the comparison
 * "derived house versus itemised house", and one bedroom was lost in the noise of the switch.
 *
 * So the decision is a patch applied to the SAME inputs the baseline was priced from — a caller
 * cannot build one side out of different state, which is what a React component did with the old
 * `to: EstimateInputs`.
 */
export interface Decision {
  /** Stable id so the UI can key a curve to a control. */
  id: string;
  label: string;
  /** One line saying what the buyer is actually being quoted, for the UI to print under the figure. */
  detail: string;
  /** Applied to the anchor. The engine re-runs on the result; nothing is estimated by hand. */
  apply: (anchor: EstimateInputs, derived: EstimateResult['derived']) => EstimateInputs;
}

/**
 * The decisions worth pricing, defined where the model lives. These were object literals inside a
 * React component, and the hard part of each is deciding what the change PHYSICALLY IS — a
 * modelling question, which written in a component is one nobody tests.
 *
 * A BEDROOM IS FLOOR AREA. Incrementing a room counter leaves the house the same size, which
 * prices the paint on a wall that was never built; a bedroom is its own floor plus its share of
 * the corridor, landing and services, which is what `sqft_per_bedroom` already means. A FLOOR
 * needs no such help — the engine derives area as footprint times floors.
 */
export function standardDecisions(base: EstimateResult): Decision[] {
  const inputs = base.inputs;
  const bua = base.derived.builtUpSqft;
  /* The same arithmetic deriveGeometry does. `floorsCount` is not on the exposed derived object,
     and reaching for a field that is not there is how a silent NaN gets into an area. */
  const floorsCount = Math.max(1, Math.floor(inputs.floors) + 1);
  const perFloor = bua / floorsCount;
  const bedroomSqft = QUANTITIES.sqft_per_bedroom;

  const out: Decision[] = [];

  if (inputs.floors < 4) {
    out.push({
      id: 'floors',
      label: `Add a floor (G+${inputs.floors + 1})`,
      detail: `${Math.round(perFloor).toLocaleString('en-IN')} sqft more house, and one more slab to cast`,
      apply: (a) => ({ ...a, floors: a.floors + 1 }),
    });
  }

  out.push({
    id: 'bedroom',
    label: 'Add a bedroom',
    detail: `${bedroomSqft} sqft more house - the room and its share of what serves it`,
    apply: (a) => ({ ...a, builtUpOverrideSqft: bua + bedroomSqft }),
  });

  if (inputs.tier !== 'premium') {
    const to: Tier = inputs.tier === 'basic' ? 'medium' : 'premium';
    out.push({
      id: 'tier',
      label: 'Upgrade the finish',
      detail: `Every finish line re-priced at the ${to} rate`,
      apply: (a) => ({ ...a, tier: to }),
    });
  }

  /* Optional on the type and defaulted to 10 everywhere it is read, so an undefined height must
     not silently drop the decision — `undefined < 12` is false. */
  if ((inputs.floorHeightFt ?? 10) < 12) {
    out.push({
      id: 'height',
      label: 'Raise the ceiling to 12 ft',
      detail: 'Taller walls, more plaster and paint, same floor area',
      apply: (a) => ({ ...a, floorHeightFt: 12 }),
    });
  }

  return out;
}

export interface ChangeCostTerms {
  baseDelta: number;
  rework: number;
  demolition: number;
  slip: number;
  slipMonths: number;
  /** Cubic metres of finished work broken out. Zero before anything is cast. */
  brokenCum: number;
}

export interface ChangeCostPoint {
  phase: PhaseKey;
  phaseLabel: string;
  /** Month the phase ends — the x-axis a buyer actually reads. */
  month: number;
  terms: ChangeCostTerms;
  /** baseDelta + the three penalty terms. */
  likely: number;
  low: number;
  high: number;
  /** Every uncertain term that fed this figure, for the UI to surface. */
  needsVerification: string[];
}

const CAST_LINES = new Set(['cement', 'steel', 'bricks', 'sand', 'aggregate', 'floor_tiles', 'wall_tiles']);

/**
 * What one decision costs at every point in the build.
 *
 * Returns a point per phase plus a phase `-1` entry meaning "decided before ground was broken",
 * which is the flat part of the curve and the number a buyer should be comparing everything else
 * against.
 */
export function regretCurve(base: EstimateResult, decision: Decision, catalog: CatalogPrices = {}): ChangeCostPoint[] {
  /* Patched onto the very inputs `base` was priced from, so the two sides cannot diverge in
     anything except the decision itself. */
  const after = estimate(decision.apply(base.inputs, base.derived), catalog);
  const order = phaseOrder(base);
  const schedule = buildSchedule(base);
  const tier: Tier = base.inputs.tier;
  const overhead = SCHEDULE.overhead_per_month[tier];

  const baseDelta = after.grandTotal - base.grandTotal;

  /* Which lines the decision moves, and by how much. The engine answers this, not a rule of thumb. */
  const afterByKey = new Map(after.lines.map((l) => [l.key, l]));
  const deltas = base.lines.map((l) => ({ line: l, delta: (afterByKey.get(l.key)?.amount ?? 0) - l.amount })).filter((d) => Math.abs(d.delta) > 0.5);

  /* The physical volume behind each line, for the demolition term. */
  const cumByKey = new Map(materialise(base).map((p) => [p.key, p.cum]));

  /* Extra calendar the change itself adds: more area to build, plus getting the site moving again. */
  const buaDelta = Math.max(0, after.derived.builtUpSqft - base.derived.builtUpSqft);
  const growthMonths = buaDelta / SCHEDULE.sqft_per_month.value;
  const remobMonths = SCHEDULE.remobilise_weeks.value / 4.345;

  const nv = (extra: boolean) => {
    const flags = [`schedule: ${SCHEDULE.sqft_per_month.basis}`];
    if (extra) {
      flags.push(`rework premium ${SCHEDULE.rework_multiplier_max.value}× — ${SCHEDULE.rework_multiplier_max.basis}`);
      flags.push(`disturbed share ${Math.round(SCHEDULE.disturbed_share.value * 100)} % — ${SCHEDULE.disturbed_share.basis}`);
      flags.push(`demolition ₹${SCHEDULE.demolition_per_cum.value}/m³ — ${SCHEDULE.demolition_per_cum.basis}`);
      flags.push(`site overhead ₹${overhead.value}/month — ${overhead.basis}`);
    }
    return flags;
  };

  const points: ChangeCostPoint[] = [];
  for (let idx = -1; idx < order.length; idx += 1) {
    let disturbedMoney = 0;
    let brokenCum = 0;
    for (const { line, delta } of deltas) {
      const billed = billedFraction(line, idx, order);
      if (billed <= 0) continue;
      /*
       * The disturbance is proportional to the SIZE of the change and to how far that line's own
       * work has gone. A change that adds 15 % more area does not put 100 % of the executed
       * brickwork in the way — it puts the interface in the way, and the interface scales with
       * the change.
       */
      const disturbed = Math.abs(delta) * billed * SCHEDULE.disturbed_share.value;
      disturbedMoney += disturbed;
      if (CAST_LINES.has(line.key) && line.amount > 0) {
        const cum = cumByKey.get(line.key) ?? 0;
        brokenCum += cum * (disturbed / line.amount);
      }
    }

    /* Lost, and then built back out of sequence. */
    const rework = disturbedMoney * (1 + SCHEDULE.rework_multiplier_max.value);
    const demolition = brokenCum * (SCHEDULE.demolition_per_cum.value + SCHEDULE.disposal_per_cum.value);
    const started = idx >= 0;
    const slipMonths = started ? remobMonths + growthMonths : 0;
    const slip = slipMonths * overhead.value;

    const extra = rework + demolition + slip;
    const band = SCHEDULE.change_band_pct.value;
    const phase = idx >= 0 ? order[idx] : ('footing' as PhaseKey);
    const sp = schedule.phases[idx] ?? null;
    points.push({
      phase,
      phaseLabel: idx < 0 ? 'Before work starts' : (sp?.label ?? phase),
      month: idx < 0 ? 0 : Math.round((sp?.endMonth ?? 0) * 10) / 10,
      terms: {
        baseDelta: Math.round(baseDelta),
        rework: Math.round(rework),
        demolition: Math.round(demolition),
        slip: Math.round(slip),
        slipMonths: Math.round(slipMonths * 10) / 10,
        brokenCum: Math.round(brokenCum * 100) / 100,
      },
      /* The band applies to the three uncertain terms only. baseDelta is the engine and is as
         accurate as any other figure it produces, so widening it would understate what is known. */
      likely: Math.round(baseDelta + extra),
      low: Math.round(baseDelta + extra * (1 - band)),
      high: Math.round(baseDelta + extra * (1 + band)),
      needsVerification: nv(extra > 0),
    });
  }
  return points;
}

/** One point off the curve, when the UI only needs "what does this cost right now". */
export function changeCost(base: EstimateResult, decision: Decision, atPhase: PhaseKey | null, catalog: CatalogPrices = {}): ChangeCostPoint {
  const curve = regretCurve(base, decision, catalog);
  if (atPhase === null) return curve[0];
  const order = phaseOrder(base);
  const idx = order.indexOf(atPhase);
  return curve[idx + 1] ?? curve[curve.length - 1];
}
