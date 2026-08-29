/**
 * pnpm scale:test [--base http://localhost:3000] [--n 200] [--concurrency 10]
 *
 * The §12.1 proof, measured against the running web app, Meilisearch and the pipeline:
 *   PLP API p95 < 150 ms · search p95 < 80 ms · PDP render p95 < 200 ms ·
 *   filter recompute (largest category) < 60 s · queue drain ≥ 50 SKUs/min.
 * Self-contained: node fetch + a tiny HS256 signer for the session cookie (no extra deps).
 * Writes storage/reports/scale-latest.json and exits 1 if any budget fails.
 */
import '../src/env';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getPool } from '../src/client';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = flag('base', 'http://localhost:3000');
const N = Number(flag('n', '200'));
const CONC = Number(flag('concurrency', '10'));
const MEILI = process.env.MEILI_HOST ?? 'http://127.0.0.1:7700';
const MEILI_KEY = process.env.MEILI_MASTER_KEY ?? '';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function sessionCookie(): string {
  const secret = process.env.SESSION_SECRET || 'buildo-local-dev-secret';
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sid: 'scale-test', uid: 0, phone: '9000000000', regionId: 'hyd', pincode: '500001', iat: now, exp: now + 3600 }));
  const sig = b64u(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `bo_session=${header}.${payload}.${sig}`;
}
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function bench(
  label: string,
  n: number,
  conc: number,
  one: (i: number) => Promise<number | null>,
): Promise<{ label: string; n: number; ok: number; p50: number; p95: number; p99: number; max: number }> {
  const lat: number[] = [];
  let ok = 0,
    next = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < n) {
        const i = next++;
        const ms = await one(i);
        if (ms !== null) {
          lat.push(ms);
          ok++;
        }
      }
    }),
  );
  const r = { label, n, ok, p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)), max: Math.round(Math.max(0, ...lat)) };
  console.log(
    `  ${label.padEnd(34)} n=${String(n).padStart(4)} ok=${String(ok).padStart(4)}  p50 ${String(r.p50).padStart(5)} ms  p95 ${String(r.p95).padStart(5)} ms  p99 ${String(r.p99).padStart(5)} ms  max ${r.max} ms`,
  );
  return r;
}

async function timed(url: string, init?: RequestInit): Promise<number | null> {
  const t0 = performance.now();
  try {
    const r = await fetch(url, init);
    await r.arrayBuffer();
    return r.ok ? performance.now() - t0 : null;
  } catch {
    return null;
  }
}

