import { CITIES } from '../rates/2026-08/cities';
import {
  type Adjustment,
  type BoundaryWall,
  type ConstructionType,
  type DrawingExtraction,
  type DrawingField,
  type EstimateInputs,
  type EstimatePick,
  EXTERIOR_FINISHES,
  FOUNDATION_TYPES,
  GATE_TYPES,
  type InteriorPackage,
  isPlotByDims,
  ROAD_ACCESS,
  ROOF_TYPES,
  type RoomCounts,
  SITE_POWER,
  SITE_WATER,
  SOIL_TYPES,
  STAIRCASE_TYPES,
  type StateCode,
  TIERS,
  type Tier,
} from './types';

export const DEFAULT_INPUTS: EstimateInputs = {
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
  // v2 — every default is "not itemised"
  rooms: null,
  floorHeightFt: 10,
  soil: null,
  foundation: null,
  roof: 'flat_rcc',
  exteriorFinish: 'paint',
  interior: null,
  plumbingTier: null,
  electricalPointsPerRoom: null,
  staircase: null,
  lift: false,
  water: { borewell: false, sump: false, septic: false, rainwater: false },
  balconyUtilitySqft: 0,
  boundaryWall: null,
  landscapingSqft: 0,
  solarKw: null,
  site: { roadAccess: 'good', water: 'municipal', power: 'available' },
  adjustments: [],
};

/** Validation ranges for the v2 inputs (min, max). Exported so the UI can mirror them on its controls. */
export const INPUT_RANGES = {
  floorHeightFt: [8, 16],
  bedrooms: [0, 20],
  bathrooms: [0, 20],
  kitchens: [0, 5],
  electricalPointsPerRoom: [2, 20],
  balconyUtilitySqft: [0, 5000],
  boundaryWallLengthFt: [0, 5000],
  boundaryWallHeightFt: [3, 10],
  landscapingSqft: [0, 200_000],
  solarKw: [1, 50],
  falseCeilingShare: [0, 1],
  adjustmentsMax: 24,
} as const;
export const ADJUSTMENT_LINE_KEY_RE = /^[a-z_:A-Z0-9-]{1,40}$/;
/** Adjustments may move a rate or quantity this far from the engine's own value (±35 %). */
export const ADJUSTMENT_CLAMP = 0.35;

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;
const isNumLike = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(String(v)) ? (v as T) : null);

function normalizeAdjustments(raw: unknown): Adjustment[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, Adjustment>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const line_key = typeof a.line_key === 'string' ? a.line_key : '';
    if (!ADJUSTMENT_LINE_KEY_RE.test(line_key)) continue;
    const provenance = a.provenance === 'ai_suggested' || a.provenance === 'user' ? a.provenance : null;
    if (!provenance) continue;
    const rate = isNumLike(a.rate) ? Math.max(0, Number(a.rate)) : undefined;
    const qty = rate === undefined && isNumLike(a.qty) ? Math.max(0, Number(a.qty)) : undefined;
    if (rate === undefined && qty === undefined) continue;
    const source_url = typeof a.source_url === 'string' && /^https?:\/\//i.test(a.source_url) ? a.source_url.slice(0, 500) : null;
    const reason = typeof a.reason === 'string' ? a.reason.trim().slice(0, 240) : '';
    // one adjustment per line — a later entry for the same line replaces the earlier one
    byKey.delete(line_key);
    byKey.set(line_key, rate !== undefined ? { line_key, rate, reason, source_url, provenance } : { line_key, qty, reason, source_url, provenance });
  }
  return [...byKey.values()].slice(0, INPUT_RANGES.adjustmentsMax);
}

