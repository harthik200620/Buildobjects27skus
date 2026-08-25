import {
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  MediaResolution,
  type Part,
  type ThinkingConfig,
  type Tool,
} from '@google/genai';
import type { ZodType } from 'zod';
import { geminiClient, geminiTimeoutMs } from './client';
import { recordUsage, type Usage, type UsageMode, usageFromResponse, ZERO_USAGE } from './cost';
import { LlmError, LlmOutputError } from './errors';
import { takeDailyCall } from './guard';
import { type ThinkingIntent, thinkingFor } from './models';
import { assertGeminiSchema, type JsonSchema } from './schema';

// ── public types ─────────────────────────────────────────────────────────────

export type LlmPart = Part | string;
export interface ImageInput {
  mimeType: string;
  base64: string;
}
export const imagePart = (img: ImageInput): Part => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } });

export type MediaRes = 'low' | 'medium' | 'high' | MediaResolution;
/** An intent name resolved through `thinkingFor(model, intent)`, an explicit config, or 'none' (model default). */
export type ThinkingOption = ThinkingIntent | ThinkingConfig | 'none';

export interface CitationSupport {
  text?: string;
  startIndex?: number;
  endIndex?: number;
  confidence?: number;
}
/** One grounding source. `uri` is Google's redirect URL — store only `resolveCitation(uri)` as provenance. */
export interface Citation {
  index: number;
  uri: string;
  title?: string;
  domain?: string;
  supports: CitationSupport[];
}

export interface BaseCallOptions {
  /** Stage / feature name for the usage log, e.g. 'pipeline.extract', 'ar.analyze'. */
  caller: string;
  sku?: string;
  model: string;
  system?: string;
  parts: LlmPart[];
  temperature?: number;
  maxOutputTokens?: number;
  /** e.g. `[{ googleSearch: {} }]` — implies grounded mode for generateJson unless `mode` says otherwise. */
  tools?: Tool[];
  thinking?: ThinkingOption;
  mediaResolution?: MediaRes;
  signal?: AbortSignal;
  /** Per-call deadline; default GEMINI_TIMEOUT_MS (120 s). Combined with `signal` via AbortSignal.any. */
  timeoutMs?: number;
}

export interface CallMeta {
  usage: Usage;
  grounding: Citation[];
  searchQueries: string[];
  model: string;
  modelVersion?: string;
  latencyMs: number;
  attempts: number;
}

export interface GenerateJsonOptions<T> extends BaseCallOptions {
  schema: JsonSchema;
  zod?: ZodType<T>;
  /** strict = JSON mode + responseJsonSchema; grounded = schema in the prompt (needed with search tools on some generations). */
  mode?: 'strict' | 'grounded';
}
export interface GenerateJsonResult<T> extends CallMeta {
  data: T;
  mode: 'strict' | 'grounded';
  raw: string;
}

export interface GenerateTextOptions extends BaseCallOptions {
  responseMimeType?: string;
}
export interface GenerateTextResult extends CallMeta {
  text: string;
}

