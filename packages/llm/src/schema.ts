/**
 * Gemini-compatible JSON Schema helpers. The API accepts only a subset of JSON Schema (type, enum,
 * items, properties, required, min/max, anyOf …) and rejects `type: ['number', 'null']` unions on
 * several generations — so "nullable" is expressed with a sentinel value described in the prompt
 * (`nullableViaSentinel`) and mapped back with `fromSentinel`.
 */
export type JsonSchema = Record<string, unknown>;

const withDesc = (schema: JsonSchema, description?: string): JsonSchema => (description ? { ...schema, description } : schema);

export const str = (description?: string, extra: { minLength?: number; maxLength?: number; format?: string } = {}): JsonSchema =>
  withDesc({ type: 'string', ...extra }, description);
export const num = (description?: string, extra: { minimum?: number; maximum?: number } = {}): JsonSchema =>
  withDesc({ type: 'number', ...extra }, description);
export const int = (description?: string, extra: { minimum?: number; maximum?: number } = {}): JsonSchema =>
  withDesc({ type: 'integer', ...extra }, description);
export const bool = (description?: string): JsonSchema => withDesc({ type: 'boolean' }, description);
export const enumOf = (values: readonly string[], description?: string): JsonSchema => withDesc({ type: 'string', enum: [...values] }, description);
export const arr = (items: JsonSchema, opts: { description?: string; minItems?: number; maxItems?: number } = {}): JsonSchema => {
  const { description, ...rest } = opts;
  return withDesc({ type: 'array', items, ...rest }, description);
};
/** Object schema; every property is required unless `required` lists a subset ('none' = all optional). */
export const obj = (properties: Record<string, JsonSchema>, opts: { required?: readonly string[] | 'all' | 'none'; description?: string } = {}): JsonSchema => {
  const req = opts.required ?? 'all';
  const required = req === 'all' ? Object.keys(properties) : req === 'none' ? [] : [...req];
  return withDesc({ type: 'object', properties, ...(required.length ? { required } : {}) }, opts.description);
};
/** 0–1 score with the convention spelled out for the model. */
export const score = (description: string): JsonSchema => num(`${description} (0–1)`, { minimum: 0, maximum: 1 });

/** Sentinels that stand in for null: numbers use -1, strings use '' (the prompt explains both). */
export const SENTINEL = Object.freeze({ number: -1, string: '' });

/** Appends the sentinel rule to the schema description instead of widening the type with null. */
export function nullableViaSentinel(schema: JsonSchema, sentinel: number | string = schema.type === 'string' ? SENTINEL.string : SENTINEL.number): JsonSchema {
  const rule = `Use ${JSON.stringify(sentinel)} when unknown or not applicable.`;
  const description = typeof schema.description === 'string' && schema.description ? `${schema.description} ${rule}` : rule;
  return { ...schema, description };
}

export function fromSentinel<T>(value: T, sentinel: number | string = typeof value === 'string' ? SENTINEL.string : SENTINEL.number): T | null {
  return (value as unknown) === sentinel ? null : value;
}