/** Coerce anything (URL params, JSON body, drawing extraction) into a valid EstimateInputs. Never throws. */
export function normalizeInputs(raw: Partial<EstimateInputs> | Record<string, unknown> | null | undefined): EstimateInputs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tier = (TIERS as string[]).includes(String(r.tier)) ? (r.tier as Tier) : DEFAULT_INPUTS.tier;
  const cityKey = CITIES.some((c) => c.key === r.city) ? String(r.city) : DEFAULT_INPUTS.city;
  const city = CITIES.find((c) => c.key === cityKey)!;
  const state: StateCode = city.state;
  const plotRaw = (r.plot ?? {}) as Record<string, unknown>;
  const plot =
    typeof plotRaw.areaSqft === 'number' || typeof plotRaw.areaSqft === 'string'
      ? { areaSqft: num(plotRaw.areaSqft, 1200, 200, 200_000) }
      : { lengthFt: num(plotRaw.lengthFt, 30, 8, 1000), widthFt: num(plotRaw.widthFt, 40, 8, 1000) };
  const addonsRaw = (r.addons ?? {}) as Record<string, unknown>;
  const picks = Array.isArray(r.picks)
    ? (r.picks as EstimatePick[])
        .filter((p) => p && typeof p.sku_code === 'string' && Number(p.qty) > 0)
        .map((p) => ({ sku_code: p.sku_code, qty: Math.min(999, Math.floor(Number(p.qty))) }))
    : [];
  const override = r.builtUpOverrideSqft;

  // ── v2 ──
  const R = INPUT_RANGES;
  const roomsRaw = r.rooms && typeof r.rooms === 'object' ? (r.rooms as Record<string, unknown>) : null;
  const rooms: RoomCounts | null =
    roomsRaw && (isNumLike(roomsRaw.bedrooms) || isNumLike(roomsRaw.bathrooms) || isNumLike(roomsRaw.kitchens))
      ? {
          bedrooms: Math.round(num(roomsRaw.bedrooms, 0, ...R.bedrooms)),
          bathrooms: Math.round(num(roomsRaw.bathrooms, 0, ...R.bathrooms)),
          kitchens: Math.round(num(roomsRaw.kitchens, 0, ...R.kitchens)),
        }
      : null;
  const interiorRaw = r.interior && typeof r.interior === 'object' ? (r.interior as Record<string, unknown>) : null;
  const interior: InteriorPackage | null = interiorRaw
    ? {
        modularKitchen: bool(interiorRaw.modularKitchen),
        wardrobes: bool(interiorRaw.wardrobes),
        falseCeilingShare: isNumLike(interiorRaw.falseCeilingShare) ? num(interiorRaw.falseCeilingShare, 0, ...R.falseCeilingShare) : null,
      }
    : null;
  const waterRaw = (r.water ?? {}) as Record<string, unknown>;
  const wallRaw = r.boundaryWall && typeof r.boundaryWall === 'object' ? (r.boundaryWall as Record<string, unknown>) : null;
  const boundaryWall: BoundaryWall | null = wallRaw
    ? {
        lengthFt: isNumLike(wallRaw.lengthFt) && Number(wallRaw.lengthFt) > 0 ? num(wallRaw.lengthFt, 0, ...R.boundaryWallLengthFt) : null,
        heightFt: num(wallRaw.heightFt, 5, ...R.boundaryWallHeightFt),
        gate: oneOf(GATE_TYPES, wallRaw.gate) ?? 'none',
      }
    : null;
  const siteRaw = (r.site ?? {}) as Record<string, unknown>;
  const solarKw = isNumLike(r.solarKw) && Number(r.solarKw) > 0 ? Math.round(num(r.solarKw, 1, ...R.solarKw) * 10) / 10 : null;

  return {
    state,
    city: cityKey,
    pincode: typeof r.pincode === 'string' && /^\d{6}$/.test(r.pincode) ? r.pincode : null,
    plot,
    floors: Math.round(num(r.floors, 1, 0, 4)),
    coverage: num(r.coverage, 0.75, 0.3, 1),
    constructionType: r.constructionType === 'load_bearing' ? 'load_bearing' : ('rcc_framed' as ConstructionType),
    parking: bool(r.parking),
    compoundWall: bool(r.compoundWall),
    tier,
    addons: { solar: bool(addonsRaw.solar), cctv: bool(addonsRaw.cctv), fireSafety: bool(addonsRaw.fireSafety) },
    builtUpOverrideSqft: override === null || override === undefined || override === '' ? null : num(override, 0, 0, 1_000_000) || null,
    picks,
    rooms,
    floorHeightFt: Math.round(num(r.floorHeightFt, 10, ...R.floorHeightFt) * 2) / 2,
    soil: oneOf(SOIL_TYPES, r.soil),
    foundation: oneOf(FOUNDATION_TYPES, r.foundation),
    roof: oneOf(ROOF_TYPES, r.roof) ?? 'flat_rcc',
    exteriorFinish: oneOf(EXTERIOR_FINISHES, r.exteriorFinish) ?? 'paint',
    interior,
    plumbingTier: oneOf(TIERS, r.plumbingTier),
    electricalPointsPerRoom:
      isNumLike(r.electricalPointsPerRoom) && Number(r.electricalPointsPerRoom) > 0
        ? Math.round(num(r.electricalPointsPerRoom, 0, ...R.electricalPointsPerRoom))
        : null,
    staircase: oneOf(STAIRCASE_TYPES, r.staircase),
    lift: bool(r.lift),
    water: { borewell: bool(waterRaw.borewell), sump: bool(waterRaw.sump), septic: bool(waterRaw.septic), rainwater: bool(waterRaw.rainwater) },
    balconyUtilitySqft: Math.round(num(r.balconyUtilitySqft, 0, ...R.balconyUtilitySqft)),
    boundaryWall,
    landscapingSqft: Math.round(num(r.landscapingSqft, 0, ...R.landscapingSqft)),
    solarKw,
    site: {
      roadAccess: oneOf(ROAD_ACCESS, siteRaw.roadAccess) ?? 'good',
      water: oneOf(SITE_WATER, siteRaw.water) ?? 'municipal',
      power: oneOf(SITE_POWER, siteRaw.power) ?? 'available',
    },
    adjustments: normalizeAdjustments(r.adjustments),
  };
}

