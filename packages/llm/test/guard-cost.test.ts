import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetUsageForTests,
  BUILT_IN_PRICES,
  estimateCostUsd,
  GROUNDED_CALL_USD,
  priceFor,
  recordUsage,
  USAGE_LOG_FILE,
  usageFromResponse,
  usageSummary,
  ZERO_USAGE,
} from '../src/cost';
import { LlmBudgetError } from '../src/errors';
import { __resetGuardsForTests, dailyBudget, dailyCallCap, parseRateSpec, rateLimit, takeDailyCall } from '../src/guard';
import { __setStorageRootForTests } from '../src/paths';
import { cleanup, freshState, reportFile } from './setup';

vi.mock('@google/genai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@google/genai')>();
  const m = await import('./genai-mock');
  return { ...orig, GoogleGenAI: m.GoogleGenAI };
});

let tmp: string;
beforeEach(() => {
  tmp = freshState();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(tmp);
  vi.restoreAllMocks();
});

describe('rateLimit', () => {
  it('is a sliding window per key', () => {
    expect(rateLimit('ip:1', 2, 1000, 0)).toEqual({ ok: true, limit: 2, remaining: 1, retryAfterMs: 0 });
    expect(rateLimit('ip:1', 2, 1000, 10)).toEqual({ ok: true, limit: 2, remaining: 0, retryAfterMs: 0 });
    expect(rateLimit('ip:1', 2, 1000, 20)).toEqual({ ok: false, limit: 2, remaining: 0, retryAfterMs: 980 });
    expect(rateLimit('ip:2', 2, 1000, 20).ok).toBe(true); // other keys unaffected
    expect(rateLimit('ip:1', 2, 1000, 1000).ok).toBe(true); // first stamp expired
    expect(rateLimit('ip:1', 2, 1000, 1001).ok).toBe(false);
  });

  it('parseRateSpec reads "calls/seconds"', () => {
    expect(parseRateSpec('5/600')).toEqual({ limit: 5, windowMs: 600_000 });
    expect(parseRateSpec(' 30 / 60 ')).toEqual({ limit: 30, windowMs: 60_000 });
    expect(parseRateSpec('nope')).toBeNull();
    expect(parseRateSpec(undefined)).toBeNull();
    expect(parseRateSpec('0/10')).toBeNull();
  });
});

describe('daily call cap', () => {
  it('defaults to 2000, honours GEMINI_DAILY_CALL_CAP, throws LlmBudgetError at the cap', () => {
    expect(dailyCallCap()).toBe(2000);
    process.env.GEMINI_DAILY_CALL_CAP = '2';
    expect(takeDailyCall('a')).toMatchObject({ used: 1, cap: 2, remaining: 1 });
    expect(takeDailyCall('a')).toMatchObject({ used: 2, remaining: 0 });
    expect(() => takeDailyCall('a')).toThrow(LlmBudgetError);
    expect(dailyBudget()).toMatchObject({ used: 2, cap: 2, remaining: 0 });
  });

  it('seeds today from the tail of llm-usage.jsonl once per process', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    fs.mkdirSync(reportFile(tmp, ''), { recursive: true });
    const lines = [
      JSON.stringify({ ts: `${yesterday}T10:00:00.000Z`, caller: 'x', ok: true }),
      JSON.stringify({ ts: `${today}T01:00:00.000Z`, caller: 'x', ok: true }),
      JSON.stringify({ ts: `${today}T02:00:00.000Z`, caller: 'y', ok: false }),
      JSON.stringify({ ts: `${today}T03:00:00.000Z`, caller: 'z', ok: true }),
    ];
    fs.writeFileSync(reportFile(tmp, USAGE_LOG_FILE), `${lines.join('\n')}\n`);
    __resetGuardsForTests();
    expect(dailyBudget().used).toBe(3);
    expect(takeDailyCall('a').used).toBe(4);
  });
});

