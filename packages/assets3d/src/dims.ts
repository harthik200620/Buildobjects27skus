/**
 * Real-world dimensions for a SKU: the spec attributes dim_w_mm / dim_h_mm / dim_d_mm, with the
 * category default (DEFAULT_DIMS_MM) filling any axis the spec does not state. Shared by the
 * parametric builder (build.ts) and the photoreal normaliser (photoreal/run.ts) so both scale
 * to the same numbers.
 */
import type { SpecJson } from '@buildobjects/catalog';
import { DEFAULT_DIMS_MM, type Dims } from './builders';

export type { Dims };
export interface DimsMm {
  w: number;
  h: number;
  d: number;
}
export interface DimsResult {
  /** Millimetres, as recorded in the manifest. */
  mm: DimsMm;
  /** Metres, as the builders and the normaliser consume them. */
  m: Dims;
  fromSpec: { w: boolean; h: boolean; d: boolean };
  source: 'spec' | 'partial' | 'default';
}

export const specAttr = (spec: SpecJson | null | undefined, key: string): string | number | boolean | null => {
  for (const g of spec?.groups ?? []) for (const r of g.rows) if (r.key === key) return r.value;
  return null;
};

function positiveNumber(v: string | number | boolean | null): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dimsFor(spec: SpecJson | null | undefined, category: string): DimsResult {
  const def = DEFAULT_DIMS_MM[category] ?? DEFAULT_DIMS_MM.generic;
  const w = positiveNumber(specAttr(spec, 'dim_w_mm')),
    h = positiveNumber(specAttr(spec, 'dim_h_mm')),
    d = positiveNumber(specAttr(spec, 'dim_d_mm'));
  const mm: DimsMm = { w: w ?? def.w, h: h ?? def.h, d: d ?? def.d };
  const fromSpec = { w: w !== null, h: h !== null, d: d !== null };
  const n = Number(fromSpec.w) + Number(fromSpec.h) + Number(fromSpec.d);
  return { mm, m: { w: mm.w / 1000, h: mm.h / 1000, d: mm.d / 1000 }, fromSpec, source: n === 3 ? 'spec' : n === 0 ? 'default' : 'partial' };
}

/** The form-factor / product-type hint the builders use to choose a variant (dome vs bullet cctv, …). */
export function variantHintFor(spec: SpecJson | null | undefined): string | null {
  const v = specAttr(spec, 'form_factor') ?? specAttr(spec, 'product_type');
  const s = v === null || v === undefined ? '' : String(v);
  return s || null;
}
