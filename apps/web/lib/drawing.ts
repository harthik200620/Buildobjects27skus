import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { clamp01 } from '@buildobjects/catalog';
import type { DrawingExtraction, DrawingProvider, DrawingRoomType, DrawingType } from '@buildobjects/estimator';
import {
  arr,
  enumOf,
  generateJson,
  hasGemini,
  imagePart,
  int,
  type JsonSchema,
  nullableViaSentinel,
  num,
  obj,
  resolveModel,
  score,
  str,
} from '@buildobjects/llm';

/**
 * Design upload → prefill. A floor plan / elevation / section / 3D render / site plan (image or
 * PDF) is read into a `DrawingExtraction` — every field a SUGGESTION the wizard asks the user to
 * confirm (`applyDrawing` in @buildobjects/estimator maps it onto the inputs and lists the fields
 * it touched).
 *
 * Provider order (first one with a key wins; a live failure surfaces as an error, never a silent
 * fall-through to a lesser provider):
 *   gemini    GEMINI_API_KEY — `resolveModel('pro', GEMINI_DRAWING_MODEL)`, one strict-JSON call over
 *             the inline image / PDF (≤ 14 MB inline; JPEG, PNG, WebP, PDF — GIF is not a Gemini type),
 *             every v2 field; 0 = unknown (−1 for floors) re-validated by the `n()` rule below.
 *   anthropic ANTHROPIC_API_KEY — the v1 Claude reader, unchanged (v1 fields + drawingType).
 *   mock      neither — an aspect-ratio sample at confidence 0.2 whose note names GEMINI_API_KEY.
 */
export const DRAWING_MAX_BYTES = 20 * 1024 * 1024;
/** Gemini inline-data ceiling — larger files must be exported as an image (the route answers 413). */
export const DRAWING_INLINE_MAX_BYTES = 14 * 1024 * 1024;
export const DRAWING_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
/** What the Gemini reader accepts inline (GIF is not an image type the API understands). */
export const GEMINI_DRAWING_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
/** Per-call deadline for the Gemini read (the route's maxDuration is 120 s). */
export const DRAWING_TIMEOUT_MS = 100_000;

const ANTHROPIC_MODEL = process.env.DRAWING_MODEL ?? 'claude-opus-5';

/** A reader error that maps to an HTTP status (413 too large for inline, 415 unsupported type). */
export class DrawingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DrawingError';
  }
}

export interface DrawingFile {
  bytes: Buffer;
  mimeType: string;
  name: string;
}

/** Which reader a call would use right now — gemini → anthropic → mock (key presence only). */
export function drawingProvider(): DrawingProvider {
  if (hasGemini()) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'mock';
}

export async function readDrawing(file: DrawingFile): Promise<DrawingExtraction> {
  const provider = drawingProvider();
  if (provider === 'gemini') return readWithGemini(file);
  if (provider === 'anthropic') return readWithClaude(file);
  return mockReading(file);
}

/* ── shared re-validation ─────────────────────────────────────────────────── */
/** The v1 rule: a number counts only when finite and > 0 — so 0 ("unknown" in the Gemini schema) becomes null. */
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const cnt = (v: unknown, max: number): number | null => {
  const x = n(v);
  return x === null ? null : Math.min(max, Math.round(x));
};
const within = (v: unknown, lo: number, hi: number): number | null => {
  const x = n(v);
  return x !== null && x >= lo && x <= hi ? x : null;
};
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(String(v)) ? (v as T) : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/* ── Gemini ───────────────────────────────────────────────────────────────── */
const YES_NO = ['yes', 'no', 'unknown'] as const;
const yes = (v: unknown): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);
export const DRAWING_KINDS = ['floor_plan', 'elevation', 'section', '3d_render', 'site_plan', 'other'] as const satisfies readonly DrawingType[];
export const ROOM_TYPES = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'dining',
  'pooja',
  'study',
  'store',
  'utility',
  'balcony',
  'other',
] as const satisfies readonly DrawingRoomType[];
const STAIR_MATERIALS = ['rcc', 'steel', 'wood', 'unknown'] as const;
const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const CONSTRUCTION = ['rcc_framed', 'load_bearing', 'unknown'] as const;