describe('cost', () => {
  it('usageFromResponse tolerates missing metadata', () => {
    expect(usageFromResponse(undefined)).toEqual(ZERO_USAGE);
    expect(usageFromResponse({ promptTokenCount: 10, candidatesTokenCount: 5 })).toEqual({
      promptTokens: 10,
      candidateTokens: 5,
      thoughtTokens: 0,
      cachedTokens: 0,
      totalTokens: 15,
    });
  });

  it('estimates with longest-prefix model matching and marks the basis', () => {
    const usage = { promptTokens: 100_000, candidateTokens: 10_000, thoughtTokens: 0, cachedTokens: 0, totalTokens: 110_000 };
    expect(estimateCostUsd('gemini-2.5-flash', usage)).toEqual({ usd: 0.055, basis: 'estimated', matched: 'gemini-2.5-flash' });
    expect(estimateCostUsd('gemini-2.5-flash', usage, { grounded: true }).usd).toBeCloseTo(0.055 + GROUNDED_CALL_USD, 6);
    expect(priceFor('gemini-2.5-flash-lite-preview-06-17').matched).toBe('gemini-2.5-flash-lite');
    expect(priceFor('models/gemini-2.5-flash-image').matched).toBe('gemini-2.5-flash-image');
    expect(priceFor('gemini-3.1-pro-preview').entry).toEqual(BUILT_IN_PRICES['gemini-3.1-pro']);
    expect(priceFor('some-unknown-model').matched).toBe('default');
    const cached = { ...usage, cachedTokens: 50_000 };
    expect(estimateCostUsd('gemini-2.5-flash', cached).usd).toBeCloseTo(50_000 * 0.3e-6 + 50_000 * 0.075e-6 + 10_000 * 2.5e-6, 6);
    const image = { promptTokens: 500, candidateTokens: 1290, thoughtTokens: 0, cachedTokens: 0, totalTokens: 1790 };
    expect(estimateCostUsd('gemini-2.5-flash-image', image, { imageOutput: true }).usd).toBeCloseTo(500 * 0.3e-6 + 1290 * 30e-6, 6);
  });

  it('GEMINI_PRICE_JSON overrides entries and flips the basis to env', () => {
    process.env.GEMINI_PRICE_JSON = JSON.stringify({ 'gemini-2.5-flash': { input: 1, output: 1 } });
    __resetUsageForTests();
    const usage = { promptTokens: 100_000, candidateTokens: 10_000, thoughtTokens: 0, cachedTokens: 0, totalTokens: 110_000 };
    expect(estimateCostUsd('gemini-2.5-flash', usage)).toEqual({ usd: 0.11, basis: 'env', matched: 'gemini-2.5-flash' });
    expect(estimateCostUsd('gemini-2.5-pro', usage).basis).toBe('env');
    process.env.GEMINI_PRICE_JSON = '{not json';
    __resetUsageForTests();
    expect(estimateCostUsd('gemini-2.5-flash', usage).basis).toBe('estimated');
  });

  it('recordUsage appends JSON lines and aggregates; an unwritable root never throws', () => {
    const usage = { promptTokens: 1000, candidateTokens: 100, thoughtTokens: 50, cachedTokens: 0, totalTokens: 1150 };
    const rec = recordUsage({
      caller: 'pipeline.extract',
      sku: 'CEM-1',
      model: 'gemini-2.5-pro',
      mode: 'strict',
      usage,
      latencyMs: 1234.6,
      ok: true,
      attempts: 1,
    });
    expect(rec).toMatchObject({
      caller: 'pipeline.extract',
      sku: 'CEM-1',
      model: 'gemini-2.5-pro',
      mode: 'strict',
      prompt_tokens: 1000,
      candidate_tokens: 100,
      thought_tokens: 50,
      total_tokens: 1150,
      grounded: false,
      latency_ms: 1235,
      ok: true,
      attempts: 1,
      price_basis: 'estimated',
    });
    expect(rec.est_usd).toBeCloseTo(1000 * 1.25e-6 + 150 * 10e-6, 9);
    recordUsage({
      caller: 'pipeline.verify',
      model: 'gemini-2.5-flash',
      mode: 'grounded',
      usage,
      grounded: true,
      latencyMs: 10,
      ok: false,
      status: 503,
      attempts: 5,
      error: 'gave up',
    });
    const lines = fs.readFileSync(reportFile(tmp, USAGE_LOG_FILE), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ caller: 'pipeline.verify', ok: false, status: 503, est_usd: 0, error: 'gave up' });
    const s = usageSummary();
    expect(s.calls).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.usage.totalTokens).toBe(2300);
    expect(s.byCaller['pipeline.extract']).toMatchObject({ calls: 1, failed: 0, tokens: 1150 });
    expect(s.byModel['gemini-2.5-flash']).toMatchObject({ calls: 1, failed: 1 });
    expect(s.priceBasis).toBe('estimated');

    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    __setStorageRootForTests(blocker);
    expect(() => recordUsage({ caller: 'x', model: 'gemini-2.5-flash', mode: 'text', usage, latencyMs: 1, ok: true })).not.toThrow();
    expect(usageSummary().calls).toBe(3);
  });
});
