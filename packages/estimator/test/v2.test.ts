import { describe, expect, it } from 'vitest';
import {
  applyDrawing,
  type CatalogPrices,
  DEFAULT_INPUTS,
  type DrawingExtraction,
  type EstimateInputs,
  estimate,
  INPUT_RANGES,
  inputsFromQuery,
  inputsToQuery,
  normalizeInputs,
} from '../src';

/**
 * Same reference case as estimate.test.ts — Hyderabad (index 1.00), 30 × 40 ft, coverage 75 %
 * → footprint 900, G+1 → BUA 1800, RCC framed, Medium, seed rates. Hand totals used below:
 *   civil materials = cement 288,000 + steel 428,400 + bricks 144,000 + sand 140,400 + aggregate 81,000 = 1,081,800
 *   civil labour    = 1,081,800 × 0.38 / 0.62 = 663,038.7 → 663,039
 *   grand total     = 3,416,796 (structure 2,611,119 + interior 805,677)
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
const REFERENCE_TOTAL = 3_416_796;
const line = (r: ReturnType<typeof estimate>, key: string) => {
  const l = r.lines.find((x) => x.key === key);
  if (!l) throw new Error(`no line ${key}`);
  return l;
};
const has = (r: ReturnType<typeof estimate>, key: string) => r.lines.some((x) => x.key === key);
const rooms331 = { bedrooms: 3, bathrooms: 3, kitchens: 1 };

describe('v2 inputs', () => {
  it('every v2 field left at its default reproduces the v1 reference total exactly', () => {
    expect(estimate(base).grandTotal).toBe(REFERENCE_TOTAL);
    // normalizeInputs fills every v2 default — the filled object must price identically
    const filled = normalizeInputs(base);
    expect(filled.rooms).toBeNull();
    expect(filled.floorHeightFt).toBe(10);
    expect(filled.roof).toBe('flat_rcc');
    expect(filled.exteriorFinish).toBe('paint');
    expect(filled.interior).toBeNull();
    expect(filled.boundaryWall).toBeNull();
    expect(filled.solarKw).toBeNull();
    expect(filled.adjustments).toEqual([]);
    const r = estimate(filled);
    expect(r.grandTotal).toBe(REFERENCE_TOTAL);
    expect(estimate(DEFAULT_INPUTS).grandTotal).toBe(REFERENCE_TOTAL);
    expect(r.adjustments).toEqual({ applied: 0, ignored: [] });
    expect(r.accuracy.note).not.toContain('adjustment');
    for (const k of [
      'foundation',
      'site_conditions',
      'cladding',
      'sloped_roof',
      'bathroom_fixtures',
      'kitchen_sink',
      'electrical_points',
      'staircase',
      'lift',
      'borewell',
      'sump',
      'septic',
      'rainwater',
      'balcony',
      'gate',
      'landscaping',
      'modular_kitchen',
      'wardrobes',
    ])
      expect(has(r, k)).toBe(false);
    expect(has(r, 'fittings')).toBe(true);
    expect(has(r, 'modular')).toBe(true);
  });

  it('floor height 12 ft: walls / plaster / paint × 1.2, steel × 1.04', () => {
    const r = estimate({ ...base, floorHeightFt: 12 });
    // steel 1800 × 3.5 = 6300 kg × (1 + 0.02 × 2) = 6552 kg × ₹68 = 445,536
    expect(line(r, 'steel').qty).toBe(6552);
    expect(line(r, 'steel').amount).toBe(445_536);
    // bricks 14,400 × 1.2 = 17,280 × ₹10 = 172,800
    expect(line(r, 'bricks').amount).toBe(172_800);
    // plaster 1800 × 2.4 × 1.2 = 5184 sqft × ₹28 = 145,152
    expect(line(r, 'plaster').amount).toBe(145_152);
    // exterior paint 1800 × 0.9 × 1.2 = 1944 sqft × ₹28 = 54,432
    expect(line(r, 'ext_paint').amount).toBe(54_432);
    // interior paint 1800 × 3.2 × 1.2 = 6912 sqft × ₹20 = 138,240
    expect(line(r, 'int_paint').amount).toBe(138_240);
    // cement, sand, aggregate are unchanged by height
    expect(line(r, 'cement').amount).toBe(288_000);
    expect(line(r, 'sand').amount).toBe(140_400);
    expect(r.needsVerification.some((f) => f.startsWith('floor height 12 ft'))).toBe(true);
  });

  it('rooms 3/3/1 drive doors, wall tiles, rough-in plumbing, bathroom fixture sets and the kitchen sink', () => {
    const r = estimate({ ...base, rooms: rooms331 });
    // doors = 3 + 3 + 1 + 2 = 9 × ₹12,000 = 108,000 (v1 thumb was 12 doors)
    expect(line(r, 'doors').qty).toBe(9);
    expect(line(r, 'doors').amount).toBe(108_000);
    // wall tiles = 3 × 180 + 1 × 60 = 600 sqft × ₹55 = 33,000 (v1 thumb was 540 sqft)
    expect(line(r, 'wall_tiles').qty).toBe(600);
    expect(line(r, 'wall_tiles').amount).toBe(33_000);
    // tile laying = (1755.36 + 600) sqft × ₹32 = 75,371.52 → 75,372
    expect(line(r, 'tile_laying').amount).toBe(75_372);
    // plumbing becomes rough-in only: 1800 × ₹85 = 153,000 (v1 all-in line was 1800 × ₹140 = 252,000)
    expect(line(r, 'plumbing').amount).toBe(153_000);
    // fixtures 3 sets × ₹32,000 = 96,000; sink 1 × ₹9,000
    expect(line(r, 'bathroom_fixtures').amount).toBe(96_000);
    expect(line(r, 'kitchen_sink').amount).toBe(9_000);
    // total moves only by those five lines: plumbing group (96,000 + 9,000 + 153,000 − 252,000) + doors (108,000 − 144,000) + wall tiles (33,000 − 29,700) + laying (75,372 − 73,452)
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + (96_000 + 9_000 + 153_000 - 252_000) + (108_000 - 144_000) + (33_000 - 29_700) + (75_372 - 73_452));
  });

  it('raft foundation premium = civil materials × footing share × (factor − 1) = 1,081,800 × 0.18 × 0.18 = 35,050', () => {
    const r = estimate({ ...base, foundation: 'raft' });
    const f = line(r, 'foundation');
    expect(f.amount).toBe(35_050);
    expect(f.group).toBe('foundation');
    expect(f.phase).toBe('footing');
    expect(f.needsVerification).toBe(true);
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + 35_050);
    // the premium bills entirely in the footing phase: R(structural × 0.18) + 35,050
    const ref = estimate(base);
    expect(r.phases.find((p) => p.key === 'footing')!.amount).toBe(ref.phases.find((p) => p.key === 'footing')!.amount + 35_050);
    // pile: 1,081,800 × 0.18 × 0.35 = 68,153.4 → 68,153
    expect(line(estimate({ ...base, foundation: 'pile' }), 'foundation').amount).toBe(68_153);
    // isolated footings = the thumb-rule baseline → no line
    expect(has(estimate({ ...base, foundation: 'isolated_footing' }), 'foundation')).toBe(false);
  });

  it('soil picks the default foundation and flags it; an explicit foundation wins', () => {
    const soft = estimate({ ...base, soil: 'soft' });
    expect(line(soft, 'foundation').amount).toBe(35_050); // soft → raft
    expect(soft.needsVerification.some((f) => f.startsWith('soil soft → raft'))).toBe(true);
    expect(line(estimate({ ...base, soil: 'black_cotton' }), 'foundation').amount).toBe(35_050);
    expect(has(estimate({ ...base, soil: 'hard' }), 'foundation')).toBe(false);
    expect(has(estimate({ ...base, soil: 'medium' }), 'foundation')).toBe(false);
    expect(line(estimate({ ...base, soil: 'hard', foundation: 'pile' }), 'foundation').amount).toBe(68_153);
  });

  it('site conditions = a share of civil materials + civil labour: narrow road 3 % of 1,744,839 = 52,345', () => {
    const r = estimate({ ...base, site: { roadAccess: 'narrow', water: 'municipal', power: 'available' } });
    const s = line(r, 'site_conditions');
    expect(s.amount).toBe(52_345);
    expect(s.group).toBe('labour');
    expect(s.ledger).toBe('structure');
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + 52_345);
    // the overhead counts as labour in the structure ledger
    expect(r.ledgers.structure.labour).toBe(663_039 + 99_000 + 52_345);
    // no truck 7 % + tanker 2 % + temporary power 1.5 % = 10.5 % × 1,744,839 = 183,208.1 → 183,208
    expect(line(estimate({ ...base, site: { roadAccess: 'no_truck', water: 'tanker', power: 'temporary' } }), 'site_conditions').amount).toBe(183_208);
    expect(has(estimate({ ...base, site: { roadAccess: 'good', water: 'borewell', power: 'available' } }), 'site_conditions')).toBe(false);
  });

  it('sloped roof premium per sqft of roof (BUA ÷ floors): 900 sqft × ₹260 = 234,000', () => {
    const r = estimate({ ...base, roof: 'sloped' });
    expect(line(r, 'sloped_roof').qty).toBe(900);
    expect(line(r, 'sloped_roof').amount).toBe(234_000);
    expect(line(r, 'sloped_roof').group).toBe('roof');
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + 234_000);
  });

  it('cladding / stone replace paint on 35 % of the façade: 1620 × 0.35 = 567 sqft clad, 1053 sqft painted', () => {
    const c = estimate({ ...base, exteriorFinish: 'cladding' });
    // cladding 567 × ₹380 = 215,460; paint 1053 × ₹28 = 29,484 (v1 paint 1620 × 28 = 45,360)
    expect(line(c, 'cladding').qty).toBe(567);
    expect(line(c, 'cladding').amount).toBe(215_460);
    expect(line(c, 'ext_paint').qty).toBe(1053);
    expect(line(c, 'ext_paint').amount).toBe(29_484);
    expect(c.grandTotal).toBe(REFERENCE_TOTAL + 215_460 + 29_484 - 45_360);
    // stone 567 × ₹480 = 272,160
    expect(line(estimate({ ...base, exteriorFinish: 'stone' }), 'cladding').amount).toBe(272_160);
  });

  it('interior package replaces the spread "modular" line with itemised kitchen and wardrobes', () => {
    const r = estimate({ ...base, rooms: rooms331, interior: { modularKitchen: true, wardrobes: true, falseCeilingShare: null } });
    expect(has(r, 'modular')).toBe(false);
    // 1 kitchen × ₹180,000; wardrobes 3 bedrooms × 7 rft = 21 rft × ₹14,000 = 294,000
    expect(line(r, 'modular_kitchen').amount).toBe(180_000);
    expect(line(r, 'wardrobes').qty).toBe(21);
    expect(line(r, 'wardrobes').amount).toBe(294_000);
    // false ceiling share null → the tier's 25 %: 450 sqft × ₹85 = 38,250 (unchanged)
    expect(line(r, 'false_ceiling').amount).toBe(38_250);
    // without room counts the bedroom thumb is one per 450 sqft: ceil(1800 / 450) = 4 → 28 rft × 14,000 = 392,000
    const noRooms = estimate({ ...base, interior: { modularKitchen: false, wardrobes: true, falseCeilingShare: 0.5 } });
    expect(line(noRooms, 'wardrobes').amount).toBe(392_000);
    expect(has(noRooms, 'modular_kitchen')).toBe(false);
    expect(line(noRooms, 'wardrobes').note).toContain('assumed');
    // explicit false-ceiling share 50 %: 900 sqft × ₹85 = 76,500; 0 → no line
    expect(line(noRooms, 'false_ceiling').amount).toBe(76_500);
    const off = estimate({ ...base, interior: { modularKitchen: false, wardrobes: false, falseCeilingShare: 0 } });
    expect(has(off, 'false_ceiling')).toBe(false);
    expect(has(off, 'modular')).toBe(false);
    expect(off.grandTotal).toBe(REFERENCE_TOTAL - 216_000 - 38_250);
  });

  it('plumbing tier prices only the plumbing lines: premium rough-in + fixtures on a medium house', () => {
    const r = estimate({ ...base, plumbingTier: 'premium' });
    expect(line(r, 'plumbing').amount).toBe(1800 * 200); // 360,000 at premium, other lines still medium
    expect(line(r, 'doors').amount).toBe(144_000);
    const itemised = estimate({ ...base, rooms: rooms331, plumbingTier: 'basic' });
    expect(line(itemised, 'plumbing').amount).toBe(1800 * 60);
    expect(line(itemised, 'bathroom_fixtures').amount).toBe(3 * 18_000);
    expect(line(itemised, 'kitchen_sink').amount).toBe(4_500);
  });

  it('electrical points per room replace the per-sqft fittings line', () => {
    // no rooms → one room per 150 sqft = 12 rooms × 8 points = 96 × ₹950 = 91,200 (v1 fittings 1800 × 50 = 90,000)
    const r = estimate({ ...base, electricalPointsPerRoom: 8 });
    expect(has(r, 'fittings')).toBe(false);
    expect(line(r, 'electrical_points').qty).toBe(96);
    expect(line(r, 'electrical_points').amount).toBe(91_200);
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + 91_200 - 90_000);
    // with rooms 3/3/1 → 9 rooms × 8 = 72 points × ₹950 = 68,400
    expect(line(estimate({ ...base, rooms: rooms331, electricalPointsPerRoom: 8 }), 'electrical_points').amount).toBe(68_400);
  });

  it('staircase per floor above ground by type; nothing on a ground-only house', () => {
    expect(line(estimate({ ...base, staircase: 'rcc_granite' }), 'staircase').amount).toBe(85_000);
    expect(line(estimate({ ...base, staircase: 'rcc_plain' }), 'staircase').amount).toBe(35_000);
    expect(line(estimate({ ...base, staircase: 'steel' }), 'staircase').amount).toBe(80_000);
    const two = estimate({ ...base, floors: 2, staircase: 'rcc_granite' });
    expect(line(two, 'staircase').qty).toBe(2);
    expect(line(two, 'staircase').amount).toBe(170_000);
    expect(line(two, 'staircase').group).toBe('lift_stairs');
    expect(has(estimate({ ...base, floors: 0, staircase: 'rcc_granite' }), 'staircase')).toBe(false);
  });

  it('lift only from G+3: base ₹12,50,000 + 4 stops × ₹80,000', () => {
    const r = estimate({ ...base, floors: 3, lift: true });
    expect(line(r, 'lift').amount).toBe(1_250_000);
    expect(line(r, 'lift_stops').qty).toBe(4);
    expect(line(r, 'lift_stops').amount).toBe(320_000);
    expect(has(estimate({ ...base, floors: 2, lift: true }), 'lift')).toBe(false);
  });

  it('water items: borewell 120,000 · sump 10 kL × 11,000 · septic 75,000 · rainwater 40,000', () => {
    const r = estimate({ ...base, water: { borewell: true, sump: true, septic: true, rainwater: true } });
    expect(line(r, 'borewell').amount).toBe(120_000);
    expect(line(r, 'sump').qty).toBe(10);
    expect(line(r, 'sump').amount).toBe(110_000);
    expect(line(r, 'septic').amount).toBe(75_000);
    expect(line(r, 'rainwater').amount).toBe(40_000);
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + 120_000 + 110_000 + 75_000 + 40_000);
    expect(r.groups.find((g) => g.key === 'external_works')!.amount).toBe(345_000);
  });

  it('balcony / utility 120 sqft × ₹1,200 = 144,000 and landscaping 500 sqft × ₹110 = 55,000', () => {
    const r = estimate({ ...base, balconyUtilitySqft: 120, landscapingSqft: 500 });
    expect(line(r, 'balcony').amount).toBe(144_000);
    expect(line(r, 'balcony').group).toBe('roof');
    expect(line(r, 'landscaping').amount).toBe(55_000);
    expect(line(r, 'landscaping').group).toBe('external_works');
  });

  it('boundary wall scales the 5 ft rate by height and adds the gate; the legacy compoundWall alias is perimeter × 5 ft, no gate', () => {
    const r = estimate({ ...base, boundaryWall: { lengthFt: 100, heightFt: 6, gate: 'ms' } });
    // ₹1,100/rft at 5 ft × 6/5 = ₹1,320/rft × 100 rft = 132,000; MS gate 40,000
    const w = line(r, 'compound_wall');
    expect(w.rate).toBe(1320);
    expect(w.qty).toBe(100);
    expect(w.amount).toBe(132_000);
    expect(w.label).toBe('Compound wall (6 ft)');
    expect(w.group).toBe('external_works');
    expect(line(r, 'gate').amount).toBe(40_000);
    expect(line(estimate({ ...base, boundaryWall: { lengthFt: null, heightFt: 5, gate: 'ss' } }), 'gate').amount).toBe(85_000);
    expect(line(estimate({ ...base, boundaryWall: { lengthFt: null, heightFt: 5, gate: 'automatic' } }), 'gate').amount).toBe(150_000);
    // lengthFt null → the plot perimeter (140 ft)
    expect(line(estimate({ ...base, boundaryWall: { lengthFt: null, heightFt: 5, gate: 'none' } }), 'compound_wall').qty).toBe(140);
    const legacy = estimate({ ...base, compoundWall: true });
    expect(line(legacy, 'compound_wall').amount).toBe(154_000);
    expect(line(legacy, 'compound_wall').label).toBe('Compound wall (5 ft)');
    expect(has(legacy, 'gate')).toBe(false);
  });

  it('explicit solar kW turns solar on and is clamped to the roof (900 sqft ≈ 9 kW)', () => {
    const r = estimate({ ...base, solarKw: 5 });
    // 5 kW / 550 Wp = 9.09 → 10 panels × (₹26/Wp × 550 = ₹14,300) = 143,000; BOS 5 × ₹30,000
    expect(line(r, 'solar_panels').qty).toBe(10);
    expect(line(r, 'solar_panels').amount).toBe(143_000);
    expect(line(r, 'solar_bos').qty).toBe(5);
    expect(line(r, 'solar_bos').amount).toBe(150_000);
    const big = estimate({ ...base, solarKw: 20 });
    expect(line(big, 'solar_bos').qty).toBe(9);
    expect(big.needsVerification.some((f) => f.includes('sized to the roof'))).toBe(true);
    // the tier default still applies when only the add-on box is ticked
    expect(line(estimate({ ...base, addons: { solar: true, cctv: false, fireSafety: false } }), 'solar_bos').qty).toBe(3);
  });

  it('groups carry the new keys and still sum to the grand total; phases stay within slab rounding', () => {
    const r = estimate({
      ...base,
      foundation: 'raft',
      roof: 'sloped',
      floors: 3,
      lift: true,
      staircase: 'rcc_plain',
      water: { borewell: true, sump: false, septic: true, rainwater: false },
      boundaryWall: { lengthFt: null, heightFt: 5, gate: 'ms' },
    });
    const keys = r.groups.map((g) => g.key);
    for (const k of ['foundation', 'roof', 'external_works', 'lift_stairs']) expect(keys).toContain(k);
    expect(r.groups.reduce((a, g) => a + g.amount, 0)).toBe(r.grandTotal);
    expect(Math.abs(r.phases.reduce((a, p) => a + p.amount, 0) - r.grandTotal)).toBeLessThanOrEqual(2);
    expect(r.tiers.basic).toBeLessThan(r.tiers.medium);
    expect(r.tiers.medium).toBeLessThan(r.tiers.premium);
  });

  it('normalizeInputs clamps and coerces every v2 field', () => {
    const n = normalizeInputs({
      ...base,
      rooms: { bedrooms: '3', bathrooms: 99, kitchens: -2 },
      floorHeightFt: '30',
      soil: 'mud',
      foundation: 'raft',
      roof: 'dome',
      exteriorFinish: 'stone',
      interior: { modularKitchen: '1', wardrobes: false, falseCeilingShare: 4 },
      plumbingTier: 'gold',
      electricalPointsPerRoom: 0,
      staircase: 'marble',
      lift: 'true',
      water: { borewell: '1' },
      balconyUtilitySqft: -5,
      boundaryWall: { lengthFt: 0, heightFt: 40, gate: 'wood' },
      landscapingSqft: '250.7',
      solarKw: '3.25',
      site: { roadAccess: 'narrow', water: 'river', power: 'temporary' },
    } as never);
    expect(n.rooms).toEqual({ bedrooms: 3, bathrooms: 20, kitchens: 0 });
    expect(n.floorHeightFt).toBe(16);
    expect(n.soil).toBeNull();
    expect(n.foundation).toBe('raft');
    expect(n.roof).toBe('flat_rcc');
    expect(n.exteriorFinish).toBe('stone');
    expect(n.interior).toEqual({ modularKitchen: true, wardrobes: false, falseCeilingShare: 1 });
    expect(n.plumbingTier).toBeNull();
    expect(n.electricalPointsPerRoom).toBeNull();
    expect(n.staircase).toBeNull();
    expect(n.lift).toBe(true);
    expect(n.water).toEqual({ borewell: true, sump: false, septic: false, rainwater: false });
    expect(n.balconyUtilitySqft).toBe(0);
    expect(n.boundaryWall).toEqual({ lengthFt: null, heightFt: 10, gate: 'none' });
    expect(n.landscapingSqft).toBe(251);
    expect(n.solarKw).toBe(3.3);
    expect(n.site).toEqual({ roadAccess: 'narrow', water: 'municipal', power: 'temporary' });
    expect(INPUT_RANGES.floorHeightFt).toEqual([8, 16]);
  });

  it('the query string carries the v2 short keys only when set, and round-trips them', () => {
    expect(inputsToQuery(normalizeInputs(base))).toBe(inputsToQuery(base)); // defaults add no keys
    const i = normalizeInputs({
      ...base,
      rooms: rooms331,
      floorHeightFt: 12,
      soil: 'soft',
      foundation: 'pile',
      roof: 'sloped',
      exteriorFinish: 'cladding',
      interior: { modularKitchen: true, wardrobes: false, falseCeilingShare: 0.4 },
      plumbingTier: 'premium',
      electricalPointsPerRoom: 8,
      staircase: 'steel',
      lift: true,
      floors: 3,
      water: { borewell: true, sump: true, septic: false, rainwater: true },
      balconyUtilitySqft: 120,
      boundaryWall: { lengthFt: 100, heightFt: 6, gate: 'ms' },
      landscapingSqft: 500,
      solarKw: 5,
      site: { roadAccess: 'no_truck', water: 'tanker', power: 'temporary' },
    });
    const qs = inputsToQuery(i);
    for (const k of [
      'bd=3',
      'ba=3',
      'kt=1',
      'fh=12',
      'soil=soft',
      'fnd=pile',
      'roof=sloped',
      'ext=cladding',
      'mk=1',
      'wr=0',
      'fc=40',
      'pt=premium',
      'ep=8',
      'st=steel',
      'lift=1',
      'bw=1',
      'sump=1',
      'rw=1',
      'bal=120',
      'bwl=100',
      'bwh=6',
      'gate=ms',
      'ls=500',
      'skw=5',
      'road=no_truck',
      'wtr=tanker',
      'pwr=temporary',
    ])
      expect(qs).toContain(k);
    expect(qs).not.toContain('sep=');
    const back = inputsFromQuery(new URLSearchParams(qs))!;
    expect(back).toEqual(i);
    expect(estimate(back).grandTotal).toBe(estimate(i).grandTotal);
  });
});

describe('adjustments', () => {
  const cementUp = {
    line_key: 'cement',
    rate: 440,
    reason: 'Aug 2026 dealer quote',
    source_url: 'https://example.com/cement',
    provenance: 'ai_suggested' as const,
  };

  it('applies a rate override deterministically and the civil labour line follows the adjusted cement', () => {
    const r = estimate({ ...base, adjustments: [cementUp] });
    const c = line(r, 'cement');
    // 720 bags × ₹440 = 316,800 (was 288,000)
    expect(c.rate).toBe(440);
    expect(c.amount).toBe(316_800);
    expect(c.needsVerification).toBe(true);
    expect(c.adjusted).toEqual({
      field: 'rate',
      from: 400,
      to: 440,
      provenance: 'ai_suggested',
      reason: 'Aug 2026 dealer quote',
      source_url: 'https://example.com/cement',
      capped: false,
    });
    // civil materials 316,800 + 428,400 + 144,000 + 140,400 + 81,000 = 1,110,600 → labour × 0.38 / 0.62 = 680,690.3 → 680,690 (was 663,039)
    expect(line(r, 'civil_labour').amount).toBe(680_690);
    expect(r.grandTotal).toBe(REFERENCE_TOTAL + (316_800 - 288_000) + (680_690 - 663_039));
    expect(r.adjustments).toEqual({ applied: 1, ignored: [] });
    expect(r.accuracy.note.endsWith('· 1 adjustment applied')).toBe(true);
    expect(r.needsVerification).toContain('Cement: AI-suggested rate applied (unverified)');
    // same inputs → identical result, every time
    expect(estimate({ ...base, adjustments: [cementUp] })).toEqual(r);
  });

  it('clamps to ±35 % and says so', () => {
    const up = line(estimate({ ...base, adjustments: [{ ...cementUp, rate: 800 }] }), 'cement');
    // 400 × 1.35 = 540 → 720 × 540 = 388,800
    expect(up.rate).toBe(540);
    expect(up.amount).toBe(388_800);
    expect(up.adjusted?.capped).toBe(true);
    expect(up.note).toContain('capped at ±35 %');
    const down = line(estimate({ ...base, adjustments: [{ ...cementUp, rate: 100 }] }), 'cement');
    // 400 × 0.65 = 260 → 720 × 260 = 187,200
    expect(down.rate).toBe(260);
    expect(down.amount).toBe(187_200);
    expect(down.adjusted?.capped).toBe(true);
    // exactly on the bound is not "capped"
    expect(line(estimate({ ...base, adjustments: [{ ...cementUp, rate: 540 }] }), 'cement').adjusted?.capped).toBe(false);
  });

  it('never touches a store-priced line — it is recorded as ignored', () => {
    const catalog: CatalogPrices = {
      'CEM-AMB-PLUS50': {
        sku_code: 'CEM-AMB-PLUS50',
        category: 'cement',
        name: 'Plus 50 kg',
        brand: 'Ambuja',
        unit: 'bag',
        selling_price: 415,
        price_provenance: 'fetched',
        in_stock: true,
      },
    };
    const r = estimate({ ...base, adjustments: [cementUp] }, catalog);
    const c = line(r, 'cement');
    expect(c.rateSource).toBe('store');
    expect(c.rate).toBe(415);
    expect(c.adjusted).toBeUndefined();
    expect(c.needsVerification).toBe(false);
    expect(r.adjustments).toEqual({ applied: 0, ignored: [{ line_key: 'cement', reason: 'store_priced', provenance: 'ai_suggested' }] });
    expect(r.accuracy.note).not.toContain('adjustment');
  });

  it('quantity overrides work the same way, and the premium lines follow the adjusted materials', () => {
    const r = estimate({
      ...base,
      foundation: 'raft',
      adjustments: [{ line_key: 'steel', qty: 6000, reason: 'G+1 needs ~3.3 kg/sqft', source_url: null, provenance: 'user' }, cementUp],
    });
    const s = line(r, 'steel');
    // 6000 kg × ₹68 = 408,000 (6300 asked → 6000 is −4.8 %, inside the clamp)
    expect(s.qty).toBe(6000);
    expect(s.amount).toBe(408_000);
    expect(s.adjusted?.field).toBe('qty');
    expect(s.adjusted?.from).toBe(6300);
    // civil materials = 316,800 + 408,000 + 144,000 + 140,400 + 81,000 = 1,090,200
    //   labour = 1,090,200 × 0.38 / 0.62 = 668,187.1 → 668,187 · raft premium = 1,090,200 × 0.18 × 0.18 = 35,322.48 → 35,322
    expect(line(r, 'civil_labour').amount).toBe(668_187);
    expect(line(r, 'foundation').amount).toBe(35_322);
    expect(r.adjustments.applied).toBe(2);
    expect(r.needsVerification).toContain('TMT steel: manual quantity applied (unverified)');
    expect(r.accuracy.note.endsWith('· 2 adjustments applied')).toBe(true);
  });

  it('an adjustment for a line this estimate does not have is ignored as no_such_line', () => {
    const r = estimate({ ...base, adjustments: [{ line_key: 'solar_bos', rate: 31000, reason: '', source_url: null, provenance: 'ai_suggested' }] });
    expect(r.adjustments).toEqual({ applied: 0, ignored: [{ line_key: 'solar_bos', reason: 'no_such_line', provenance: 'ai_suggested' }] });
    expect(r.grandTotal).toBe(REFERENCE_TOTAL);
  });

  it('normalizeInputs validates adjustments: keys, provenance, fields, one per line, max 24', () => {
    const n = normalizeInputs({
      ...base,
      adjustments: [
        { line_key: 'bad key!', rate: 1, reason: '', source_url: null, provenance: 'user' }, // invalid key
        { line_key: 'steel', rate: 70, reason: '', source_url: null, provenance: 'vendor' }, // invalid provenance
        { line_key: 'bricks', reason: 'no numbers', source_url: null, provenance: 'user' }, // neither rate nor qty
        { line_key: 'cement', rate: 390, reason: 'first', source_url: 'ftp://x', provenance: 'user' }, // replaced by the later cement entry
        { line_key: 'cement', rate: '410', qty: 700, reason: 'second', source_url: 'https://ok.example', provenance: 'ai_suggested' },
        { line_key: 'pick:FIR-1', qty: '2', reason: '', source_url: null, provenance: 'user' },
      ],
    } as never);
    expect(n.adjustments).toEqual([
      { line_key: 'cement', rate: 410, reason: 'second', source_url: 'https://ok.example', provenance: 'ai_suggested' }, // rate wins when both are given
      { line_key: 'pick:FIR-1', qty: 2, reason: '', source_url: null, provenance: 'user' },
    ]);
    const many = normalizeInputs({
      ...base,
      adjustments: Array.from({ length: 30 }, (_, i) => ({ line_key: `line_${i}`, rate: 1, reason: '', source_url: null, provenance: 'user' })),
    } as never);
    expect(many.adjustments).toHaveLength(24);
    expect(normalizeInputs({ ...base, adjustments: 'nope' } as never).adjustments).toEqual([]);
  });

  it('the query string carries only the count of adjustments, and reading it back drops them', () => {
    const i = normalizeInputs({
      ...base,
      rooms: rooms331,
      adjustments: [cementUp, { line_key: 'steel', qty: 6000, reason: '', source_url: null, provenance: 'user' }],
    });
    const qs = inputsToQuery(i);
    expect(qs).toContain('adj=2');
    expect(qs).not.toContain('cement');
    expect(qs).not.toContain('example.com');
    const back = inputsFromQuery(new URLSearchParams(qs))!;
    expect(back.adjustments).toEqual([]);
    expect(back.rooms).toEqual(rooms331);
    expect(inputsToQuery({ ...i, adjustments: [] })).not.toContain('adj=');
  });
});

describe('applyDrawing', () => {
  const empty: DrawingExtraction = {
    provider: 'mock',
    floors: null,
    plotLengthFt: null,
    plotWidthFt: null,
    builtUpSqft: null,
    rooms: null,
    doors: null,
    windows: null,
    constructionType: null,
    confidence: 0,
    notes: '',
  };

  it('maps a v1-shaped reading to plot, floors, BUA, type and the derived coverage', () => {
    const reading: DrawingExtraction = {
      ...empty,
      provider: 'anthropic',
      floors: 1,
      plotLengthFt: 40.2,
      plotWidthFt: 29.8,
      builtUpSqft: 1800,
      rooms: 5,
      doors: 8,
      windows: 10,
      constructionType: 'rcc_framed',
      confidence: 0.8,
    };
    const { patch, fields } = applyDrawing(base, reading);
    expect(patch.plot).toEqual({ lengthFt: 40, widthFt: 30 });
    expect(patch.floors).toBe(1);
    expect(patch.builtUpOverrideSqft).toBe(1800);
    expect(patch.constructionType).toBe('rcc_framed');
    // footprint = 1800 / (1 + 1) = 900 over a 40 × 30 = 1200 plot → 0.75
    expect(patch.coverage).toBe(0.75);
    expect(fields).toEqual(['plot', 'floors', 'bua', 'type', 'coverage']);
    expect(patch.rooms).toBeUndefined();
    expect(patch.staircase).toBeUndefined();
  });

  it('reads nothing from an empty reading and never mutates the inputs', () => {
    const before = JSON.stringify(base);
    const { patch, fields } = applyDrawing(base, empty);
    expect(patch).toEqual({});
    expect(fields).toEqual([]);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('a ≥ 9 in wall without columns reads as load-bearing; drawn columns read as framed', () => {
    expect(applyDrawing(base, { ...empty, wallThicknessIn: 9, constructionType: 'rcc_framed' }).patch.constructionType).toBe('load_bearing');
    expect(applyDrawing(base, { ...empty, wallThicknessIn: 9, columns: { present: true, count: 12 } }).patch.constructionType).toBe('rcc_framed');
    expect(applyDrawing(base, { ...empty, wallThicknessIn: 4.5, constructionType: 'load_bearing' }).patch.constructionType).toBe('load_bearing');
    expect(applyDrawing(base, { ...empty, wallThicknessIn: 6, columns: { present: false, count: 0 } }).patch.constructionType).toBeUndefined();
    expect(applyDrawing(base, { ...empty, wallThicknessIn: 9 }).fields).toEqual(['type']);
  });

  it('sums the per-floor areas into the BUA override and takes floors from the floor list', () => {
    const { patch, fields } = applyDrawing(base, {
      ...empty,
      floorsDetail: [
        { level: 0, label: 'GROUND FLOOR PLAN', areaSqft: 950, rooms: 4 },
        { level: 1, label: 'FIRST FLOOR PLAN', areaSqft: 850, rooms: 3 },
      ],
    });
    expect(patch.floors).toBe(1);
    expect(patch.builtUpOverrideSqft).toBe(1800);
    // ground floor 950 over the current 30 × 40 plot = 0.7916 → 0.79
    expect(patch.coverage).toBe(0.79);
    expect(fields).toEqual(['floors', 'bua', 'coverage']);
    // a stated BUA wins over the sum; an unknown floor area blocks the sum
    expect(
      applyDrawing(base, { ...empty, builtUpSqft: 2000, floorsDetail: [{ level: 0, label: null, areaSqft: 950, rooms: null }] }).patch.builtUpOverrideSqft,
    ).toBe(2000);
    expect(
      applyDrawing(base, {
        ...empty,
        floorsDetail: [
          { level: 0, label: null, areaSqft: 950, rooms: null },
          { level: 1, label: null, areaSqft: null, rooms: null },
        ],
      }).patch.builtUpOverrideSqft,
    ).toBeUndefined();
  });

  it('room counts come from the direct fields or from roomsByType; unknown counts keep the current value', () => {
    expect(applyDrawing(base, { ...empty, bedrooms: 3, bathrooms: 2 }).patch.rooms).toEqual({ bedrooms: 3, bathrooms: 2, kitchens: 0 });
    expect(applyDrawing({ ...base, rooms: { bedrooms: 2, bathrooms: 2, kitchens: 1 } }, { ...empty, bedrooms: 3 }).patch.rooms).toEqual({
      bedrooms: 3,
      bathrooms: 2,
      kitchens: 1,
    });
    const byType = applyDrawing(base, {
      ...empty,
      roomsByType: [
        { type: 'bedroom', count: 2, areaSqft: 150 },
        { type: 'bedroom', count: 1, areaSqft: 180 },
        { type: 'bathroom', count: 3, areaSqft: 40 },
        { type: 'kitchen', count: 1, areaSqft: 90 },
        { type: 'living', count: 1, areaSqft: 220 },
      ],
    });
    expect(byType.patch.rooms).toEqual({ bedrooms: 3, bathrooms: 3, kitchens: 1 });
    expect(byType.fields).toEqual(['rooms']);
    expect(applyDrawing(base, { ...empty, rooms: 5 }).patch.rooms).toBeUndefined(); // a bare room total cannot be split
  });

  it('staircase only with floors above ground; balcony and parking map directly', () => {
    expect(applyDrawing(base, { ...empty, floors: 1, staircase: { present: true, material: 'rcc', flights: 2 } }).patch.staircase).toBe('rcc_plain');
    expect(applyDrawing(base, { ...empty, floors: 2, staircase: { present: true, material: 'steel', flights: 4 } }).patch.staircase).toBe('steel');
    expect(applyDrawing({ ...base, floors: 0 }, { ...empty, staircase: { present: true, material: 'rcc', flights: 1 } }).patch.staircase).toBeUndefined();
    expect(applyDrawing(base, { ...empty, staircase: { present: true, material: null, flights: null } }).fields).toEqual(['staircase']); // inputs.floors = 1
    expect(applyDrawing(base, { ...empty, staircase: { present: false, material: null, flights: null } }).fields).toEqual([]);
    const { patch, fields } = applyDrawing(base, { ...empty, balconySqft: 120.4, parking: { present: true, cars: 1, covered: true } });
    expect(patch.balconyUtilitySqft).toBe(120);
    expect(patch.parking).toBe(true);
    expect(fields).toEqual(['balcony', 'parking']);
    expect(applyDrawing({ ...base, parking: true }, { ...empty, parking: { present: false, cars: 0, covered: null } }).patch.parking).toBe(false);
  });

  it('the patch prices through estimate() like any other input', () => {
    const { patch } = applyDrawing(base, {
      ...empty,
      floors: 1,
      plotLengthFt: 40,
      plotWidthFt: 30,
      builtUpSqft: 1800,
      bedrooms: 3,
      bathrooms: 3,
      kitchens: 1,
      staircase: { present: true, material: 'rcc', flights: 2 },
      balconySqft: 120,
    });
    const r = estimate(normalizeInputs({ ...base, ...patch }));
    expect(r.derived.fromDrawing).toBe(true);
    expect(r.derived.builtUpSqft).toBe(1800);
    expect(line(r, 'doors').qty).toBe(9);
    expect(line(r, 'staircase').amount).toBe(35_000);
    expect(line(r, 'balcony').amount).toBe(144_000);
  });
});
