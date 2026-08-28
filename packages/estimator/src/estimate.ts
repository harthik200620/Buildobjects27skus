/**
 * The deterministic cost engine: estimate(inputs, catalog) → EstimateResult. Pure — no I/O,
 * no randomness, no model. Quantities come from the thumb-rule table, rates from the tier card
 * (city-indexed) or from a live store SKU (never indexed). Two ledgers, always separate.
 *
 * v2 inputs (rooms, floor height, soil / foundation, roof, exterior finish, interior package,
 * plumbing tier, electrical points, staircase, lift, water, balcony, boundary wall, landscaping,
 * explicit solar kW, site conditions) each default to "not itemised", so the v1 reference case
 * returns exactly the v1 total. Adjustments (AI review / manual) are applied inside `push()`:
 * clamped to ±35 %, never on a store-priced line, always flagged for verification; the civil
 * labour line is computed from the adjusted material amounts, so it follows deterministically.
 */
import {
  CATALOG_MAP,
  cityByKey,
  PHASE_LABELS,
  QUANTITIES,
  RATES,
  RATES_VERSION,
  STATE_NAME,
  STRUCTURAL_SPLIT,
  slabLabel,
  type TierRate,
} from '../rates/2026-08';
import { perSqft, resolveStoreSku } from './catalog';
import {
  type Adjustment,
  type CatalogPrice,
  type CatalogPrices,
  type EstimateInputs,
  type EstimateResult,
  FOUNDATION_LABEL,
  GATE_LABEL,
  GROUPS,
  type GroupAmount,
  type GroupKey,
  type IgnoredAdjustment,
  isPlotByDims,
  type LineItem,
  type PhaseAmount,
  STAIRCASE_LABEL,
  TIER_LABEL,
  TIERS,
  type Tier,
} from './types';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const R = (n: number) => Math.round(n);
/** Adjustments may move a rate or quantity at most this far from the engine's own value. */
const ADJ_CLAMP = 0.35;

export function deriveGeometry(inputs: EstimateInputs) {
  const plotAreaSqft = isPlotByDims(inputs.plot) ? inputs.plot.lengthFt * inputs.plot.widthFt : inputs.plot.areaSqft;
  const perimeterFt = isPlotByDims(inputs.plot) ? 2 * (inputs.plot.lengthFt + inputs.plot.widthFt) : 4 * Math.sqrt(Math.max(0, plotAreaSqft));
  const coverage = clamp(inputs.coverage, 0.3, 1);
  const floorsCount = Math.max(1, Math.floor(inputs.floors) + 1);
  const footprintSqft = plotAreaSqft * coverage;
  const fromDrawing = typeof inputs.builtUpOverrideSqft === 'number' && inputs.builtUpOverrideSqft > 0;
  const builtUpSqft = fromDrawing ? (inputs.builtUpOverrideSqft as number) : footprintSqft * floorsCount;
  const city = cityByKey(inputs.city);
  return {
    plotAreaSqft,
    footprintSqft,
    builtUpSqft,
    floorsCount,
    floorsLabel: inputs.floors === 0 ? 'G' : `G+${inputs.floors}`,
    perimeterFt,
    cityIndex: city.index,
    cityName: city.name,
    stateName: STATE_NAME[city.state],
    fromDrawing,
    city,
  };
}

type Phase = LineItem['phase'];
type Ledger = LineItem['ledger'];

/**
 * The five fields that say "this rate came off our own shelf", in one place.
 *
 * Three lines in this file price against the catalogue — a mapped material, the solar panel and a
 * buyer's own pick — and each wrote these out itself. The `note` differs between an estimate and a
 * confirmed price, and the difference is the reason `needsVerification` exists, so the two must be
 * decided together or a line can claim a price is confirmed while flagging it as an estimate.
 */
const storePriced = (sku: CatalogPrice, note?: string) => ({
  rateSource: 'store' as const,
  sku_code: sku.sku_code,
  skuName: `${sku.brand} ${sku.name}`,
  priceProvenance: sku.price_provenance,
  needsVerification: sku.price_provenance === 'estimated',
  note: note ?? `${sku.brand} ${sku.name} · store ${sku.price_provenance === 'estimated' ? 'estimate' : 'price'}`,
});

