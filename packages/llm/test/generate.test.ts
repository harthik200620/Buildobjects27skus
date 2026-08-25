import { ApiError } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { usageSummary } from '../src/cost';
import { LlmBudgetError, LlmOutputError, LlmUnavailableError } from '../src/errors';
import {
  __resetGenerateForTests,
  backoffMs,
  classifyError,
  extractGrounding,
  gateStatus,
  generateImage,
  generateJson,
  generateText,
  parseJsonLoose,
} from '../src/generate';
import { dailyBudget } from '../src/guard';
import { num, obj, str } from '../src/schema';
import * as mock from './genai-mock';
import { cleanup, freshState } from './setup';

vi.mock('@google/genai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@google/genai')>();
  const m = await import('./genai-mock');
  return { ...orig, GoogleGenAI: m.GoogleGenAI };
});

const schema = obj({ a: num('a number') });
const A = z.object({ a: z.number() });
const body = (code: number, message: string, status: string, retryDelay?: string) =>
  JSON.stringify({
    error: { code, message, status, ...(retryDelay ? { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } : {}) },
  });
const BODY_429 = body(429, 'You exceeded your current quota, please check your plan and billing details.', 'RESOURCE_EXHAUSTED', '2s');
const BODY_400_JSON = body(400, "Function calling with a response mime type: 'application/json' is unsupported", 'INVALID_ARGUMENT');
const BODY_400_SCHEMA = body(
  400,
  'Invalid JSON payload received. Unknown name "foo" at \'generation_config.response_json_schema\': Cannot find field.',
  'INVALID_ARGUMENT',
);
const GROUNDED_META = {
  groundingChunks: [
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC', title: 'Havells Adore LED', domain: 'havells.com' } },
    { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/DeF', title: 'Dealer page' } },
    { retrievedContext: { uri: 'gs://x' } },
  ],
  groundingSupports: [{ segment: { startIndex: 0, endIndex: 8, text: '{"a": 5}' }, groundingChunkIndices: [0, 1], confidenceScores: [0.91, 0.4] }],
  webSearchQueries: ['havells adore led price'],
};

let tmp: string;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  tmp = freshState();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  cleanup(tmp);
  vi.restoreAllMocks();
});

