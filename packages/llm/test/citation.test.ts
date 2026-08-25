import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetGenerateForTests, isGoogleRedirect, resolveCitation, resolveCitations } from '../src/generate';

type FakeResponse = { ok: boolean; status: number; url: string; body: { cancel: () => Promise<void> } | null };
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE123';
const FINAL = 'https://www.havells.com/en/consumer/lighting/led-bulbs/adore-led-bulb-9w.html';

const res = (status: number, url: string): FakeResponse => ({ ok: status < 400, status, url, body: { cancel: vi.fn(async () => {}) } });
let calls: { url: string; method: string; redirect?: string }[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetGenerateForTests();
  calls = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), redirect: init.redirect });
    return res(200, FINAL);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveCitation', () => {
  it('follows the Google redirect with a HEAD and returns the final URL', async () => {
    expect(await resolveCitation(REDIRECT)).toBe(FINAL);
    expect(calls).toEqual([{ url: REDIRECT, method: 'HEAD', redirect: 'follow' }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)['user-agent']).toContain('BuildObjects');
  });

  it('falls back to GET when HEAD is refused (405/403/404/5xx) and cancels the body', async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method) });
      return res(405, REDIRECT);
    });
    expect(await resolveCitation(REDIRECT)).toBe(FINAL);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    const getRes = (await fetchMock.mock.results[1].value) as FakeResponse;
    expect(getRes.body?.cancel).toHaveBeenCalled();
  });

  it('falls back to GET when HEAD throws (network / timeout)', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await resolveCitation(REDIRECT)).toBe(FINAL);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('returns null when both attempts fail, when the final hop is still a redirect, or for non-http input', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await resolveCitation(REDIRECT)).toBeNull();
    fetchMock.mockImplementation(async () => res(200, REDIRECT));
    expect(await resolveCitation(`${REDIRECT}x`)).toBeNull();
    expect(await resolveCitation('gs://bucket/object')).toBeNull();
    expect(await resolveCitation('')).toBeNull();
  });

  it('keeps a 4xx final page URL (the page exists even if it blocks bots) and caches successes only', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method) });
      return res(String(init.method) === 'HEAD' ? 403 : 403, FINAL);
    });
    expect(await resolveCitation(REDIRECT)).toBe(FINAL);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    expect(await resolveCitation(REDIRECT)).toBe(FINAL);
    expect(calls).toHaveLength(2); // cached
  });

  it('accepts an injected fetch implementation', async () => {
    const f = vi.fn(async () => res(200, 'https://example.com/final') as unknown as Response);
    expect(await resolveCitation('https://example.com/start', { fetchImpl: f as unknown as typeof fetch, timeoutMs: 1000 })).toBe('https://example.com/final');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolveCitations keeps input order, dedupes and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return res(200, url.replace('/grounding-api-redirect/', '/final/').replace('vertexaisearch.cloud.google.com', 'site.example'));
    });
    const uris = [`${REDIRECT}1`, `${REDIRECT}2`, `${REDIRECT}1`, `${REDIRECT}3`, `${REDIRECT}4`, `${REDIRECT}5`];
    const map = await resolveCitations(uris, { concurrency: 2 });
    expect([...map.keys()]).toEqual([`${REDIRECT}1`, `${REDIRECT}2`, `${REDIRECT}3`, `${REDIRECT}4`, `${REDIRECT}5`]);
    expect(map.get(`${REDIRECT}3`)).toBe('https://site.example/final/AUZIYQE1233');
    expect(peak).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('isGoogleRedirect recognises both redirect hosts', () => {
    expect(isGoogleRedirect(REDIRECT)).toBe(true);
    expect(isGoogleRedirect('https://www.google.com/url?q=https://x.example')).toBe(true);
    expect(isGoogleRedirect(FINAL)).toBe(false);
  });
});