/**
 * Compact, shareable query string for an inputs object (the calculator's URL state). v2 keys are
 * written only when they differ from the default; adjustments never travel in the URL — only
 * their count (`adj`) does, so a shared link says "this had 3 adjustments" without carrying them.
 */
export function inputsToQuery(i: EstimateInputs): string {
  const p = new URLSearchParams();
  p.set('city', i.city);
  if ('areaSqft' in i.plot) p.set('area', String(i.plot.areaSqft));
  else {
    p.set('l', String(i.plot.lengthFt));
    p.set('w', String(i.plot.widthFt));
  }
  p.set('floors', String(i.floors));
  p.set('cov', String(Math.round(i.coverage * 100)));
  p.set('type', i.constructionType);
  p.set('tier', i.tier);
  if (i.parking) p.set('parking', '1');
  if (i.compoundWall) p.set('wall', '1');
  if (i.addons.solar) p.set('solar', '1');
  if (i.addons.cctv) p.set('cctv', '1');
  if (i.addons.fireSafety) p.set('fire', '1');
  if (i.builtUpOverrideSqft) p.set('bua', String(Math.round(i.builtUpOverrideSqft)));
  if (i.pincode) p.set('pin', i.pincode);
  // v2
  if (i.rooms) {
    p.set('bd', String(i.rooms.bedrooms));
    p.set('ba', String(i.rooms.bathrooms));
    p.set('kt', String(i.rooms.kitchens));
  }
  if (i.floorHeightFt && i.floorHeightFt !== 10) p.set('fh', String(i.floorHeightFt));
  if (i.soil) p.set('soil', i.soil);
  if (i.foundation) p.set('fnd', i.foundation);
  if (i.roof && i.roof !== 'flat_rcc') p.set('roof', i.roof);
  if (i.exteriorFinish && i.exteriorFinish !== 'paint') p.set('ext', i.exteriorFinish);
  if (i.interior) {
    p.set('mk', i.interior.modularKitchen ? '1' : '0');
    p.set('wr', i.interior.wardrobes ? '1' : '0');
    if (i.interior.falseCeilingShare !== null) p.set('fc', String(Math.round(i.interior.falseCeilingShare * 100)));
  }
  if (i.plumbingTier) p.set('pt', i.plumbingTier);
  if (i.electricalPointsPerRoom) p.set('ep', String(i.electricalPointsPerRoom));
  if (i.staircase) p.set('st', i.staircase);
  if (i.lift) p.set('lift', '1');
  if (i.water?.borewell) p.set('bw', '1');
  if (i.water?.sump) p.set('sump', '1');
  if (i.water?.septic) p.set('sep', '1');
  if (i.water?.rainwater) p.set('rw', '1');
  if (i.balconyUtilitySqft) p.set('bal', String(Math.round(i.balconyUtilitySqft)));
  if (i.boundaryWall) {
    if (i.boundaryWall.lengthFt) p.set('bwl', String(Math.round(i.boundaryWall.lengthFt)));
    p.set('bwh', String(i.boundaryWall.heightFt));
    if (i.boundaryWall.gate !== 'none') p.set('gate', i.boundaryWall.gate);
  }
  if (i.landscapingSqft) p.set('ls', String(Math.round(i.landscapingSqft)));
  if (i.solarKw) p.set('skw', String(i.solarKw));
  if (i.site?.roadAccess && i.site.roadAccess !== 'good') p.set('road', i.site.roadAccess);
  if (i.site?.water && i.site.water !== 'municipal') p.set('wtr', i.site.water);
  if (i.site?.power && i.site.power !== 'available') p.set('pwr', i.site.power);
  if (i.adjustments?.length) p.set('adj', String(i.adjustments.length));
  return p.toString();
}

