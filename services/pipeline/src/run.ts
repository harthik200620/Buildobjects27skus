/**
 * Orchestration: one queue job per SKU running the requested stages in order, every
 * SKU × stage audited in ingest_items, then a run-level derive pass (read-models → search →
 * facets → stats → coverage report).
 */

import { categories, getDb, ingestItems, ingestRuns } from '@buildobjects/db';
import { and, desc, eq } from 'drizzle-orm';
import { env, hasAnthropic, STAGES, type Stage } from './config';
import { buildAllFacets } from './facets/build';
import { listCurated, llm } from './providers';
import { createQueue, type IngestJobData } from './queue';
import { rebuildCategoryStats, rebuildSku, resetManifestCache, skuIdsForScope } from './readmodel';
import { loadRegistry } from './registry/seed';
import { coverageRows, printCoverage, writeReport } from './report';
import { ensureIndex, indexDocs } from './search';
import { ensureRows, loadExistingValues, type SkuWork, STAGE_FNS, workHash } from './stages';

export interface RunOptions {
  category?: string;
  sku?: string;
  stage?: string;
  resume?: boolean;
  driver?: 'auto' | 'bullmq' | 'local';
  concurrency?: number;
  log?: (s: string) => void;
}

const notes: Record<string, string[]> = {};

export async function runPipeline(opts: RunOptions) {
  const log = opts.log ?? console.log;
  const db = getDb();
  const stages: Stage[] = opts.stage ? (opts.stage.split(',') as Stage[]).filter((s) => (STAGES as readonly string[]).includes(s)) : [...STAGES];
  if (!stages.length) throw new Error(`unknown stage ${opts.stage}; valid: ${STAGES.join(', ')}`);
  const curated = listCurated(opts.category).filter((c) => !opts.sku || c.sku_code === opts.sku);
  if (!curated.length) throw new Error('no SKUs to ingest — add curated files under services/pipeline/data/curated/{category}/');
  const provider = llm();
  log(`provider: ${provider.name}${hasAnthropic() ? '' : ' (set ANTHROPIC_API_KEY to unlock live extraction/verification/fill/description)'}`);
  const queue = await createQueue(opts.driver ?? env.queueDriver);
  log(
    `queue: ${queue.driver}${queue.driver === 'local' ? ' (Redis not reachable — MySQL-audited in-process pool)' : ` (${env.redisUrl})`} · concurrency ${opts.concurrency ?? env.concurrency} · stages ${stages.join(' → ')}`,
  );

  const [run] = await db
    .insert(ingestRuns)
    .values({ startedAt: new Date(), scope: { category: opts.category, sku: opts.sku, stage: opts.stage, resume: !!opts.resume, driver: queue.driver } });
  const runId = Number(run.insertId);
  const t0 = Date.now();

  const jobs: IngestJobData[] = curated.map((c) => ({ skuCode: c.sku_code, stages, runId, resume: !!opts.resume }));
  const result = await queue.run(jobs, (job) => processSku(job, log), {
    concurrency: opts.concurrency ?? env.concurrency,
    attempts: 3,
    backoffMs: 2000,
    onProgress: (done, total, code, ok) => log(`  [${done}/${total}] ${ok ? '✓' : '✗'} ${code}`),
  });
  await queue.close();

  log('deriving read-models, search index and filters…');
  const touched = await skuIdsForScope({ skuCodes: curated.map((c) => c.sku_code) });
  await derive(
    touched.map((t) => t.id),
    log,
  );

  const rows = await coverageRows();
  const scoped = rows.filter((r) => curated.some((c) => c.sku_code === r.sku));
  const report = printCoverage(scoped, notes);
  const file = writeReport(runId, scoped, notes, {
    provider: provider.name,
    queue: queue.driver,
    stages,
    duration_ms: Date.now() - t0,
    done: result.done,
    failed: result.failed,
  });
  await db
    .update(ingestRuns)
    .set({
      finishedAt: new Date(),
      status: result.failed.length ? 'failed' : 'done',
      summary: { done: result.done, failed: result.failed, duration_ms: Date.now() - t0, report: file },
    })
    .where(eq(ingestRuns.id, runId));
  log('');
  log(report);
  log('');
  log(
    `run ${runId} ${result.failed.length ? `finished with ${result.failed.length} failure(s)` : 'complete'} in ${Math.round((Date.now() - t0) / 1000)} s · report ${file}`,
  );
  if (result.failed.length) for (const f of result.failed) log(`  ✗ ${f.skuCode}: ${f.error}`);
  return { runId, ...result };
}

