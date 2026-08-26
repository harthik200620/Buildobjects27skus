/**
 * Which question is worth asking next, and what answering it is worth.
 *
 * ── WHY THIS IS NOT A HARD-CODED LIST ───────────────────────────────────────────────────────
 * Twenty inputs at one visual weight makes the buyer decide what matters, and that is the
 * product's job, not theirs. So the form is ordered by how much each answer actually MOVES the
 * number — computed by running the engine at each input's range endpoints and sorting by the
 * spread between them.
 *
 * Computed, not written down, for one reason: when a rate changes, the order has to change with
 * it. A hard-coded "soil matters most" ordering is true until the day the steel rate moves, and
 * then it is a lie nobody notices. This is the same discipline as every other number here —
 * derived from the engine, never asserted beside it.
 *
 * ── WHAT IT BUYS THE INTERFACE ──────────────────────────────────────────────────────────────
 *   · the order of the questions
 *   · the consequence line under each one — "changes the foundation, ±₹2.4L on this house" —
 *     with the figure computed for THIS house rather than a generic claim
 *   · the accuracy meter's "next best question", which is simply the top unanswered row
 */
import { estimate } from './estimate';
import type { CatalogPrices, EstimateInputs, EstimateResult, FoundationType, RoofType, SoilType, Tier } from './types';

export interface SensitivityRow {
  /** Stable id, matching the control that sets it. */
  id: string;
  label: string;
  /** What the answer changes, in the buyer's language. Never jargon. */
  consequence: string;
  /** Grand totals at the extremes of this input's range, for THIS house. */
  low: number;
  high: number;
  /** high − low. The number the ordering is by. */
  spread: number;
  /** Share of the current grand total that spread represents. */
  spreadShare: number;
  /** True when the buyer has not set this yet, so the engine is using a default. */
  unanswered: boolean;
  /** What answering this is worth on the accuracy meter, in points. */
  accuracyPoints: number;
}

type Variant = { label: string; patch: (i: EstimateInputs) => EstimateInputs };

/** A question, its extremes, and whether the buyer has answered it. */
interface Question {
  id: string;
  label: string;
  consequence: string;
  variants: Variant[];
  answered: (i: EstimateInputs) => boolean;
  accuracyPoints: number;
}

const set =
  <K extends keyof EstimateInputs>(k: K, v: EstimateInputs[K]): Variant['patch'] =>
  (i) => ({ ...i, [k]: v });