const unknown0 = (s: JsonSchema) => nullableViaSentinel(s, 0);
const yesNo = (what: string) => enumOf(YES_NO, `${what}; "unknown" when the drawing does not show it`);

/**
 * Strict Gemini schema — no null unions (they 400 on several generations): numbers use 0 for
 * unknown (−1 for floors_above_ground, where 0 = ground only), strings "", choices "unknown".
 */
export const GEMINI_DRAWING_SCHEMA: JsonSchema = obj({
  drawing_type: enumOf(DRAWING_KINDS, 'What the sheet (or the dominant sheet of a set) is'),
  floors_above_ground: nullableViaSentinel(
    int('Floors ABOVE ground: 0 = ground only, 1 = G+1, 2 = G+2 … Read from the elevation or from sheet titles such as "FIRST FLOOR PLAN"', {
      minimum: -1,
      maximum: 10,
    }),
    -1,
  ),
  plot_length_ft: unknown0(num('Overall plot (or building) length in feet; convert metres × 3.281, mm ÷ 304.8', { minimum: 0 })),
  plot_width_ft: unknown0(num('Overall plot (or building) width in feet', { minimum: 0 })),
  built_up_sqft: unknown0(num('Total built-up area across ALL floors in square feet, if stated or derivable (m² × 10.764)', { minimum: 0 })),
  floors_detail: arr(
    obj({
      level: int('0 = ground, 1 = first floor, …', { minimum: 0, maximum: 10 }),
      label: str('Sheet title as printed, e.g. "GROUND FLOOR PLAN"; "" when none'),
      area_sqft: unknown0(num('Built-up area of this floor in sqft', { minimum: 0 })),
      rooms: unknown0(int('Rooms on this floor (bedrooms + living + dining + kitchen + baths)', { minimum: 0 })),
    }),
    { description: 'One entry per floor plan shown; empty when the sheet is not a floor plan', maxItems: 12 },
  ),
  rooms_by_type: arr(
    obj({
      type: enumOf(ROOM_TYPES),
      count: int('How many rooms of this type across all floors', { minimum: 0, maximum: 40 }),
      area_sqft: unknown0(num('Combined area of these rooms in sqft', { minimum: 0 })),
    }),
    { description: 'Rooms grouped by type, read from the room labels; empty when not a floor plan', maxItems: 20 },
  ),
  rooms_total: unknown0(int('Total rooms (bedrooms + living + dining + kitchen + baths) across all floors', { minimum: 0 })),
  bedrooms: unknown0(int('Bedrooms across all floors', { minimum: 0 })),
  bathrooms: unknown0(int('Bathrooms / toilets / W.C. across all floors', { minimum: 0 })),
  kitchens: unknown0(int('Kitchens across all floors', { minimum: 0 })),
  doors: obj({
    total: unknown0(int('Door symbols counted', { minimum: 0 })),
    external: unknown0(int('Doors to the outside (main, back, balcony)', { minimum: 0 })),
    internal: unknown0(int('Internal room doors', { minimum: 0 })),
    bathroom: unknown0(int('Bathroom / toilet doors', { minimum: 0 })),
  }),
  windows: obj({
    count: unknown0(int('Window symbols counted', { minimum: 0 })),
    total_sqft: unknown0(num('Combined window area in sqft when sizes are given', { minimum: 0 })),
  }),
  staircase: obj({
    present: yesNo('A staircase is drawn'),
    material: enumOf(STAIR_MATERIALS, 'Staircase material when stated'),
    flights: unknown0(int('Number of flights', { minimum: 0 })),
  }),
  balcony_sqft: unknown0(num('Balcony + utility slab area in sqft', { minimum: 0 })),
  parking: obj({
    present: yesNo('Car parking / porch / portico is drawn'),
    cars: unknown0(int('Cars it holds', { minimum: 0 })),
    covered: yesNo('The parking is covered (porch / stilt)'),
  }),
  columns: obj({
    present: yesNo('RCC columns are drawn (filled squares / rectangles at wall junctions)'),
    count: unknown0(int('Columns counted on the ground-floor plan', { minimum: 0 })),
  }),
  orientation: enumOf([...ORIENTATIONS, 'unknown'], 'Direction the main entrance faces, from the north arrow'),
  wall_thickness_in: unknown0(num('External wall thickness in inches (230 mm = 9 in, 115 mm = 4.5 in, 150 mm = 6 in)', { minimum: 0 })),
  scale: obj({
    stated: str('Scale as printed, e.g. "1:100"; "" when none'),
    px_per_ft: unknown0(num('Pixels per foot if a dimension line lets you infer it; else 0', { minimum: 0 })),
  }),
  construction_type: enumOf(
    CONSTRUCTION,
    'rcc_framed when columns / beams are drawn; load_bearing when thick masonry walls carry the structure with no columns',
  ),
  field_confidence: obj({
    floors: score('confidence in floors_above_ground'),
    plot: score('confidence in the plot dimensions'),
    built_up: score('confidence in built_up_sqft and the per-floor areas'),
    rooms: score('confidence in the room counts'),
    doors_windows: score('confidence in the door / window counts'),
    staircase: score('confidence in staircase'),
    balcony: score('confidence in balcony_sqft'),
    parking: score('confidence in parking'),
    columns: score('confidence in columns'),
    wall_thickness: score('confidence in wall_thickness_in'),
    construction_type: score('confidence in construction_type'),
  }),
  confidence: score('overall confidence in this reading'),
  notes: str('One or two sentences: what was read, what was assumed, what the sheet does not show'),
});

