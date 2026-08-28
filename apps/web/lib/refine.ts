import 'server-only';
import { createHash } from 'node:crypto';
import { clamp01 } from '@buildobjects/catalog';
import {
  ADJUSTMENT_CLAMP,
  type EstimateInputs,
  type EstimateResult,
  estimate,
  type LineItem,
  normalizeInputs,
  RATES_VERSION,
  TIER_LABEL,
  type Tier,
} from '@buildobjects/estimator';
import {
  arr,
  defaultModel,
  enumOf,
  generateJson,
  hasGemini,
  type JsonSchema,
  LlmUnavailableError,
  num,
  obj,
  resolveCitation,
  resolveModel,
  score,
  str,
} from '@buildobjects/llm';
import { z } from 'zod';
import { loadCalculatorCatalog } from './estimator';
import { dailyUsed, refineLimits } from './rate-limit';

/**
 * AI review ("refine") of a cost estimate — Gemini flash with Google Search grounding checks the
 * estimate's SEED lines (thumb-rule rates × city index) against current AP/TS dealer and
 * schedule-of-rates prices and proposes corrections. Store-priced lines never leave the server.
 *
 * ── HTTP contract (apps/web/app/api/estimate/refine/route.ts) ────────────────────────────────
 *   GET  /api/estimate/refine                → 200 RefineStatus  { live, provider, unlock, model, limits, cacheSeconds, maxSuggestions }
 *   POST /api/estimate/refine { inputs }     → 200 RefineResponse (see below)
 *        400 { error }                         body is not { inputs: object }
 *        401 { error: 'unauthenticated' }      no valid bo_session cookie (the proxy normally answers first)
 *        429 { error, retryAfterMs, ... }      per-IP+session window (REFINE_RATE_LIMIT, default 5/600 s), the
 *                                              per-process day cap (REFINE_DAILY_CAP, default 200) or the Gemini-wide
 *                                              GEMINI_DAILY_CALL_CAP — always with a `Retry-After` header (seconds)
 *        502 { error }                         the model answered but not with a usable review / API failure
 *        503 { error, unlock: 'GEMINI_API_KEY', provider: 'off' }   no key — never a fake review
 *        504 { error }                         the review did not finish inside the route's deadline
 *   Cache: 10 min in memory by sha1(JSON(normalizeInputs(inputs) sans adjustments)); a hit answers `cached: true`
 *   and does NOT consume the per-IP window. Response header `Cache-Control: private, no-store`.
 *
 * ── RefineResponse ───────────────────────────────────────────────────────────────────────────
 *   { provider: 'gemini', model, suggestions: RefineSuggestion[], notes, ratesVersion, generatedAt, cached,
 *     reviewed (seed lines sent), sources (resolved URLs behind the kept suggestions) }
 *   RefineSuggestion = { line_key, label, field: 'rate' | 'qty', unit, current, suggested, delta_pct, reason,
 *     source_url, source_quote, source_date, confidence, verified_quote, unverified, capped }
 *     current / suggested are ₹ per unit for `rate`, a quantity in `unit` for `qty`; `suggested` is already
 *     clamped to ±35 % of `current` (`capped: true` when the model asked for more — the engine clamps the same way);
 *     `source_url` is only ever a URL that `resolveCitation()` resolved (Google redirect followed; ≤ 5 per review);
 *     `verified_quote` = the rupee figure the model cited was found in the fetched page text (3 s fetch);
 *     `unverified` = no resolvable URL, a dead page, or a source older than 12 months — then `confidence ≤ 0.5`.
 *   Accepting a suggestion in the UI = pushing an Adjustment onto `inputs.adjustments`:
 *     { line_key, rate: suggested }  (or { qty: suggested }), reason, source_url, provenance: 'ai_suggested' }
 *   and re-running `estimate()` — the engine re-clamps, flags the line `needsVerification` and records it in
 *   `result.adjustments`. Saved estimates keep both `inputs.adjustments` and `outputs.adjustments`.
 */

export const MAX_SUGGESTIONS = 12;
export const MAX_CITATIONS = 5;
export const REFINE_CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
/** The model call (retries included) must finish inside this — the route's maxDuration is 60 s. */
const MODEL_TIMEOUT_MS = 40_000;
const OUTER_TIMEOUT_MS = 48_000;
const CITATION_TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 3_000;
const PAGE_MAX_BYTES = 1_000_000;
const SOURCE_MAX_AGE_MONTHS = 12;
const PAGE_UA = 'Mozilla/5.0 (compatible; BuildObjectsBot/1.0; price-quote check)';

