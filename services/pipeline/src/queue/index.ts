/**
 * JobQueue — one job per SKU. `bullmq` runs on Redis with a Worker (resumable, concurrent,
 * the same architecture that runs at scale); `local` is a MySQL-audited in-process pool with
 * the same attempts/backoff semantics for machines without Redis. `auto` picks by probing Redis.
 */
import { env } from '../config';

export interface IngestJobData {
  skuCode: string;
  stages: string[];
  runId: number;
  resume: boolean;
}
export interface QueueRunOpts {
  concurrency: number;
  attempts: number;
  backoffMs: number;
  onProgress?: (done: number, total: number, skuCode: string, ok: boolean) => void;
}
export interface JobQueue {
  readonly driver: 'bullmq' | 'local';
  run(
    jobs: IngestJobData[],
    handler: (job: IngestJobData) => Promise<void>,
    opts: QueueRunOpts,
  ): Promise<{ done: number; failed: { skuCode: string; error: string }[] }>;
  close(): Promise<void>;
}

async function redisReachable(url: string, ms = 1500): Promise<boolean> {
  try {
    const { default: IORedis } = await import('ioredis');
    const r = new IORedis(url, { lazyConnect: true, connectTimeout: ms, maxRetriesPerRequest: 1, retryStrategy: () => null });
    await r.connect();
    const pong = await r.ping();
    r.disconnect();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function createQueue(driver = env.queueDriver): Promise<JobQueue> {
  if (driver === 'bullmq' || driver === 'auto') {
    const reachable = await redisReachable(env.redisUrl);
    if (reachable) {
      const { BullQueue } = await import('./bullmq');
      return new BullQueue(env.redisUrl);
    }
    if (driver === 'bullmq') throw new Error(`QUEUE_DRIVER=bullmq but Redis at ${env.redisUrl} is unreachable`);
  }
  const { LocalQueue } = await import('./local');
  return new LocalQueue();
}