const GEMINI_SYSTEM = [
  'You read Indian residential architectural drawings (floor plans, elevations, sections, 3D renders, site plans) for a construction cost estimator.',
  'Report only what the drawing makes clear — counts from the symbols and labels, dimensions from the dimension lines and titles. Unknown is a valid answer; never round up to look complete.',
  'Units: feet and square feet (convert metres × 3.281, mm ÷ 304.8, m² × 10.764).',
  'Indian conventions: 230 mm (9 in) brick walls, 115 mm (4.5 in) partitions; columns are drawn as filled rectangles; "G+1" = one floor above ground; "BHK" = bedrooms-hall-kitchen; "W.C.", "TOILET", "BATH" are bathrooms; "POOJA" is a prayer room; "UTILITY" a wash area; "PORTICO" / "CAR PORCH" is parking.',
].join(' ');

async function readWithGemini(file: DrawingFile): Promise<DrawingExtraction> {
  if (!(GEMINI_DRAWING_TYPES as readonly string[]).includes(file.mimeType))
    throw new DrawingError(`The reader cannot take ${file.mimeType} — export the drawing as PNG, JPEG, WebP or PDF`, 415);
  if (file.bytes.length > DRAWING_INLINE_MAX_BYTES)
    throw new DrawingError('This file is over 14 MB — export the drawing as an image (PNG or JPEG) and upload that instead', 413);
  const model = await resolveModel('pro', process.env.GEMINI_DRAWING_MODEL);
  const res = await generateJson<Record<string, unknown>>({
    caller: 'calculator.drawing',
    model,
    system: GEMINI_SYSTEM,
    parts: [
      imagePart({ mimeType: file.mimeType, base64: file.bytes.toString('base64') }),
      `File: ${file.name}. Read this drawing and fill every field of the schema. Use 0 for any number the drawing does not make clear (-1 for floors_above_ground, since 0 means ground only), "" for text and "unknown" for choices. Counts and areas cover the WHOLE building across all floors unless a field says otherwise.`,
    ],
    schema: GEMINI_DRAWING_SCHEMA,
    thinking: 'drawing',
    temperature: 0,
    mediaResolution: 'high',
    timeoutMs: DRAWING_TIMEOUT_MS,
  });
  return toGeminiExtraction(res.data);
}

