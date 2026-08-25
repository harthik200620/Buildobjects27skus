import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import { writeReport } from './paths';

export interface Usage {
  promptTokens: number;
  candidateTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export const ZERO_USAGE: Readonly<Usage> = Object.freeze({ promptTokens: 0, candidateTokens: 0, thoughtTokens: 0, cachedTokens: 0, totalTokens: 0 });

export function usageFromResponse(meta?: GenerateContentResponseUsageMetadata | null): Usage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const promptTokens = n(meta?.promptTokenCount);
  const candidateTokens = n(meta?.candidatesTokenCount);
  const thoughtTokens = n(meta?.thoughtsTokenCount);
  const cachedTokens = n(meta?.cachedContentTokenCount);
  const totalTokens = n(meta?.totalTokenCount) || promptTokens + candidateTokens + thoughtTokens;
  return { promptTokens, candidateTokens, thoughtTokens, cachedTokens, totalTokens };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    candidateTokens: a.candidateTokens + b.candidateTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** USD per 1M tokens. `cached` defaults to 25 % of `input`; `image_output` prices image tokens (≈1290 per image). */
export interface PriceEntry {
  input: number;
  output: number;
  cached?: number;
  image_output?: number;
}
export type PriceTable = Record<string, PriceEntry>;

/**
 * ESTIMATED list prices (USD / 1M tokens, paid tier, ≤ 200k context) as of the 2026-08 build — the
 * 3.x entries in particular are guesses pending the public price sheet. Every figure this module
 * reports is labelled `estimated`; set GEMINI_PRICE_JSON to the real sheet to make it `env`.
 * Longest-prefix match on the model id.
 */
export const BUILT_IN_PRICES: PriceTable = {
  'gemini-3.1-pro': { input: 2, output: 12 },
  'gemini-3-pro': { input: 2, output: 12 },
  'gemini-3.1-flash-image': { input: 0.5, output: 3, image_output: 60 },
  'gemini-3-flash': { input: 0.5, output: 3 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash-image': { input: 0.3, output: 2.5, image_output: 30 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  default: { input: 1, output: 5 },
};

/** Google Search grounding: ≈ $35 per 1 000 grounded prompts beyond the free allowance (estimated). */
export const GROUNDED_CALL_USD = 0.035;

export const USAGE_LOG_FILE = 'llm-usage.jsonl';

let envPrices: { raw: string; table: PriceTable | null } | null = null;

/** Built-in table merged with GEMINI_PRICE_JSON (same shape, e.g. {"gemini-2.5-flash":{"input":0.3,"output":2.5}}). */
export function priceTable(): { table: PriceTable; basis: 'estimated' | 'env' } {
  const raw = (process.env.GEMINI_PRICE_JSON ?? '').trim();
  if (!raw) return { table: BUILT_IN_PRICES, basis: 'estimated' };
  if (!envPrices || envPrices.raw !== raw) {
    let table: PriceTable | null = null;
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<PriceEntry>>;
      table = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.input === 'number' && typeof v.output === 'number') table[k] = { ...v, input: v.input, output: v.output };
      }
    } catch {
      console.warn('[llm] GEMINI_PRICE_JSON is not valid JSON — using the built-in estimated price table');
      table = null;
    }
    envPrices = { raw, table };
  }
  if (!envPrices.table) return { table: BUILT_IN_PRICES, basis: 'estimated' };
  return { table: { ...BUILT_IN_PRICES, ...envPrices.table }, basis: 'env' };
}

export function priceFor(model: string): { entry: PriceEntry; matched: string; basis: 'estimated' | 'env' } {
  const { table, basis } = priceTable();
  const id = model.replace(/^models\//, '').toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (key === 'default') continue;
    if (id.startsWith(key.toLowerCase()) && (best === null || key.length > best.length)) best = key;
  }
  const matched = best ?? 'default';
  return { entry: table[matched] ?? BUILT_IN_PRICES.default, matched, basis };
}

export function estimateCostUsd(
  model: string,
  usage: Usage,
  opts: { grounded?: boolean; imageOutput?: boolean } = {},
): { usd: number; basis: 'estimated' | 'env'; matched: string } {
  const { entry, matched, basis } = priceFor(model);
  const perToken = (usd: number) => usd / 1_000_000;
  const cachedRate = entry.cached ?? entry.input * 0.25;
  const freshPrompt = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const outRate = opts.imageOutput && entry.image_output !== undefined ? entry.image_output : entry.output;
  let usd = freshPrompt * perToken(entry.input) + usage.cachedTokens * perToken(cachedRate) + (usage.candidateTokens + usage.thoughtTokens) * perToken(outRate);
  if (opts.grounded) usd += GROUNDED_CALL_USD;
  return { usd: Math.round(usd * 1e6) / 1e6, basis, matched };
}