/** Guard used before sending a schema: no null unions anywhere (they 400 on several generations). */
export function assertGeminiSchema(schema: unknown, path = '$'): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.type)) throw new Error(`Gemini schema at ${path}: union types are not supported (${JSON.stringify(s.type)}) — use nullableViaSentinel`);
  if (s.type === 'null') throw new Error(`Gemini schema at ${path}: type null is not supported`);
  if (s.properties && typeof s.properties === 'object')
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) assertGeminiSchema(v, `${path}.${k}`);
  if (s.items) assertGeminiSchema(s.items, `${path}[]`);
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const)
    if (Array.isArray(s[key]))
      (s[key] as unknown[]).forEach((v, i) => {
        assertGeminiSchema(v, `${path}.${key}[${i}]`);
      });
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Trim, NFC-normalise, drop zero-width characters, collapse whitespace (incl. NBSP), strip wrapping quotes/backticks. */
export function cleanString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).normalize('NFC').replace(ZERO_WIDTH, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    const same = /^(["'`])(.*)\1$/.exec(s);
    const curly = /^[“”‘’](.*)[“”‘’]$/.exec(s);
    const inner = same ? same[2] : curly ? curly[1] : null;
    if (inner === null) break;
    s = inner.trim();
  }
  return s;
}

export interface CoercionResult {
  value: string | number | boolean | null;
  /** Subtract from the model's confidence (0–0.5): 0 = clean, larger = more interpretation was needed. */
  confidencePenalty: number;
  /** Why the value was transformed or dropped — becomes `AttributeValue.note` downstream. */
  note?: string;
}

const EMPTY_TOKENS = new Set([
  '',
  '-',
  '—',
  '–',
  'n/a',
  'na',
  'none',
  'nil',
  'null',
  'unknown',
  'not specified',
  'not available',
  'unspecified',
  'not applicable',
  'tbd',
  '?',
]);
const EXACT_TRUE = new Set(['yes', 'y', 'true', '1', '✓', '✔']);
const EXACT_FALSE = new Set(['no', 'n', 'false', '0', '✗', '✘']);
const FALSE_START = /^(no|not|non|none|nil|without|un(?:available|marked|supported|certified))\b/i;
const TRUE_WORD = /\b(yes|true|available|provided|included|supported|compliant|present|applicable|marked|certified|conforms?|complies)\b/i;
const NUM_RE = /-?\d+(?:[,\d]*\d)?(?:\.\d+)?/;
const RANGE_REST = /^\s*(?:[-–—~]|to|x|×|\/|,|and|or)\s*-?\d/i;

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
const short = (s: string) => s.slice(0, 80);

/**
 * Re-validates a model-supplied value against the registry attribute's data type (`text | number |
 * boolean | enum`). Nothing is invented: anything that cannot be interpreted becomes `null` with a
 * note, and every transformation (first number of a range, enum token match, …) carries a
 * confidence penalty for the caller to subtract.
 */
export function coerceByDataType(attr: { data_type: string; enum_values?: string[] | null; unit?: string | null }, raw: unknown): CoercionResult {
  if (raw === null || raw === undefined) return { value: null, confidencePenalty: 0 };
  const v = typeof raw === 'string' ? cleanString(raw) : raw;
  if (typeof v === 'string' && EMPTY_TOKENS.has(v.toLowerCase())) return { value: null, confidencePenalty: 0 };
  switch (attr.data_type) {
    case 'number':
      return coerceNumber(v, attr.unit ?? null);
    case 'boolean':
      return coerceBoolean(v);
    case 'enum':
      return attr.enum_values?.length ? coerceEnum(v, attr.enum_values) : coerceText(v);
    default:
      return coerceText(v);
  }
}

function coerceNumber(v: unknown, unit: string | null): CoercionResult {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, confidencePenalty: 0 } : { value: null, confidencePenalty: 0, note: 'non-finite number' };
  if (typeof v === 'boolean') return { value: null, confidencePenalty: 0, note: `boolean ${v} given for a numeric attribute` };
  const s = String(v);
  const m = NUM_RE.exec(s);
  if (!m) return { value: null, confidencePenalty: 0, note: `no numeric value in "${short(s)}"` };
  const n = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) return { value: null, confidencePenalty: 0, note: `unparseable number in "${short(s)}"` };
  const rest = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`.trim();
  if (!rest || squash(rest) === squash(unit ?? '')) return { value: n, confidencePenalty: 0 };
  if (RANGE_REST.test(s.slice(m.index + m[0].length))) return { value: n, confidencePenalty: 0.15, note: `took the first number of "${short(s)}"` };
  if (/[a-z%°]/i.test(rest)) return { value: n, confidencePenalty: 0.1, note: `extracted ${n} from "${short(s)}"${unit ? ` (expected unit ${unit})` : ''}` };
  return { value: n, confidencePenalty: 0.05, note: `extracted ${n} from "${short(s)}"` };
}

function coerceBoolean(v: unknown): CoercionResult {
  if (typeof v === 'boolean') return { value: v, confidencePenalty: 0 };
  if (typeof v === 'number')
    return v === 1 || v === 0
      ? { value: v === 1, confidencePenalty: 0 }
      : { value: null, confidencePenalty: 0, note: `number ${v} given for a boolean attribute` };
  const s = String(v).trim();
  const lower = s.toLowerCase();
  if (EXACT_TRUE.has(lower)) return { value: true, confidencePenalty: 0 };
  if (EXACT_FALSE.has(lower)) return { value: false, confidencePenalty: 0 };
  if (FALSE_START.test(s)) return { value: false, confidencePenalty: 0.1, note: `read "${short(s)}" as false` };
  if (TRUE_WORD.test(s)) return { value: true, confidencePenalty: 0.1, note: `read "${short(s)}" as true` };
  return { value: null, confidencePenalty: 0, note: `unrecognised boolean "${short(s)}"` };
}

function coerceEnum(v: unknown, allowed: string[]): CoercionResult {
  const s = typeof v === 'string' ? v : String(v);
  const exact = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
  if (exact) return { value: exact, confidencePenalty: 0 };
  const fuzzy = allowed.find((a) => squash(a) && squash(a) === squash(s));
  if (fuzzy) return { value: fuzzy, confidencePenalty: 0.05, note: `matched "${short(s)}" to ${fuzzy}` };
  const lower = s.toLowerCase();
  const hits = allowed
    .map((a) => ({ a, at: wordIndex(lower, a.toLowerCase()) }))
    .filter((h) => h.at >= 0)
    .sort((x, y) => x.at - y.at);
  if (hits.length === 1) return { value: hits[0].a, confidencePenalty: 0.1, note: `took ${hits[0].a} from "${short(s)}"` };
  if (hits.length > 1)
    return { value: hits[0].a, confidencePenalty: 0.25, note: `several allowed values in "${short(s)}" (${hits.map((h) => h.a).join(', ')}) — kept the first` };
  return { value: null, confidencePenalty: 0, note: `"${short(s)}" is not one of: ${allowed.join(' | ')}` };
}

function wordIndex(haystack: string, needle: string): number {
  if (!needle) return -1;
  const re = new RegExp(`(?:^|[^a-z0-9])(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^a-z0-9])`, 'i');
  const m = re.exec(haystack);
  return m ? m.index + m[0].indexOf(m[1]) : -1;
}

function coerceText(v: unknown): CoercionResult {
  const s = typeof v === 'string' ? v : cleanString(String(v));
  if (!s) return { value: null, confidencePenalty: 0 };
  if (s.length > 512) return { value: s.slice(0, 512).trim(), confidencePenalty: 0.05, note: `truncated from ${s.length} characters` };
  return { value: s, confidencePenalty: 0 };
}
