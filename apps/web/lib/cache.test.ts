import { describe, expect, it, vi } from 'vitest';
import { memo, memoOnce } from './cache';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('memo', () => {
  it('serves a repeat read from cache', async () => {
    const load = vi.fn(async (key: string) => `v:${key}`);
    const get = memo(load);

    await expect(get('a')).resolves.toBe('v:a');
    await expect(get('a')).resolves.toBe('v:a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keys entries independently', async () => {
    const load = vi.fn(async (key: string) => `v:${key}`);
    const get = memo(load);

    await Promise.all([get('a'), get('b')]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent misses into one upstream call', async () => {
    // The property the hand-rolled caches this replaced did not have: without it, a cold cache
    // under load fans every in-flight request out to the database at once.
    const load = vi.fn(async (key: string) => {
      await tick();
      return `v:${key}`;
    });
    const get = memo(load);

    const all = await Promise.all([get('a'), get('a'), get('a'), get('a')]);
    expect(all).toEqual(['v:a', 'v:a', 'v:a', 'v:a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  // Real timers: lru-cache reads its own monotonic clock, which fake timers do not drive.
  it('reloads once the entry goes stale', async () => {
    const load = vi.fn(async (key: string) => `v:${key}`);
    const get = memo(load, { ttlMs: 20 });

    await get('a');
    await get('a');
    expect(load).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 40));
    await get('a');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches a null result, so a missing SKU is not re-queried on every view', async () => {
    const load = vi.fn(async () => null);
    const get = memo(load);

    await expect(get('nope')).resolves.toBeNull();
    await expect(get('nope')).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejection — the next call retries', async () => {
    let attempt = 0;
    const get = memo(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('database down');
      return 'recovered';
    });

    await expect(get('a')).rejects.toThrow('database down');
    await expect(get('a')).resolves.toBe('recovered');
  });

  it('evicts least-recently-used entries rather than growing without bound', async () => {
    const load = vi.fn(async (key: string) => `v:${key}`);
    const get = memo(load, { max: 2 });

    await get('a');
    await get('b');
    await get('c'); // evicts 'a'
    await get('c'); // still resident
    expect(load).toHaveBeenCalledTimes(3);

    await get('a'); // was evicted, so this reloads
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe('memoOnce', () => {
  it('loads a single value once and reuses it', async () => {
    const load = vi.fn(async () => ['hyd', 'vij']);
    const get = memoOnce(load);

    await expect(get()).resolves.toEqual(['hyd', 'vij']);
    await expect(get()).resolves.toEqual(['hyd', 'vij']);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