export type RefineField = 'rate' | 'qty';

export interface RefineSuggestion {
  line_key: string;
  label: string;
  field: RefineField;
  unit: string;
  current: number;
  suggested: number;
  delta_pct: number;
  reason: string;
  source_url: string | null;
  source_quote: string | null;
  source_date: string | null;
  confidence: number;
  verified_quote: boolean;
  unverified: boolean;
  capped: boolean;
}

export interface RefineResponse {
  provider: 'gemini';
  model: string;
  suggestions: RefineSuggestion[];
  notes: string;
  ratesVersion: string;
  generatedAt: string;
  cached: boolean;
  reviewed: number;
  sources: string[];
}

export interface RefineStatus {
  live: boolean;
  provider: 'gemini' | 'off';
  unlock: 'GEMINI_API_KEY' | null;
  /** The configured / preferred flash model; discovery may pick another listed one at call time. */
  model: string | null;
  limits: { perWindow: number; windowSeconds: number; dailyCap: number; dailyUsed: number };
  cacheSeconds: number;
  maxSuggestions: number;
}

/* ── what the model sees ─────────────────────────────────────────────────── */

export interface ReviewLine {
  key: string;
  label: string;
  qty: number;
  unit: string;
  rate: number;
  basis: string;
  thumb: boolean;
}

/** Seed-rate lines with a per-unit rate. Store-priced lines and derived lump sums (`lot`) are never reviewed. */
export function reviewableLines(lines: LineItem[]): ReviewLine[] {
  return lines
    .filter((l) => l.rateSource === 'seed' && l.unit !== 'lot' && l.rate > 0)
    .map((l) => ({ key: l.key, label: l.label, qty: l.qty, unit: l.unit, rate: l.rate, basis: l.note ?? '', thumb: l.needsVerification }));
}

export interface ReviewContext {
  cityName: string;
  stateName: string;
  cityIndex: number;
  tier: Tier;
  builtUpSqft: number;
  floorsLabel: string;
  constructionType: string;
  ratesVersion: string;
  /** YYYY-MM-DD */
  today: string;
  lines: ReviewLine[];
}