export function inputsFromQuery(q: URLSearchParams | Record<string, string | string[] | undefined>): EstimateInputs | null {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : Array.isArray(q[k]) ? (q[k] as string[])[0] : (q[k] as string | undefined)) ?? null;
  if (!get('city') && !get('l') && !get('area')) return null;
  const cov = get('cov');
  const has = (k: string) => get(k) !== null;
  const fc = get('fc');
  return normalizeInputs({
    city: get('city') ?? undefined,
    plot: get('area') ? { areaSqft: Number(get('area')) } : { lengthFt: Number(get('l') ?? 30), widthFt: Number(get('w') ?? 40) },
    floors: Number(get('floors') ?? 1),
    coverage: cov ? Number(cov) / 100 : 0.75,
    constructionType: (get('type') as ConstructionType) ?? 'rcc_framed',
    tier: (get('tier') as Tier) ?? 'medium',
    parking: get('parking') === '1',
    compoundWall: get('wall') === '1',
    addons: { solar: get('solar') === '1', cctv: get('cctv') === '1', fireSafety: get('fire') === '1' },
    builtUpOverrideSqft: get('bua') ? Number(get('bua')) : null,
    pincode: get('pin') ?? null,
    // v2 — `adj` is deliberately ignored: adjustments live in saved estimates, never in a link
    rooms:
      has('bd') || has('ba') || has('kt') ? { bedrooms: Number(get('bd') ?? 0), bathrooms: Number(get('ba') ?? 0), kitchens: Number(get('kt') ?? 0) } : null,
    floorHeightFt: has('fh') ? Number(get('fh')) : 10,
    soil: get('soil'),
    foundation: get('fnd'),
    roof: get('roof') ?? 'flat_rcc',
    exteriorFinish: get('ext') ?? 'paint',
    interior:
      has('mk') || has('wr') || has('fc')
        ? { modularKitchen: get('mk') === '1', wardrobes: get('wr') === '1', falseCeilingShare: fc !== null ? Number(fc) / 100 : null }
        : null,
    plumbingTier: get('pt'),
    electricalPointsPerRoom: has('ep') ? Number(get('ep')) : null,
    staircase: get('st'),
    lift: get('lift') === '1',
    water: { borewell: get('bw') === '1', sump: get('sump') === '1', septic: get('sep') === '1', rainwater: get('rw') === '1' },
    balconyUtilitySqft: has('bal') ? Number(get('bal')) : 0,
    boundaryWall:
      has('bwl') || has('bwh') || has('gate')
        ? { lengthFt: has('bwl') ? Number(get('bwl')) : null, heightFt: has('bwh') ? Number(get('bwh')) : 5, gate: get('gate') ?? 'none' }
        : null,
    landscapingSqft: has('ls') ? Number(get('ls')) : 0,
    solarKw: has('skw') ? Number(get('skw')) : null,
    site: { roadAccess: get('road') ?? 'good', water: get('wtr') ?? 'municipal', power: get('pwr') ?? 'available' },
    adjustments: [],
  });
}

/* ── drawing → inputs ────────────────────────────────────────────────────── */
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * Map a drawing reading onto the inputs (pure). Returns the patch to spread over the inputs and the
 * list of input fields it touched, so the UI can highlight each one until the user confirms.
 *   plot      — plot length × width (rounded to feet)
 *   floors    — `floors`, else one less than the number of floors detailed
 *   bua       — `builtUpSqft`, else the sum of the per-floor areas → builtUpOverrideSqft
 *   type      — columns drawn → rcc_framed; else a ≥ 9 in wall → load_bearing; else the reader's own call
 *   rooms     — bedrooms / bathrooms / kitchens (direct, else counted from roomsByType); unknown counts keep the current value
 *   staircase — present and floors > 0 → 'steel' when read as steel, else 'rcc_plain'
 *   balcony   — balconySqft → balconyUtilitySqft
 *   parking   — parking.present → parking
 *   coverage  — ground-floor area (or BUA ÷ floors) over the plot, when both are known
 */
