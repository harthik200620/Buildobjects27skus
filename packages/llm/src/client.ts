import { GoogleGenAI } from '@google/genai';
import { LlmUnavailableError } from './errors';

/**
 * The key is read from process.env at call time — never at import time and never logged. The
 * pipeline loads .env through `@buildobjects/db`'s `loadEnv()`; apps/web has it in the environment.
 * This module deliberately does not import dotenv.
 */
const apiKey = (): string => (process.env.GEMINI_API_KEY ?? '').trim();

/** True when GEMINI_API_KEY is present. Every live feature gates on this and degrades to a labelled mock otherwise. */
export const hasGemini = (): boolean => apiKey().length > 0;

/** Per-request HTTP timeout (GEMINI_TIMEOUT_MS, default 120 s). */
export function geminiTimeoutMs(): number {
  const n = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120_000;
}

let cached: { key: string; ai: GoogleGenAI } | null = null;

/**
 * Lazy singleton over `@google/genai`. Re-created only when the key changes (tests, key rotation).
 * The SDK's own retry (`retryOptions.attempts: 4`) covers transient 408/429/5xx blips with a fast
 * 1/2/4 s backoff; `generate.ts` adds the slower, quota-aware retry on top.
 * Throws `LlmUnavailableError` without a key — check `hasGemini()` first.
 */
export function geminiClient(): GoogleGenAI {
  const key = apiKey();
  if (!key) throw new LlmUnavailableError();
  if (cached && cached.key === key) return cached.ai;
  cached = {
    key,
    ai: new GoogleGenAI({ apiKey: key, httpOptions: { timeout: geminiTimeoutMs(), retryOptions: { attempts: 4 } } }),
  };
  return cached.ai;
}

/** @internal */
export function __resetClientForTests(): void {
  cached = null;
}