export interface GenerateImageOptions {
  caller?: string;
  sku?: string;
  model: string;
  parts: LlmPart[];
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface GenerateImageResult {
  image: ImageInput;
  text?: string;
  usage: Usage;
  model: string;
  modelVersion?: string;
  latencyMs: number;
  attempts: number;
}

// ── process-wide gates: concurrency semaphore + requests-per-minute ──────────

const envInt = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

class Gate {
  active = 0;
  readonly waiters: (() => void)[] = [];
  stamps: number[] = [];
  constructor(
    readonly limit: number,
    readonly rpm: number,
  ) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    while (this.active >= this.limit) {
      throwIfAborted(signal);
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      for (;;) {
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < 60_000);
        if (this.stamps.length < this.rpm) {
          this.stamps.push(now);
          return;
        }
        await sleep(this.stamps[0] + 60_000 - now + 1, signal);
      }
    } catch (err) {
      this.release();
      throw err;
    }
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

let gate: Gate | null = null;
const getGate = (): Gate => (gate ??= new Gate(envInt('GEMINI_CONCURRENCY', 4), envInt('GEMINI_RPM', 30)));

/** Live view of the gates (health endpoints, debug panels). */
export function gateStatus(): { active: number; waiting: number; concurrency: number; rpm: number; usedLastMinute: number } {
  const g = getGate();
  const now = Date.now();
  return { active: g.active, waiting: g.waiters.length, concurrency: g.limit, rpm: g.rpm, usedLastMinute: g.stamps.filter((t) => now - t < 60_000).length };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new LlmError('The request was aborted', 'aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ErrorInfo {
  retryable: boolean;
  aborted: boolean;
  status?: number;
  retryDelayMs?: number;
  /** A 400 saying JSON mode / response schema is unsupported with the given tools. */
  jsonModeUnsupported: boolean;
  summary: string;
}

const STATUS_TEXT: Record<string, number> = {
  'request timeout': 408,
  'too many requests': 429,
  'internal server error': 500,
  'bad gateway': 502,
  'service unavailable': 503,
  'gateway timeout': 504,
};
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Classifies SDK/network errors. Handles both shapes `@google/genai` produces: `ApiError` (status +
 * JSON body, which may carry `retryDelay`) and the plain `Error('Retryable HTTP Error: …')` the
 * SDK throws once its own retry wrapper gives up.
 */
export function classifyError(err: unknown): ErrorInfo {
  const e = (err ?? {}) as { name?: string; message?: string; status?: unknown; cause?: unknown; code?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : String(err ?? '');
  if (name === 'AbortError' || name === 'TimeoutError' || (err instanceof LlmError && err.code === 'aborted')) {
    return { retryable: false, aborted: true, jsonModeUnsupported: false, summary: name || 'aborted' };
  }
  let status = typeof e.status === 'number' ? e.status : undefined;
  if (status === undefined) {
    const m = /"code"\s*:\s*(\d{3})\b/.exec(message);
    if (m) status = Number(m[1]);
  }
  if (status === undefined) {
    const m = /Retryable HTTP Error:\s*(.+?)\s*$/i.exec(message);
    if (m) status = STATUS_TEXT[m[1].trim().toLowerCase()];
  }
  const rd = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  const retryDelayMs = rd ? Math.ceil(Number(rd[1]) * 1000) : undefined;
  const causeMessage = e.cause instanceof Error ? `${e.cause.message} ${String((e.cause as { code?: unknown }).code ?? '')}` : '';
  const network = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR|socket hang up|network error/i.test(
    `${message} ${causeMessage} ${String(e.code ?? '')}`,
  );
  const retryableText = /RESOURCE_EXHAUSTED|UNAVAILABLE|Retryable HTTP Error|overloaded|try again later/i.test(message);
  const retryable = status !== undefined ? RETRYABLE_STATUS.has(status) || status >= 500 : retryableText || network;
  const jsonModeUnsupported =
    status === 400 && /unsupported|not supported|response[_ ]?mime[_ ]?type|json mode|function calling with a response/i.test(message);
  return {
    retryable,
    aborted: false,
    status,
    retryDelayMs,
    jsonModeUnsupported,
    summary: `${status ?? 'error'}: ${message.replace(/\s+/g, ' ').slice(0, 180)}`,
  };
}

export const MAX_ATTEMPTS = 5;

/** Jittered exponential backoff (1 s base, ×2, 30 s cap, 0.5–1.5× jitter) that never undercuts a server `retryDelay`. */
export function backoffMs(attempt: number, retryDelayMs?: number, rnd: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  const jittered = base * (0.5 + rnd());
  return Math.min(90_000, Math.max(retryDelayMs ?? 0, jittered)) + rnd() * 250;
}

const toParts = (parts: LlmPart[]): Part[] => parts.map((p) => (typeof p === 'string' ? { text: p } : p));

function mediaRes(v?: MediaRes): MediaResolution | undefined {
  if (!v) return undefined;
  if (v === 'low') return MediaResolution.MEDIA_RESOLUTION_LOW;
  if (v === 'medium') return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
  if (v === 'high') return MediaResolution.MEDIA_RESOLUTION_HIGH;
  return v;
}

function resolveThinking(model: string, t?: ThinkingOption): ThinkingConfig | undefined {
  if (!t || t === 'none') return undefined;
  return typeof t === 'string' ? thinkingFor(model, t) : t;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** Text of the first candidate (works on the SDK class and on plain objects). */
export function responseText(res: GenerateContentResponse): string {
  const direct = (res as { text?: unknown }).text;
  if (typeof direct === 'string') return direct;
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

/** Citations from `groundingMetadata.groundingChunks[].web` joined with their `groundingSupports`. */
export function extractGrounding(res: GenerateContentResponse): { citations: Citation[]; searchQueries: string[] } {
  const gm = res.candidates?.[0]?.groundingMetadata;
  const byIndex = new Map<number, Citation>();
  const citations: Citation[] = [];
  (gm?.groundingChunks ?? []).forEach((chunk, index) => {
    const uri = chunk.web?.uri;
    if (!uri) return;
    const c: Citation = { index, uri, supports: [] };
    if (chunk.web?.title) c.title = chunk.web.title;
    if (chunk.web?.domain) c.domain = chunk.web.domain;
    byIndex.set(index, c);
    citations.push(c);
  });
  for (const s of gm?.groundingSupports ?? []) {
    (s.groundingChunkIndices ?? []).forEach((idx, k) => {
      const c = byIndex.get(idx);
      if (!c) return;
      const support: CitationSupport = {};
      if (typeof s.segment?.text === 'string') support.text = s.segment.text;
      if (typeof s.segment?.startIndex === 'number') support.startIndex = s.segment.startIndex;
      if (typeof s.segment?.endIndex === 'number') support.endIndex = s.segment.endIndex;
      const conf = s.confidenceScores?.[k];
      if (typeof conf === 'number') support.confidence = conf;
      c.supports.push(support);
    });
  }
  return { citations, searchQueries: (gm?.webSearchQueries ?? []).filter((q): q is string => typeof q === 'string') };
}

/** Strips a ```json fence (anywhere in the text) and returns the inside; otherwise the text unchanged. */
export function stripCodeFences(text: string): string {
  const m = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  return m ? m[1].trim() : text.trim();
}

/** JSON.parse with fence stripping and a first-bracket → last-bracket rescue for chatty outputs. */
export function parseJsonLoose(text: string): unknown {
  const t = stripCodeFences(text);
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const starts = ['{', '['].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) throw new LlmOutputError('The model returned no JSON', text);
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end <= start) throw new LlmOutputError('The model returned unterminated JSON', text);
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (err) {
    throw new LlmOutputError('The model returned invalid JSON', text, err);
  }
}

function schemaInstruction(schema: JsonSchema): string {
  return `Respond with ONE JSON document and nothing else — no markdown fences, no commentary before or after. It must conform exactly to this JSON Schema (every required key present, enum values verbatim):\n${JSON.stringify(schema)}`;
}

// ── the single call path (gates, timeout, retries, usage log) ────────────────

interface CallSpec {
  opts: BaseCallOptions;
  config: GenerateContentConfig;
  extraParts?: Part[];
  mode: UsageMode;
}

interface CallOutcome {
  res: GenerateContentResponse;
  attempts: number;
  latencyMs: number;
}

async function callModel(spec: CallSpec): Promise<CallOutcome> {
  const { opts } = spec;
  takeDailyCall(opts.caller);
  const ai = geminiClient();
  const signal = withTimeout(opts.signal, opts.timeoutMs ?? geminiTimeoutMs());
  const config: GenerateContentConfig = { ...spec.config, abortSignal: signal };
  if (opts.system) config.systemInstruction = opts.system;
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) config.maxOutputTokens = opts.maxOutputTokens;
  if (opts.tools?.length) config.tools = opts.tools;
  const thinking = resolveThinking(opts.model, opts.thinking);
  if (thinking) config.thinkingConfig = thinking;
  const mr = mediaRes(opts.mediaResolution);
  if (mr) config.mediaResolution = mr;
  const parts = [...toParts(opts.parts), ...(spec.extraParts ?? [])];
  const req: GenerateContentParameters = { model: opts.model, contents: [{ role: 'user', parts }], config };
  const grounded = !!opts.tools?.length;
  const g = getGate();
  const t0 = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    throwIfAborted(signal);
    try {
      await g.acquire(signal);
      let res: GenerateContentResponse;
      try {
        res = await ai.models.generateContent(req);
      } finally {
        g.release();
      }
      return { res, attempts: attempt, latencyMs: Date.now() - t0 };
    } catch (err) {
      const info = classifyError(err);
      if (info.aborted || !info.retryable || attempt >= MAX_ATTEMPTS) {
        recordUsage({
          caller: opts.caller,
          sku: opts.sku,
          model: opts.model,
          mode: spec.mode,
          usage: ZERO_USAGE,
          grounded,
          latencyMs: Date.now() - t0,
          ok: false,
          status: info.status,
          attempts: attempt,
          error: info.summary,
        });
        throw err;
      }
      const delay = backoffMs(attempt, info.retryDelayMs);
      console.warn(`[llm] ${opts.caller} ${opts.model}: ${info.summary} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(delay)} ms`);
      await sleep(delay, signal);
    }
  }
}

function finishMeta(opts: BaseCallOptions, mode: UsageMode, out: CallOutcome): CallMeta {
  const usage = usageFromResponse(out.res.usageMetadata);
  const { citations, searchQueries } = extractGrounding(out.res);
  recordUsage({
    caller: opts.caller,
    sku: opts.sku,
    model: opts.model,
    mode,
    usage,
    grounded: !!opts.tools?.length,
    latencyMs: out.latencyMs,
    ok: true,
    attempts: out.attempts,
  });
  const meta: CallMeta = { usage, grounding: citations, searchQueries, model: opts.model, latencyMs: out.latencyMs, attempts: out.attempts };
  if (typeof out.res.modelVersion === 'string') meta.modelVersion = out.res.modelVersion;
  return meta;
}

function validateWithZod<T>(zod: ZodType<T> | undefined, parsed: unknown, raw: string): T {
  if (!zod) return parsed as T;
  const r = zod.safeParse(parsed);
  if (r.success) return r.data;
  const issues = r.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '$'}: ${i.message}`)
    .join('; ');
  throw new LlmOutputError(`The model's JSON failed schema validation: ${issues}`, raw, r.error);
}

