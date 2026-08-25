/**
 * Tier rate card — ₹ at Hyderabad (index 1.00), Aug 2026. Basic / Medium / Premium switch the
 * whole card. These are thumb-rule market rates (dealer counter + labour contractor quotes typical
 * of Hyderabad), structured so real quotes can replace them line by line. Every rate carries
 * `needs_verification: true` until a quote replaces it; product lines that resolve to a store
 * SKU use the store price instead and inherit the store's provenance.
 */
import type { Tier } from '../../src/types';

export interface TierRate {
  basic: number;
  medium: number;
  premium: number;
  unit: string;
  basis: string;
  needs_verification: boolean;
}
const r = (basic: number, medium: number, premium: number, unit: string, basis: string, needs_verification = true): TierRate => ({
  basic,
  medium,
  premium,
  unit,
  basis,
  needs_verification,
});

export const RATES = {
  // ── structure: materials the store does not (yet) sell ──────────────────────
  steel_per_kg: r(62, 68, 74, '₹/kg', 'Fe500 TMT / Fe500D / Fe550D branded, Hyderabad dealer Aug 2026'),
  brick_per_no: r(8.5, 10, 11.5, '₹/no', 'fly-ash brick / red clay table-moulded / wire-cut'),
  sand_per_cft: r(55, 65, 75, '₹/cft', 'M-sand / river sand delivered, Hyderabad'),
  aggregate_per_cft: r(45, 50, 55, '₹/cft', '20 mm crushed aggregate delivered'),
  formwork_per_sqft: r(45, 55, 65, '₹/sqft', 'shuttering hire + fixing labour per slab sqft'),
  plaster_per_sqft: r(22, 28, 34, '₹/sqft', 'cement plaster 12 mm incl. labour, per plastered sqft'),
  ext_paint_per_sqft: r(20, 28, 40, '₹/sqft', 'exterior emulsion / weather-proof, two coats + primer'),
  waterproofing_per_sqft: r(45, 60, 80, '₹/sqft', 'polymer / acrylic membrane on roof & wet areas'),
  plumbing_per_sqft_bua: r(95, 140, 200, '₹/sqft', 'CPVC/UPVC rough-in + sanitary ware + fittings, per sqft BUA'),
  electrical_wiring_per_sqft_bua: r(65, 90, 125, '₹/sqft', 'FR copper wiring, conduits, DB & MCBs, per sqft BUA'),
  window_frame_per_sqft: r(350, 520, 800, '₹/sqft', 'aluminium / UPVC / UPVC-premium frame + hardware, per sqft of window (glass separate)'),
  compound_wall_per_rft: r(900, 1100, 1400, '₹/rft', '5 ft brick wall on strip footing with plaster, per running ft'),
  parking_per_sqft: r(1100, 1300, 1500, '₹/sqft', 'covered porch slab on columns, per sqft'),
  /** Labour as a share of the civil (structure) total — 35–40 % is the standard split. */
  labour_share_of_civil: { value: 0.38, basis: 'civil labour ≈ 35–40 % of structure cost (materials + labour)', needs_verification: true },

  // ── interior ──────────────────────────────────────────────────────────────
  door_each: r(6500, 12000, 22000, '₹/door', 'flush door + frame / laminated + hardware / teak-finish + designer hardware'),
  tile_laying_per_sqft: r(28, 32, 40, '₹/sqft', 'laying labour + adhesive/grout, per sqft laid'),
  int_paint_per_sqft: r(14, 20, 30, '₹/sqft', 'putty + primer + emulsion, per painted sqft'),
  electrical_fittings_per_sqft_bua: r(30, 50, 85, '₹/sqft', 'switches, sockets, fan & light points, fixtures (bulbs separate)'),
  false_ceiling_per_sqft: r(0, 85, 110, '₹/sqft', 'gypsum false ceiling, per sqft of ceiling covered'),
  modular_per_sqft_bua: r(40, 120, 260, '₹/sqft', 'modular kitchen + wardrobes, spread per sqft BUA'),

  // ── add-ons ───────────────────────────────────────────────────────────────
  solar_bos_per_kw: r(28000, 30000, 32000, '₹/kW', 'inverter, structure, cabling, net-meter work per kW (panels separate)'),
  cctv_nvr_cabling: r(12000, 18000, 28000, '₹/set', 'NVR/DVR, HDD, cabling & installation (cameras separate)'),

  // ── seed fallbacks for product lines when a store price is unavailable ───
  seed_cement_per_bag: r(380, 400, 430, '₹/bag', 'PPC / PPC premium / OPC 53 50 kg, Hyderabad dealer'),
  seed_tile_per_sqft: r(38, 55, 95, '₹/sqft', 'ceramic / GVT 600×600 / PGVT 600×1200'),
  seed_bulb_each: r(70, 110, 160, '₹/piece', '9 W B22 LED bulb'),
  seed_glass_per_sqft: r(95, 140, 220, '₹/sqft', '5 mm clear float / 6 mm toughened / 6 mm solar-control toughened'),
  seed_solar_per_wp: r(24, 26, 28, '₹/Wp', 'mono PERC / TOPCon / bifacial TOPCon module only'),
  seed_cctv_camera_each: r(1800, 2800, 4500, '₹/camera', '2 MP HD bullet / 2 MP IP dome / 4 MP IP colour-night'),
  seed_extinguisher_each: r(2200, 3500, 5500, '₹/piece', '4 kg ABC / 6 kg ABC / 6 kg ABC MAP-90'),
  seed_epoxy_kit_each: r(1800, 2200, 2600, '₹/kit', 'epoxy grout / anchoring kit'),

  // ── v2: rooms-driven interior & plumbing (replace the spread lines when rooms are itemised) ──
  /** Replaces `plumbing_per_sqft_bua` when bathrooms are itemised — the sanitary ware moves to the fixture sets. */
  plumbing_roughin_per_sqft_bua: r(60, 85, 120, '₹/sqft', 'CPVC/UPVC rough-in, drainage & fittings only, per sqft BUA (sanitary ware itemised per bathroom)'),
  bathroom_fixture_set: r(
    18000,
    32000,
    65000,
    '₹/set',
    'per bathroom: EWC, basin, shower/mixer, taps & accessories — Parryware/Hindware basic / Jaquar mid / Kohler-Grohe premium',
  ),
  kitchen_sink_set: r(4500, 9000, 18000, '₹/set', 'per kitchen: SS sink + tap + connections / quartz sink + pull-out tap / premium workstation sink'),
  wardrobe_per_rft: r(9000, 14000, 22000, '₹/rft', '7 ft high plywood wardrobe per running ft: laminate / laminate + loft / veneer-acrylic, hardware incl.'),
  modular_kitchen_each: r(
    90000,
    180000,
    350000,
    '₹/kitchen',
    'L-shaped modular kitchen 8–10 ft run: laminate / acrylic / PU finish, hardware & countertop incl.',
  ),
  electrical_point_each: r(
    650,
    950,
    1500,
    '₹/point',
    'per wiring point incl. switch/socket module, labour and a pro-rata fan & fixture allowance (bulbs separate)',
  ),

  // ── v2: structure, roof, exterior ─────────────────────────────────────────
  sloped_roof_per_sqft: r(
    180,
    260,
    380,
    '₹/sqft',
    'sloped roof premium over the flat RCC slab: colour-coated sheet / clay tiles on steel purlins / Mangalore tiles on sloped RCC, per sqft of roof',
  ),
  cladding_per_sqft: r(
    280,
    380,
    520,
    '₹/sqft',
    'ACP / HPL / WPC exterior cladding on frame incl. fixing, per sqft of façade clad (replaces paint on that share)',
  ),
  stone_cladding_per_sqft: r(
    350,
    480,
    700,
    '₹/sqft',
    'natural stone (sadarahalli / kota / slate) exterior cladding incl. fixing, per sqft clad (replaces paint on that share)',
  ),
  balcony_per_sqft: r(900, 1200, 1600, '₹/sqft', 'cantilever balcony / utility slab with parapet, railing & flooring, per sqft'),

  // ── v2: staircase & lift ──────────────────────────────────────────────────
  staircase_rcc_plain_per_floor: r(
    25000,
    35000,
    48000,
    '₹/floor',
    'MS railing + kota / cement tread finish on the RCC stair already in the structure thumb rules, per floor',
  ),
  staircase_rcc_granite_per_floor: r(60000, 85000, 120000, '₹/floor', 'granite treads & risers + SS/MS railing on the RCC stair, per floor'),
  staircase_steel_per_floor: r(55000, 80000, 115000, '₹/floor', 'fabricated MS/SS staircase with wooden / granite treads, per floor (no RCC credit taken)'),
  lift_base: r(900000, 1250000, 1800000, '₹/lift', '6-passenger home lift incl. installation: hydraulic / MRL gearless / premium cabin & finishes'),
  lift_per_stop: r(60000, 80000, 110000, '₹/stop', 'per landing: landing doors, shaft work, wiring & commissioning'),

  // ── v2: water & external works ────────────────────────────────────────────
  borewell_each: r(85000, 120000, 180000, '₹/bore', '6.5 in bore to ~300 ft with casing, 1 HP submersible pump, cabling & starter — depth varies by site'),
  sump_per_kl: r(9000, 11000, 14000, '₹/kL', 'RCC underground sump incl. excavation, waterproofing & cover, per kL'),
  septic_tank_each: r(55000, 75000, 110000, '₹/tank', 'two-chamber RCC / brick septic tank + soak pit for a 5–8 user house'),
  rainwater_each: r(25000, 40000, 65000, '₹/system', 'rooftop rainwater harvesting: downtake pipes, first-flush filter & recharge pit'),
  gate_ms_each: r(25000, 40000, 60000, '₹/gate', 'MS fabricated swing gate 10–12 ft incl. painting & fixing'),
  gate_ss_each: r(60000, 85000, 120000, '₹/gate', 'SS 304 swing / sliding gate 10–12 ft'),
  gate_automatic_each: r(110000, 150000, 220000, '₹/gate', 'MS/SS sliding gate with motor, remote & safety sensors'),
  landscaping_per_sqft: r(60, 110, 200, '₹/sqft', 'open-area treatment: pavers / lawn + soil prep + drip / stone paving + planters, per sqft'),
} as const;

export type RateKey = keyof typeof RATES;
export function rate(key: Exclude<RateKey, 'labour_share_of_civil'>, tier: Tier): number {
  return (RATES[key] as TierRate)[tier];
}
