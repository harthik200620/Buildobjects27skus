/**
 * How long a house takes, and what it costs to change your mind once it has started.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
 * The engine already knows what a house costs. It did not know WHEN the money leaves, and it had
 * no way to answer the question that actually destroys Indian home budgets: not "what does a
 * bedroom cost" but "what does a bedroom cost in month seven, after the slab is cast".
 *
 * Mid-build changes are the number one reason a ₹40L house finishes at ₹52L. Every contractor
 * prices them; no platform has ever shown the buyer the curve in advance. That is what these
 * numbers are for.
 *
 * ── EVERY VALUE HERE IS A THUMB VALUE AND SAYS SO ───────────────────────────────────────────
 * Same law as `rates.ts`: a basis string on every entry and `needs_verification: true` until a
 * real quote replaces it. The change-cost model compounds three uncertain terms, so it is the
 * least certain thing the engine produces — which is why `changeCost()` returns a RANGE and
 * never a single figure, and why its band is wider than the estimate's own.
 */
import type { Tier } from '../../src/types';

export interface ScheduleTerm {
  value: number;
  unit: string;
  basis: string;
  needs_verification: boolean;
}
const t = (value: number, unit: string, basis: string, needs_verification = true): ScheduleTerm => ({ value, unit, basis, needs_verification });

export const SCHEDULE = {
  /**
   * Build rate. A single crew on a residential site puts up roughly this much finished area a
   * month once it is running; the whole-project duration is derived from it and then floored,
   * because even a 600 sqft ground-floor house does not finish in two months — curing alone
   * fixes a minimum.
   */
  sqft_per_month: t(160, 'sqft/month', 'one mason crew + helpers on a residential site, AP/TS, continuous work and material on time'),
  min_months: t(7, 'months', 'shortest realistic G+0 build: excavation to handover with 28-day cures observed'),
  /**
   * Curing is calendar time nobody can buy back. A slab is not loadable for 14 days and not fully
   * cured for 28; the next storey's columns wait on it. This is why floors cost months, not just
   * money — and it is why the regret curve steps so hard at a slab boundary.
   */
  cure_days_per_slab: t(21, 'days', 'IS 456 requires 14 days of curing on RCC; 21 is the practical wait before the next storey loads it'),

  /**
   * Share of the total duration each phase occupies. Sums to 1. Footing and plinth are quick and
   * finishing is long — the last 20 % of the money is the last 35 % of the calendar, which is the
   * single most under-estimated thing about building a house.
   */
  phase_share: {
    footing: t(0.1, 'share', 'excavation, PCC, footings and column starters'),
    plinth: t(0.07, 'share', 'plinth beam, backfill, DPC'),
    slabs: t(0.33, 'share', 'columns, shuttering, casting and curing — split equally per slab'),
    brickwork: t(0.16, 'share', 'masonry, internal and external plaster'),
    services: t(0.11, 'share', 'plumbing and electrical rough-in, windows, external works'),
    finishing: t(0.23, 'share', 'flooring, painting, fixtures, joinery, snagging'),
  },

  /**
   * ── THE CHANGE-COST MODEL ──────────────────────────────────────────────────────────────────
   *
   *   changeCost(decision, atPhase) = baseDelta
   *                                 + rework(phases already passed)
   *                                 + demolitionAndDisposal
   *                                 + scheduleSlipCost
   *
   * `baseDelta` is not a thumb value at all — it is the engine re-run with the decision applied,
   * so it carries the same provenance as any other figure here. The three terms below are what
   * turn that delta into the real cost of deciding late.
   */

  /**
   * Rework multiplier: what the same work costs when it is done out of sequence, as a multiple of
   * doing it in sequence. Zero while the decision is still upstream of the phase it touches;
   * climbing to the ceiling once that phase is complete.
   *
   * This is the construction form of Boehm's cost-of-change curve, and site foremen price it the
   * same way: a change on paper is free, a change before the pour costs a day, a change after the
   * pour costs the pour.
   */
  rework_multiplier_max: t(1.45, 'x', 'out-of-sequence work at 1.3–1.6x the in-sequence rate: crew remobilisation, part loads, working around finished work'),
  /**
   * The share of an affected line already in place that has to be physically undone rather than
   * merely added to. A new door in a plastered wall does not waste the whole wall — it wastes the
   * opening plus its margins.
   */
  disturbed_share: t(0.22, 'share', 'material physically broken out to make a change, as a share of the affected line already executed'),
  /**
   * Breaking and carting away. Priced per cubic metre of RCC or masonry removed, which is how
   * demolition contractors in AP/TS quote it.
   */
  demolition_per_cum: t(2400, '₹/m³', 'breaking RCC/masonry with a breaker, cutting exposed reinforcement, loading and disposal'),
  disposal_per_cum: t(650, '₹/m³', 'tipper hire and municipal debris disposal, per m³ of rubble'),
  /**
   * The contractor's month. A build that runs late does not only cost the change — it costs the
   * site staying open: supervision, site office, watchman, plant on hire, and the interest on
   * money already sunk.
   */
  overhead_per_month: {
    basic: t(18000, '₹/month', 'supervisor part-time, watchman, site power and water, small plant on hire'),
    medium: t(32000, '₹/month', 'full-time supervisor, watchman, site office, plant on hire'),
    premium: t(55000, '₹/month', 'site engineer, supervisor, watchman, site office, plant and scaffolding on hire'),
  } as Record<Tier, ScheduleTerm>,
  /**
   * Weeks lost to a change beyond the work itself: agreeing it, revising the drawing, ordering
   * material that was not in the original schedule, and getting the crew back.
   */
  remobilise_weeks: t(2.5, 'weeks', 'decision, drawing revision, material lead time and crew return for an in-flight change'),

  /**
   * The band on a change-cost figure. Wider than the estimate's own ±12 %, because this compounds
   * three uncertain terms on top of a delta — and a number this soft must arrive as a range or it
   * is a lie with a decimal point.
   */
  change_band_pct: t(0.3, 'share', 'compounding uncertainty of rework multiplier, disturbed share and slip — reported as a band, never a point'),
} as const;

/** Total build duration in months for a built-up area and a floor count. */
export function buildMonths(builtUpSqft: number, floors: number): number {
  const fromArea = builtUpSqft / SCHEDULE.sqft_per_month.value;
  /* Every slab adds calendar time nobody can compress: the next storey waits on the cure. */
  const cure = ((floors + 1) * SCHEDULE.cure_days_per_slab.value) / 30;
  return Math.max(SCHEDULE.min_months.value, Math.round(fromArea + cure));
}
