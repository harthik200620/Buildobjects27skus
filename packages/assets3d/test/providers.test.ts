import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/photoreal/http';
import { MESHY_COST_USD, MeshyProvider } from '../src/photoreal/meshy';
import { describeProviders, parseProviderPref, pickProvider } from '../src/photoreal/providers';
import { pollUntilDone } from '../src/photoreal/run';
import { TRIPO_COST_USD, TripoProvider } from '../src/photoreal/tripo';
import { DEFAULT_SUBMIT_OPTIONS, type JobStatus, type Provider3D, ProviderError, type SubmitInput } from '../src/photoreal/types';
import { bytesResponse, jsonResponse } from './helpers';

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit | undefined, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls);
  };
  return { fetch, calls };
}
const hero = { buffer: Buffer.from('png-bytes'), role: 'front' as const, mime: 'image/png' as const, key: 'skus/aa/SKU/img/1-orig.png' };
const input = (over: Partial<SubmitInput> = {}): SubmitInput => ({ sku: 'SKU', images: [hero], mode: 'single', opts: DEFAULT_SUBMIT_OPTIONS, ...over });

describe('Meshy adapter', () => {
  it('submit → poll → download with data-URI images, bearer auth, status mapping', async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch((url, init) => {
      if (url === 'https://api.meshy.ai/openapi/v1/image-to-3d' && init?.method === 'POST') return jsonResponse({ result: 'task-abc' });
      if (url === 'https://api.meshy.ai/openapi/v1/image-to-3d/task-abc') {
        polls++;
        if (polls === 1) return jsonResponse({ status: 'PENDING', progress: 0 });
        if (polls === 2) return jsonResponse({ status: 'IN_PROGRESS', progress: 40 });
        return jsonResponse({
          status: 'SUCCEEDED',
          progress: 100,
          model_urls: { glb: 'https://cdn/m.glb', usdz: 'https://cdn/m.usdz', fbx: 'https://cdn/m.fbx' },
          thumbnail_url: 'https://cdn/t.png',
        });
      }
      if (url === 'https://cdn/m.glb') return bytesResponse(Buffer.from('GLBDATA'));
      return new Response('nope', { status: 404 });
    });
    const p = new MeshyProvider({ apiKey: 'KEY', fetch });
    const handle = await p.submit(input());
    expect(handle).toEqual({ provider: 'meshy', id: 'task-abc', mode: 'single' });
    const req = calls[0];
    expect((req.init?.headers as Record<string, string>).Authorization).toBe('Bearer KEY');
    const body = JSON.parse(req.init?.body as string);
    expect(body.image_url).toBe(`data:image/png;base64,${hero.buffer.toString('base64')}`);
    expect(body).toMatchObject({
      ai_model: 'meshy-7',
      should_texture: true,
      enable_pbr: true,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: 100_000,
      symmetry_mode: 'auto',
      target_formats: ['glb', 'usdz'],
    });
    expect((await p.poll(handle)).state).toBe('pending');
    const running = await p.poll(handle);
    expect(running).toMatchObject({ state: 'running', progress: 40 });
    const done = await p.poll(handle);
    expect(done).toMatchObject({
      state: 'succeeded',
      modelUrls: { glb: 'https://cdn/m.glb', usdz: 'https://cdn/m.usdz', fbx: 'https://cdn/m.fbx' },
      previewUrl: 'https://cdn/t.png',
      error: null,
    });
    expect((await p.download('https://cdn/m.glb')).toString()).toBe('GLBDATA');
    expect(p.estimateCostUsd(input())).toBe(MESHY_COST_USD.single);
  });

  it('uses multi-image-to-3d with ≤ 4 image_urls and honours MESHY_MODEL', async () => {
    const { fetch, calls } = mockFetch((url) =>
      url.endsWith('/multi-image-to-3d') ? jsonResponse({ result: 'multi-1' }) : jsonResponse({ status: 'FAILED', task_error: { message: 'bad input' } }),
    );
    const p = new MeshyProvider({ apiKey: 'KEY', model: 'meshy-5', fetch });
    const imgs = [
      hero,
      { ...hero, role: 'extra' as const },
      { ...hero, role: 'extra' as const },
      { ...hero, role: 'extra' as const },
      { ...hero, role: 'extra' as const },
    ];
    const handle = await p.submit(input({ images: imgs, mode: 'multi' }));
    expect(handle.mode).toBe('multi');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.image_urls).toHaveLength(4);
    expect(body.ai_model).toBe('meshy-5');
    expect(p.estimateCostUsd(input({ images: imgs, mode: 'multi' }))).toBe(MESHY_COST_USD.multi);
    const failed = await p.poll(handle);
    expect(calls[1].url).toBe('https://api.meshy.ai/openapi/v1/multi-image-to-3d/multi-1');
    expect(failed).toMatchObject({ state: 'failed', error: 'bad input' });
  });

  it('maps HTTP errors: 401 auth, 402 quota, 429 rate_limit (retryable), 500 server, 400 bad_request', async () => {
    for (const [status, code, retryable] of [
      [401, 'auth', false],
      [402, 'quota', false],
      [429, 'rate_limit', true],
      [500, 'server', true],
      [400, 'bad_request', false],
    ] as const) {
      const { fetch } = mockFetch(() => jsonResponse({ message: `status ${status}` }, status));
      const p = new MeshyProvider({ apiKey: 'KEY', fetch });
      const err = await p.submit(input()).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.status).toBe(status);
      expect(err.message).toContain(`status ${status}`);
    }
    const { fetch } = mockFetch(() => {
      throw new Error('ECONNRESET');
    });
    const err = await new MeshyProvider({ apiKey: 'KEY', fetch }).submit(input()).catch((e) => e);
    expect(err.code).toBe('network');
    expect(err.retryable).toBe(true);
    expect(() => new MeshyProvider({ apiKey: '' })).toThrow(/MESHY_API_KEY/);
  });
});