const QUESTIONS: Question[] = [
  {
    id: 'tier',
    label: 'Finish level',
    consequence: 'changes every rate on the card — the same house, built three ways',
    variants: (['basic', 'premium'] as Tier[]).map((t) => ({ label: t, patch: set('tier', t) })),
    answered: () => true,
    accuracyPoints: 0,
  },
  {
    id: 'floors',
    label: 'Floors',
    consequence: 'each storey adds a slab, its columns and its own finishing',
    variants: [
      { label: 'G+0', patch: set('floors', 0) },
      { label: 'G+2', patch: set('floors', 2) },
    ],
    answered: () => true,
    accuracyPoints: 0,
  },
  {
    id: 'coverage',
    label: 'Ground coverage',
    consequence: 'how much of the plot the house sits on — drives every per-sqft line',
    variants: [
      { label: '40 %', patch: set('coverage', 0.4) },
      { label: '90 %', patch: set('coverage', 0.9) },
    ],
    answered: () => true,
    accuracyPoints: 0,
  },
  {
    id: 'soil',
    label: 'Soil at the site',
    consequence: 'decides the foundation — rock needs footings, black cotton needs a raft',
    variants: (['hard', 'black_cotton'] as SoilType[]).map((s) => ({ label: s, patch: set('soil', s) })),
    answered: (i) => i.soil != null,
    accuracyPoints: 6,
  },
  {
    id: 'foundation',
    label: 'Foundation',
    consequence: 'a raft is a fifth more than isolated footings; piles more again',
    variants: (['isolated_footing', 'pile'] as FoundationType[]).map((f) => ({ label: f, patch: set('foundation', f) })),
    answered: (i) => i.foundation != null,
    accuracyPoints: 5,
  },
  {
    id: 'rooms',
    label: 'Rooms',
    consequence: 'itemises doors, bathroom fixtures, wardrobes and wall tiling instead of guessing them from area',
    variants: [
      { label: '2 BHK', patch: (i) => ({ ...i, rooms: { bedrooms: 2, bathrooms: 2, kitchens: 1 } }) },
      { label: '5 BHK', patch: (i) => ({ ...i, rooms: { bedrooms: 5, bathrooms: 5, kitchens: 1 } }) },
    ],
    answered: (i) => i.rooms != null,
    accuracyPoints: 8,
  },
  {
    id: 'floorHeightFt',
    label: 'Floor height',
    consequence: 'taller rooms mean more wall, more plaster, more paint and more steel',
    variants: [
      { label: '9 ft', patch: set('floorHeightFt', 9) },
      { label: '13 ft', patch: set('floorHeightFt', 13) },
    ],
    answered: (i) => i.floorHeightFt != null && i.floorHeightFt !== 10,
    accuracyPoints: 4,
  },
  {
    id: 'roof',
    label: 'Roof',
    consequence: 'a sloped roof is a premium on top of the flat slab, not instead of it',
    variants: (['flat_rcc', 'sloped'] as RoofType[]).map((r) => ({ label: r, patch: set('roof', r) })),
    answered: (i) => i.roof != null,
    accuracyPoints: 3,
  },
  {
    id: 'exteriorFinish',
    label: 'Exterior finish',
    consequence: 'cladding or stone replaces paint on the front elevation',
    variants: [
      { label: 'paint', patch: set('exteriorFinish', 'paint') },
      { label: 'stone', patch: set('exteriorFinish', 'stone') },
    ],
    answered: (i) => i.exteriorFinish != null && i.exteriorFinish !== 'paint',
    accuracyPoints: 3,
  },
  {
    id: 'interior',
    label: 'Interiors',
    consequence: 'modular kitchen, wardrobes and false ceiling — the second ledger, and the one that moves most',
    variants: [
      { label: 'none', patch: (i) => ({ ...i, interior: { modularKitchen: false, wardrobes: false, falseCeilingShare: 0 } }) },
      { label: 'full', patch: (i) => ({ ...i, interior: { modularKitchen: true, wardrobes: true, falseCeilingShare: 1 } }) },
    ],
    answered: (i) => i.interior != null,
    accuracyPoints: 8,
  },
  {
    id: 'water',
    label: 'Water & sanitation',
    consequence: 'borewell, sump, septic tank and rainwater are each a real line, not an allowance',
    variants: [
      { label: 'none', patch: (i) => ({ ...i, water: { borewell: false, sump: false, septic: false, rainwater: false } }) },
      { label: 'all', patch: (i) => ({ ...i, water: { borewell: true, sump: true, septic: true, rainwater: true } }) },
    ],
    answered: (i) => i.water != null,
    accuracyPoints: 5,
  },
  {
    id: 'boundaryWall',
    label: 'Boundary wall & gate',
    consequence: 'priced on the real perimeter at the real height, with the gate itemised',
    variants: [
      { label: 'none', patch: (i) => ({ ...i, boundaryWall: null, compoundWall: false }) },
      { label: 'wall + automatic gate', patch: (i) => ({ ...i, boundaryWall: { lengthFt: null, heightFt: 7, gate: 'automatic' } }) },
    ],
    answered: (i) => i.boundaryWall != null || i.compoundWall,
    accuracyPoints: 4,
  },
  {
    id: 'site',
    label: 'Site access',
    consequence: 'a lane a truck cannot enter adds a percentage to everything civil',
    variants: [
      { label: 'good', patch: (i) => ({ ...i, site: { roadAccess: 'good', water: 'municipal', power: 'available' } }) },
      { label: 'hard', patch: (i) => ({ ...i, site: { roadAccess: 'no_truck', water: 'tanker', power: 'temporary' } }) },
    ],
    answered: (i) => i.site != null,
    accuracyPoints: 4,
  },
  {
    id: 'staircase',
    label: 'Staircase',
    consequence: 'granite treads and a steel stair are priced per floor',
    variants: [
      { label: 'plain', patch: set('staircase', 'rcc_plain') },
      { label: 'granite', patch: set('staircase', 'rcc_granite') },
    ],
    answered: (i) => i.staircase != null,
    accuracyPoints: 2,
  },
];

/**
 * Rank every question by what it is worth on THIS house.
 *
 * The engine is run twice per question. That is ~28 runs, each a few hundred microseconds of
 * pure arithmetic with no I/O, which is why this can be recomputed on every keystroke and the
 * order can stay honest instead of being cached and going stale.
 */
export function sensitivity(inputs: EstimateInputs, catalog: CatalogPrices = {}, current?: EstimateResult): SensitivityRow[] {
  const base = current ?? estimate(inputs, catalog);
  const rows: SensitivityRow[] = [];
  for (const q of QUESTIONS) {
    const totals = q.variants.map((v) => estimate(v.patch(inputs), catalog).grandTotal);
    const low = Math.min(...totals);
    const high = Math.max(...totals);
    const spread = high - low;
    rows.push({
      id: q.id,
      label: q.label,
      consequence: q.consequence,
      low,
      high,
      spread,
      spreadShare: base.grandTotal > 0 ? spread / base.grandTotal : 0,
      unanswered: !q.answered(inputs),
      accuracyPoints: q.accuracyPoints,
    });
  }
  return rows.sort((a, b) => b.spread - a.spread);
}

/**
 * The question worth asking next: the biggest spread among the ones still unanswered.
 *
 * This is the accuracy meter's reward loop. The buyer is not filling a form, they are buying
 * certainty, and this is the shop assistant pointing at the cheapest way to buy more of it.
 */
export function nextBestQuestion(rows: SensitivityRow[]): SensitivityRow | null {
  return rows.find((r) => r.unanswered && r.accuracyPoints > 0) ?? null;
}