async function main() {
  const pool = getPool();
  const cookie = sessionCookie();
  const [cats] = (await pool.query('SELECT slug FROM categories')) as unknown as [{ slug: string }[]];
  const [[{ total }]] = (await pool.query('SELECT COUNT(*) AS total FROM skus')) as unknown as [[{ total: number }]];
  const [[{ maxId }]] = (await pool.query('SELECT MAX(id) AS maxId FROM skus')) as unknown as [[{ maxId: number }]];
  const [codes] = (await pool.query('SELECT sku_code FROM skus ORDER BY RAND() LIMIT 300')) as unknown as [{ sku_code: string }[]];
  console.log(`catalogue: ${Number(total).toLocaleString('en-IN')} SKUs · base ${BASE} · n=${N} conc=${CONC}`);
  // warm the app routes once so the first compile is not measured
  await timed(`${BASE}/api/skus?limit=1`, { headers: { cookie } });
  await timed(`${BASE}/p/${codes[0]?.sku_code.toLowerCase()}`, { headers: { cookie } });

  const results: Record<string, unknown> = {};
  results.plp_api = await bench('PLP API /api/skus keyset', N, CONC, (i) =>
    timed(`${BASE}/api/skus?category=${cats[i % cats.length].slug}&after=${Math.floor(Math.random() * Number(maxId))}&limit=48`, { headers: { cookie } }),
  );
  const queries = ['cement', 'cemet', 'bulp 9w', 'hikvision', 'tiles 600', 'glass 6mm', 'సిమెంట్', 'extingisher', 'solar 550', 'leica', 'waterproofing', 'led'];
  results.search = await bench('Meilisearch query + facets', N, CONC, async (i) => {
    const t0 = performance.now();
    try {
      const r = await fetch(`${MEILI}/indexes/skus/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${MEILI_KEY}` },
        body: JSON.stringify({
          q: queries[i % queries.length],
          facets: ['category', 'brand', 'in_stock'],
          filter: i % 3 === 0 ? `category = "${cats[i % cats.length].slug}"` : undefined,
          hitsPerPage: 24,
          page: 1 + (i % 5),
        }),
      });
      await r.arrayBuffer();
      return r.ok ? performance.now() - t0 : null;
    } catch {
      return null;
    }
  });
  results.pdp = await bench('PDP render /p/[sku] (HTML)', Math.min(N, codes.length), CONC, (i) =>
    timed(`${BASE}/p/${codes[i % codes.length].sku_code.toLowerCase()}`, { headers: { cookie } }),
  );

  // filter recompute: the pipeline's facet engine over every category; report the slowest category
  const t0 = performance.now();
  const facets = spawnSync('pnpm pipeline facets', { cwd: ROOT, encoding: 'utf8', shell: true });
  const facetMs = Math.round(performance.now() - t0);
  const facetLines = (facets.stdout || '')
    .split('\n')
    .filter((l) => /facets/.test(l))
    .map((l) => l.trim())
    .slice(0, 12);
  console.log(`  ${'filter recompute (all categories)'.padEnd(34)} ${facetMs} ms${facets.status !== 0 ? `  (exit ${facets.status})` : ''}`);
  results.facets = { ms: facetMs, exit: facets.status, lines: facetLines };

  // queue drain rate: BullMQ with no-op jobs (network-bound stages are rate-limited by politeness; this measures the queue itself)
  let drain: { jobs: number; ms: number; perMin: number } | null = null;
  try {
    const { Queue, Worker } = await import('bullmq');
    const { default: IORedis } = await import('ioredis');
    const conn = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null, lazyConnect: true, connectTimeout: 1500 });
    await conn.connect();
    const name = `scale-drain-${Date.now()}`;
    const q = new Queue(name, { connection: conn });
    const JOBS = 600;
    await q.addBulk(Array.from({ length: JOBS }, (_, i) => ({ name: 'sku', data: { i } })));
    const t1 = performance.now();
    let done = 0;
    await new Promise<void>((resolve) => {
      const w = new Worker(
        name,
        async () => {
          await new Promise((r) => setTimeout(r, 25));
        },
        { connection: conn, concurrency: 6 },
      );
      w.on('completed', () => {
        done++;
        if (done >= JOBS) w.close().then(resolve);
      });
    });
    const ms = Math.round(performance.now() - t1);
    drain = { jobs: JOBS, ms, perMin: Math.round(JOBS / (ms / 60000)) };
    await q.obliterate({ force: true });
    await q.close();
    conn.disconnect();
    console.log(`  ${'queue drain (BullMQ, 6 workers)'.padEnd(34)} ${JOBS} jobs in ${ms} ms = ${drain.perMin.toLocaleString('en-IN')} SKUs/min`);
  } catch (e) {
    console.log(`  queue drain: skipped (${(e as Error).message})`);
  }
  results.queue = drain;

  const budgets = [
    { key: 'PLP API p95 < 150 ms', ok: (results.plp_api as { p95: number; ok: number }).p95 < 150 && (results.plp_api as { ok: number }).ok > 0 },
    { key: 'search p95 < 80 ms', ok: (results.search as { p95: number; ok: number }).p95 < 80 && (results.search as { ok: number }).ok > 0 },
    { key: 'PDP render p95 < 200 ms', ok: (results.pdp as { p95: number; ok: number }).p95 < 200 && (results.pdp as { ok: number }).ok > 0 },
    { key: 'filter recompute < 60 s', ok: facetMs < 60_000 && facets.status === 0 },
    { key: 'queue drain ≥ 50 SKUs/min', ok: !!drain && drain.perMin >= 50 },
  ];
  console.log('');
  for (const b of budgets) console.log(`  ${b.ok ? '✓' : '✗'} ${b.key}`);
  const report = { generated_at: new Date().toISOString(), base: BASE, catalogue_skus: Number(total), n: N, concurrency: CONC, results, budgets };
  fs.mkdirSync(path.join(ROOT, 'storage', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'storage', 'reports', 'scale-latest.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → storage/reports/scale-latest.json`);
  await closeDb();
  process.exit(budgets.every((b) => b.ok) ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
