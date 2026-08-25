import type { IngestJobData, JobQueue, QueueRunOpts } from './index';

/** In-process pool with the same attempts + exponential backoff as the BullMQ driver. */
export class LocalQueue implements JobQueue {
  readonly driver = 'local' as const;
  async run(jobs: IngestJobData[], handler: (job: IngestJobData) => Promise<void>, opts: QueueRunOpts) {
    const failed: { skuCode: string; error: string }[] = [];
    let done = 0,
      next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        let lastErr = '';
        for (let attempt = 1; attempt <= opts.attempts; attempt++) {
          try {
            await handler(job);
            lastErr = '';
            break;
          } catch (e) {
            lastErr = (e as Error).message;
            if (attempt < opts.attempts) await new Promise((r) => setTimeout(r, opts.backoffMs * 2 ** (attempt - 1)));
          }
        }
        if (lastErr) failed.push({ skuCode: job.skuCode, error: lastErr });
        else done++;
        opts.onProgress?.(done + failed.length, jobs.length, job.skuCode, !lastErr);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, jobs.length)) }, worker));
    return { done, failed };
  }
  async close() {}
}
