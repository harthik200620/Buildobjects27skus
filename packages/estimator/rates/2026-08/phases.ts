/**
 * Stage-wise phasing. Structural lines (cement, steel, sand, aggregate, formwork, civil labour)
 * split footing → plinth → slabs (one slab per floor, equal shares); brickwork takes bricks +
 * plaster + exterior paint + waterproofing; services takes plumbing, wiring, windows and the
 * exterior add-ons; finishing takes every interior line. Shares are standard progress-billing
 * splits used by AP/TS contractors (10–12 % footing, 6–8 % plinth, balance by slab).
 */
export const STRUCTURAL_SPLIT = { footing: 0.18, plinth: 0.1, slabs: 0.72 } as const;

export const PHASE_LABELS = {
  footing: 'Footing & foundation',
  plinth: 'Plinth & DPC',
  brickwork: 'Brickwork, plaster & exterior finish',
  services: 'Plumbing, electrical & external works',
  finishing: 'Interior finishing',
} as const;

export function slabLabel(i: number, floors: number): string {
  if (i === 0) return floors === 0 ? 'Roof slab' : 'Ground-floor roof slab';
  return `Floor ${i} roof slab`;
}