function finishJson<T>(opts: GenerateJsonOptions<T>, mode: 'strict' | 'grounded', out: CallOutcome): GenerateJsonResult<T> {
  const raw = responseText(out.res);
  const meta = finishMeta(opts, mode, out);
  const parsed = parseJsonLoose(raw);
  const data = validateWithZod(opts.zod, parsed, raw);
  return { ...meta, data, mode, raw };
}

/** Models on which JSON mode + tools returned 400 in this process — later grounded calls skip the strict try. */
const groundedFallbackModels = new Set<string>();

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Structured output. `strict` (default without tools) = `responseMimeType: application/json` +
 * `responseJsonSchema`. `grounded` (default with tools) = try strict once, and when the API answers
 * 400 "unsupported" for JSON mode with search, fall back to the schema in the prompt + fence strip +
 * JSON.parse + zod. `GEMINI_GROUNDED_STRICT_JSON=0` skips the strict try. Retries 429/503-class
 * errors with jittered backoff (honouring `retryDelay`), never a 400 schema error.
 */
export async function generateJson<T = unknown>(opts: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
  assertGeminiSchema(opts.schema);
  const grounded = opts.mode === 'grounded' || (opts.mode === undefined && !!opts.tools?.length);
  const tryStrict = !grounded || (process.env.GEMINI_GROUNDED_STRICT_JSON !== '0' && !groundedFallbackModels.has(opts.model));
  if (tryStrict) {
    try {
      const out = await callModel({ opts, mode: 'strict', config: { responseMimeType: 'application/json', responseJsonSchema: opts.schema } });
      return finishJson(opts, 'strict', out);
    } catch (err) {
      if (!grounded || !classifyError(err).jsonModeUnsupported) throw err;
      groundedFallbackModels.add(opts.model);
      console.warn(`[llm] ${opts.model}: JSON mode is not supported together with tools — using the schema-in-prompt fallback for this model`);
    }
  }
  const extraParts: Part[] = [{ text: schemaInstruction(opts.schema) }];
  let lastErr: unknown;
  for (let i = 0; i < 2; i++) {
    const out = await callModel({ opts, mode: 'grounded', config: {}, extraParts });
    try {
      return finishJson(opts, 'grounded', out);
    } catch (err) {
      if (!(err instanceof LlmOutputError) || i === 1) throw err;
      lastErr = err;
      console.warn(`[llm] ${opts.caller} ${opts.model}: grounded answer was not valid JSON — asking once more`);
    }
  }
  throw lastErr;
}

