/**
 * Quantity model — material per sqft of built-up area (BUA), standard Indian thumb rules for a
 * residential RCC-framed / load-bearing house. Every value is a published rule of thumb, not a
 * BOQ: cement ≈ 0.4 bags/sqft, steel ≈ 3.5–4 kg/sqft (framed), bricks ≈ 8 nos/sqft,
 * sand ≈ 1.2 cft/sqft, aggregate ≈ 0.9 cft/sqft (IS 10067-style coefficients as used by
 * PWD/CPWD thumb estimates). Surface multipliers are geometric (wall area ≈ 3.2 × floor area
 * for a 10 ft ceiling with both faces counted; windows ≈ 12 % of BUA for NBC daylight rules).
 *
 * v2 rules (rooms, floor height, foundation, site) are thumb factors too — each one is named
 * here so the engine never carries a magic number, and each is a prefill the buyer can override.
 */
import type { ConstructionType, FoundationType, RoadAccess, SitePower, SiteWater, SoilType, Tier } from '../../src/types';

export const QUANTITIES = {
  cement_bags_per_sqft: { rcc_framed: 0.4, load_bearing: 0.34 } as Record<ConstructionType, number>,
  steel_kg_per_sqft: { rcc_framed: 3.5, load_bearing: 1.8 } as Record<ConstructionType, number>,
  bricks_per_sqft: 8,
  sand_cft_per_sqft: 1.2,
  aggregate_cft_per_sqft: 0.9,
  /** Shuttering area ≈ the slab area once over. */
  formwork_sqft_per_sqft: 1.0,
  /** Plastered surface: both wall faces + ceiling. */
  plaster_sqft_per_sqft: 2.4,
  /** Exterior wall face exposed, per sqft BUA. */
  ext_paint_sqft_per_sqft: 0.9,
  /** Interior wall + ceiling surface to paint, per sqft BUA. */
  int_paint_sqft_per_sqft: 3.2,
  /** Net floor to tile (walls/columns excluded) × 6 % cutting wastage. */
  floor_tile_sqft_per_sqft: 0.92 * 1.06,
  /** Kitchen + bathroom wall tiling, per sqft BUA (used when room counts are not given). */
  wall_tile_sqft_per_sqft: 0.3,
  /** Glazed window area, per sqft BUA. */
  window_glass_sqft_per_sqft: 0.12,
  /** One door per ~150 sqft (main + bedrooms + baths + kitchen) when room counts are not given; also the room-count thumb. */
  sqft_per_door: 150,
  /** One light point per ~80 sqft. */
  sqft_per_bulb: 80,
  /** Roof + wet-area waterproofing, per sqft BUA. */
  waterproof_sqft_per_sqft: 0.35,
  /** Epoxy grout/anchoring kits: one per ~800 sqft BUA for anchoring + repair. */
  sqft_per_epoxy_kit: 800,
  false_ceiling_share: { basic: 0, medium: 0.25, premium: 0.45 } as Record<Tier, number>,
  /** Covered two-wheeler + car porch. */
  parking_sqft: 150,
  /** Compound wall height 5 ft; perimeter from the plot dimensions. (Legacy `compoundWall` alias; the rate card is per rft at this height.) */
  compound_wall_height_ft: 5,
  /** Solar sizing: kW by tier, clamped to what the roof (footprint) can carry at ~100 sqft/kW. */
  solar_kw: { basic: 2, medium: 3, premium: 5 } as Record<Tier, number>,
  solar_sqft_per_kw: 100,
  /** CCTV: two cameras per floor + two at the gate / entrance. */
  cctv_per_floor: 2,
  cctv_base: 2,
  /** Fire: one extinguisher per floor plus one in the kitchen. */
  extinguisher_per_floor: 1,
  extinguisher_base: 1,

  /* ── v2 ───────────────────────────────────────────────────────────────── */
  /** Floor-to-floor height the thumb rules assume. Walls / plaster / paint scale by h / ref. */
  floor_height_ref_ft: 10,
  /** Steel grows ~2 % per ft of floor height over the reference (taller columns, more lateral steel). */
  steel_per_ft_over_10ft: 0.02,
  /** Foundation cost relative to isolated footings, applied to the footing share (STRUCTURAL_SPLIT.footing) of civil materials. */
  foundation_factor: { isolated_footing: 1.0, raft: 1.18, pile: 1.35 } as Record<FoundationType, number>,
  /** Default foundation by soil when the buyer has not chosen one. */
  soil_default_foundation: { hard: 'isolated_footing', medium: 'isolated_footing', soft: 'raft', black_cotton: 'raft' } as Record<SoilType, FoundationType>,
  /** Site-condition overheads as a share of civil cost (materials + civil labour); summed across the three. */
  site_factor: {
    road: { good: 0, narrow: 0.03, no_truck: 0.07 } as Record<RoadAccess, number>,
    water: { municipal: 0, borewell: 0, tanker: 0.02 } as Record<SiteWater, number>,
    power: { available: 0, temporary: 0.015 } as Record<SitePower, number>,
  },
  /** Share of the exterior face that cladding / stone covers (front elevation + accents); the rest is painted. */
  cladding_share_of_facade: 0.35,
  /** Doors beyond one per room: main door + utility / terrace door. */
  doors_extra: 2,
  /** Wall tiling per bathroom (7 ft dado on a ~6 × 8 ft bathroom) and per kitchen (2 ft dado over the counter). */
  wall_tile_sqft_per_bathroom: 180,
  wall_tile_sqft_per_kitchen: 60,
  /** Wardrobe run per bedroom, running ft. */
  wardrobe_rft_per_bedroom: 7,
  /** Bedroom count thumb when rooms are not given (one bedroom per ~450 sqft BUA). */
  sqft_per_bedroom: 450,
  /** Underground sump capacity when the buyer ticks "sump". */
  sump_kl_default: 10,
  /** The compound-wall rate is quoted at this height; other heights scale the rate linearly. */
  boundary_wall_ref_height_ft: 5,
  /** A lift is itemised only at this many floors above ground or more (G+3). */
  lift_min_floors: 3,
} as const;