/** Maps the strict-schema output onto `DrawingExtraction` v2; every number passes the `n()` rule, every choice an enum check. Exported for tests. */
export function toGeminiExtraction(raw: unknown): DrawingExtraction {
  const r = rec(raw);
  const floors =
    typeof r.floors_above_ground === 'number' && Number.isFinite(r.floors_above_ground) && r.floors_above_ground >= 0
      ? Math.min(4, Math.round(r.floors_above_ground))
      : null;
  const floorsDetail = (Array.isArray(r.floors_detail) ? r.floors_detail : [])
    .map(rec)
    .filter((f) => typeof f.level === 'number' && Number.isFinite(f.level))
    .slice(0, 12)
    .map((f) => ({
      level: Math.max(0, Math.min(10, Math.round(f.level as number))),
      label: text(f.label, 80),
      areaSqft: within(f.area_sqft, 50, 100_000),
      rooms: cnt(f.rooms, 50),
    }));
  const roomsByType = (Array.isArray(r.rooms_by_type) ? r.rooms_by_type : [])
    .map(rec)
    .filter((x) => oneOf(ROOM_TYPES, x.type) !== null && cnt(x.count, 40) !== null)
    .slice(0, 20)
    .map((x) => ({ type: x.type as DrawingRoomType, count: cnt(x.count, 40) as number, areaSqft: within(x.area_sqft, 10, 50_000) }));
  const doors = rec(r.doors),
    windows = rec(r.windows),
    st = rec(r.staircase),
    pk = rec(r.parking),
    col = rec(r.columns),
    sc = rec(r.scale),
    fc = rec(r.field_confidence);
  const drawingType = oneOf(DRAWING_KINDS, r.drawing_type);
  const staircase = { present: yes(st.present), material: oneOf(['rcc', 'steel', 'wood'] as const, st.material), flights: cnt(st.flights, 20) };
  const parking = { present: yes(pk.present), cars: cnt(pk.cars, 20), covered: yes(pk.covered) };
  const columns = { present: yes(col.present), count: cnt(col.count, 500) };
  const doorsDetail = { external: cnt(doors.external, 100), internal: cnt(doors.internal, 200), bathroom: cnt(doors.bathroom, 50) };
  const windowsDetail = { count: cnt(windows.count, 500), totalSqft: within(windows.total_sqft, 1, 50_000) };
  const scale = { stated: text(sc.stated, 40), pxPerFt: n(sc.px_per_ft) };
  const allNull = (o: Record<string, unknown>) => Object.values(o).every((v) => v === null);

  const fieldConfidence: Record<string, number> = {};
  const spread = (from: string, to: string[]) => {
    if (typeof fc[from] === 'number') for (const k of to) fieldConfidence[k] = clamp01(fc[from]);
  };
  spread('floors', ['floors']);
  spread('plot', ['plotLengthFt', 'plotWidthFt']);
  spread('built_up', ['builtUpSqft']);
  spread('rooms', ['rooms', 'bedrooms', 'bathrooms', 'kitchens']);
  spread('doors_windows', ['doors', 'windows']);
  spread('staircase', ['staircase']);
  spread('balcony', ['balconySqft']);
  spread('parking', ['parking']);
  spread('columns', ['columns']);
  spread('wall_thickness', ['wallThicknessIn']);
  spread('construction_type', ['constructionType']);

  const notes = text(r.notes, 600) ?? '';
  return {
    provider: 'gemini',
    floors,
    plotLengthFt: within(r.plot_length_ft, 8, 1000),
    plotWidthFt: within(r.plot_width_ft, 8, 1000),
    builtUpSqft: within(r.built_up_sqft, 100, 1_000_000),
    rooms: cnt(r.rooms_total, 200),
    doors: cnt(doors.total, 500),
    windows: cnt(windows.count, 500),
    constructionType: oneOf(['rcc_framed', 'load_bearing'] as const, r.construction_type),
    confidence: clamp01(r.confidence),
    notes: `${(drawingType ?? 'drawing').replace(/_/g, ' ')} · ${notes}`.trim(),
    drawingType,
    floorsDetail: floorsDetail.length ? floorsDetail : null,
    roomsByType: roomsByType.length ? roomsByType : null,
    bedrooms: cnt(r.bedrooms, 20),
    bathrooms: cnt(r.bathrooms, 20),
    kitchens: cnt(r.kitchens, 5),
    doorsDetail: allNull(doorsDetail) ? null : doorsDetail,
    windowsDetail: allNull(windowsDetail) ? null : windowsDetail,
    staircase: allNull(staircase) ? null : staircase,
    balconySqft: within(r.balcony_sqft, 1, 5000),
    parking: allNull(parking) ? null : parking,
    columns: allNull(columns) ? null : columns,
    orientation: oneOf(ORIENTATIONS, r.orientation),
    wallThicknessIn: within(r.wall_thickness_in, 3, 24),
    scale: allNull(scale) ? null : scale,
    fieldConfidence: Object.keys(fieldConfidence).length ? fieldConfidence : null,
  };
}