export function reviewContext(inputs: EstimateInputs, result: EstimateResult, today = new Date()): ReviewContext {
  const d = result.derived;
  return {
    cityName: d.cityName,
    stateName: d.stateName,
    cityIndex: d.cityIndex,
    tier: inputs.tier,
    builtUpSqft: Math.round(d.builtUpSqft),
    floorsLabel: d.floorsLabel,
    constructionType: inputs.constructionType.replace(/_/g, ' '),
    ratesVersion: result.version,
    today: today.toISOString().slice(0, 10),
    lines: reviewableLines(result.lines),
  };
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** ISO date `months` before an ISO date (UTC). */
export function monthsBefore(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export const REFINE_SYSTEM = [
  'You are a quantity surveyor reviewing a house-construction cost estimate for Andhra Pradesh / Telangana, India.',
  "The estimate's lines carry thumb-rule rates (a published rate card scaled by a city index).",
  "Use Google Search to check each line's rate against CURRENT market prices — dealer price lists, manufacturer MRPs, government schedules of rates (AP / Telangana SoR), trade-portal quotes — and suggest a correction only where a source shows a materially different figure for the same unit.",
  'You never invent a number: every suggestion quotes the verbatim text where the rupee figure appears and the URL of the page you saw it on.',
  'Answer with JSON only.',
].join(' ');

export function buildReviewPrompt(ctx: ReviewContext): string {
  const since = monthsBefore(ctx.today, SOURCE_MAX_AGE_MONTHS);
  const rows = ctx.lines.map(
    (l) =>
      `- ${l.key} | ${l.label} | ${fmt(l.qty)} ${l.unit} | ₹${fmt(l.rate)}/${l.unit} | ${l.basis || 'rate card'}${l.thumb ? ' (thumb value, unverified)' : ''}`,
  );
  return [
    `Estimate: ${ctx.cityName}, ${ctx.stateName} (city cost index ${ctx.cityIndex.toFixed(2)}), quality tier ${TIER_LABEL[ctx.tier]}, ${ctx.builtUpSqft} sqft built-up, ${ctx.floorsLabel}, ${ctx.constructionType}. Rate card version ${ctx.ratesVersion}. Today is ${ctx.today}.`,
    '',
    'Lines to review (key | label | quantity | current rate | basis):',
    ...rows,
    '',
    'Rules:',
    `1. Search for current dealer, manufacturer or government schedule-of-rates prices for Andhra Pradesh / Telangana published on or after ${since}; national Indian dealer prices are acceptable when no AP/TS figure exists. Ignore anything older.`,
    '2. Suggest a change only when a source shows a figure at least 5 % away from the current rate for the SAME unit (convert: 1 tonne = 1000 kg, 1 m³ = 35.31 cft, 1 m² = 10.764 sqft, a cement bag = 50 kg). Skip lines whose rate already matches the market.',
    '3. field "rate" carries ₹ per unit of the line. field "qty" is only for a quantity that contradicts a standard thumb rule you can cite (e.g. steel kg per sqft of built-up area) — never both for one line.',
    '4. Never invent a figure. source_quote must be the verbatim text containing the rupee figure, source_url the page you saw it on, source_date its publication or observation date. Leave them "" when you have none — such a suggestion is shown as unverified.',
    `5. At most ${MAX_SUGGESTIONS} suggestions, one per line key, keys verbatim from the list. Put the overall picture and caveats (GST treatment, transport, brand premiums, seasonal moves) in notes.`,
  ].join('\n');
}

/* ── schema ───────────────────────────────────────────────────────────────── */

export const REFINE_SCHEMA: JsonSchema = obj({
  suggestions: arr(
    obj({
      line_key: str('The line key exactly as listed'),
      field: enumOf(['rate', 'qty'], "rate = ₹ per unit of the line; qty = quantity in the line's unit (only with a citable norm)"),
      suggested: num("The figure from the source, converted to the line's unit", { minimum: 0 }),
      reason: str('One sentence: what the source says and why it applies to this city and tier'),
      source_url: str('The page URL where the rupee figure appears; "" when you have none'),
      source_quote: str('Verbatim sentence or table cell containing the rupee figure; "" when none'),
      source_date: str('Publication or observation date of the source as YYYY-MM-DD or YYYY-MM; "" when unknown'),
      confidence: score('How sure you are that the figure applies to this line, city and tier'),
    }),
    { description: `At most ${MAX_SUGGESTIONS}, one per line key, only where a source shows a materially different figure`, maxItems: MAX_SUGGESTIONS },
  ),
  notes: str('Two or three sentences: what was checked, which lines look fine, caveats'),
});

const SuggestionZ = z.object({
  line_key: z.string(),
  field: z.enum(['rate', 'qty']),
  suggested: z.coerce.number(),
  reason: z.string().default(''),
  source_url: z.string().default(''),
  source_quote: z.string().default(''),
  source_date: z.string().default(''),
  confidence: z.coerce.number().default(0.5),
});
export const ReviewZ = z.object({ suggestions: z.array(SuggestionZ).default([]), notes: z.string().default('') });
export type ReviewRaw = z.infer<typeof ReviewZ>;

/* ── citation verification ───────────────────────────────────────────────── */

export interface PageText {
  ok: boolean;
  status: number;
  text: string;
}

/** Strips scripts, styles, tags and the common entities; collapses whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (m, c: string) => {
      const n = Number(c);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

async function readUpTo(res: Response, maxBytes: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== 'function') return typeof res.text === 'function' ? await res.text() : '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** GET the page (3 s, ≤ 1 MB) and return its visible text; `null` on a network error / timeout, `ok: false` on a non-2xx status. PDFs and binaries yield empty text. */
export async function fetchPageText(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<PageText | null> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? PAGE_TIMEOUT_MS),
      headers: { 'user-agent': PAGE_UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    });
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, text: '' };
    }
    const type = res.headers?.get?.('content-type') ?? '';
    if (type && !/text\/|html|xml|json/i.test(type)) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: true, status: res.status, text: '' };
    }
    return { ok: true, status: res.status, text: htmlToText(await readUpTo(res, opts.maxBytes ?? PAGE_MAX_BYTES)) };
  } catch {
    return null;
  }
}

