import fs from 'node:fs';
import path from 'node:path';
import { type AssetManifest, shard } from '@buildobjects/catalog';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/photoreal/http';
import { runPhotoreal } from '../src/photoreal/run';
import type { PhotorealTarget } from '../src/photoreal/select-images';
import { boxGlb, bytesResponse, jsonResponse, pngSolid, specWithDims, studioPhoto, tmpDir } from './helpers';

const SKU = 'TST-PR-BOX';
function target(over: Partial<PhotorealTarget> = {}): PhotorealTarget {
  return {
    code: SKU,
    category: 'cement',
    name: 'Test bag',
    brand: 'Test',
    spec: specWithDims(200, 100, 50),
    images: [{ position: 1, role: 'hero', key: `skus/${shard(SKU)}/${SKU}/img/1-orig.png`, width: 200, height: 200 }],
    ...over,
  };
}
async function mediaRootWithHero(): Promise<string> {
  const root = tmpDir('pr-media');
  const dir = path.join(root, 'skus', shard(SKU), SKU, 'img');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1-orig.png'), await studioPhoto());
  return root;
}
/** A Meshy API double: submit → two polls → succeeded; serves a 2 × 1 × 0.5 box GLB and a thumbnail. */
function meshyDouble(glb: Buffer, thumb: Buffer) {
  const calls: string[] = [];
  let polls = 0,
    tasks = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/image-to-3d') && init?.method === 'POST') {
      tasks++;
      polls = 0;
      return jsonResponse({ result: `task-${tasks}` });
    }
    if (/\/image-to-3d\/task-\d+$/.test(url)) {
      polls++;
      return polls < 3
        ? jsonResponse({ status: 'IN_PROGRESS', progress: polls * 30 })
        : jsonResponse({ status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://cdn.test/model.glb' }, thumbnail_url: 'https://cdn.test/thumb.png' });
    }
    if (url === 'https://cdn.test/model.glb') return bytesResponse(glb);
    if (url === 'https://cdn.test/thumb.png') return bytesResponse(thumb);
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls, submits: () => calls.filter((c) => c.endsWith('/image-to-3d') && c.startsWith('POST')).length };
}
const quiet = { log: () => {}, sleep: async () => {}, now: () => 0 };

