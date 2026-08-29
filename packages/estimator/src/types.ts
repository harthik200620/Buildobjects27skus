export type StateCode = 'AP' | 'TS';
export type Tier = 'basic' | 'medium' | 'premium';
export const TIERS: Tier[] = ['basic', 'medium', 'premium'];
export const TIER_LABEL: Record<Tier, string> = { basic: 'Basic', medium: 'Medium', premium: 'Premium' };
export type ConstructionType = 'rcc_framed' | 'load_bearing';
export type Ledger = 'structure' | 'interior';
export const LEDGER_LABEL: Record<Ledger, string> = { structure: 'Exterior & structure', interior: 'Interior' };

/** Material groups — the donut's segments. Every line belongs to exactly one. */
export type GroupKey =
  | 'cement'
  | 'steel'
  | 'bricks'
  | 'sand_aggregate'
  | 'foundation'
  | 'labour'
  | 'finishes'
  | 'roof'
  | 'doors_windows'
  | 'flooring'
  | 'services'
  | 'external_works'
  | 'lift_stairs'
  | 'interiors'
  | 'addons'
  | 'picks';
export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'cement', label: 'Cement' },
  { key: 'steel', label: 'Steel' },
  { key: 'bricks', label: 'Bricks' },
  { key: 'sand_aggregate', label: 'Sand & aggregate' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'labour', label: 'Civil labour & shuttering' },
  { key: 'finishes', label: 'Plaster, paint & waterproofing' },
  { key: 'roof', label: 'Roof & balconies' },
  { key: 'doors_windows', label: 'Doors & windows' },
  { key: 'flooring', label: 'Flooring & tiles' },
  { key: 'services', label: 'Plumbing, electrical & external' },
  { key: 'external_works', label: 'Boundary, water & external works' },
  { key: 'lift_stairs', label: 'Staircase & lift' },
  { key: 'interiors', label: 'Interiors' },
  { key: 'addons', label: 'Add-ons' },
  { key: 'picks', label: 'Your store picks' },
];

export type PhaseKey = 'footing' | 'plinth' | `slab_${number}` | 'brickwork' | 'services' | 'finishing';

export interface PlotByDims {
  lengthFt: number;
  widthFt: number;
}
export interface PlotByArea {
  areaSqft: number;
}
export const isPlotByDims = (p: PlotByDims | PlotByArea): p is PlotByDims => (p as PlotByDims).lengthFt !== undefined;

/** A store SKU the buyer added with "Add to Estimate". Priced from the catalogue snapshot. */
export interface EstimatePick {
  sku_code: string;
  qty: number;
}

/* ── v2 input vocabulary ─────────────────────────────────────────────────── */
export type SoilType = 'hard' | 'medium' | 'soft' | 'black_cotton';
export const SOIL_TYPES: SoilType[] = ['hard', 'medium', 'soft', 'black_cotton'];
export type FoundationType = 'isolated_footing' | 'raft' | 'pile';
export const FOUNDATION_TYPES: FoundationType[] = ['isolated_footing', 'raft', 'pile'];
export const FOUNDATION_LABEL: Record<FoundationType, string> = { isolated_footing: 'Isolated footings', raft: 'Raft', pile: 'Pile' };
export type RoofType = 'flat_rcc' | 'sloped';
export const ROOF_TYPES: RoofType[] = ['flat_rcc', 'sloped'];
export type ExteriorFinish = 'paint' | 'cladding' | 'stone';
export const EXTERIOR_FINISHES: ExteriorFinish[] = ['paint', 'cladding', 'stone'];
export type StaircaseType = 'rcc_plain' | 'rcc_granite' | 'steel';
export const STAIRCASE_TYPES: StaircaseType[] = ['rcc_plain', 'rcc_granite', 'steel'];
export const STAIRCASE_LABEL: Record<StaircaseType, string> = { rcc_plain: 'RCC, plain finish', rcc_granite: 'RCC, granite', steel: 'Steel' };
export type GateType = 'none' | 'ms' | 'ss' | 'automatic';
export const GATE_TYPES: GateType[] = ['none', 'ms', 'ss', 'automatic'];
export const GATE_LABEL: Record<GateType, string> = { none: 'No gate', ms: 'MS gate', ss: 'SS gate', automatic: 'Automatic gate' };
export type RoadAccess = 'good' | 'narrow' | 'no_truck';
export const ROAD_ACCESS: RoadAccess[] = ['good', 'narrow', 'no_truck'];
export type SiteWater = 'municipal' | 'borewell' | 'tanker';
export const SITE_WATER: SiteWater[] = ['municipal', 'borewell', 'tanker'];
export type SitePower = 'available' | 'temporary';
export const SITE_POWER: SitePower[] = ['available', 'temporary'];
/** Room counts for the whole building (all floors). Drives doors, wall tiles, fixtures, wardrobes and kitchens. */
export interface RoomCounts {
  bedrooms: number;
  bathrooms: number;
  kitchens: number;
}
/** Interior package. `null` on the inputs = not itemised (the v1 "modular spread per sqft" line and the tier's false-ceiling share apply). */
export interface InteriorPackage {
  modularKitchen: boolean;
  wardrobes: boolean /** 0–1 share of BUA with a false ceiling; null = the tier's default share. */;
  falseCeilingShare: number | null;
}
export interface WaterItems {
  borewell: boolean;
  sump: boolean;
  septic: boolean;
  rainwater: boolean;
}
/** `lengthFt: null` = the plot perimeter. */
export interface BoundaryWall {
  lengthFt: number | null;
  heightFt: number;
  gate: GateType;
}
export interface SiteConditions {
  roadAccess: RoadAccess;
  water: SiteWater;
  power: SitePower;
}