export type UsageMode = 'strict' | 'grounded' | 'text' | 'image';

export interface UsageRecordInput {
  caller: string;
  sku?: string;
  model: string;
  mode: UsageMode;
  usage: Usage;
  grounded?: boolean;
  latencyMs: number;
  ok: boolean;
  status?: number;
  attempts?: number;
  error?: string;
}

export interface UsageRecord {
  ts: string;
  caller: string;
  sku?: string;
  model: string;
  mode: UsageMode;
  prompt_tokens: number;
  candidate_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  grounded: boolean;
  latency_ms: number;
  ok: boolean;
  status?: number;
  attempts?: number;
  error?: string;
  est_usd: number;
  price_basis: 'estimated' | 'env';
}

interface Bucket {
  calls: number;
  failed: number;
  tokens: number;
  estUsd: number;
}

export interface UsageSummary {
  calls: number;
  failed: number;
  usage: Usage;
  estUsd: number;
  priceBasis: 'estimated' | 'env';
  byCaller: Record<string, Bucket>;
  byModel: Record<string, Bucket>;
}

const summary: { calls: number; failed: number; usage: Usage; estUsd: number; byCaller: Record<string, Bucket>; byModel: Record<string, Bucket> } = {
  calls: 0,
  failed: 0,
  usage: { ...ZERO_USAGE },
  estUsd: 0,
  byCaller: {},
  byModel: {},
};

function bump(map: Record<string, Bucket>, key: string, rec: UsageRecord): void {
  const b = (map[key] ??= { calls: 0, failed: 0, tokens: 0, estUsd: 0 });
  b.calls += 1;
  if (!rec.ok) b.failed += 1;
  b.tokens += rec.total_tokens;
  b.estUsd += rec.est_usd;
}

/**
 * Appends one JSON line to storage/reports/llm-usage.jsonl (write errors swallowed) and updates the
 * in-memory summary. Called by `generate.ts` after every call, successful or not. Never throws.
 */
export function recordUsage(input: UsageRecordInput): UsageRecord {
  const cost = input.ok
    ? estimateCostUsd(input.model, input.usage, { grounded: input.grounded, imageOutput: input.mode === 'image' })
    : { usd: 0, basis: priceTable().basis, matched: 'n/a' };
  const rec: UsageRecord = {
    ts: new Date().toISOString(),
    caller: input.caller,
    ...(input.sku ? { sku: input.sku } : {}),
    model: input.model,
    mode: input.mode,
    prompt_tokens: input.usage.promptTokens,
    candidate_tokens: input.usage.candidateTokens,
    thought_tokens: input.usage.thoughtTokens,
    cached_tokens: input.usage.cachedTokens,
    total_tokens: input.usage.totalTokens,
    grounded: !!input.grounded,
    latency_ms: Math.round(input.latencyMs),
    ok: input.ok,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
    ...(input.error ? { error: input.error.slice(0, 300) } : {}),
    est_usd: cost.usd,
    price_basis: cost.basis,
  };
  summary.calls += 1;
  if (!rec.ok) summary.failed += 1;
  summary.usage = addUsage(summary.usage, input.usage);
  summary.estUsd += rec.est_usd;
  bump(summary.byCaller, rec.caller, rec);
  bump(summary.byModel, rec.model, rec);
  try {
    writeReport(USAGE_LOG_FILE, `${JSON.stringify(rec)}\n`, 'append');
  } catch {
    /* never fail a call over the log */
  }
  return rec;
}

/** In-memory totals for this process (the pipeline prints it at the end of a run; /api/health exposes it). */
export function usageSummary(): UsageSummary {
  return {
    calls: summary.calls,
    failed: summary.failed,
    usage: { ...summary.usage },
    estUsd: Math.round(summary.estUsd * 1e6) / 1e6,
    priceBasis: priceTable().basis,
    byCaller: structuredClone(summary.byCaller),
    byModel: structuredClone(summary.byModel),
  };
}

/** @internal */
export function __resetUsageForTests(): void {
  summary.calls = 0;
  summary.failed = 0;
  summary.usage = { ...ZERO_USAGE };
  summary.estUsd = 0;
  summary.byCaller = {};
  summary.byModel = {};
  envPrices = null;
}