/* ── Anthropic (the v1 reader, unchanged apart from drawingType) ──────────── */
const claudeTool: Anthropic.Tool = {
  name: 'record_drawing_reading',
  description: 'Record what the architectural drawing shows. Null for anything the drawing does not make clear. Dimensions in feet, areas in square feet.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      drawing_type: { type: 'string', description: 'floor_plan | elevation | section | 3d_render | site_plan | other' },
      floors: {
        type: ['integer', 'null'],
        description: 'Number of floors ABOVE ground: 0 = ground only, 1 = G+1, … Read from elevation / labels such as "FIRST FLOOR PLAN".',
      },
      plot_length_ft: { type: ['number', 'null'], description: 'Overall plot or building length in feet (convert metres × 3.281).' },
      plot_width_ft: { type: ['number', 'null'], description: 'Overall plot or building width in feet.' },
      built_up_sqft: { type: ['number', 'null'], description: 'Total built-up area across all floors in sqft if stated or derivable; else null.' },
      rooms: { type: ['integer', 'null'], description: 'Count of rooms (bedrooms + living + kitchen + baths) visible on the plan.' },
      doors: { type: ['integer', 'null'], description: 'Door symbols counted.' },
      windows: { type: ['integer', 'null'], description: 'Window symbols counted.' },
      construction_type: {
        type: ['string', 'null'],
        description: 'rcc_framed if columns/beams are drawn, load_bearing if thick masonry walls without columns, else null.',
      },
      confidence: { type: 'number', description: '0–1 overall confidence in this reading.' },
      notes: { type: 'string', description: 'One or two sentences on what was read and what was assumed.' },
    },
    required: [
      'drawing_type',
      'floors',
      'plot_length_ft',
      'plot_width_ft',
      'built_up_sqft',
      'rooms',
      'doors',
      'windows',
      'construction_type',
      'confidence',
      'notes',
    ],
    additionalProperties: false,
  } as Anthropic.Tool['input_schema'],
};