describe('Tripo adapter', () => {
  it('uploads each image (multipart → image_token), creates image_to_model with file_token, polls and maps output.pbr_model', async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch((url, init) => {
      if (url === 'https://api.tripo3d.ai/v2/openapi/upload') return jsonResponse({ code: 0, data: { image_token: 'tok-1' } });
      if (url === 'https://api.tripo3d.ai/v2/openapi/task' && init?.method === 'POST') return jsonResponse({ code: 0, data: { task_id: 'tripo-1' } });
      if (url === 'https://api.tripo3d.ai/v2/openapi/task/tripo-1') {
        polls++;
        if (polls === 1) return jsonResponse({ code: 0, data: { status: 'queued', progress: 0 } });
        if (polls === 2) return jsonResponse({ code: 0, data: { status: 'running', progress: 55 } });
        return jsonResponse({
          code: 0,
          data: {
            status: 'success',
            progress: 100,
            output: { model: 'https://cdn/base.glb', pbr_model: 'https://cdn/pbr.glb', rendered_image: 'https://cdn/r.webp' },
          },
        });
      }
      return new Response('nope', { status: 404 });
    });
    const p = new TripoProvider({ apiKey: 'TK', fetch });
    const handle = await p.submit(input());
    expect(handle).toEqual({ provider: 'tripo', id: 'tripo-1', mode: 'single' });
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer TK');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const task = JSON.parse(calls[1].init?.body as string);
    expect(task).toMatchObject({
      type: 'image_to_model',
      file: { type: 'png', file_token: 'tok-1' },
      model_version: 'v2.5-20250123',
      pbr: true,
      texture: true,
      texture_quality: 'detailed',
      face_limit: 100_000,
      orientation: 'align_image',
    });
    expect(task.model_seed).toBeUndefined();
    expect((await p.poll(handle)).state).toBe('pending');
    expect(await p.poll(handle)).toMatchObject({ state: 'running', progress: 55 });
    expect(await p.poll(handle)).toMatchObject({ state: 'succeeded', modelUrls: { glb: 'https://cdn/pbr.glb' }, previewUrl: 'https://cdn/r.webp' });
    expect(p.estimateCostUsd(input())).toBe(TRIPO_COST_USD.single);
  });

  it('multiview_to_model orders files front, left, back, right with {} for missing views; extras without a side stay single', async () => {
    let n = 0;
    const { fetch, calls } = mockFetch((url) =>
      url.endsWith('/upload') ? jsonResponse({ code: 0, data: { image_token: `tok-${++n}` } }) : jsonResponse({ code: 0, data: { task_id: 'mv-1' } }),
    );
    const p = new TripoProvider({ apiKey: 'TK', modelVersion: 'v3.0-20250812', fetch });
    const imgs = [hero, { ...hero, role: 'right' as const }, { ...hero, role: 'back' as const }];
    const handle = await p.submit(input({ images: imgs, mode: 'multi', opts: { ...DEFAULT_SUBMIT_OPTIONS, variant: 'retry' } }));
    expect(handle.mode).toBe('multi');
    const task = JSON.parse(calls.at(-1)!.init?.body as string);
    expect(task.type).toBe('multiview_to_model');
    // uploads happen in slot order: front, (left missing), back, right
    expect(task.files).toEqual([{ type: 'png', file_token: 'tok-1' }, {}, { type: 'png', file_token: 'tok-2' }, { type: 'png', file_token: 'tok-3' }]);
    expect(task.model_version).toBe('v3.0-20250812');
    expect(typeof task.model_seed).toBe('number');
    expect(p.isMulti({ mode: 'multi', images: [hero, { ...hero, role: 'extra' }] })).toBe(false);
    expect(p.estimateCostUsd(input({ images: imgs, mode: 'multi' }))).toBe(TRIPO_COST_USD.multi);
  });

  it('maps envelope errors (code ≠ 0) and failed / expired / banned task states', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ code: 2010, message: 'insufficient balance' }));
    const err = await new TripoProvider({ apiKey: 'TK', fetch }).submit(input()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('quota');
    const p = new TripoProvider({ apiKey: 'TK', fetch: mockFetch(() => jsonResponse({ code: 0, data: { status: 'banned' } })).fetch });
    expect(await p.poll({ provider: 'tripo', id: 'x', mode: 'single' })).toMatchObject({ state: 'failed' });
    const p2 = new TripoProvider({ apiKey: 'TK', fetch: mockFetch(() => jsonResponse({ code: 0, data: { status: 'expired' } })).fetch });
    expect((await p2.poll({ provider: 'tripo', id: 'x', mode: 'single' })).state).toBe('expired');
    const p3 = new TripoProvider({ apiKey: 'TK', fetch: mockFetch(() => jsonResponse({ code: 0, data: { status: 'failed', message: 'no object' } })).fetch });
    expect(await p3.poll({ provider: 'tripo', id: 'x', mode: 'single' })).toMatchObject({ state: 'failed', error: 'no object' });
  });
});