async function processSku(job: IngestJobData, log: (s: string) => void) {
  const db = getDb();
  const curated = listCurated().find((c) => c.sku_code === job.skuCode);
  if (!curated) throw new Error(`curated file vanished for ${job.skuCode}`);
  const registry = loadRegistry(curated.category);
  if (!registry) throw new Error(`no registry for ${curated.category}`);
  const ids = await ensureRows(curated, (m) => log(`    ${job.skuCode}: ${m}`));
  const w: SkuWork = {
    code: job.skuCode,
    curated,
    registry,
    ids,
    raw: { pageText: '', pdfText: '', pdfUrl: null, secondaryText: '', secondaryUrl: '', fetched: false },
    values: {},
    notes: (notes[job.skuCode] ??= []),
    log: (m) => log(`    ${job.skuCode}: ${m}`),
  };
  w.notes.length = 0;
  const hash = workHash(curated, registry);
  const needsValues = job.stages.some((s) => ['verify', 'fill', 'describe'].includes(s)) && !job.stages.includes('extract');
  if (needsValues) await loadExistingValues(w);

  for (const stage of job.stages) {
    if (job.resume) {
      const [prev] = await db
        .select({ id: ingestItems.id })
        .from(ingestItems)
        .where(and(eq(ingestItems.skuCode, job.skuCode), eq(ingestItems.stage, stage), eq(ingestItems.status, 'done')))
        .orderBy(desc(ingestItems.id))
        .limit(1);
      const [prevMeta] = prev ? await db.select({ meta: ingestItems.meta }).from(ingestItems).where(eq(ingestItems.id, prev.id)) : [];
      if (prev && (prevMeta?.meta as { hash?: string } | null)?.hash === hash) {
        await db
          .insert(ingestItems)
          .values({ runId: job.runId, skuCode: job.skuCode, stage, status: 'skipped', attempts: 0, meta: { hash, reason: 'resume: unchanged' } });
        w.log(`${stage}: skipped (unchanged)`);
        if (stage === 'extract' || stage === 'fill') await loadExistingValues(w);
        continue;
      }
    }
    const [ins] = await db
      .insert(ingestItems)
      .values({ runId: job.runId, skuCode: job.skuCode, stage, status: 'running', attempts: 1, startedAt: new Date(), meta: { hash } });
    const itemId = Number(ins.insertId);
    const t0 = Date.now();
    try {
      await STAGE_FNS[stage](w);
      await db
        .update(ingestItems)
        .set({ status: 'done', finishedAt: new Date(), durationMs: Date.now() - t0, meta: { hash, notes: w.notes.slice(-20) } })
        .where(eq(ingestItems.id, itemId));
    } catch (e) {
      await db
        .update(ingestItems)
        .set({ status: 'failed', finishedAt: new Date(), durationMs: Date.now() - t0, error: String((e as Error).stack ?? e).slice(0, 4000) })
        .where(eq(ingestItems.id, itemId));
      throw e;
    }
  }
}

/** Rebuild read-models for the given SKUs, push them to Meilisearch, recompute facets + stats. */
export async function derive(skuIds: number[], log: (s: string) => void = console.log) {
  resetManifestCache();
  const docs = [];
  for (const id of skuIds) docs.push((await rebuildSku(id)).doc);
  const db = getDb();
  const cats = await db.select({ id: categories.id }).from(categories);
  for (const c of cats) await rebuildCategoryStats(c.id);
  try {
    const filterable = await buildAllFacets(log);
    await ensureIndex(filterable);
    await indexDocs(docs);
    log(`  indexed ${docs.length} documents into Meilisearch (${filterable.length} filterable attributes)`);
  } catch (e) {
    log(`  ! Meilisearch step failed: ${(e as Error).message} — DB read-models are current; re-run \`pnpm pipeline derive\` once Meilisearch is up`);
  }
}

/** Full re-derive of everything in the DB (used by `pipeline derive` and after scale seeding). */
export async function deriveAll(log: (s: string) => void = console.log, scope: { category?: string; sku?: string } = {}) {
  const all = await skuIdsForScope(scope.sku ? { skuCodes: [scope.sku] } : scope.category ? { category: scope.category } : {});
  log(`rebuilding ${all.length} SKUs…`);
  await derive(
    all.map((s) => s.id),
    log,
  );
}
