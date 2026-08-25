import type { SpecJson } from '@buildobjects/catalog';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMS_MM } from '../src/builders';
import { dimsFor, variantHintFor } from '../src/dims';
import { specWithDims } from './helpers';

describe('dimsFor', () => {
  it('reads dim_*_mm from the spec and converts to metres', () => {
    const r = dimsFor(specWithDims(200, 100, 50), 'cement');
    expect(r.mm).toEqual({ w: 200, h: 100, d: 50 });
    expect(r.m).toEqual({ w: 0.2, h: 0.1, d: 0.05 });
    expect(r.source).toBe('spec');
  });
  it('falls back to the category default per axis', () => {
    expect(dimsFor(null, 'tiles')).toMatchObject({ mm: DEFAULT_DIMS_MM.tiles, source: 'default' });
    expect(dimsFor(null, 'nope').mm).toEqual(DEFAULT_DIMS_MM.generic);
    const partial = {
      groups: [
        {
          key: 'g',
          label: 'g',
          importance: 1,
          rows: [
            {
              key: 'dim_w_mm',
              label: 'w',
              value: '450',
              unit: 'mm',
              data_type: 'number',
              provenance: 'fetched',
              confidence: 1,
              source_url: null,
              compare: false,
            },
          ],
        },
      ],
      filled: 1,
      total: 1,
      by_provenance: { fetched: 1, verified: 0, ai_filled: 0 },
    } as unknown as SpecJson;
    const r = dimsFor(partial, 'cctv');
    expect(r.mm).toEqual({ w: 450, h: DEFAULT_DIMS_MM.cctv.h, d: DEFAULT_DIMS_MM.cctv.d });
    expect(r.source).toBe('partial');
    expect(r.fromSpec).toEqual({ w: true, h: false, d: false });
  });
  it('ignores non-positive values and reads the variant hint', () => {
    const bad = specWithDims(0, -5, 50);
    expect(dimsFor(bad, 'glass').mm).toEqual({ w: DEFAULT_DIMS_MM.glass.w, h: DEFAULT_DIMS_MM.glass.h, d: 50 });
    expect(variantHintFor(null)).toBeNull();
    const spec = {
      groups: [
        {
          key: 'g',
          label: 'g',
          importance: 1,
          rows: [
            {
              key: 'form_factor',
              label: 'f',
              value: 'Bullet',
              unit: null,
              data_type: 'enum',
              provenance: 'fetched',
              confidence: 1,
              source_url: null,
              compare: false,
            },
          ],
        },
      ],
      filled: 1,
      total: 1,
      by_provenance: { fetched: 1, verified: 0, ai_filled: 0 },
    } as unknown as SpecJson;
    expect(variantHintFor(spec)).toBe('Bullet');
  });
});