describe('generateJson — strict mode', () => {
  it('sends JSON mode + responseJsonSchema, parses, validates with zod, records usage', async () => {
    mock.generateContent.mockResolvedValue(mock.okResponse('{"a": 1}'));
    const r = await generateJson({
      caller: 'test.strict',
      sku: 'SKU-1',
      model: 'gemini-2.5-flash',
      system: 'be terse',
      parts: ['hi'],
      schema,
      zod: A,
      temperature: 0,
      thinking: 'judge',
      maxOutputTokens: 200,
    });
    expect(r.data).toEqual({ a: 1 });
    expect(r.mode).toBe('strict');
    expect(r.model).toBe('gemini-2.5-flash');
    expect(r.modelVersion).toBe('mock-version');
    expect(r.attempts).toBe(1);
    expect(r.usage).toEqual({ promptTokens: 100, candidateTokens: 20, thoughtTokens: 5, cachedTokens: 0, totalTokens: 125 });
    expect(r.grounding).toEqual([]);
    const req = mock.lastRequest();
    expect(req.model).toBe('gemini-2.5-flash');
    expect(req.contents[0].parts).toEqual([{ text: 'hi' }]);
    expect(req.config.responseMimeType).toBe('application/json');
    expect(req.config.responseJsonSchema).toEqual(schema);
    expect(req.config.systemInstruction).toBe('be terse');
    expect(req.config.temperature).toBe(0);
    expect(req.config.maxOutputTokens).toBe(200);
    expect(req.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(req.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(req.config.tools).toBeUndefined();
    const s = usageSummary();
    expect(s.calls).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.byCaller['test.strict'].calls).toBe(1);
    expect(s.estUsd).toBeGreaterThan(0);
    expect(dailyBudget().used).toBe(1);
  });

  it('rejects with LlmOutputError when the JSON does not match the zod schema (no retry)', async () => {
    mock.generateContent.mockResolvedValue(mock.okResponse('{"a": "not a number"}'));
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema, zod: A })).rejects.toBeInstanceOf(LlmOutputError);
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
  });

  it('refuses schemas with null unions before any call', async () => {
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema: obj({ a: { type: ['number', 'null'] } }) })).rejects.toThrow(/union types/);
    expect(mock.generateContent).not.toHaveBeenCalled();
  });

  it('throws LlmUnavailableError without a key', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema })).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe('generateJson — grounded mode', () => {
  it('tries strict once, falls back to schema-in-prompt on a 400 "unsupported", strips fences and extracts citations', async () => {
    mock.generateContent.mockRejectedValueOnce(new ApiError({ status: 400, message: BODY_400_JSON })).mockResolvedValueOnce(
      mock.okResponse('Here you go:\n```json\n{"a": 5}\n```\nDone.', {
        candidates: [{ content: { parts: [{ text: '{"a": 5}' }] }, groundingMetadata: GROUNDED_META }],
      }),
    );
    const tools = [{ googleSearch: {} }];
    const r = await generateJson({ caller: 'test.grounded', model: 'gemini-2.5-flash', parts: ['find the price'], schema, zod: A, tools });
    expect(r.data).toEqual({ a: 5 });
    expect(r.mode).toBe('grounded');
    expect(mock.generateContent).toHaveBeenCalledTimes(2);
    const first = mock.generateContent.mock.calls[0][0] as ReturnType<typeof mock.lastRequest>;
    expect(first.config.responseMimeType).toBe('application/json');
    expect(first.config.tools).toEqual(tools);
    const second = mock.lastRequest();
    expect(second.config.responseMimeType).toBeUndefined();
    expect(second.config.responseJsonSchema).toBeUndefined();
    expect(second.config.tools).toEqual(tools);
    const lastPart = second.contents[0].parts[second.contents[0].parts.length - 1];
    expect(lastPart.text).toContain('JSON Schema');
    expect(lastPart.text).toContain('"a"');
    expect(r.grounding).toHaveLength(2);
    expect(r.grounding[0]).toEqual({
      index: 0,
      uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC',
      title: 'Havells Adore LED',
      domain: 'havells.com',
      supports: [{ text: '{"a": 5}', startIndex: 0, endIndex: 8, confidence: 0.91 }],
    });
    expect(r.grounding[1].supports[0].confidence).toBe(0.4);
    expect(r.searchQueries).toEqual(['havells adore led price']);
    expect(warn).toHaveBeenCalled();
    const s = usageSummary();
    expect(s.calls).toBe(2);
    expect(s.failed).toBe(1);

    // the model is remembered: the next grounded call skips the strict try
    mock.generateContent.mockResolvedValueOnce(mock.okResponse('{"a": 6}'));
    const r2 = await generateJson({ caller: 'test.grounded', model: 'gemini-2.5-flash', parts: ['again'], schema, zod: A, tools });
    expect(r2.mode).toBe('grounded');
    expect(mock.generateContent).toHaveBeenCalledTimes(3);
    expect(mock.lastRequest().config.responseMimeType).toBeUndefined();
  });

  it('GEMINI_GROUNDED_STRICT_JSON=0 goes straight to the prompt schema', async () => {
    process.env.GEMINI_GROUNDED_STRICT_JSON = '0';
    mock.generateContent.mockResolvedValue(mock.okResponse('{"a": 7}'));
    const r = await generateJson({ caller: 't', model: 'm', parts: ['x'], schema, zod: A, tools: [{ googleSearch: {} }] });
    expect(r.mode).toBe('grounded');
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
    expect(mock.lastRequest().config.responseMimeType).toBeUndefined();
  });

  it('a 400 that is not about JSON mode is not retried and not downgraded', async () => {
    mock.generateContent.mockRejectedValue(new ApiError({ status: 400, message: BODY_400_SCHEMA }));
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema, tools: [{ googleSearch: {} }] })).rejects.toBeInstanceOf(ApiError);
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
    expect(usageSummary().failed).toBe(1);
  });

  it('asks once more when the grounded answer is not JSON', async () => {
    process.env.GEMINI_GROUNDED_STRICT_JSON = '0';
    mock.generateContent.mockResolvedValueOnce(mock.okResponse('Sorry, I could not find that.')).mockResolvedValueOnce(mock.okResponse('{"a": 8}'));
    const r = await generateJson({ caller: 't', model: 'm', parts: ['x'], schema, zod: A, mode: 'grounded' });
    expect(r.data).toEqual({ a: 8 });
    expect(mock.generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('retries', () => {
  it('retries a 429 after the server retryDelay (jittered) and then succeeds', async () => {
    vi.useFakeTimers();
    mock.generateContent.mockRejectedValueOnce(new ApiError({ status: 429, message: BODY_429 })).mockResolvedValueOnce(mock.okResponse('{"a": 2}'));
    const p = generateJson({ caller: 't', model: 'm', parts: ['x'], schema, zod: A });
    await vi.advanceTimersByTimeAsync(1_990);
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(mock.generateContent).toHaveBeenCalledTimes(2);
    const r = await p;
    expect(r.data).toEqual({ a: 2 });
    expect(r.attempts).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/429/);
    expect(usageSummary().calls).toBe(1); // only the final outcome is logged
  });

  it('retries the SDK "Retryable HTTP Error" shape and 503s, gives up after 5 attempts', async () => {
    vi.useFakeTimers();
    mock.generateContent.mockRejectedValue(new Error('Retryable HTTP Error: Service Unavailable'));
    const p = generateJson({ caller: 't', model: 'm', parts: ['x'], schema });
    const guard = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await guard;
    expect(err).toBeInstanceOf(Error);
    expect(mock.generateContent).toHaveBeenCalledTimes(5);
    expect(usageSummary().failed).toBe(1);
    expect(usageSummary().calls).toBe(1);
  });

  it('does not retry a 400 schema error', async () => {
    mock.generateContent.mockRejectedValue(new ApiError({ status: 400, message: BODY_400_SCHEMA }));
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema })).rejects.toBeInstanceOf(ApiError);
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an already-aborted signal rejects before any call', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema, signal: ctrl.signal })).rejects.toThrow();
    expect(mock.generateContent).not.toHaveBeenCalled();
  });

  it('enforces GEMINI_DAILY_CALL_CAP', async () => {
    process.env.GEMINI_DAILY_CALL_CAP = '1';
    mock.generateContent.mockResolvedValue(mock.okResponse('{"a": 1}'));
    await generateJson({ caller: 't', model: 'm', parts: ['x'], schema });
    await expect(generateJson({ caller: 't', model: 'm', parts: ['x'], schema })).rejects.toBeInstanceOf(LlmBudgetError);
    expect(mock.generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('gates', () => {
  it('caps in-flight calls at GEMINI_CONCURRENCY and paces by GEMINI_RPM', async () => {
    process.env.GEMINI_CONCURRENCY = '2';
    process.env.GEMINI_RPM = '3';
    __resetGenerateForTests();
    vi.useFakeTimers();
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const pending: (() => void)[] = [];
    mock.generateContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          started += 1;
          peak = Math.max(peak, inFlight);
          pending.push(() => {
            inFlight -= 1;
            resolve(mock.okResponse('{"a": 1}'));
          });
        }),
    );
    const calls = Array.from({ length: 4 }, () => generateJson({ caller: 't', model: 'm', parts: ['x'], schema }));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBe(2);
    expect(peak).toBe(2);
    expect(gateStatus()).toMatchObject({ active: 2, concurrency: 2, rpm: 3, usedLastMinute: 2 });

    pending.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBe(3); // a slot freed and the RPM window still has room

    pending.shift()!();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toBe(3); // RPM exhausted: the 4th call waits for the window
    expect(peak).toBe(2);

    await vi.advanceTimersByTimeAsync(60_001);
    expect(started).toBe(4);
    for (const done of pending.splice(0)) done();
    const results = await Promise.all(calls);
    expect(results.map((r) => r.data)).toEqual([{ a: 1 }, { a: 1 }, { a: 1 }, { a: 1 }]);
    expect(gateStatus().active).toBe(0);
  });
});

describe('generateText / generateImage', () => {
  it('generateText returns text and grounding with the same gates', async () => {
    mock.generateContent.mockResolvedValue(
      mock.okResponse('plain answer', { candidates: [{ content: { parts: [{ text: 'plain answer' }] }, groundingMetadata: GROUNDED_META }] }),
    );
    const r = await generateText({
      caller: 'test.text',
      model: 'gemini-3-flash-preview',
      parts: ['q'],
      tools: [{ googleSearch: {} }],
      thinking: 'verify',
      mediaResolution: 'medium',
    });
    expect(r.text).toBe('plain answer');
    expect(r.grounding).toHaveLength(2);
    const req = mock.lastRequest();
    expect(req.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(req.config.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM');
    expect(req.config.responseMimeType).toBeUndefined();
  });

  it('generateImage returns the first inline image and records image usage', async () => {
    mock.generateContent.mockResolvedValue({
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 1290, totalTokenCount: 1790 },
      candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
    });
    const r = await generateImage({
      caller: 'ar.composite',
      model: 'gemini-2.5-flash-image',
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }, 'edit it'],
    });
    expect(r.image).toEqual({ mimeType: 'image/png', base64: 'AAAA' });
    expect(r.text).toBe('here');
    expect(mock.lastRequest().config.responseModalities).toEqual(['IMAGE']);
    expect(mock.lastRequest().config.thinkingConfig).toBeUndefined();
    const s = usageSummary();
    expect(s.byModel['gemini-2.5-flash-image'].calls).toBe(1);
    expect(s.estUsd).toBeGreaterThan(0.03); // 1290 image tokens at the image rate
  });

  it('generateImage throws LlmOutputError when no image comes back', async () => {
    mock.generateContent.mockResolvedValue(mock.okResponse('I cannot do that'));
    await expect(generateImage({ model: 'gemini-2.5-flash-image', parts: ['x'] })).rejects.toBeInstanceOf(LlmOutputError);
    expect(usageSummary().failed).toBe(1);
  });
});

