/**
 * assets/3d/jobs.json — the provider job ledger, keyed by SKU. The same inputs (image hashes +
 * provider + mode + options + dims) never pay twice: a finished job is skipped, a running one is
 * resumed, a rejected one needs --force, a failed one gets one automatic retry.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Dims } from '../builders';
import type { ProviderName, SubmitOptions } from './types';

export type JobRecordState = 'submitted' | 'running' | 'timeout' | 'succeeded' | 'normalised' | 'rejected' | 'failed';
export interface JobRecord {
  sku: string;
  provider: ProviderName;
  mode: 'single' | 'multi';
  variant: 'primary' | 'retry';
  /** Hash of this very submission (provider + variant + images + dims + options). */
  inputHash: string;
  /** Hash of the SKU's primary plan — what `decide()` compares, so a retry / fallback attempt still counts as "these inputs". */
  planHash?: string;
  jobId: string;
  state: JobRecordState;
  submittedAt: string;
  updatedAt: string;
  /** Submissions made for this SKU across runs (including retries and the fallback provider). */
  attempts: number;
  /** Estimated spend for this submission (USD). */
  estCostUsd: number;
  images?: string[];
  modelUrls?: Record<string, string>;
  previewUrl?: string | null;
  error?: string | null;
  reason?: string | null;
  outputFile?: string | null;
}
export interface JobsFile {
  version: 1;
  updated_at: string;
  jobs: Record<string, JobRecord>;
  ledger: JobRecord[];
}

export const JOBS_FILE = 'jobs.json';
export const MAX_AUTO_ATTEMPTS = 2;

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

export interface HashInput {
  provider: ProviderName;
  mode: 'single' | 'multi';
  variant: 'primary' | 'retry';
  images: Buffer[];
  dims: Dims;
  opts: SubmitOptions;
}
/** Stable across runs for identical inputs; any change (new cut-out, other provider, retry variant, new dims) is a new job. */
export function inputHash(i: HashInput): string {
  const dims = [i.dims.w, i.dims.h, i.dims.d].map((v) => Math.round(v * 1000));
  const opts = { pbr: i.opts.pbr, texture: i.opts.texture, polycount: i.opts.polycount, symmetry: i.opts.symmetry, formats: [...i.opts.targetFormats].sort() };
  return sha1(JSON.stringify({ provider: i.provider, mode: i.mode, variant: i.variant, images: i.images.map((b) => sha1(b)), dims, opts }));
}

export type JobDecision = 'submit' | 'resume' | 'skip-done' | 'skip-rejected' | 'skip-failed';
export function decide(prev: JobRecord | undefined, hash: string, opts: { force?: boolean; maxAttempts?: number } = {}): JobDecision {
  if (opts.force) return 'submit';
  if (!prev || (prev.planHash ?? prev.inputHash) !== hash) return 'submit';
  switch (prev.state) {
    case 'submitted':
    case 'running':
    case 'timeout':
      return 'resume';
    case 'succeeded':
    case 'normalised':
      return 'skip-done';
    case 'rejected':
      return 'skip-rejected';
    case 'failed':
      return prev.attempts < (opts.maxAttempts ?? MAX_AUTO_ATTEMPTS) ? 'submit' : 'skip-failed';
    default:
      return 'submit';
  }
}

export class JobStore {
  private data: JobsFile;
  constructor(
    public readonly file: string,
    data?: JobsFile,
  ) {
    this.data = data ?? { version: 1, updated_at: new Date().toISOString(), jobs: {}, ledger: [] };
  }
  static load(file: string): JobStore {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<JobsFile>;
      return new JobStore(file, {
        version: 1,
        updated_at: parsed.updated_at ?? new Date().toISOString(),
        jobs: parsed.jobs ?? {},
        ledger: parsed.ledger ?? [],
      });
    } catch {
      return new JobStore(file);
    }
  }
  get(sku: string): JobRecord | undefined {
    return this.data.jobs[sku];
  }
  all(): JobRecord[] {
    return Object.values(this.data.jobs);
  }
  /** Record a new submission (bumps attempts, appends to the ledger). */
  submitted(rec: Omit<JobRecord, 'attempts' | 'submittedAt' | 'updatedAt' | 'state'> & { state?: JobRecordState }): JobRecord {
    const prev = this.data.jobs[rec.sku];
    const now = new Date().toISOString();
    const full: JobRecord = { ...rec, state: rec.state ?? 'submitted', attempts: (prev?.attempts ?? 0) + 1, submittedAt: now, updatedAt: now };
    this.data.jobs[rec.sku] = full;
    this.data.ledger.push({ ...full });
    this.save();
    return full;
  }
  update(sku: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const cur = this.data.jobs[sku];
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.data.jobs[sku] = next;
    const i = this.data.ledger.findIndex((l) => l.jobId === cur.jobId && l.sku === sku);
    if (i >= 0) this.data.ledger[i] = { ...next };
    this.save();
    return next;
  }
  /** Sum of the estimated cost of every submission ever made (the ledger). */
  spentUsd(): number {
    return this.data.ledger.reduce((s, r) => s + (r.estCostUsd || 0), 0);
  }
  save() {
    this.data.updated_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
  snapshot(): JobsFile {
    return JSON.parse(JSON.stringify(this.data)) as JobsFile;
  }
}
