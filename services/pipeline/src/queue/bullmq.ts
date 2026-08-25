import { type Job, Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { IngestJobData, JobQueue, QueueRunOpts } from './index';

export const QUEUE_NAME = 'buildobjects-ingest';

export class BullQueue implements JobQueue {
  readonly driver = 'bullmq' as const;
  private conn: IORedis;
  private queue: Queue<IngestJobData>;
  private worker: Worker<IngestJobData> | null = null;
  private events: QueueEvents | null = null;

  constructor(url: string) {
    this.conn = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.queue = new Queue<IngestJobData>(QUEUE_NAME, { connection: this.conn });
  }

  async run(jobs: IngestJobData[], handler: (job: IngestJobData) => Promise<void>, opts: QueueRunOpts) {
    await this.queue.obliterate({ force: true }).catch(() => {});
    this.events = new QueueEvents(QUEUE_NAME, { connection: this.conn.duplicate() });
    await this.events.waitUntilReady();
    const failed: { skuCode: string; error: string }[] = [];
    let done = 0;
    const byId = new Map<string, IngestJobData>();
    const finished = new Promise<void>((resolve) => {
      const check = () => {
        if (done + failed.length >= jobs.length) resolve();
      };
      this.events!.on('completed', ({ jobId }) => {
        done++;
        opts.onProgress?.(done + failed.length, jobs.length, byId.get(jobId)?.skuCode ?? jobId, true);
        check();
      });
      this.events!.on('failed', ({ jobId, failedReason }) => {
        // `failed` fires per attempt; count only the final failure.
        this.queue.getJob(jobId).then((j) => {
          if (j && (j.attemptsMade ?? 0) < (j.opts.attempts ?? 1)) return;
          failed.push({ skuCode: byId.get(jobId)?.skuCode ?? jobId, error: failedReason });
          opts.onProgress?.(done + failed.length, jobs.length, byId.get(jobId)?.skuCode ?? jobId, false);
          check();
        });
      });
    });
    this.worker = new Worker<IngestJobData>(
      QUEUE_NAME,
      async (job: Job<IngestJobData>) => {
        await handler(job.data);
      },
      {
        connection: this.conn.duplicate(),
        concurrency: opts.concurrency,
        lockDuration: 10 * 60_000,
      },
    );
    await this.worker.waitUntilReady();
    for (const data of jobs) {
      const j = await this.queue.add('ingest', data, {
        jobId: `${data.runId}-${data.skuCode}`,
        attempts: opts.attempts,
        backoff: { type: 'exponential', delay: opts.backoffMs },
        removeOnComplete: 500,
        removeOnFail: 500,
      });
      byId.set(j.id!, data);
    }
    if (jobs.length === 0) return { done: 0, failed: [] };
    await finished;
    return { done, failed };
  }

  async close() {
    await this.worker?.close();
    await this.events?.close();
    await this.queue.close();
    this.conn.disconnect();
  }
}