describe('helpers', () => {
  it('parseJsonLoose handles fences, chatter and failures', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure!\n```\n[1,2]\n```\nthanks')).toEqual([1, 2]);
    expect(parseJsonLoose('The answer is {"a": {"b": [1]}} ok?')).toEqual({ a: { b: [1] } });
    expect(() => parseJsonLoose('no json here')).toThrow(LlmOutputError);
    expect(() => parseJsonLoose('{"a": ')).toThrow(LlmOutputError);
  });

  it('classifyError understands both SDK error shapes, network errors and aborts', () => {
    const e429 = classifyError(new ApiError({ status: 429, message: BODY_429 }));
    expect(e429).toMatchObject({ retryable: true, status: 429, retryDelayMs: 2000, aborted: false, jsonModeUnsupported: false });
    expect(classifyError(new ApiError({ status: 503, message: body(503, 'The model is overloaded. Please try again later.', 'UNAVAILABLE') }))).toMatchObject({
      retryable: true,
      status: 503,
    });
    expect(classifyError(new ApiError({ status: 400, message: BODY_400_JSON }))).toMatchObject({ retryable: false, status: 400, jsonModeUnsupported: true });
    expect(classifyError(new ApiError({ status: 400, message: BODY_400_SCHEMA }))).toMatchObject({ retryable: false, status: 400, jsonModeUnsupported: false });
    expect(classifyError(new Error('Retryable HTTP Error: Too Many Requests'))).toMatchObject({ retryable: true, status: 429 });
    expect(classifyError(new Error('Retryable HTTP Error: Internal Server Error'))).toMatchObject({ retryable: true, status: 500 });
    expect(classifyError(new TypeError('fetch failed'))).toMatchObject({ retryable: true, status: undefined });
    expect(
      classifyError(Object.assign(new Error('request failed'), { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) })),
    ).toMatchObject({ retryable: true });
    expect(classifyError(new Error('something odd'))).toMatchObject({ retryable: false, aborted: false });
    expect(classifyError(new DOMException('The operation was aborted', 'AbortError'))).toMatchObject({ aborted: true, retryable: false });
    expect(classifyError(new DOMException('Timed out', 'TimeoutError'))).toMatchObject({ aborted: true });
    expect(classifyError(null).retryable).toBe(false);
  });

  it('backoffMs grows exponentially, caps, jitters and never undercuts retryDelay', () => {
    const mid = () => 0.5;
    expect(backoffMs(1, undefined, mid)).toBe(1000 + 125);
    expect(backoffMs(2, undefined, mid)).toBe(2000 + 125);
    expect(backoffMs(3, undefined, mid)).toBe(4000 + 125);
    expect(backoffMs(10, undefined, mid)).toBe(30_000 + 125);
    expect(backoffMs(1, 5000, mid)).toBe(5000 + 125);
    expect(backoffMs(1, 120_000, mid)).toBe(90_000 + 125);
    const lo = backoffMs(1, undefined, () => 0);
    const hi = backoffMs(1, undefined, () => 0.999);
    expect(lo).toBe(500);
    expect(hi).toBeGreaterThan(1400);
    expect(hi).toBeLessThan(1750);
  });

  it('extractGrounding ignores chunks without a web uri and supports pointing at them', () => {
    const { citations, searchQueries } = extractGrounding({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [{ retrievedContext: { uri: 'gs://x' } }, { web: { uri: 'https://a.example/x' } }],
            groundingSupports: [{ groundingChunkIndices: [0, 1], confidenceScores: [0.2, 0.8], segment: { text: 'claim' } }],
          },
        },
      ],
    } as never);
    expect(citations).toEqual([{ index: 1, uri: 'https://a.example/x', supports: [{ text: 'claim', confidence: 0.8 }] }]);
    expect(searchQueries).toEqual([]);
    expect(extractGrounding({} as never)).toEqual({ citations: [], searchQueries: [] });
  });

  it('str helper is a plain string schema', () => {
    expect(str('x')).toEqual({ type: 'string', description: 'x' });
  });
});