/** Plain text (or any `responseMimeType`) with the same gates, retries and usage log. */
export async function generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
  const config: GenerateContentConfig = {};
  if (opts.responseMimeType) config.responseMimeType = opts.responseMimeType;
  const out = await callModel({ opts, mode: 'text', config });
  return { ...finishMeta(opts, 'text', out), text: responseText(out.res) };
}

/** Image generation / editing (`responseModalities: ['IMAGE']`). Returns the first inline image. */
export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const base: BaseCallOptions = {
    caller: opts.caller ?? 'image',
    sku: opts.sku,
    model: opts.model,
    parts: opts.parts,
    temperature: opts.temperature,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    thinking: 'none',
  };
  const out = await callModel({ opts: base, mode: 'image', config: { responseModalities: ['IMAGE'] } });
  const parts = (out.res.candidates ?? []).flatMap((c) => c.content?.parts ?? []);
  const img = parts.find((p) => p.inlineData?.data)?.inlineData;
  const usage = usageFromResponse(out.res.usageMetadata);
  recordUsage({
    caller: base.caller,
    sku: base.sku,
    model: base.model,
    mode: 'image',
    usage,
    latencyMs: out.latencyMs,
    ok: !!img?.data,
    attempts: out.attempts,
    error: img?.data ? undefined : 'no image in response',
  });
  if (!img?.data) throw new LlmOutputError('The image model returned no image', responseText(out.res));
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text as string)
    .join('');
  const result: GenerateImageResult = {
    image: { mimeType: img.mimeType ?? 'image/png', base64: img.data },
    usage,
    model: base.model,
    latencyMs: out.latencyMs,
    attempts: out.attempts,
  };
  if (text) result.text = text;
  if (typeof out.res.modelVersion === 'string') result.modelVersion = out.res.modelVersion;
  return result;
}