/** The ways a rupee figure is written: plain, Western and Indian grouping, and the decimal forms for non-integers. */
export function figureVariants(value: number): string[] {
  if (!Number.isFinite(value) || value <= 0) return [];
  const out = new Set<string>();
  const add = (n: number) => {
    out.add(String(n));
    out.add(n.toLocaleString('en-US'));
    out.add(n.toLocaleString('en-IN'));
  };
  add(Math.round(value));
  if (!Number.isInteger(value)) {
    out.add(String(value));
    out.add(value.toFixed(2));
    out.add(value.toFixed(1));
    add(Math.floor(value));
    add(Math.ceil(value));
  }
  return [...out];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the figure appears in the text as a whole number token (not inside a longer number). */
export function figureAppears(text: string, value: number): boolean {
  if (!text) return false;
  return figureVariants(value).some((v) => new RegExp(`(?<![\\d,.])${escapeRe(v)}(?!\\d|,\\d)`).test(text));
}

/** `YYYY-MM-DD` or `YYYY-MM` → Date (UTC, first of the month when no day); null when unparseable. */
export function parseSourceDate(s: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s ?? '');
  if (!m) return null;
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = m[3] ? Number(m[3]) : 1;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isStale(date: Date, today: Date, months = SOURCE_MAX_AGE_MONTHS): boolean {
  const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  return date.getTime() < limit.getTime();
}

const cleanText = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The guardrails, pure and exported for tests:
 *   - unknown / store-priced keys are dropped (only `lines` — the seed lines that were sent — count), one suggestion per line, ≤ 12;
 *   - `suggested` is clamped to ±35 % of the engine's value (`capped`), rounded like the engine, no-ops (< 0.5 %) dropped;
 *   - `source_url` is the resolved URL for the model's URL (from `citations`), else null;
 *   - `verified_quote` when the figure the model cited appears in the fetched page text;
 *   - `unverified` (confidence ≤ 0.5) when there is no resolved URL, the page is dead, or the source is older than 12 months.
 */
export function applyGuardrails(
  raw: ReviewRaw,
  lines: ReviewLine[],
  citations: Map<string, string | null>,
  pages: Map<string, PageText | null>,
  today: Date,
): RefineSuggestion[] {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const out: RefineSuggestion[] = [];
  for (const s of raw.suggestions) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const line = byKey.get(s.line_key);
    if (!line || seen.has(s.line_key)) continue;
    const want = Number(s.suggested);
    if (!Number.isFinite(want) || want <= 0) continue;
    const current = s.field === 'qty' ? line.qty : line.rate;
    if (!(current > 0)) continue;
    const round = (v: number) => (s.field === 'rate' ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);
    const suggested = round(Math.min(current * (1 + ADJUSTMENT_CLAMP), Math.max(current * (1 - ADJUSTMENT_CLAMP), want)));
    const capped = suggested !== round(want);
    const delta_pct = Math.round(((suggested - current) / current) * 1000) / 10;
    if (Math.abs(delta_pct) < 0.5) continue;
    seen.add(s.line_key);
    const given = s.source_url.trim();
    const url = /^https?:\/\//i.test(given) ? (citations.get(given) ?? null) : null;
    const page = url ? (pages.get(url) ?? null) : null;
    const date = parseSourceDate(s.source_date);
    const stale = date !== null && isStale(date, today);
    const dead = page !== null && !page.ok;
    const unverified = !url || dead || stale;
    const verified_quote = !!url && !!page?.ok && figureAppears(page.text, want);
    let confidence = clamp01(s.confidence);
    if (unverified) confidence = Math.min(confidence, 0.5);
    let reason = cleanText(s.reason, 240);
    if (stale)
      reason = `${reason}${reason ? ' · ' : ''}source dated ${cleanText(s.source_date, 10)} (older than ${SOURCE_MAX_AGE_MONTHS} months)`.slice(0, 240);
    out.push({
      line_key: line.key,
      label: line.label,
      field: s.field,
      unit: line.unit,
      current,
      suggested,
      delta_pct,
      reason,
      source_url: url,
      source_quote: cleanText(s.source_quote, 300) || null,
      source_date: date ? cleanText(s.source_date, 10) : null,
      confidence,
      verified_quote,
      unverified,
      capped,
    });
  }
  return out;
}

async function mapLimit<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

/* ── cache ────────────────────────────────────────────────────────────────── */

const cache = new Map<string, { at: number; value: RefineResponse }>();

/** sha1 of the normalised inputs without their adjustments — the same estimate reviewed twice costs one call. */
export function refineCacheKey(inputs: Partial<EstimateInputs> | Record<string, unknown>): string {
  const { adjustments: _adjustments, ...rest } = normalizeInputs(inputs as Partial<EstimateInputs>);
  void _adjustments;
  return createHash('sha1').update(JSON.stringify(rest)).digest('hex');
}