describe('runPhotoreal (end to end with a provider double)', () => {
  it('dry-run: selection + cut-out availability + cost estimate, no network, no key needed', async () => {
    const mediaRoot = await mediaRootWithHero(),
      assetsDir = tmpDir('pr-assets');
    const report = await runPhotoreal({
      targets: [target(), target({ code: 'TST-NOHERO', images: [] })],
      dryRun: true,
      env: {},
      assetsDir,
      mediaRoot,
      ...quiet,
    });
    expect(report.dry_run).toBe(true);
    expect(report.totals).toMatchObject({ planned: 1, skipped: 1 });
    const planned = report.results.find((r) => r.sku === SKU)!;
    expect(planned).toMatchObject({ outcome: 'planned', mode: 'single', cutouts: 0, est_cost_usd: 0.4 });
    expect(planned.images[0]).toMatchObject({ role: 'front', source: 'orig' });
    expect(report.results.find((r) => r.sku === 'TST-NOHERO')?.reason).toMatch(/no real hero image/);
    expect(report.estimated_spend_usd).toBe(0.4);
    expect(fs.existsSync(path.join(assetsDir, 'photoreal-report.json'))).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, 'jobs.json'))).toBe(false);
    fs.rmSync(mediaRoot, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it('submits, polls, downloads, normalises, writes {SKU}.glb + manifest + jobs; a second run never pays twice; --force resubmits; max-spend guards', async () => {
    const mediaRoot = await mediaRootWithHero(),
      assetsDir = tmpDir('pr-assets');
    const double = meshyDouble(boxGlb(2, 1, 0.5), await pngSolid(64, 64));
    const env = { MESHY_API_KEY: 'k' };
    const judged: string[] = [];
    const assist = {
      judge: async (_hero: Buffer, _preview: Buffer, ctx: { sku: string }) => {
        judged.push(ctx.sku);
        return { overall: 0.9, defects: [] };
      },
    };

    const first = await runPhotoreal({ targets: [target()], env, fetch: double.fetch, assetsDir, mediaRoot, assist, ...quiet });
    expect(first.totals.photoreal).toBe(1);
    expect(double.submits()).toBe(1);
    expect(judged).toEqual([SKU]);
    const r = first.results[0];
    expect(r).toMatchObject({ outcome: 'photoreal', provider: 'meshy', job_id: 'task-1', file: `${SKU}.glb` });
    expect(r.quality_report).toMatchObject({ overall: 0.9, judge: 'llm', aspect_mismatch: 0 });
    expect(fs.existsSync(path.join(assetsDir, `${SKU}.glb`))).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, 'photoreal', 'raw', `${SKU}.meshy.glb`))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(assetsDir, 'manifest.json'), 'utf8')) as AssetManifest;
    expect(manifest.assets[SKU]).toMatchObject({
      file: `${SKU}.glb`,
      placeholder: false,
      quality: 'photoreal',
      provider: 'meshy',
      job_id: 'task-1',
      axis_map: 'x,y,z',
      front_yaw_deg: 0,
      builder: 'photoreal',
      dims_mm: { w: 200, h: 100, d: 50 },
    });
    expect(manifest.assets[SKU].bbox_m!.x).toBeCloseTo(0.2, 3);
    expect(manifest.assets[SKU].source_images).toEqual([`skus/${shard(SKU)}/${SKU}/img/1-orig.png`]);
    const jobs = JSON.parse(fs.readFileSync(path.join(assetsDir, 'jobs.json'), 'utf8'));
    expect(jobs.jobs[SKU]).toMatchObject({ provider: 'meshy', jobId: 'task-1', state: 'normalised', attempts: 1, estCostUsd: 0.4 });

    // same inputs → skipped, no new submission
    const second = await runPhotoreal({ targets: [target()], env, fetch: double.fetch, assetsDir, mediaRoot, ...quiet });
    expect(second.totals.skipped).toBe(1);
    expect(second.results[0].reason).toMatch(/already generated/);
    expect(double.submits()).toBe(1);
    expect(second.ledger_spend_usd).toBeCloseTo(0.4, 6);

    // --force → a new paid submission (no judge wired → note in the manifest)
    const third = await runPhotoreal({ targets: [target()], env, fetch: double.fetch, assetsDir, mediaRoot, force: true, ...quiet });
    expect(third.totals.photoreal).toBe(1);
    expect(double.submits()).toBe(2);
    const m3 = JSON.parse(fs.readFileSync(path.join(assetsDir, 'manifest.json'), 'utf8')) as AssetManifest;
    expect(m3.assets[SKU].job_id).toBe('task-2');
    expect(m3.assets[SKU].quality_report?.judge).toBe('skipped');
    expect(m3.assets[SKU].note).toMatch(/no vision assist/);

    // max-spend below one task → nothing submitted
    const capped = await runPhotoreal({ targets: [target()], env, fetch: double.fetch, assetsDir, mediaRoot, force: true, maxSpendUsd: 0.1, ...quiet });
    expect(capped.totals.skipped).toBe(1);
    expect(capped.results[0].reason).toMatch(/max-spend/);
    expect(double.submits()).toBe(2);
    fs.rmSync(mediaRoot, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it('rejects a model whose proportions contradict the spec, then retries and falls back to the other provider before giving up', async () => {
    const mediaRoot = await mediaRootWithHero(),
      assetsDir = tmpDir('pr-assets');
    const cube = boxGlb(1, 1, 1);
    const calls: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('meshy') && url.endsWith('/image-to-3d') && init?.method === 'POST') return jsonResponse({ result: 'm-task' });
      if (url.includes('meshy') && url.endsWith('/image-to-3d/m-task'))
        return jsonResponse({ status: 'SUCCEEDED', model_urls: { glb: 'https://cdn.test/cube.glb' } });
      if (url.includes('tripo') && url.endsWith('/upload')) return jsonResponse({ code: 0, data: { image_token: 'tok' } });
      if (url.includes('tripo') && url.endsWith('/task') && init?.method === 'POST') return jsonResponse({ code: 0, data: { task_id: 't-task' } });
      if (url.includes('tripo') && url.endsWith('/task/t-task'))
        return jsonResponse({ code: 0, data: { status: 'success', output: { pbr_model: 'https://cdn.test/cube.glb' } } });
      if (url === 'https://cdn.test/cube.glb') return bytesResponse(cube);
      return new Response('not found', { status: 404 });
    };
    const report = await runPhotoreal({
      targets: [target({ spec: specWithDims(200, 100, 20) })],
      env: { MESHY_API_KEY: 'm', TRIPO_API_KEY: 't' },
      fetch,
      assetsDir,
      mediaRoot,
      ...quiet,
    });
    expect(report.totals.rejected).toBe(1);
    const r = report.results[0];
    expect(r.reason).toMatch(/aspect mismatch/);
    expect(r.attempts).toBe(3); // primary, retry, fallback
    expect(calls.filter((c) => c.startsWith('POST') && c.includes('meshy'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('POST') && c.endsWith('/task'))).toHaveLength(1);
    expect(fs.existsSync(path.join(assetsDir, `${SKU}.glb`))).toBe(false);
    const jobs = JSON.parse(fs.readFileSync(path.join(assetsDir, 'jobs.json'), 'utf8'));
    expect(jobs.jobs[SKU]).toMatchObject({ provider: 'tripo', state: 'rejected', attempts: 3 });
    expect(jobs.ledger).toHaveLength(3);
    // next run: rejected from these inputs → skipped until --force
    const again = await runPhotoreal({
      targets: [target({ spec: specWithDims(200, 100, 20) })],
      env: { MESHY_API_KEY: 'm', TRIPO_API_KEY: 't' },
      fetch,
      assetsDir,
      mediaRoot,
      ...quiet,
    });
    expect(again.results[0]).toMatchObject({ outcome: 'skipped' });
    expect(again.results[0].reason).toMatch(/rejected earlier/);
    fs.rmSync(mediaRoot, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  it('aborts the run on an auth error and reports it', async () => {
    const mediaRoot = await mediaRootWithHero(),
      assetsDir = tmpDir('pr-assets');
    const fetch: FetchLike = async () => jsonResponse({ message: 'invalid api key' }, 401);
    const report = await runPhotoreal({
      targets: [target(), target({ code: 'TST-PR-TWO' })],
      env: { MESHY_API_KEY: 'bad' },
      fetch,
      assetsDir,
      mediaRoot,
      concurrency: 1,
      ...quiet,
    });
    expect(report.totals.failed + report.totals.skipped).toBe(2);
    expect(report.results.some((r) => /invalid api key/.test(r.reason ?? ''))).toBe(true);
    await expect(runPhotoreal({ targets: [target()], env: {}, assetsDir, mediaRoot, ...quiet })).rejects.toThrow(/no 3D provider key/);
    fs.rmSync(mediaRoot, { recursive: true, force: true });
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });
});