async function readWithClaude(file: DrawingFile): Promise<DrawingExtraction> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const data = file.bytes.toString('base64');
  const part: Anthropic.ContentBlockParam =
    file.mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data } };
  const stream = client.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 4_000,
    system:
      'You read Indian residential architectural drawings (floor plans, elevations, sections, 3D renders) for a construction cost estimator. Report only what the drawing makes clear; leave unclear values null. Units: feet and square feet (convert from metres / mm). Do not round up to look complete.',
    tools: [claudeTool],
    tool_choice: { type: 'tool', name: claudeTool.name },
    messages: [{ role: 'user', content: [part, { type: 'text', text: `File: ${file.name}. Read this drawing and record the reading.` }] }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('The model declined to read this file.');
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === claudeTool.name);
  if (!block) throw new Error('No reading returned.');
  const r = block.input as Record<string, unknown>;
  return {
    provider: 'anthropic',
    floors: typeof r.floors === 'number' ? Math.max(0, Math.min(4, Math.round(r.floors))) : null,
    plotLengthFt: n(r.plot_length_ft),
    plotWidthFt: n(r.plot_width_ft),
    builtUpSqft: n(r.built_up_sqft),
    rooms: cnt(r.rooms, 200),
    doors: cnt(r.doors, 500),
    windows: cnt(r.windows, 500),
    constructionType: r.construction_type === 'rcc_framed' || r.construction_type === 'load_bearing' ? r.construction_type : null,
    confidence: clamp01(r.confidence),
    notes: `${String(r.drawing_type ?? 'drawing').replace(/_/g, ' ')} · ${String(r.notes ?? '')}`.trim(),
    drawingType: oneOf(DRAWING_KINDS, r.drawing_type),
  };
}

/* ── mock ─────────────────────────────────────────────────────────────────── */
/**
 * Mock reader — never pretends. It returns a typical AP/TS plot reading derived only from the
 * file's aspect ratio (landscape sheets read as wider plots) at confidence 0.2, with the v2
 * fields filled from the same sample so the prefill → highlight → confirm flow runs end to end,
 * and a note that names the key that unlocks the real reader.
 */
function mockReading(file: DrawingFile): DrawingExtraction {
  const dims = imageSize(file.bytes, file.mimeType);
  const landscape = dims ? dims.w >= dims.h : true;
  const c = 0.2;
  return {
    provider: 'mock',
    floors: 1,
    plotLengthFt: landscape ? 40 : 30,
    plotWidthFt: landscape ? 30 : 40,
    builtUpSqft: 1800,
    rooms: 5,
    doors: 8,
    windows: 10,
    constructionType: 'rcc_framed',
    confidence: c,
    notes: `Mock reading of ${file.name}${dims ? ` (${dims.w}×${dims.h}px)` : ''} — a typical G+1 on a 30×40 ft plot. Set GEMINI_API_KEY to read the actual drawing.`,
    drawingType: 'floor_plan',
    floorsDetail: [
      { level: 0, label: 'GROUND FLOOR PLAN (sample)', areaSqft: 900, rooms: 3 },
      { level: 1, label: 'FIRST FLOOR PLAN (sample)', areaSqft: 900, rooms: 2 },
    ],
    roomsByType: [
      { type: 'bedroom', count: 2, areaSqft: 300 },
      { type: 'bathroom', count: 1, areaSqft: 45 },
      { type: 'kitchen', count: 1, areaSqft: 100 },
      { type: 'living', count: 1, areaSqft: 250 },
    ],
    bedrooms: 2,
    bathrooms: 1,
    kitchens: 1,
    doorsDetail: { external: 2, internal: 5, bathroom: 1 },
    windowsDetail: { count: 10, totalSqft: null },
    staircase: { present: true, material: 'rcc', flights: 2 },
    balconySqft: null,
    parking: { present: false, cars: null, covered: null },
    columns: { present: true, count: null },
    orientation: null,
    wallThicknessIn: null,
    scale: null,
    fieldConfidence: {
      floors: c,
      plotLengthFt: c,
      plotWidthFt: c,
      builtUpSqft: c,
      rooms: c,
      bedrooms: c,
      bathrooms: c,
      kitchens: c,
      doors: c,
      windows: c,
      staircase: c,
      parking: c,
      columns: c,
      constructionType: c,
    },
  };
}

/** PNG / JPEG / WebP / GIF header parse — enough for an aspect ratio, no image library needed. */
export function imageSize(buf: Buffer, mime: string): { w: number; h: number } | null {
  try {
    if (mime === 'image/png' && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/webp' && buf.length > 30) {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}