export function getCachedReview(key: string, now = Date.now()): RefineResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > REFINE_CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function putCache(key: string, value: RefineResponse, now: number): void {
  for (const [k, v] of cache) if (now - v.at > REFINE_CACHE_MS) cache.delete(k);
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { at: now, value });
}

/* ── the review ───────────────────────────────────────────────────────────── */

export interface ReviewOptions {
  /** Precomputed `refineCacheKey` (the route computes it for its cache check). */
  key?: string;
  now?: Date;
  /** Test seam for the citation / page fetches. */
  fetchImpl?: typeof fetch;
}

/**
 * Recomputes the estimate server-side (adjustments stripped, so the engine's own values are reviewed),
 * sends the seed lines to Gemini flash with Google Search, verifies the citations and applies the
 * guardrails. Throws `LlmUnavailableError` without a key, `LlmBudgetError` on the Gemini day cap,
 * `LlmOutputError` when the model's JSON is unusable — the route maps them to 503 / 429 / 502.
 */
export async function reviewEstimate(inputs: EstimateInputs, opts: ReviewOptions = {}): Promise<RefineResponse> {
  if (!hasGemini()) throw new LlmUnavailableError();
  const now = opts.now ?? new Date();
  const key = opts.key ?? refineCacheKey(inputs);
  const cached = getCachedReview(key, now.getTime());
  if (cached) return { ...cached, cached: true };

  const clean: EstimateInputs = { ...normalizeInputs(inputs), adjustments: [] };
  const catalog = await loadCalculatorCatalog(clean.picks?.map((p) => p.sku_code) ?? []);
  const result = estimate(clean, catalog, { tiers: false });
  const ctx = reviewContext(clean, result, now);
  if (ctx.lines.length === 0) {
    return {
      provider: 'gemini',
      model: 'none',
      suggestions: [],
      notes: 'Every line is priced by the store — nothing to review.',
      ratesVersion: RATES_VERSION,
      generatedAt: now.toISOString(),
      cached: false,
      reviewed: 0,
      sources: [],
    };
  }

  const model = await resolveModel('flash');
  const res = await generateJson<ReviewRaw>({
    caller: 'calculator.refine',
    model,
    system: REFINE_SYSTEM,
    parts: [buildReviewPrompt(ctx)],
    schema: REFINE_SCHEMA,
    zod: ReviewZ,
    tools: [{ googleSearch: {} }],
    thinking: 'refine',
    temperature: 0.2,
    timeoutMs: MODEL_TIMEOUT_MS,
    signal: AbortSignal.timeout(OUTER_TIMEOUT_MS),
  });

  // Only a URL that resolveCitation() resolved counts as a source — the first MAX_CITATIONS distinct ones.
  const candidates = [...new Set(res.data.suggestions.map((s) => s.source_url.trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_CITATIONS);
  const citations = new Map<string, string | null>();
  await Promise.all(
    candidates.map(async (u) => {
      citations.set(u, await resolveCitation(u, { timeoutMs: CITATION_TIMEOUT_MS, fetchImpl: opts.fetchImpl }).catch(() => null));
    }),
  );
  const urls = [...new Set([...citations.values()].filter((u): u is string => !!u))];
  const pages = new Map<string, PageText | null>();
  await mapLimit(urls, 3, async (u) => {
    pages.set(u, await fetchPageText(u, { timeoutMs: PAGE_TIMEOUT_MS, fetchImpl: opts.fetchImpl }));
  });

  const suggestions = applyGuardrails(res.data, ctx.lines, citations, pages, now);
  const response: RefineResponse = {
    provider: 'gemini',
    model: res.model,
    suggestions,
    notes: cleanText(res.data.notes, 800),
    ratesVersion: RATES_VERSION,
    generatedAt: now.toISOString(),
    cached: false,
    reviewed: ctx.lines.length,
    sources: [...new Set(suggestions.map((s) => s.source_url).filter((u): u is string => !!u))],
  };
  putCache(key, response, now.getTime());
  return response;
}

export function refineStatus(): RefineStatus {
  const live = hasGemini();
  const { window, dailyCap } = refineLimits();
  return {
    live,
    provider: live ? 'gemini' : 'off',
    unlock: live ? null : 'GEMINI_API_KEY',
    model: live ? defaultModel('flash') : null,
    limits: { perWindow: window.limit, windowSeconds: Math.round(window.windowMs / 1000), dailyCap, dailyUsed: dailyUsed('refine') },
    cacheSeconds: REFINE_CACHE_MS / 1000,
    maxSuggestions: MAX_SUGGESTIONS,
  };
}