export function estimate(inputs: EstimateInputs, catalog: CatalogPrices = {}, opts: { tiers?: boolean } = {}): EstimateResult {
  const g = deriveGeometry(inputs);
  const tier = inputs.tier;
  const idx = g.cityIndex;
  const bua = g.builtUpSqft;
  const q = QUANTITIES;
  const lines: LineItem[] = [];
  const flags = new Set<string>();
  if (g.city.needs_verification) flags.add(`${g.city.name} cost index ${g.city.index.toFixed(2)} (thumb value, not a surveyed index)`);

  /* ── v2 knobs (each resolves to the v1 behaviour when left at its default) ── */
  const h = clamp(inputs.floorHeightFt ?? q.floor_height_ref_ft, 8, 16);
  const wallF = h / q.floor_height_ref_ft; // walls, plaster, paint
  const steelF = 1 + q.steel_per_ft_over_10ft * (h - q.floor_height_ref_ft); // taller columns → more steel
  if (h !== q.floor_height_ref_ft) flags.add(`floor height ${h} ft — walls/plaster/paint × ${wallF.toFixed(2)}, steel × ${steelF.toFixed(2)} (thumb factors)`);
  const rooms = inputs.rooms ?? null;
  /** Rooms for doors / electrical points: bedrooms + bathrooms + kitchens + 2 (living, utility), else one per ~150 sqft. */
  const roomCount = rooms ? rooms.bedrooms + rooms.bathrooms + rooms.kitchens + q.doors_extra : Math.ceil(bua / q.sqft_per_door);
  const plumbTier: Tier = inputs.plumbingTier ?? tier;
  const roofSqft = bua / g.floorsCount;
  const water = inputs.water ?? { borewell: false, sump: false, septic: false, rainwater: false };
  const site = inputs.site ?? { roadAccess: 'good' as const, water: 'municipal' as const, power: 'available' as const };

  /* ── adjustments ── */
  const pending = new Map<string, Adjustment>();
  for (const a of inputs.adjustments ?? []) pending.set(a.line_key, a);
  const ignored: IgnoredAdjustment[] = [];
  let applied = 0;

  /** A seed rate at a tier (default: the estimate's tier), city-indexed, with its verification flag recorded. */
  const seed = (key: keyof typeof RATES, t: Tier = tier): { rate: number; basis: string; nv: boolean } => {
    const tr = RATES[key] as TierRate;
    if (tr.needs_verification) flags.add(`${String(key).replace(/_/g, ' ')} — ${tr.basis}`);
    return { rate: tr[t] * idx, basis: tr.basis, nv: tr.needs_verification };
  };
  /** Record a line. Applies a pending adjustment (clamped, flagged, never on a store price) before the amount is fixed. */
  const push = (l: Omit<LineItem, 'amount'>) => {
    let qtyRaw = l.qty,
      rateRaw = l.rate;
    let line: Omit<LineItem, 'amount'> = { ...l, qty: Math.round(l.qty * 1000) / 1000, rate: Math.round(l.rate * 100) / 100 };
    const a = pending.get(l.key);
    if (a) {
      pending.delete(l.key);
      if (l.rateSource === 'store') ignored.push({ line_key: l.key, reason: 'store_priced', provenance: a.provenance });
      else {
        const field: 'rate' | 'qty' = a.rate !== undefined ? 'rate' : 'qty';
        const from = field === 'rate' ? line.rate : line.qty;
        const want = (field === 'rate' ? a.rate : a.qty) as number;
        const lo = from * (1 - ADJ_CLAMP),
          hi = from * (1 + ADJ_CLAMP);
        const toRaw = clamp(want, lo, hi);
        const to = field === 'rate' ? Math.round(toRaw * 100) / 100 : Math.round(toRaw * 1000) / 1000;
        const capped = to !== (field === 'rate' ? Math.round(want * 100) / 100 : Math.round(want * 1000) / 1000);
        if (field === 'rate') rateRaw = to;
        else qtyRaw = to;
        const who = a.provenance === 'ai_suggested' ? 'AI-suggested' : 'manual';
        const what = field === 'rate' ? 'rate' : 'quantity';
        line = {
          ...line,
          [field]: to,
          needsVerification: true,
          adjusted: { field, from, to, provenance: a.provenance, reason: a.reason, source_url: a.source_url, capped },
          note: `${line.note ? `${line.note} · ` : ''}${what} ${from} → ${to}${capped ? ' (capped at ±35 %)' : ''}${a.reason ? ` · ${a.reason}` : ''}`,
        };
        flags.add(`${l.label}: ${who} ${what} applied (unverified)`);
        applied += 1;
      }
    }
    lines.push({ ...line, amount: R(qtyRaw * rateRaw) });
  };
  const seedLine = (
    key: string,
    label: string,
    ledger: Ledger,
    group: GroupKey,
    phase: Phase,
    qty: number,
    unit: string,
    rateKey: keyof typeof RATES,
    note?: string,
    t: Tier = tier,
  ) => {
    const s = seed(rateKey, t);
    push({ key, label, ledger, group, phase, qty, unit, rate: s.rate, rateSource: 'seed', needsVerification: s.nv, note: note ?? s.basis });
  };
  /** A product line priced by the store when the mapped SKU exists, else by the seed rate. */
  const productLine = (
    key: string,
    label: string,
    ledger: Ledger,
    group: GroupKey,
    phase: Phase,
    qty: number,
    unit: string,
    mapKey: keyof typeof CATALOG_MAP,
    seedKey: keyof typeof RATES,
    priceOf: (s: CatalogPrice) => number | null,
  ) => {
    const sku = resolveStoreSku(CATALOG_MAP[mapKey], tier, catalog);
    const price = sku ? priceOf(sku) : null;
    if (sku && price !== null && price > 0) {
      push({
        key,
        label,
        ledger,
        group,
        phase,
        qty,
        unit,
        rate: price,
        ...storePriced(sku),
      });
      if (sku.price_provenance === 'estimated') flags.add(`${label}: store price for ${sku.sku_code} is an estimate`);
    } else seedLine(key, label, ledger, group, phase, qty, unit, seedKey);
  };
  const amountOf = (key: string) => lines.find((l) => l.key === key)?.amount ?? 0;

  /* ── structure ledger ─────────────────────────────────────────────────── */
  productLine(
    'cement',
    'Cement',
    'structure',
    'cement',
    'structural',
    bua * q.cement_bags_per_sqft[inputs.constructionType],
    'bag',
    'cement',
    'seed_cement_per_bag',
    (s) => s.selling_price,
  );
  seedLine('steel', 'TMT steel', 'structure', 'steel', 'structural', bua * q.steel_kg_per_sqft[inputs.constructionType] * steelF, 'kg', 'steel_per_kg');
  seedLine('bricks', 'Bricks', 'structure', 'bricks', 'brickwork', bua * q.bricks_per_sqft * wallF, 'no', 'brick_per_no');
  seedLine('sand', 'Sand', 'structure', 'sand_aggregate', 'structural', bua * q.sand_cft_per_sqft, 'cft', 'sand_per_cft');
  seedLine('aggregate', 'Aggregate (20 mm)', 'structure', 'sand_aggregate', 'structural', bua * q.aggregate_cft_per_sqft, 'cft', 'aggregate_per_cft');
  seedLine('formwork', 'Shuttering & formwork', 'structure', 'labour', 'structural', bua * q.formwork_sqft_per_sqft, 'sqft', 'formwork_per_sqft');
  // Civil labour = the standard 35–40 % share of civil (material + labour) cost, shown as its own line.
  // Read from the recorded lines, so an adjusted material amount carries through deterministically.
  const civilMaterials = lines.filter((l) => ['cement', 'steel', 'bricks', 'sand', 'aggregate'].includes(l.key)).reduce((a, l) => a + l.amount, 0);
  const share = RATES.labour_share_of_civil.value;
  flags.add(`civil labour share ${Math.round(share * 100)} % — ${RATES.labour_share_of_civil.basis}`);
  push({
    key: 'civil_labour',
    label: 'Civil labour (mason, bar-bending, concreting)',
    ledger: 'structure',
    group: 'labour',
    phase: 'structural',
    qty: 1,
    unit: 'lot',
    rate: civilMaterials * (share / (1 - share)),
    rateSource: 'seed',
    needsVerification: true,
    note: `${Math.round(share * 100)} % of civil cost (materials + labour)`,
  });

  // Foundation premium on the footing share of civil materials (isolated footings = the thumb rules' baseline, no line).
  const foundation = inputs.foundation ?? (inputs.soil ? q.soil_default_foundation[inputs.soil] : 'isolated_footing');
  if (inputs.soil)
    flags.add(
      `soil ${inputs.soil.replace(/_/g, ' ')} → ${FOUNDATION_LABEL[foundation].toLowerCase()} assumed${inputs.soil === 'black_cotton' ? ' (black cotton soil needs a soil test; under-reamed piles are common)' : ''} — confirm with a soil report`,
    );
  const fFactor = q.foundation_factor[foundation];
  if (fFactor > 1) {
    flags.add(`${FOUNDATION_LABEL[foundation].toLowerCase()} premium ${Math.round((fFactor - 1) * 100)} % of the footing share — thumb factor, not a design`);
    push({
      key: 'foundation',
      label: `${FOUNDATION_LABEL[foundation]} foundation — premium over isolated footings`,
      ledger: 'structure',
      group: 'foundation',
      phase: 'footing',
      qty: 1,
      unit: 'lot',
      rate: civilMaterials * STRUCTURAL_SPLIT.footing * (fFactor - 1),
      rateSource: 'seed',
      needsVerification: true,
      note: `civil materials × ${STRUCTURAL_SPLIT.footing} footing share × ${(fFactor - 1).toFixed(2)} (material + labour premium)`,
    });
  }

  // Site conditions: a logistics overhead on civil cost (materials + civil labour).
  const siteFactor = q.site_factor.road[site.roadAccess] + q.site_factor.water[site.water] + q.site_factor.power[site.power];
  if (siteFactor > 0) {
    const parts = [
      site.roadAccess !== 'good' ? (site.roadAccess === 'narrow' ? 'narrow road' : 'no truck access') : null,
      site.water === 'tanker' ? 'tanker water' : null,
      site.power === 'temporary' ? 'temporary power' : null,
    ].filter(Boolean);
    flags.add(`site conditions ${Math.round(siteFactor * 1000) / 10} % of civil cost (${parts.join(', ')}) — thumb overhead`);
    push({
      key: 'site_conditions',
      label: `Site conditions (${parts.join(', ')})`,
      ledger: 'structure',
      group: 'labour',
      phase: 'structural',
      qty: 1,
      unit: 'lot',
      rate: (civilMaterials + amountOf('civil_labour')) * siteFactor,
      rateSource: 'seed',
      needsVerification: true,
      note: `${Math.round(siteFactor * 1000) / 10} % of civil materials + labour: extra handling, smaller loads, tanker curing, DG hire`,
    });
  }

  seedLine('plaster', 'Cement plaster', 'structure', 'finishes', 'brickwork', bua * q.plaster_sqft_per_sqft * wallF, 'sqft', 'plaster_per_sqft');
  // Exterior finish: paint everywhere, or cladding / stone on a share of the façade with paint on the rest.
  const extFace = bua * q.ext_paint_sqft_per_sqft * wallF;
  const ext = inputs.exteriorFinish ?? 'paint';
  const cladShare = ext === 'paint' ? 0 : q.cladding_share_of_facade;
  seedLine('ext_paint', 'Exterior paint', 'structure', 'finishes', 'brickwork', extFace * (1 - cladShare), 'sqft', 'ext_paint_per_sqft');
  if (ext === 'cladding')
    seedLine(
      'cladding',
      `Exterior cladding (ACP / HPL, ${Math.round(cladShare * 100)} % of the façade)`,
      'structure',
      'finishes',
      'brickwork',
      extFace * cladShare,
      'sqft',
      'cladding_per_sqft',
    );
  if (ext === 'stone')
    seedLine(
      'cladding',
      `Stone cladding (${Math.round(cladShare * 100)} % of the façade)`,
      'structure',
      'finishes',
      'brickwork',
      extFace * cladShare,
      'sqft',
      'stone_cladding_per_sqft',
    );
  seedLine(
    'waterproofing',
    'Waterproofing (roof & wet areas)',
    'structure',
    'finishes',
    'brickwork',
    bua * q.waterproof_sqft_per_sqft,
    'sqft',
    'waterproofing_per_sqft',
  );
  if ((inputs.roof ?? 'flat_rcc') === 'sloped')
    seedLine(
      'sloped_roof',
      'Sloped roof (tiles / sheet on the RCC roof) — premium over flat',
      'structure',
      'roof',
      'structural',
      roofSqft,
      'sqft',
      'sloped_roof_per_sqft',
    );
  productLine(
    'epoxy',
    'Epoxy grout & anchoring kits',
    'structure',
    'finishes',
    'brickwork',
    Math.ceil(bua / q.sqft_per_epoxy_kit),
    'kit',
    'epoxy',
    'seed_epoxy_kit_each',
    (s) => s.selling_price,
  );
  // Plumbing: one spread line, or rough-in + itemised fixture sets when the rooms are known.
  if (rooms) {
    seedLine(
      'plumbing',
      'Plumbing rough-in & drainage',
      'structure',
      'services',
      'services',
      bua,
      'sqft',
      'plumbing_roughin_per_sqft_bua',
      undefined,
      plumbTier,
    );
    if (rooms.bathrooms > 0)
      seedLine(
        'bathroom_fixtures',
        'Bathroom fixtures (EWC, basin, shower, taps)',
        'structure',
        'services',
        'services',
        rooms.bathrooms,
        'set',
        'bathroom_fixture_set',
        undefined,
        plumbTier,
      );
    if (rooms.kitchens > 0)
      seedLine('kitchen_sink', 'Kitchen sink & tap', 'structure', 'services', 'services', rooms.kitchens, 'set', 'kitchen_sink_set', undefined, plumbTier);
  } else seedLine('plumbing', 'Plumbing & sanitary', 'structure', 'services', 'services', bua, 'sqft', 'plumbing_per_sqft_bua', undefined, plumbTier);
  seedLine('wiring', 'Electrical wiring & distribution', 'structure', 'services', 'services', bua, 'sqft', 'electrical_wiring_per_sqft_bua');
  seedLine(
    'window_frames',
    'Window frames & hardware',
    'structure',
    'doors_windows',
    'services',
    bua * q.window_glass_sqft_per_sqft,
    'sqft',
    'window_frame_per_sqft',
  );
  productLine(
    'window_glass',
    'Window glass',
    'structure',
    'doors_windows',
    'services',
    bua * q.window_glass_sqft_per_sqft,
    'sqft',
    'glass',
    'seed_glass_per_sqft',
    (s) => perSqft(s),
  );
  // Boundary wall: explicit length / height / gate, or the legacy `compoundWall` alias (perimeter × 5 ft, no gate).
  const wall = inputs.boundaryWall ?? (inputs.compoundWall ? { lengthFt: null, heightFt: q.compound_wall_height_ft, gate: 'none' as const } : null);
  if (wall) {
    const wallH = clamp(wall.heightFt || q.compound_wall_height_ft, 3, 10);
    const s = seed('compound_wall_per_rft');
    push({
      key: 'compound_wall',
      label: `Compound wall (${wallH} ft)`,
      ledger: 'structure',
      group: 'external_works',
      phase: 'services',
      qty: wall.lengthFt ?? g.perimeterFt,
      unit: 'rft',
      rate: s.rate * (wallH / q.boundary_wall_ref_height_ft),
      rateSource: 'seed',
      needsVerification: s.nv,
      note: wallH === q.boundary_wall_ref_height_ft ? s.basis : `${s.basis} · scaled × ${wallH}/${q.boundary_wall_ref_height_ft} for height`,
    });
    if (wall.gate !== 'none')
      seedLine(
        'gate',
        `Main gate (${GATE_LABEL[wall.gate].replace(/ gate$/i, '')})`,
        'structure',
        'external_works',
        'services',
        1,
        'gate',
        wall.gate === 'ms' ? 'gate_ms_each' : wall.gate === 'ss' ? 'gate_ss_each' : 'gate_automatic_each',
      );
  }
  if (inputs.parking) seedLine('parking', 'Car parking porch', 'structure', 'services', 'structural', q.parking_sqft, 'sqft', 'parking_per_sqft');
  if ((inputs.balconyUtilitySqft ?? 0) > 0)
    seedLine('balcony', 'Balcony & utility slabs', 'structure', 'roof', 'structural', inputs.balconyUtilitySqft as number, 'sqft', 'balcony_per_sqft');
  if (inputs.staircase && inputs.floors > 0) {
    const st = inputs.staircase;
    seedLine(
      'staircase',
      `Staircase (${STAIRCASE_LABEL[st]})`,
      'structure',
      'lift_stairs',
      st === 'steel' ? 'structural' : 'finishing',
      inputs.floors,
      'floor',
      st === 'rcc_plain' ? 'staircase_rcc_plain_per_floor' : st === 'rcc_granite' ? 'staircase_rcc_granite_per_floor' : 'staircase_steel_per_floor',
    );
  }
  if (inputs.lift && inputs.floors >= q.lift_min_floors) {
    seedLine('lift', 'Home lift (6 passenger)', 'structure', 'lift_stairs', 'services', 1, 'lift', 'lift_base');
    seedLine('lift_stops', 'Lift landings (doors, shaft, wiring)', 'structure', 'lift_stairs', 'services', g.floorsCount, 'stop', 'lift_per_stop');
  }
  if (water.borewell) seedLine('borewell', 'Borewell with submersible pump', 'structure', 'external_works', 'services', 1, 'bore', 'borewell_each');
  if (water.sump)
    seedLine('sump', `Underground sump (${q.sump_kl_default} kL)`, 'structure', 'external_works', 'services', q.sump_kl_default, 'kL', 'sump_per_kl');
  if (water.septic) seedLine('septic', 'Septic tank & soak pit', 'structure', 'external_works', 'services', 1, 'tank', 'septic_tank_each');
  if (water.rainwater) seedLine('rainwater', 'Rainwater harvesting', 'structure', 'external_works', 'services', 1, 'system', 'rainwater_each');
  if ((inputs.landscapingSqft ?? 0) > 0)
    seedLine(
      'landscaping',
      'Landscaping & paving',
      'structure',
      'external_works',
      'finishing',
      inputs.landscapingSqft as number,
      'sqft',
      'landscaping_per_sqft',
    );

  /* ── interior ledger ──────────────────────────────────────────────────── */
  seedLine(
    'doors',
    'Doors (frame + shutter + hardware)',
    'interior',
    'doors_windows',
    'finishing',
    roomCount,
    'door',
    'door_each',
    rooms ? `${rooms.bedrooms} bedrooms + ${rooms.bathrooms} bathrooms + ${rooms.kitchens} kitchens + ${q.doors_extra} (main, utility)` : undefined,
  );
  const floorTileSqft = bua * q.floor_tile_sqft_per_sqft;
  const wallTileSqft = rooms
    ? rooms.bathrooms * q.wall_tile_sqft_per_bathroom + rooms.kitchens * q.wall_tile_sqft_per_kitchen
    : bua * q.wall_tile_sqft_per_sqft;
  productLine('floor_tiles', 'Floor tiles', 'interior', 'flooring', 'finishing', floorTileSqft, 'sqft', 'tiles', 'seed_tile_per_sqft', (s) => perSqft(s));
  productLine('wall_tiles', 'Kitchen & bathroom wall tiles', 'interior', 'flooring', 'finishing', wallTileSqft, 'sqft', 'tiles', 'seed_tile_per_sqft', (s) =>
    perSqft(s),
  );
  seedLine('tile_laying', 'Tile laying, adhesive & grout', 'interior', 'flooring', 'finishing', floorTileSqft + wallTileSqft, 'sqft', 'tile_laying_per_sqft');
  seedLine(
    'int_paint',
    'Interior putty, primer & paint',
    'interior',
    'finishes',
    'finishing',
    bua * q.int_paint_sqft_per_sqft * wallF,
    'sqft',
    'int_paint_per_sqft',
  );
  if (inputs.electricalPointsPerRoom)
    seedLine(
      'electrical_points',
      `Electrical points (${inputs.electricalPointsPerRoom} per room × ${roomCount} rooms)`,
      'interior',
      'services',
      'finishing',
      roomCount * inputs.electricalPointsPerRoom,
      'point',
      'electrical_point_each',
    );
  else seedLine('fittings', 'Switches, sockets, fans & light points', 'interior', 'services', 'finishing', bua, 'sqft', 'electrical_fittings_per_sqft_bua');
  productLine(
    'bulbs',
    'LED bulbs',
    'interior',
    'services',
    'finishing',
    Math.ceil(bua / q.sqft_per_bulb),
    'piece',
    'bulbs',
    'seed_bulb_each',
    (s) => s.selling_price,
  );
  const fcShare = inputs.interior?.falseCeilingShare ?? q.false_ceiling_share[tier];
  if (fcShare > 0) seedLine('false_ceiling', 'False ceiling', 'interior', 'interiors', 'finishing', bua * fcShare, 'sqft', 'false_ceiling_per_sqft');
  // Interiors: the v1 spread line, or itemised kitchen + wardrobes when the package is chosen.
  if (!inputs.interior) seedLine('modular', 'Modular kitchen & wardrobes', 'interior', 'interiors', 'finishing', bua, 'sqft', 'modular_per_sqft_bua');
  else {
    const kitchens = rooms ? rooms.kitchens : 1;
    const bedrooms = rooms ? rooms.bedrooms : Math.ceil(bua / q.sqft_per_bedroom);
    if (inputs.interior.modularKitchen && kitchens > 0)
      seedLine('modular_kitchen', 'Modular kitchen', 'interior', 'interiors', 'finishing', kitchens, 'kitchen', 'modular_kitchen_each');
    if (inputs.interior.wardrobes && bedrooms > 0)
      seedLine(
        'wardrobes',
        `Wardrobes (${bedrooms} bedrooms × ${q.wardrobe_rft_per_bedroom} rft)`,
        'interior',
        'interiors',
        'finishing',
        bedrooms * q.wardrobe_rft_per_bedroom,
        'rft',
        'wardrobe_per_rft',
        rooms ? undefined : `${bedrooms} bedrooms assumed at one per ${q.sqft_per_bedroom} sqft BUA — enter room counts to correct`,
      );
  }

  /* ── add-ons ─────────────────────────────────────────────────────────── */
  const solarOn = inputs.addons.solar || (inputs.solarKw ?? 0) > 0;
  if (solarOn) {
    const roofMaxKw = Math.max(1, Math.floor(roofSqft / q.solar_sqft_per_kw));
    const kw =
      inputs.solarKw && inputs.solarKw > 0 ? Math.max(1, Math.min(roofMaxKw, Math.round(inputs.solarKw))) : Math.max(1, Math.min(q.solar_kw[tier], roofMaxKw));
    if (inputs.solarKw && Math.round(inputs.solarKw) > roofMaxKw)
      flags.add(`solar ${inputs.solarKw} kW asked, roof carries ~${roofMaxKw} kW at ${q.solar_sqft_per_kw} sqft/kW — sized to the roof`);
    const sku = resolveStoreSku(CATALOG_MAP.solar, tier, catalog);
    const wp = sku?.wp && sku.wp > 0 ? sku.wp : 550;
    const panels = Math.ceil((kw * 1000) / wp);
    const label = `Solar panels (${kw} kW, ${wp} Wp each)`;
    if (sku?.selling_price)
      push({
        key: 'solar_panels',
        label,
        ledger: 'structure',
        group: 'addons',
        phase: 'services',
        qty: panels,
        unit: 'panel',
        rate: sku.selling_price,
        ...storePriced(sku),
      });
    else {
      const s = seed('seed_solar_per_wp');
      push({
        key: 'solar_panels',
        label,
        ledger: 'structure',
        group: 'addons',
        phase: 'services',
        qty: panels,
        unit: 'panel',
        rate: s.rate * wp,
        rateSource: 'seed',
        needsVerification: true,
        note: s.basis,
      });
    }
    seedLine('solar_bos', `Solar inverter, structure & net-meter (${kw} kW)`, 'structure', 'addons', 'services', kw, 'kW', 'solar_bos_per_kw');
  }
  if (inputs.addons.cctv) {
    const n = q.cctv_base + q.cctv_per_floor * g.floorsCount;
    productLine('cctv_cameras', 'CCTV cameras', 'structure', 'addons', 'services', n, 'camera', 'cctv', 'seed_cctv_camera_each', (s) => s.selling_price);
    seedLine('cctv_nvr', 'NVR, storage & cabling', 'structure', 'addons', 'services', 1, 'set', 'cctv_nvr_cabling');
  }
  if (inputs.addons.fireSafety) {
    const n = q.extinguisher_base + q.extinguisher_per_floor * g.floorsCount;
    productLine('extinguishers', 'Fire extinguishers', 'structure', 'addons', 'services', n, 'piece', 'fire', 'seed_extinguisher_each', (s) => s.selling_price);
  }

  /* ── store picks ("Add to Estimate") ───────────────────────────────────── */
  for (const p of inputs.picks ?? []) {
    const s = catalog[p.sku_code];
    if (!s || s.selling_price === null) continue;
    push({
      key: `pick:${p.sku_code}`,
      label: `${s.brand} ${s.name}`,
      ledger: 'interior',
      group: 'picks',
      phase: 'finishing',
      qty: p.qty,
      unit: s.unit,
      rate: s.selling_price,
      ...storePriced(s, 'added from the store'),
    });
  }
  // Adjustments that named a line this estimate does not have.
  for (const a of pending.values()) ignored.push({ line_key: a.line_key, reason: 'no_such_line', provenance: a.provenance });

  /* ── totals ───────────────────────────────────────────────────────────── */
  const sum = (f: (l: LineItem) => boolean) => lines.filter(f).reduce((a, l) => a + l.amount, 0);
  const structure = sum((l) => l.ledger === 'structure');
  const interior = sum((l) => l.ledger === 'interior');
  const labour = sum((l) => l.key === 'civil_labour' || l.key === 'formwork' || l.key === 'site_conditions');
  const grandTotal = structure + interior;
  const groups: GroupAmount[] = GROUPS.map((gr) => ({ key: gr.key, label: gr.label, amount: sum((l) => l.group === gr.key), share: 0 }))
    .filter((x) => x.amount > 0)
    .map((x) => ({ ...x, share: grandTotal ? x.amount / grandTotal : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const structural = sum((l) => l.phase === 'structural');
  const phases: PhaseAmount[] = [
    { key: 'footing' as const, label: PHASE_LABELS.footing, amount: R(structural * STRUCTURAL_SPLIT.footing) + sum((l) => l.phase === 'footing'), share: 0 },
    { key: 'plinth' as const, label: PHASE_LABELS.plinth, amount: R(structural * STRUCTURAL_SPLIT.plinth), share: 0 },
    ...Array.from({ length: g.floorsCount }, (_, i) => ({
      key: `slab_${i}` as const,
      label: slabLabel(i, inputs.floors),
      amount: R((structural * STRUCTURAL_SPLIT.slabs) / g.floorsCount),
      share: 0,
    })),
    { key: 'brickwork' as const, label: PHASE_LABELS.brickwork, amount: sum((l) => l.phase === 'brickwork'), share: 0 },
    { key: 'services' as const, label: PHASE_LABELS.services, amount: sum((l) => l.phase === 'services'), share: 0 },
    { key: 'finishing' as const, label: PHASE_LABELS.finishing, amount: sum((l) => l.phase === 'finishing'), share: 0 },
  ].map((p) => ({ ...p, share: grandTotal ? p.amount / grandTotal : 0 }));

  const tiers =
    (opts.tiers ?? true)
      ? (Object.fromEntries(TIERS.map((t) => [t, t === tier ? grandTotal : estimate({ ...inputs, tier: t }, catalog, { tiers: false }).grandTotal])) as Record<
          Tier,
          number
        >)
      : ({ basic: 0, medium: 0, premium: 0, [tier]: grandTotal } as Record<Tier, number>);

  return {
    version: RATES_VERSION,
    inputs,
    derived: {
      plotAreaSqft: g.plotAreaSqft,
      footprintSqft: g.footprintSqft,
      builtUpSqft: bua,
      floorsLabel: g.floorsLabel,
      perimeterFt: g.perimeterFt,
      cityIndex: idx,
      cityName: g.cityName,
      stateName: g.stateName,
      fromDrawing: g.fromDrawing,
    },
    lines,
    ledgers: {
      structure: { subtotal: structure, material: structure - labour, labour, labourShare: civilMaterials + labour ? labour / (civilMaterials + labour) : 0 },
      interior: { subtotal: interior },
    },
    grandTotal,
    perSqft: bua ? grandTotal / bua : 0,
    groups,
    phases,
    tiers,
    accuracy: {
      pct: 12,
      note: `Estimate ±12% — thumb-rule quantities at ${g.cityName} ${TIER_LABEL[tier]} rates, rates ${RATES_VERSION}${applied ? ` · ${applied} adjustment${applied === 1 ? '' : 's'} applied` : ''}`,
    },
    needsVerification: [...flags].sort(),
    storeLinks: lines
      .filter((l) => l.sku_code)
      .map((l) => ({
        key: l.key,
        sku_code: l.sku_code as string,
        name: l.skuName ?? l.label,
        brand: l.skuName?.split(' ')[0] ?? '',
        provenance: l.priceProvenance ?? 'store',
      })),
    adjustments: { applied, ignored },
  };
}