// ── citation resolution ──────────────────────────────────────────────────────

const GOOGLE_REDIRECT = /^https?:\/\/(?:vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/|www\.google\.com\/url\?)/i;
const CITATION_UA = 'Mozilla/5.0 (compatible; BuildObjectsBot/1.0; provenance check)';
const citationCache = new Map<string, Promise<string | null>>();

export const isGoogleRedirect = (uri: string): boolean => GOOGLE_REDIRECT.test(uri);

/**
 * Follows the redirect behind a grounding `uri` (HEAD, then GET when HEAD is refused; 8 s budget)
 * and returns the final URL — the only thing provenance may store. `null` when the URL is not
 * http(s), the request fails, or the final hop is still a Google redirect. Cached per process.
 */
export function resolveCitation(uri: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  if (!/^https?:\/\//i.test(uri)) return Promise.resolve(null);
  const cached = citationCache.get(uri);
  if (cached) return cached;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const pending = (async (): Promise<string | null> => {
    const attempt = async (method: 'HEAD' | 'GET'): Promise<Response> => {
      const res = await fetchImpl(uri, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': CITATION_UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      if (method === 'GET') {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      }
      return res;
    };
    let res: Response | null = null;
    try {
      res = await attempt('HEAD');
    } catch {
      res = null;
    }
    if (!res || res.status === 405 || res.status === 403 || res.status === 404 || res.status >= 500) {
      try {
        res = await attempt('GET');
      } catch {
        if (!res) return null;
      }
    }
    const finalUrl = typeof res.url === 'string' && res.url ? res.url : null;
    if (!finalUrl || !/^https?:\/\//i.test(finalUrl) || isGoogleRedirect(finalUrl)) return null;
    return finalUrl;
  })();
  citationCache.set(uri, pending);
  pending.then(
    (v) => {
      if (v === null) citationCache.delete(uri);
    },
    () => citationCache.delete(uri),
  );
  return pending;
}

/** Resolves many citations with bounded parallelism; the map keeps input order. */
export async function resolveCitations(
  uris: string[],
  opts: { concurrency?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, string | null>> {
  const unique = [...new Set(uris)];
  const out = new Map<string, string | null>();
  const width = Math.max(1, opts.concurrency ?? 4);
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const uri = unique[next++];
      out.set(uri, await resolveCitation(uri, opts));
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, unique.length) }, worker));
  return new Map(uris.map((u) => [u, out.get(u) ?? null]));
}

/** @internal */
export function __resetGenerateForTests(): void {
  gate = null;
  groundedFallbackModels.clear();
  citationCache.clear();
}