describe('provider selection', () => {
  it('auto picks the first provider with a key; explicit names need their key; none → auth error', () => {
    expect(pickProvider('auto', { TRIPO_API_KEY: 't' }).primary.name).toBe('tripo');
    const both = pickProvider('auto', { MESHY_API_KEY: 'm', TRIPO_API_KEY: 't' });
    expect(both.primary.name).toBe('meshy');
    expect(both.fallback?.name).toBe('tripo');
    expect(pickProvider('tripo', { MESHY_API_KEY: 'm', TRIPO_API_KEY: 't' }).primary.name).toBe('tripo');
    expect(() => pickProvider('meshy', { TRIPO_API_KEY: 't' })).toThrow(/MESHY_API_KEY/);
    expect(() => pickProvider('auto', {})).toThrow(/no 3D provider key/);
    expect(parseProviderPref(undefined)).toBe('auto');
    expect(parseProviderPref('Tripo')).toBe('tripo');
    expect(() => parseProviderPref('sketchfab')).toThrow(/must be auto, meshy or tripo/);
    expect(describeProviders({ MESHY_API_KEY: 'm' })).toEqual(['meshy: key present', 'tripo: no key']);
  });
});

describe('pollUntilDone', () => {
  const fake = (states: JobStatus['state'][]): Provider3D => {
    let i = 0;
    return {
      name: 'meshy',
      submit: async () => ({ provider: 'meshy', id: 'x', mode: 'single' }),
      poll: async (handle) => ({ handle, state: states[Math.min(i++, states.length - 1)], progress: 0, modelUrls: {}, previewUrl: null, error: null }),
      download: async () => Buffer.alloc(0),
      estimateCostUsd: () => 0,
    };
  };
  it('backs off 5 → 10 → 20 → 20 s and returns the settled status', async () => {
    const sleeps: number[] = [];
    let t = 0;
    const status = await pollUntilDone(
      fake(['pending', 'running', 'running', 'running', 'succeeded']),
      { provider: 'meshy', id: 'x', mode: 'single' },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
        now: () => t,
      },
    );
    expect(status.state).toBe('succeeded');
    expect(sleeps).toEqual([5000, 10000, 20000, 20000]);
  });
  it('gives up after maxMs and returns the still-running status', async () => {
    let t = 0;
    const status = await pollUntilDone(
      fake(['running']),
      { provider: 'meshy', id: 'x', mode: 'single' },
      {
        sleep: async (ms) => {
          t += ms;
        },
        now: () => t,
        maxMs: 30_000,
      },
    );
    expect(status.state).toBe('running');
    expect(t).toBeGreaterThanOrEqual(30_000);
  });
});
