import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide, inputHash, type JobRecord, JobStore } from '../src/photoreal/jobs';
import { DEFAULT_SUBMIT_OPTIONS } from '../src/photoreal/types';
import { tmpDir } from './helpers';

const img = Buffer.from('hero-bytes');
const base = {
  provider: 'meshy' as const,
  mode: 'single' as const,
  variant: 'primary' as const,
  images: [img],
  dims: { w: 0.2, h: 0.1, d: 0.05 },
  opts: DEFAULT_SUBMIT_OPTIONS,
};
const rec = (over: Partial<JobRecord>): JobRecord => ({
  sku: 'X',
  provider: 'meshy',
  mode: 'single',
  variant: 'primary',
  inputHash: 'h',
  jobId: 'j1',
  state: 'normalised',
  submittedAt: 't',
  updatedAt: 't',
  attempts: 1,
  estCostUsd: 0.4,
  ...over,
});

describe('jobs — cache semantics (never pay twice)', () => {
  it('inputHash is stable for identical inputs and changes with any input', () => {
    const h = inputHash(base);
    expect(inputHash({ ...base, images: [Buffer.from('hero-bytes')] })).toBe(h);
    expect(inputHash({ ...base, images: [Buffer.from('other')] })).not.toBe(h);
    expect(inputHash({ ...base, provider: 'tripo' })).not.toBe(h);
    expect(inputHash({ ...base, mode: 'multi' })).not.toBe(h);
    expect(inputHash({ ...base, variant: 'retry' })).not.toBe(h);
    expect(inputHash({ ...base, dims: { w: 0.21, h: 0.1, d: 0.05 } })).not.toBe(h);
    expect(inputHash({ ...base, opts: { ...DEFAULT_SUBMIT_OPTIONS, polycount: 50_000 } })).not.toBe(h);
    expect(inputHash({ ...base, opts: { ...DEFAULT_SUBMIT_OPTIONS, variant: 'retry' } })).toBe(h); // opts.variant is carried by `variant`
  });

  it('decide: same hash → skip when done / rejected, resume when in flight, one auto retry after failure, force overrides', () => {
    expect(decide(undefined, 'h')).toBe('submit');
    expect(decide(rec({ inputHash: 'other' }), 'h')).toBe('submit');
    expect(decide(rec({ state: 'normalised' }), 'h')).toBe('skip-done');
    expect(decide(rec({ state: 'succeeded' }), 'h')).toBe('skip-done');
    expect(decide(rec({ state: 'rejected' }), 'h')).toBe('skip-rejected');
    for (const state of ['submitted', 'running', 'timeout'] as const) expect(decide(rec({ state }), 'h')).toBe('resume');
    expect(decide(rec({ state: 'failed', attempts: 1 }), 'h')).toBe('submit');
    expect(decide(rec({ state: 'failed', attempts: 2 }), 'h')).toBe('skip-failed');
    expect(decide(rec({ state: 'normalised' }), 'h', { force: true })).toBe('submit');
    // a fallback / retry attempt carries its own inputHash but the SKU's planHash is what counts
    expect(decide(rec({ state: 'rejected', provider: 'tripo', inputHash: 'tripo-attempt', planHash: 'h' }), 'h')).toBe('skip-rejected');
    expect(decide(rec({ state: 'rejected', provider: 'tripo', inputHash: 'tripo-attempt', planHash: 'h' }), 'h2')).toBe('submit');
  });

  it('JobStore persists, bumps attempts per submission, tracks the ledger spend and survives reload', () => {
    const dir = tmpDir('jobs');
    const file = path.join(dir, 'jobs.json');
    const store = JobStore.load(file);
    expect(store.get('SKU-1')).toBeUndefined();
    const a = store.submitted({ sku: 'SKU-1', provider: 'meshy', mode: 'single', variant: 'primary', inputHash: 'h1', jobId: 'task-1', estCostUsd: 0.4 });
    expect(a.attempts).toBe(1);
    expect(a.state).toBe('submitted');
    store.update('SKU-1', { state: 'failed', error: 'boom' });
    const b = store.submitted({ sku: 'SKU-1', provider: 'tripo', mode: 'single', variant: 'primary', inputHash: 'h2', jobId: 'task-2', estCostUsd: 0.3 });
    expect(b.attempts).toBe(2);
    expect(store.spentUsd()).toBeCloseTo(0.7, 6);
    store.update('SKU-1', { state: 'normalised', outputFile: 'SKU-1.glb' });
    const again = JobStore.load(file);
    expect(again.get('SKU-1')).toMatchObject({ provider: 'tripo', jobId: 'task-2', state: 'normalised', attempts: 2, outputFile: 'SKU-1.glb' });
    expect(again.snapshot().ledger).toHaveLength(2);
    expect(again.snapshot().ledger[0]).toMatchObject({ jobId: 'task-1', state: 'failed' });
    expect(decide(again.get('SKU-1'), 'h2')).toBe('skip-done');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