export type AdjustmentProvenance = 'ai_suggested' | 'user';
/**
 * A rate or quantity override for one line (from the AI review panel or a manual edit). One
 * adjustment per line, one field per adjustment; the engine clamps it to ±35 % of the engine's
 * own value and never applies it to a store-priced line.
 */
export interface Adjustment {
  line_key: string;
  rate?: number;
  qty?: number;
  reason: string;
  source_url: string | null;
  provenance: AdjustmentProvenance;
}

export interface EstimateInputs {
  state: StateCode;
  city: string; // city key from rates/cities (e.g. "hyderabad")
  pincode?: string | null;
  plot: PlotByDims | PlotByArea;
  /** 0 = Ground only, 1 = G+1 … 4 = G+4 */
  floors: number;
  /** Ground coverage as a fraction of the plot, 0.4 … 1.0 */
  coverage: number;
  constructionType: ConstructionType;
  parking: boolean;
  /** Legacy alias for `boundaryWall` ≡ plot perimeter × 5 ft, no gate. */
  compoundWall: boolean;
  tier: Tier;
  addons: { solar: boolean; cctv: boolean; fireSafety: boolean };
  /** Built-up area read from a drawing (overrides the plot × coverage × floors derivation). */
  builtUpOverrideSqft?: number | null;
  picks?: EstimatePick[];

  /* ── v2 (every field optional; the default means "not itemised" and leaves the v1 total unchanged) ── */
  /** Whole-building room counts. null = thumb rules by BUA. */
  rooms?: RoomCounts | null;
  /** Floor-to-floor height, 8–16 ft. 10 ft = ×1; walls / plaster / paint scale by h/10, steel by 1 + 0.02·(h − 10). */
  floorHeightFt?: number;
  /** Soil at site. Picks the default foundation when `foundation` is null and adds a verification flag. */
  soil?: SoilType | null;
  /** null = by soil (hard / medium → isolated footings, soft / black cotton → raft). Isolated footings carry no premium line. */
  foundation?: FoundationType | null;
  /** 'flat_rcc' (default, no extra line) or 'sloped' (premium per sqft of roof). */
  roof?: RoofType;
  /** 'paint' (default) — cladding / stone replace paint on a share of the façade. */
  exteriorFinish?: ExteriorFinish;
  interior?: InteriorPackage | null;
  /** Tier for the plumbing lines only; null = follows `tier`. */
  plumbingTier?: Tier | null;
  /** When set, the electrical fittings line becomes an itemised points line (2–20 per room). */
  electricalPointsPerRoom?: number | null;
  /** Itemised only when floors > 0. */
  staircase?: StaircaseType | null;
  /** Itemised only at G+3 and above. */
  lift?: boolean;
  water?: WaterItems;
  /** Cantilever balcony / utility slab area, sqft. */
  balconyUtilitySqft?: number;
  boundaryWall?: BoundaryWall | null;
  landscapingSqft?: number;
  /** Explicit rooftop solar size in kW (clamped to what the roof carries); null = the tier default when `addons.solar`. */
  solarKw?: number | null;
  site?: SiteConditions;
  /** Max 24; validated by normalizeInputs. Never in the URL — saved estimates carry them. */
  adjustments?: Adjustment[];
}

/** One store SKU as the calculator sees it — the store and the calculator share one price truth. */
export interface CatalogPrice {
  sku_code: string;
  category: string;
  name: string;
  brand: string;
  unit: string;
  selling_price: number | null;
  price_provenance: string;
  /** Derived by the loader: ₹ per sqft for tiles / glass. */
  per_sqft?: number | null;
  /** Derived by the loader: rated Wp for solar panels. */
  wp?: number | null;
  in_stock?: boolean;
}
export type CatalogPrices = Record<string, CatalogPrice>;

/** How an adjustment landed on a line. `capped` = the request exceeded ±35 % and was clamped. */
export interface LineAdjustment {
  field: 'rate' | 'qty';
  from: number;
  to: number;
  provenance: AdjustmentProvenance;
  reason: string;
  source_url: string | null;
  capped: boolean;
}

