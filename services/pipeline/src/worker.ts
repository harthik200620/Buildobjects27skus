/**
 * Standalone BullMQ worker — the ECS-task shape of the pipeline. `pnpm pipeline run` runs an
 * in-process worker for local use; at scale, N of these drain the same Redis queue.
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './config';
import { listCurated } from './providers';
import type { IngestJobData } from './queue';
import { QUEUE_NAME } from './queue/bullmq';
import { loadRegistry } from './registry/seed';
import { ensureRows, type SkuWork, STAGE_FNS } from './stages';

const conn = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
const worker = new Worker<IngestJobData>(
  QUEUE_NAME,
  async (job) => {
    const curated = listCurated().find((c) => c.sku_code === job.data.skuCode);
    if (!curated) throw new Error(`no curated file for ${job.data.skuCode}`);
    const registry = loadRegistry(curated.category);
    if (!registry) throw new Error(`no registry for ${curated.category}`);
    const ids = await ensureRows(curated, (m) => console.log(`${job.data.skuCode}: ${m}`));
    const w: SkuWork = {
      code: curated.sku_code,
      curated,
      registry,
      ids,
      raw: { pageText: '', pdfText: '', pdfUrl: null, secondaryText: '', secondaryUrl: '', fetched: false },
      values: {},
      notes: [],
      log: (m) => console.log(`${job.data.skuCode}: ${m}`),
    };
    for (const stage of job.data.stages) await STAGE_FNS[stage](w);
  },
  { connection: conn, concurrency: env.concurrency },
);

worker.on('completed', (job) => console.log(`✓ ${job.data.skuCode}`));
worker.on('failed', (job, err) => console.log(`✗ ${job?.data.skuCode}: ${err.message}`));
console.log(`worker listening on ${QUEUE_NAME} (${env.redisUrl}) concurrency ${env.concurrency}`);
