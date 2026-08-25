import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetModelsForTests, defaultModel, listModels, MODELS_CACHE_FILE, PREFS, resolveAllModels, resolveModel, thinkingFor } from '../src/models';
import * as mock from './genai-mock';
import { cleanup, freshState, reportFile } from './setup';

vi.mock('@google/genai', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@google/genai')>();
  const m = await import('./genai-mock');
  return { ...orig, GoogleGenAI: m.GoogleGenAI };
});

let tmp: string;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  tmp = freshState();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(tmp);
  vi.restoreAllMocks();
});

describe('resolveModel', () => {
  it('without a key: first preference for every kind, one warning in total, no discovery', async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await resolveModel('pro')).toBe('gemini-3.1-pro-preview');
    expect(await resolveModel('flash')).toBe('gemini-3-flash-preview');
    expect(await resolveModel('vision')).toBe('gemini-3-flash-preview');
    expect(await resolveModel('image')).toBe('gemini-3.1-flash-image-preview');
    expect(await resolveModel('segment')).toBe('gemini-3-flash-preview');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('test-key');
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.ctor).not.toHaveBeenCalled();
  });

  it('env override and explicit override win without discovery', async () => {
    process.env.GEMINI_PIPELINE_MODEL = 'gemini-custom-pro';
    expect(await resolveModel('pro')).toBe('gemini-custom-pro');
    expect(await resolveModel('pro', 'gemini-drawing-x')).toBe('gemini-drawing-x');
    process.env.GEMINI_SEGMENT_MODEL = ' gemini-seg ';
    expect(await resolveModel('segment')).toBe('gemini-seg');
    expect(defaultModel('flash')).toBe(PREFS.flash[0]);
    expect(mock.list).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('with a key: first preference the key can reach, models/ prefix stripped, non-generateContent models ignored, cached in memory and on disk', async () => {
    mock.list.mockResolvedValue(
      mock.modelList([{ name: 'gemini-2.5-flash' }, { name: 'text-embedding-004', actions: ['embedContent'] }, { name: 'gemini-2.5-pro' }]),
    );
    expect(await resolveModel('pro')).toBe('gemini-2.5-pro');
    expect(await resolveModel('flash')).toBe('gemini-2.5-flash');
    expect(await resolveModel('image')).toBe('gemini-3.1-flash-image-preview'); // none listed → first preference + warning
    expect(mock.list).toHaveBeenCalledTimes(1);
    expect(mock.ctor).toHaveBeenCalledTimes(1);
    const ctorOpts = mock.ctor.mock.calls[0][0] as { apiKey: string; httpOptions: { timeout: number; retryOptions: { attempts: number } } };
    expect(ctorOpts.httpOptions).toEqual({ timeout: 120_000, retryOptions: { attempts: 4 } });
    const cache = JSON.parse(fs.readFileSync(reportFile(tmp, MODELS_CACHE_FILE), 'utf8')) as { fetched_at: string; models: string[] };
    expect(cache.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(Date.now() - Date.parse(cache.fetched_at)).toBeLessThan(10_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('image');
  });

  it('uses a fresh file cache and ignores a stale one', async () => {
    fs.mkdirSync(reportFile(tmp, ''), { recursive: true });
    fs.writeFileSync(reportFile(tmp, MODELS_CACHE_FILE), JSON.stringify({ fetched_at: new Date().toISOString(), models: ['gemini-3-pro-preview'] }));
    expect(await resolveModel('pro')).toBe('gemini-3-pro-preview');
    expect(mock.list).not.toHaveBeenCalled();

    __resetModelsForTests();
    fs.writeFileSync(
      reportFile(tmp, MODELS_CACHE_FILE),
      JSON.stringify({ fetched_at: new Date(Date.now() - 25 * 3600_000).toISOString(), models: ['gemini-3-pro-preview'] }),
    );
    mock.list.mockResolvedValue(mock.modelList([{ name: 'gemini-2.5-pro' }]));
    expect(await resolveModel('pro')).toBe('gemini-2.5-pro');
    expect(mock.list).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first preference with a single warning when listing fails, and retries discovery next time', async () => {
    mock.list.mockRejectedValue(new Error('fetch failed'));
    expect(await resolveModel('pro')).toBe(PREFS.pro[0]);
    expect(await resolveModel('flash')).toBe(PREFS.flash[0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(mock.list).toHaveBeenCalledTimes(2); // a failure is never cached
    await expect(listModels()).rejects.toThrow('fetch failed');
  });

  it('resolveAllModels resolves every kind', async () => {
    mock.list.mockResolvedValue(mock.modelList([{ name: 'gemini-3-flash-preview' }, { name: 'gemini-3-pro-preview' }, { name: 'gemini-2.5-flash-image' }]));
    expect(await resolveAllModels()).toEqual({
      pro: 'gemini-3-pro-preview',
      flash: 'gemini-3-flash-preview',
      vision: 'gemini-3-flash-preview',
      image: 'gemini-2.5-flash-image',
      segment: 'gemini-3-flash-preview',
    });
  });
});

describe('thinkingFor', () => {
  it('applies the per-family policy when GEMINI_THINKING is unset', () => {
    expect(thinkingFor('gemini-3-flash-preview', 'judge')).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingFor('gemini-3.1-pro-preview', 'verify')).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingFor('gemini-3.1-pro-preview', 'extract')).toBeUndefined();
    expect(thinkingFor('gemini-3-pro-preview', 'drawing')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-flash', 'judge')).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor('gemini-2.5-flash', 'segment')).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor('gemini-2.5-flash', 'live')).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor('gemini-2.5-flash', 'extract')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-flash', 'price')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-pro', 'judge')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-flash-image', 'judge')).toBeUndefined();
    expect(thinkingFor('gemini-3.1-flash-image-preview', 'live')).toBeUndefined();
  });

  it('honours GEMINI_THINKING=off|low|default', () => {
    process.env.GEMINI_THINKING = 'default';
    expect(thinkingFor('gemini-3-flash-preview', 'judge')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-flash', 'judge')).toBeUndefined();
    process.env.GEMINI_THINKING = 'off';
    expect(thinkingFor('gemini-3-flash-preview', 'extract')).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingFor('gemini-2.5-flash', 'extract')).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor('gemini-2.5-pro', 'extract')).toBeUndefined();
    process.env.GEMINI_THINKING = 'low';
    expect(thinkingFor('gemini-3-pro-preview', 'drawing')).toEqual({ thinkingLevel: 'LOW' });
    expect(thinkingFor('gemini-2.5-flash', 'extract')).toBeUndefined();
    expect(thinkingFor('gemini-2.5-flash', 'fill')).toEqual({ thinkingBudget: 0 });
  });
});
