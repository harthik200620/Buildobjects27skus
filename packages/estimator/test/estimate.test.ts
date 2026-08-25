import { describe, expect, it } from 'vitest';
import {
  CATALOG_MAP,
  type CatalogPrices,
  DEFAULT_INPUTS,
  type EstimateInputs,
  estimate,
  inputsFromQuery,
  inputsToQuery,
  normalizeInputs,
  resolveStoreSku,
} from '../src';

/**
 * Hand-computed reference case (no store catalogue → every product line uses seed rates):
 *   Hyderabad (index 1.00), plot 30 × 40 ft = 1200 sqft, coverage 75 % → footprint 900 sqft,
 *   G+1 → 2 floors → BUA 1800 sqft, RCC framed, Medium tier, no parking / wall / add-ons.
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
const line = (r: ReturnType<typeof estimate>, key: string) => {
  const l = r.lines.find((x) => x.key === key);
  if (!l) throw new Error(`no line ${key}`);
  return l;
};

describe('geometry', () => {
  it('derives footprint, BUA, floors label and perimeter', () => {
    const r = estimate(base);
    expect(r.derived.plotAreaSqft).toBe(1200);
    expect(r.derived.footprintSqft).toBe(900);
    expect(r.derived.builtUpSqft).toBe(1800);
    expect(r.derived.floorsLabel).toBe('G+1');
    expect(r.derived.perimeterFt).toBe(140);
    expect(r.derived.cityIndex).toBe(1);
  });
  it('ground-only is one slab; area-only plots get a square perimeter', () => {
    const r = estimate({ ...base, floors: 0, plot: { areaSqft: 1600 } });
    expect(r.derived.builtUpSqft).toBe(1200);
    expect(r.derived.floorsLabel).toBe('G');
    expect(r.derived.perimeterFt).toBe(160);
    expect(r.phases.filter((p) => p.key.startsWith('slab_'))).toHaveLength(1);
  });
  it('a drawing BUA override replaces the derived BUA and is flagged', () => {
    const r = estimate({ ...base, builtUpOverrideSqft: 2100 });
    expect(r.derived.builtUpSqft).toBe(2100);
    expect(r.derived.fromDrawing).toBe(true);
  });
});

describe('reference case — Hyderabad G+1 1800 sqft medium, seed rates', () => {
  const r = estimate(base);
  it('cement: 0.4 bags/sqft × 1800 = 720 bags × ₹400', () => {
    const l = line(r, 'cement');
    expect(l.qty).toBe(720);
    expect(l.rate).toBe(400);
    expect(l.amount).toBe(288_000);
    expect(l.rateSource).toBe('seed');
  });
  it('steel: 3.5 kg/sqft × 1800 = 6300 kg × ₹68', () => {
    const l = line(r, 'steel');
    expect(l.qty).toBe(6300);
    expect(l.amount).toBe(428_400);
  });
  it('bricks: 8/sqft × 1800 = 14,400 × ₹10', () => {
    const l = line(r, 'bricks');
    expect(l.qty).toBe(14_400);
    expect(l.amount).toBe(144_000);
  });
  it('sand 2160 cft × ₹65 and aggregate 1620 cft × ₹50', () => {
    expect(line(r, 'sand').amount).toBe(140_400);
    expect(line(r, 'aggregate').amount).toBe(81_000);
  });
  it('civil labour = 38 % of civil cost → materials × 0.38/0.62', () => {
    const materials = 288_000 + 428_400 + 144_000 + 140_400 + 81_000;
    expect(materials).toBe(1_081_800);
    expect(line(r, 'civil_labour').amount).toBe(Math.round(materials * (0.38 / 0.62)));
    expect(line(r, 'civil_labour').amount).toBe(663_039);
    // labour shown = civil labour + shuttering; share of (civil materials + labour) ≈ 41 %
    expect(r.ledgers.structure.labour).toBe(663_039 + 99_000);
    expect(r.ledgers.structure.labourShare).toBeCloseTo(762_039 / (1_081_800 + 762_039), 3);
  });
  it('doors: one per 150 sqft → 12 doors × ₹12,000', () => {
    const l = line(r, 'doors');
    expect(l.qty).toBe(12);
    expect(l.amount).toBe(144_000);
  });
  it('bulbs: one per 80 sqft → 23 × ₹110', () => {
    const l = line(r, 'bulbs');
    expect(l.qty).toBe(23);
    expect(l.amount).toBe(2_530);
  });
  it('tiles: floor 1755.36 sqft and wall 540 sqft at ₹55, laying at ₹32', () => {
    expect(line(r, 'floor_tiles').amount).toBe(96_545);
    expect(line(r, 'wall_tiles').amount).toBe(29_700);
    expect(line(r, 'tile_laying').amount).toBe(73_452);
  });
  it('ledgers stay separate and add up to the grand total', () => {
    // 288000+428400+144000+140400+81000+99000+663039+120960+45360+37800+6600+252000+162000+112320+30240
    expect(r.ledgers.structure.subtotal).toBe(2_611_119);
    // 144000+96545+29700+73452+115200+90000+2530+38250+216000
    expect(r.ledgers.interior.subtotal).toBe(805_677);
    expect(r.grandTotal).toBe(3_416_796);
    expect(r.perSqft).toBeCloseTo(1898.2, 0);
    expect(
      r.lines.filter((l) => l.ledger === 'structure').reduce((a, l) => a + l.amount, 0) +
        r.lines.filter((l) => l.ledger === 'interior').reduce((a, l) => a + l.amount, 0),
    ).toBe(r.grandTotal);
  });
  it('groups and phases each sum to the grand total', () => {
    expect(r.groups.reduce((a, g) => a + g.amount, 0)).toBe(r.grandTotal);
    expect(Math.abs(r.phases.reduce((a, p) => a + p.amount, 0) - r.grandTotal)).toBeLessThanOrEqual(2); // slab rounding
    expect(r.groups[0].share).toBeGreaterThan(0);
    expect(r.groups.map((g) => g.key)).toContain('cement');
  });
  it('no add-on lines, no false-ceiling line at basic, a false-ceiling line at medium', () => {
    expect(r.lines.some((l) => l.key.startsWith('solar'))).toBe(false);
    expect(r.lines.some((l) => l.key === 'false_ceiling')).toBe(true);
    expect(estimate({ ...base, tier: 'basic' }).lines.some((l) => l.key === 'false_ceiling')).toBe(false);
  });
  it('tiers are monotonic and the current tier equals the grand total', () => {
    expect(r.tiers.medium).toBe(r.grandTotal);
    expect(r.tiers.basic).toBeLessThan(r.tiers.medium);
    expect(r.tiers.medium).toBeLessThan(r.tiers.premium);
  });
  it('carries an honest accuracy note and verification flags', () => {
    expect(r.accuracy.pct).toBe(12);
    expect(r.accuracy.note).toContain('Hyderabad Medium');
    expect(r.needsVerification.length).toBeGreaterThan(5);
  });
});

describe('city index', () => {
  it('scales seed rates but never store prices', () => {
    const catalog: CatalogPrices = {
      'CEM-ULT-PPC50': {
        sku_code: 'CEM-ULT-PPC50',
        category: 'cement',
        name: 'PPC 50 kg',
        brand: 'UltraTech',
        unit: 'bag',
        selling_price: 415,
        price_provenance: 'estimated',
        in_stock: true,
      },
    };
    const k = estimate({ ...base, city: 'kurnool', tier: 'premium' }, catalog);
    expect(k.derived.cityIndex).toBe(0.92);
    expect(line(k, 'steel').rate).toBeCloseTo(74 * 0.92, 2);
    expect(line(k, 'cement').rate).toBe(415);
    expect(line(k, 'cement').rateSource).toBe('store');
    expect(line(k, 'cement').sku_code).toBe('CEM-ULT-PPC50');
    expect(k.storeLinks.some((s) => s.sku_code === 'CEM-ULT-PPC50')).toBe(true);
  });
});

describe('store catalogue bridge', () => {
  it('maps by explicit code first, then by price rank', () => {
    const catalog: CatalogPrices = {
      'TIL-A': { sku_code: 'TIL-A', category: 'tiles', name: 'A', brand: 'X', unit: 'box', selling_price: 900, price_provenance: 'fetched', per_sqft: 40 },
      'TIL-B': { sku_code: 'TIL-B', category: 'tiles', name: 'B', brand: 'Y', unit: 'box', selling_price: 1200, price_provenance: 'fetched', per_sqft: 60 },
      'TIL-C': { sku_code: 'TIL-C', category: 'tiles', name: 'C', brand: 'Z', unit: 'box', selling_price: 1500, price_provenance: 'fetched', per_sqft: 90 },
    };
    expect(resolveStoreSku(CATALOG_MAP.tiles, 'basic', catalog)?.sku_code).toBe('TIL-A');
    expect(resolveStoreSku(CATALOG_MAP.tiles, 'medium', catalog)?.sku_code).toBe('TIL-B');
    expect(resolveStoreSku(CATALOG_MAP.tiles, 'premium', catalog)?.sku_code).toBe('TIL-C');
    const r = estimate({ ...base, tier: 'premium' }, catalog);
    expect(line(r, 'floor_tiles').rate).toBe(90);
    expect(line(r, 'floor_tiles').rateSource).toBe('store');
  });
  it('falls back to the seed rate when the store has no price', () => {
    const r = estimate(base, {
      'BUL-X': { sku_code: 'BUL-X', category: 'bulbs', name: 'x', brand: 'b', unit: 'piece', selling_price: null, price_provenance: 'estimated' },
    });
    expect(line(r, 'bulbs').rateSource).toBe('seed');
  });
  it('prices picks from the store into the interior ledger', () => {
    const r = estimate(
      { ...base, picks: [{ sku_code: 'FIR-1', qty: 3 }] },
      {
        'FIR-1': {
          sku_code: 'FIR-1',
          category: 'fire-extinguishers',
          name: 'ABC 4 kg',
          brand: 'Ceasefire',
          unit: 'piece',
          selling_price: 4000,
          price_provenance: 'fetched',
        },
      },
    );
    const l = line(r, 'pick:FIR-1');
    expect(l.amount).toBe(12_000);
    expect(l.ledger).toBe('interior');
    expect(l.group).toBe('picks');
  });
});

describe('add-ons', () => {
  it('solar sizes to the tier and the roof, 550 Wp default panels', () => {
    const r = estimate({ ...base, addons: { solar: true, cctv: false, fireSafety: false } });
    const p = line(r, 'solar_panels');
    expect(p.qty).toBe(6); // 3 kW / 550 Wp → 6 panels
    expect(line(r, 'solar_bos').qty).toBe(3);
    expect(line(r, 'solar_bos').amount).toBe(90_000);
  });
  it('cctv and fire counts follow the floors', () => {
    const r = estimate({ ...base, addons: { solar: false, cctv: true, fireSafety: true } });
    expect(line(r, 'cctv_cameras').qty).toBe(2 + 2 * 2);
    expect(line(r, 'extinguishers').qty).toBe(1 + 1 * 2);
  });
  it('compound wall uses the plot perimeter and parking adds 150 sqft', () => {
    const r = estimate({ ...base, compoundWall: true, parking: true });
    expect(line(r, 'compound_wall').qty).toBe(140);
    expect(line(r, 'parking').qty).toBe(150);
  });
});

describe('inputs', () => {
  it('normalises junk into valid inputs and round-trips a query string', () => {
    const n = normalizeInputs({ city: 'nowhere', floors: 9, coverage: 2, tier: 'gold', plot: { lengthFt: '50', widthFt: '60' } } as never);
    expect(n.city).toBe(DEFAULT_INPUTS.city);
    expect(n.floors).toBe(4);
    expect(n.coverage).toBe(1);
    expect(n.tier).toBe('medium');
    expect(n.plot).toEqual({ lengthFt: 50, widthFt: 60 });
    const i: EstimateInputs = { ...base, city: 'vijayawada', parking: true, addons: { solar: true, cctv: false, fireSafety: true }, builtUpOverrideSqft: 2400 };
    const back = inputsFromQuery(new URLSearchParams(inputsToQuery(i)));
    expect(back?.city).toBe('vijayawada');
    expect(back?.parking).toBe(true);
    expect(back?.addons.solar).toBe(true);
    expect(back?.builtUpOverrideSqft).toBe(2400);
    expect(inputsFromQuery(new URLSearchParams(''))).toBeNull();
  });
});