export interface LineItem {
  key: string;
  label: string;
  ledger: Ledger;
  group: GroupKey;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  /** 'store' = a live store SKU price (not city-indexed); 'seed' = a thumb-rule rate × city index. */
  rateSource: 'store' | 'seed';
  sku_code?: string;
  skuName?: string;
  priceProvenance?: string;
  note?: string;
  needsVerification: boolean;
  /** Which phase bucket this line bills in. 'structural' is split footing / plinth / slabs; 'footing' bills entirely in the footing phase. */
  phase: 'structural' | 'footing' | 'brickwork' | 'services' | 'finishing';
  /** Present when an adjustment changed this line. */
  adjusted?: LineAdjustment;
}

export interface PhaseAmount {
  key: PhaseKey;
  label: string;
  amount: number;
  share: number;
}
export interface GroupAmount {
  key: GroupKey;
  label: string;
  amount: number;
  share: number;
}

export type IgnoredAdjustmentReason = 'store_priced' | 'no_such_line';
export interface IgnoredAdjustment {
  line_key: string;
  reason: IgnoredAdjustmentReason;
  provenance: AdjustmentProvenance;
}

export interface EstimateResult {
  version: string;
  inputs: EstimateInputs;
  derived: {
    plotAreaSqft: number;
    footprintSqft: number;
    builtUpSqft: number;
    floorsLabel: string;
    perimeterFt: number;
    cityIndex: number;
    cityName: string;
    stateName: string;
    fromDrawing: boolean;
  };
  lines: LineItem[];
  ledgers: {
    structure: { subtotal: number; material: number; labour: number; labourShare: number };
    interior: { subtotal: number };
  };
  grandTotal: number;
  perSqft: number;
  groups: GroupAmount[];
  phases: PhaseAmount[];
  /** This design at the three tiers. */
  tiers: Record<Tier, number>;
  accuracy: { pct: number; note: string };
  needsVerification: string[];
  /** Store SKUs that priced a line, by line key — the calculator's link back to the store. */
  storeLinks: { key: string; sku_code: string; name: string; brand: string; provenance: string }[];
  /** How many adjustments changed a line, and which were ignored (store-priced line, or no such line in this estimate). */
  adjustments: { applied: number; ignored: IgnoredAdjustment[] };
}

/* ── drawing reader ──────────────────────────────────────────────────────── */
export type DrawingProvider = 'gemini' | 'anthropic' | 'mock';
export type DrawingType = 'floor_plan' | 'elevation' | 'section' | '3d_render' | 'site_plan' | 'other';
export type DrawingRoomType = 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'dining' | 'pooja' | 'study' | 'store' | 'utility' | 'balcony' | 'other';
/** One floor as read from the sheet set. `level` 0 = ground. */
export interface DrawingFloorDetail {
  level: number;
  label: string | null;
  areaSqft: number | null;
  rooms: number | null;
}
export interface DrawingRoomByType {
  type: DrawingRoomType;
  count: number;
  areaSqft: number | null;
}
export interface DrawingDoorsDetail {
  external: number | null;
  internal: number | null;
  bathroom: number | null;
}
export interface DrawingWindowsDetail {
  count: number | null;
  totalSqft: number | null;
}
export interface DrawingStaircase {
  present: boolean | null;
  material: 'rcc' | 'steel' | 'wood' | null;
  flights: number | null;
}
export interface DrawingParking {
  present: boolean | null;
  cars: number | null;
  covered: boolean | null;
}
export interface DrawingColumns {
  present: boolean | null;
  count: number | null;
}
export interface DrawingScale {
  stated: string | null;
  pxPerFt: number | null;
}

/** What the design-upload reader returns. Every field is a prefill suggestion, never silent truth. */
export interface DrawingExtraction {
  provider: DrawingProvider;
  floors: number | null;
  plotLengthFt: number | null;
  plotWidthFt: number | null;
  builtUpSqft: number | null;
  rooms: number | null;
  doors: number | null;
  windows: number | null;
  constructionType: ConstructionType | null;
  confidence: number;
  notes: string;

  /* ── v2 (all optional so a v1 reader still type-checks) ── */
  drawingType?: DrawingType | null;
  floorsDetail?: DrawingFloorDetail[] | null;
  roomsByType?: DrawingRoomByType[] | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  kitchens?: number | null;
  doorsDetail?: DrawingDoorsDetail | null;
  windowsDetail?: DrawingWindowsDetail | null;
  staircase?: DrawingStaircase | null;
  balconySqft?: number | null;
  parking?: DrawingParking | null;
  /** Columns drawn on the plan — with `wallThicknessIn` decides framed vs load-bearing. */
  columns?: DrawingColumns | null;
  /** Facing direction of the main entrance, e.g. 'N', 'NE', 'E'. Informational. */
  orientation?: string | null;
  /** External wall thickness in inches (9 in without columns reads as load-bearing). */
  wallThicknessIn?: number | null;
  scale?: DrawingScale | null;
  /** 0–1 confidence per field name of this object (e.g. { floors: 0.9, builtUpSqft: 0.4 }). */
  fieldConfidence?: Partial<Record<string, number>> | null;
}

/** Input fields a drawing reading can prefill — the UI highlights each until the user confirms. */
export type DrawingField = 'plot' | 'floors' | 'bua' | 'type' | 'rooms' | 'staircase' | 'balcony' | 'parking' | 'coverage';