export function applyDrawing(inputs: EstimateInputs, reading: DrawingExtraction): { patch: Partial<EstimateInputs>; fields: DrawingField[] } {
  const patch: Partial<EstimateInputs> = {};
  const fields: DrawingField[] = [];
  const touch = (f: DrawingField) => {
    if (!fields.includes(f)) fields.push(f);
  };

  const L = pos(reading.plotLengthFt),
    W = pos(reading.plotWidthFt);
  if (L && W) {
    patch.plot = { lengthFt: Math.round(L), widthFt: Math.round(W) };
    touch('plot');
  }

  const detail = Array.isArray(reading.floorsDetail) ? reading.floorsDetail.filter((f) => f && typeof f === 'object') : [];
  let floors: number | null =
    typeof reading.floors === 'number' && Number.isFinite(reading.floors) ? Math.max(0, Math.min(4, Math.round(reading.floors))) : null;
  if (floors === null && detail.length) floors = Math.max(0, Math.min(4, detail.length - 1));
  if (floors !== null) {
    patch.floors = floors;
    touch('floors');
  }
  const floorsNow = floors ?? inputs.floors;

  let bua = pos(reading.builtUpSqft);
  if (!bua && detail.length && detail.every((f) => pos(f.areaSqft))) bua = detail.reduce((a, f) => a + (f.areaSqft as number), 0);
  if (bua) {
    patch.builtUpOverrideSqft = Math.round(bua);
    touch('bua');
  }

  const wall = pos(reading.wallThicknessIn);
  const columns = reading.columns?.present ?? null;
  if (columns === true) {
    patch.constructionType = 'rcc_framed';
    touch('type');
  } else if (wall && wall >= 9) {
    patch.constructionType = 'load_bearing';
    touch('type');
  } else if (reading.constructionType === 'rcc_framed' || reading.constructionType === 'load_bearing') {
    patch.constructionType = reading.constructionType;
    touch('type');
  }

  const byType = (t: string) => {
    const rows = (reading.roomsByType ?? []).filter((r) => r && r.type === t);
    return rows.length ? rows.reduce((a, r) => a + (count(r.count) ?? 0), 0) : null;
  };
  const bedrooms = count(reading.bedrooms) ?? byType('bedroom');
  const bathrooms = count(reading.bathrooms) ?? byType('bathroom');
  const kitchens = count(reading.kitchens) ?? byType('kitchen');
  if (bedrooms !== null || bathrooms !== null || kitchens !== null) {
    const cur = inputs.rooms ?? { bedrooms: 0, bathrooms: 0, kitchens: 0 };
    patch.rooms = { bedrooms: bedrooms ?? cur.bedrooms, bathrooms: bathrooms ?? cur.bathrooms, kitchens: kitchens ?? cur.kitchens };
    touch('rooms');
  }

  if (reading.staircase?.present === true && floorsNow > 0) {
    patch.staircase = reading.staircase.material === 'steel' ? 'steel' : 'rcc_plain';
    touch('staircase');
  }

  const balcony = pos(reading.balconySqft);
  if (balcony) {
    patch.balconyUtilitySqft = Math.round(balcony);
    touch('balcony');
  }

  if (typeof reading.parking?.present === 'boolean') {
    patch.parking = reading.parking.present;
    touch('parking');
  }

  const ground = detail.find((f) => f.level === 0) ?? null;
  const footprint = pos(ground?.areaSqft) ?? (bua && floors !== null ? bua / (floors + 1) : null);
  const plot = patch.plot ?? inputs.plot;
  const plotArea = isPlotByDims(plot) ? plot.lengthFt * plot.widthFt : plot.areaSqft;
  if (footprint && plotArea > 0) {
    patch.coverage = Math.round(Math.min(1, Math.max(0.3, footprint / plotArea)) * 100) / 100;
    touch('coverage');
  }

  return { patch, fields };
}
