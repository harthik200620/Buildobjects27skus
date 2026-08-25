/**
 * pnpm assets:3d:photoreal [--sku CODE] [--category c] [--force] [--provider auto|meshy|tripo]
 *                          [--dry-run] [--concurrency 2] [--max-spend 30] [--assist ./module.ts]
 *
 * Image-to-3D for every SKU with a real hero photo: select views (hero → angle → detail →
 * in_context, cut-outs preferred) → submit to Meshy / Tripo → poll 5→10→20 s (≤ 15 min) →
 * download → normalise (true dimensions, Y up, base y = 0, front = +Z, ≤ 100k tris, ≤ 12 MB) →
 * judge (when an assist is wired) → assets/3d/{SKU}.glb + manifest merge. jobs.json guarantees
 * the same inputs never pay twice; photoreal-report.json records every outcome with its reason.
 * `--dry-run` = selection + cut-out availability + cost estimate only, no network.
 * `--assist` points at a module exporting a PhotorealAssist (default export / `assist` /
 * `createAssist()`) — the LLM track's Gemini cut-out + judge. Exit 1 when any SKU failed or was rejected.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetManifestEntry, AssetQualityReport } from '@buildobjects/catalog';
import { closeDb, getDb } from '@buildobjects/db';
import { ASSETS_DIR, flags, resolveMediaRoot, writeManifest } from '../build';
import { type DimsResult, dimsFor } from '../dims';
import { heroCutoutFor } from '../textures';
import type { FetchLike } from './http';
import { decide, inputHash, JOBS_FILE, type JobDecision, type JobRecord, JobStore } from './jobs';
import { MESHY_COST_USD } from './meshy';
import { normaliseGlb } from './normalise';
import { describeProviders, type ProviderPick, type ProviderPref, parseProviderPref, pickProvider } from './providers';
import { DISTINCT_VIEW_BITS, dhash, hamming, loadTargets, type PhotorealTarget, readView, type SelectedView, selectViews } from './select-images';
import { TRIPO_COST_USD } from './tripo';
import {
  DEFAULT_SUBMIT_OPTIONS,
  type JobHandle,
  type JobStatus,
  JUDGE_MIN,
  type JudgeVerdict,
  type PhotorealAssist,
  type Provider3D,
  ProviderError,
  type ProviderName,
  type SubmitImage,
  type SubmitInput,
} from './types';

export const POLL_DELAYS_MS = [5_000, 10_000, 20_000];
export const POLL_MAX_MS = 15 * 60_000;
export const REPORT_FILE = 'photoreal-report.json';

export interface RunOptions {
  sku?: string;
  category?: string;
  force?: boolean;
  provider?: ProviderPref;
  dryRun?: boolean;
  concurrency?: number;
  maxSpendUsd?: number;
  assist?: PhotorealAssist | null;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  assetsDir?: string;
  mediaRoot?: string;
  pollMaxMs?: number;
  /** Injected targets (tests) — skips the database. */
  targets?: PhotorealTarget[];
}
export type Outcome = 'photoreal' | 'planned' | 'skipped' | 'failed' | 'rejected';
export interface SkuResult {
  sku: string;
  category: string;
  outcome: Outcome;
  reason?: string;
  provider?: ProviderName;
  job_id?: string;
  mode?: 'single' | 'multi';
  images: { key: string; role: string; source: 'cutout' | 'orig' }[];
  cutouts: number;
  est_cost_usd: number;
  warnings: string[];
  quality_report?: AssetQualityReport | null;
  file?: string;
  attempts?: number;
}
export interface RunReport {
  generated_at: string;
  dry_run: boolean;
  provider_pref: ProviderPref;
  providers: string[];
  max_spend_usd: number;
  estimated_spend_usd: number;
  ledger_spend_usd: number;
  results: SkuResult[];
  totals: Record<Outcome, number>;
}

type PlanImage = SubmitImage & { source: 'cutout' | 'orig'; position: number; key: string };
interface SkuPlan {
  target: PhotorealTarget;
  dims: DimsResult;
  views: SelectedView[];
  images: PlanImage[];
  cutouts: number;
  /** RGBA silhouette source for the front check (cut-out, else a near-white knockout of the hero). */
  heroMask: Buffer | null;
  mode: 'single' | 'multi';
  hash: string;
  decision: JobDecision;
  prev?: JobRecord;
  cost: number;
  skip?: string;
}
interface Ctx {
  env: NodeJS.ProcessEnv;
  log: (l: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  assetsDir: string;
  mediaRoot: string;
  cutoutsDir: string;
  rawDir: string;
  pollMaxMs: number;
  pick: ProviderPick | null;
  primaryName: ProviderName;
  jobs: JobStore;
  assist: PhotorealAssist | null;
  dryRun: boolean;
  force: boolean;
  maxSpend: number;
  spent: number;
  fatal: ProviderError | null;
}

const isFatal = (e: unknown) => e instanceof ProviderError && (e.code === 'auth' || e.code === 'quota');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Table estimate when no provider instance exists (dry-run without a key). */
export function estimateCost(provider: ProviderName, mode: 'single' | 'multi', images: number, instance?: Provider3D | null): number {
  if (instance)
    return instance.estimateCostUsd({
      mode,
      images: Array.from({ length: images }, () => ({ buffer: Buffer.alloc(0), role: 'extra' as const, mime: 'image/png' as const })),
      opts: DEFAULT_SUBMIT_OPTIONS,
    });
  const multi = mode === 'multi' && images >= 2;
  return provider === 'meshy' ? (multi ? MESHY_COST_USD.multi : MESHY_COST_USD.single) : TRIPO_COST_USD.single;
}

async function withRetry<T>(fn: () => Promise<T>, ctx: Pick<Ctx, 'sleep' | 'log'>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || i >= attempts - 1) throw e;
      const wait = 2_000 * 2 ** i;
      ctx.log(`    ${e.message} — retrying in ${wait / 1000}s`);
      await ctx.sleep(wait);
    }
  }
}

/** 5 → 10 → 20 → 20 … seconds until the task settles; returns the last status (still pending/running on timeout). */
export async function pollUntilDone(
  provider: Provider3D,
  handle: JobHandle,
  o: { sleep: (ms: number) => Promise<void>; now: () => number; maxMs?: number; log?: (l: string) => void },
): Promise<JobStatus> {
  const start = o.now(),
    maxMs = o.maxMs ?? POLL_MAX_MS;
  for (let i = 0; ; i++) {
    const status = await withRetry(() => provider.poll(handle), { sleep: o.sleep, log: o.log ?? (() => {}) });
    if (status.state !== 'pending' && status.state !== 'running') return status;
    if (o.now() - start >= maxMs) return status;
    const delay = POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)];
    o.log?.(`    ${handle.provider} ${handle.id}: ${status.state} ${Math.round(status.progress)} % — next poll in ${delay / 1000}s`);
    await o.sleep(delay);
  }
}

async function planSku(t: PhotorealTarget, ctx: Ctx): Promise<SkuPlan> {
  const dims = dimsFor(t.spec, t.category);
  const base: SkuPlan = { target: t, dims, views: [], images: [], cutouts: 0, heroMask: null, mode: 'single', hash: '', decision: 'submit', cost: 0 };
  const views = selectViews(t, ctx.mediaRoot, { extraCutoutDirs: [ctx.cutoutsDir] });
  if (!views.length)
    return {
      ...base,
      skip: t.images.some((i) => i.role === 'hero')
        ? 'hero file missing under MEDIA_ROOT'
        : 'no real hero image (placeholder only) — nothing honest to model from',
    };
  const images: PlanImage[] = [];
  for (const v of views) {
    const img = await readView(v, { preferCutout: true });
    if (!img) continue;
    let buffer = img.buffer,
      source = img.source;
    if (source === 'orig' && ctx.assist?.cutout && !ctx.dryRun) {
      try {
        const cut = await ctx.assist.cutout(buffer, { sku: t.code, role: v.role, position: v.position, key: v.key });
        if (cut) {
          const dir = path.join(ctx.cutoutsDir, t.code);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${v.position}-cutout.png`), cut);
          buffer = cut;
          source = 'cutout';
        }
      } catch (e) {
        ctx.log(`    ${t.code}: assist cut-out failed for ${v.key}: ${msg(e)}`);
      }
    }
    images.push({ buffer, mime: 'image/png', role: v.viewRole, key: v.key, source, position: v.position });
  }
  if (!images.length) return { ...base, views, skip: 'hero image unreadable' };
  // multi-view only with ≥ 2 distinct cut-outs (dHash distance > 12); unlabelled extras stay `extra`
  const cutouts = images.filter((i) => i.source === 'cutout');
  let submit: PlanImage[] = [images[0]];
  if (images[0].source === 'cutout' && cutouts.length >= 2) {
    const kept: { img: PlanImage; hash: bigint }[] = [{ img: images[0], hash: await dhash(images[0].buffer) }];
    for (const c of cutouts.slice(1)) {
      const h = await dhash(c.buffer);
      if (kept.every((k) => hamming(k.hash, h) > DISTINCT_VIEW_BITS)) kept.push({ img: c, hash: h });
      if (kept.length >= 4) break;
    }
    if (kept.length >= 2) submit = kept.map((k) => k.img);
  }
  const mode: 'single' | 'multi' = submit.length >= 2 ? 'multi' : 'single';
  const heroMask =
    images[0].source === 'cutout'
      ? images[0].buffer
      : ((await heroCutoutFor(t.code, ctx.mediaRoot, { position: views[0].position, allowOrig: true }))?.buffer ?? null);
  const hash = inputHash({
    provider: ctx.primaryName,
    mode,
    variant: 'primary',
    images: submit.map((i) => i.buffer),
    dims: dims.m,
    opts: DEFAULT_SUBMIT_OPTIONS,
  });
  const prev = ctx.jobs.get(t.code);
  const decision = decide(prev, hash, { force: ctx.force });
  const cost = decision === 'submit' ? estimateCost(ctx.primaryName, mode, submit.length, ctx.pick?.primary) : 0;
  return { ...base, views, images: submit, cutouts: cutouts.length, heroMask, mode, hash, decision, prev, cost };
}

function planResult(p: SkuPlan, outcome: Outcome, reason?: string): SkuResult {
  return {
    sku: p.target.code,
    category: p.target.category,
    outcome,
    reason,
    provider: p.prev?.provider,
    job_id: p.prev?.jobId,
    mode: p.mode,
    images: p.images.map((i) => ({ key: i.key, role: i.role, source: i.source })),
    cutouts: p.cutouts,
    est_cost_usd: p.cost,
    warnings: [],
  };
}

async function executeSku(p: SkuPlan, ctx: Ctx): Promise<SkuResult> {
  const sku = p.target.code,
    { log, jobs } = ctx,
    pick = ctx.pick!;
  const byName = (n: ProviderName): Provider3D | null => (pick.primary.name === n ? pick.primary : pick.fallback?.name === n ? pick.fallback : null);
  const warnings: string[] = [];
  const sources = p.images.map((i) => i.key);
  const attempts: { provider: Provider3D; variant: 'primary' | 'retry' }[] = [
    { provider: pick.primary, variant: 'primary' },
    { provider: pick.primary, variant: 'retry' },
  ];
  if (pick.fallback) attempts.push({ provider: pick.fallback, variant: 'primary' });
  let resume: JobRecord | null = p.decision === 'resume' && p.prev ? p.prev : null;
  let lastReason = 'no attempt made',
    lastOutcome: Outcome = 'failed',
    made = 0;

  for (const att of attempts) {
    if (ctx.fatal) {
      lastReason = `run aborted: ${ctx.fatal.message}`;
      break;
    }
    let provider = att.provider,
      handle: JobHandle,
      cost = 0;
    if (resume) {
      const rp = byName(resume.provider);
      if (!rp) {
        lastReason = `cannot resume ${resume.provider} job ${resume.jobId}: no key for that provider`;
        resume = null;
        continue;
      }
      provider = rp;
      handle = { provider: resume.provider, id: resume.jobId, mode: resume.mode };
      log(`  ${sku}: resuming ${resume.provider} job ${resume.jobId} (no new spend)`);
      resume = null;
    } else {
      cost = provider.estimateCostUsd({ mode: p.mode, images: p.images, opts: DEFAULT_SUBMIT_OPTIONS });
      if (ctx.spent + cost > ctx.maxSpend + 1e-9) {
        lastReason = `max-spend ${ctx.maxSpend.toFixed(2)} USD reached (≈ ${ctx.spent.toFixed(2)} committed) — not submitted`;
        lastOutcome = 'skipped';
        break;
      }
      ctx.spent += cost; // reserve before the await so concurrent workers cannot overshoot
      const input: SubmitInput = { sku, images: p.images, mode: p.mode, opts: { ...DEFAULT_SUBMIT_OPTIONS, variant: att.variant } };
      try {
        handle = await withRetry(() => provider.submit(input), ctx);
      } catch (e) {
        ctx.spent -= cost;
        if (isFatal(e)) {
          ctx.fatal = e as ProviderError;
          lastReason = `${provider.name}: ${msg(e)}`;
          break;
        }
        lastReason = `${provider.name} submit (${att.variant}) failed: ${msg(e)}`;
        continue;
      }
      made++;
      const hash = inputHash({
        provider: provider.name,
        mode: p.mode,
        variant: att.variant,
        images: p.images.map((i) => i.buffer),
        dims: p.dims.m,
        opts: DEFAULT_SUBMIT_OPTIONS,
      });
      jobs.submitted({
        sku,
        provider: provider.name,
        mode: handle.mode,
        variant: att.variant,
        inputHash: hash,
        planHash: p.hash,
        jobId: handle.id,
        estCostUsd: cost,
        images: sources,
      });
      log(`  ${sku}: submitted to ${provider.name} (${handle.mode}, ${att.variant}) → ${handle.id}  ≈ $${cost.toFixed(2)}`);
    }

    let status: JobStatus;
    try {
      status = await pollUntilDone(provider, handle, { sleep: ctx.sleep, now: ctx.now, maxMs: ctx.pollMaxMs, log });
    } catch (e) {
      if (isFatal(e)) {
        ctx.fatal = e as ProviderError;
        lastReason = `${provider.name}: ${msg(e)}`;
        break;
      }
      jobs.update(sku, { state: 'failed', error: msg(e) });
      lastReason = `${provider.name} poll failed: ${msg(e)}`;
      continue;
    }
    if (status.state === 'pending' || status.state === 'running') {
      jobs.update(sku, { state: 'timeout' });
      lastReason = `${provider.name} job ${handle.id} still ${status.state} after ${Math.round(ctx.pollMaxMs / 60_000)} min — the next run resumes it`;
      break;
    }
    if (status.state !== 'succeeded') {
      jobs.update(sku, { state: 'failed', error: status.error });
      lastReason = `${provider.name} task ${status.state}: ${status.error ?? 'no detail'}`;
      continue;
    }
    jobs.update(sku, { state: 'succeeded', modelUrls: status.modelUrls as Record<string, string>, previewUrl: status.previewUrl });
    if (!status.modelUrls.glb) {
      jobs.update(sku, { state: 'failed', error: 'no GLB url' });
      lastReason = `${provider.name}: task succeeded without a GLB url`;
      continue;
    }

    let raw: Buffer;
    try {
      raw = await withRetry(() => provider.download(status.modelUrls.glb!), ctx);
    } catch (e) {
      lastReason = `${provider.name} download failed: ${msg(e)}`;
      continue;
    }
    fs.mkdirSync(ctx.rawDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.rawDir, `${sku}.${provider.name}.glb`), raw);

    const norm = await normaliseGlb(raw, { dims: p.dims.m, heroCutout: p.heroMask });
    warnings.push(...norm.warnings.map((w) => `${provider.name}: ${w}`));
    if (norm.rejected || !norm.glb) {
      jobs.update(sku, { state: 'rejected', reason: norm.rejected });
      lastReason = `normalise rejected (${provider.name}, ${att.variant}): ${norm.rejected}`;
      lastOutcome = 'rejected';
      continue;
    }

    let verdict: JudgeVerdict | null = null,
      judgeNote: string;
    if (ctx.assist?.judge && status.previewUrl) {
      try {
        const preview = await provider.download(status.previewUrl);
        verdict = await ctx.assist.judge(p.images[0].buffer, preview, { sku, name: p.target.name, brand: p.target.brand, category: p.target.category });
        judgeNote = `judge ${verdict.overall.toFixed(2)}${verdict.defects.length ? ` — ${verdict.defects.join('; ')}` : ''}`;
        if (verdict.overall < JUDGE_MIN) {
          jobs.update(sku, { state: 'rejected', reason: `judge ${verdict.overall.toFixed(2)} < ${JUDGE_MIN}` });
          lastReason = `judge rejected (${provider.name}, ${att.variant}): ${verdict.overall.toFixed(2)} < ${JUDGE_MIN}${verdict.defects.length ? ` — ${verdict.defects.join('; ')}` : ''}`;
          lastOutcome = 'rejected';
          continue;
        }
      } catch (e) {
        judgeNote = `judge skipped — ${msg(e)}`;
        warnings.push(judgeNote);
      }
    } else
      judgeNote = ctx.assist?.judge
        ? 'judge skipped — provider returned no preview render'
        : 'judge skipped — no vision assist wired (@buildobjects/llm judgeModelMatch)';

    // write outputs + manifest
    fs.writeFileSync(path.join(ctx.assetsDir, `${sku}.glb`), norm.glb);
    let usdz: string | null = null;
    if (status.modelUrls.usdz) {
      try {
        const u = await provider.download(status.modelUrls.usdz);
        const identity = norm.axis_map === 'x,y,z' && norm.front_yaw_deg === 0 && Math.abs(norm.scale - 1) < 0.02;
        if (identity) {
          fs.writeFileSync(path.join(ctx.assetsDir, `${sku}.usdz`), u);
          usdz = `${sku}.usdz`;
        } else {
          fs.writeFileSync(path.join(ctx.rawDir, `${sku}.${provider.name}.usdz`), u);
          warnings.push('provider USDZ kept un-normalised under photoreal/raw (axes / scale differ) — Quick Look exports from the GLB');
        }
      } catch (e) {
        warnings.push(`usdz download failed: ${msg(e)}`);
      }
    }
    const quality_report: AssetQualityReport = {
      overall: verdict?.overall ?? null,
      defects: verdict?.defects ?? [],
      judge: verdict ? 'llm' : 'skipped',
      silhouette_iou: norm.silhouette_iou,
      aspect_mismatch: norm.aspect_mismatch,
      warnings,
      note: judgeNote,
    };
    const entry: AssetManifestEntry = {
      file: `${sku}.glb`,
      category: p.target.category,
      placeholder: false,
      dims_mm: p.dims.mm,
      bbox_m: norm.bbox_m,
      triangles: norm.triangles,
      builder: 'photoreal',
      usdz,
      quality: 'photoreal',
      provider: provider.name,
      source_images: sources,
      job_id: handle.id,
      generated_at: new Date().toISOString(),
      axis_map: norm.axis_map,
      front_yaw_deg: norm.front_yaw_deg,
      quality_report,
      textures: { count: norm.textures.count, max_px: norm.textures.max_px, sources: [`${provider.name}`] },
      note: judgeNote,
    };
    writeManifest({ [sku]: entry }, ctx.assetsDir);
    jobs.update(sku, { state: 'normalised', outputFile: `${sku}.glb` });
    log(
      `  ${sku}: ✓ ${sku}.glb  ${norm.triangles.toLocaleString()} tris  ${norm.size_mb.toFixed(1)} MB  axis ${norm.axis_map}  yaw ${norm.front_yaw_deg}°  ${judgeNote}`,
    );
    return {
      ...planResult(p, 'photoreal'),
      provider: provider.name,
      job_id: handle.id,
      mode: handle.mode,
      warnings,
      quality_report,
      file: `${sku}.glb`,
      attempts: made,
    };
  }
  return { ...planResult(p, lastOutcome, lastReason), warnings, attempts: made };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export async function runPhotoreal(opts: RunOptions): Promise<RunReport> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((_l: string) => {});
  const assetsDir = opts.assetsDir ?? ASSETS_DIR;
  const pref = opts.provider ?? parseProviderPref(env.PHOTOREAL_PROVIDER);
  const dryRun = !!opts.dryRun;
  const maxSpend = opts.maxSpendUsd ?? (Number(env.PHOTOREAL_MAX_SPEND_USD) || 30);
  let pick: ProviderPick | null = null,
    pickError: string | null = null;
  try {
    pick = pickProvider(pref, env, opts.fetch);
  } catch (e) {
    pickError = msg(e);
  }
  if (!pick && !dryRun) throw new ProviderError('none', 'auth', pickError ?? 'no provider');
  const ctx: Ctx = {
    env,
    log,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: opts.now ?? (() => Date.now()),
    assetsDir,
    mediaRoot: opts.mediaRoot ?? resolveMediaRoot(env),
    cutoutsDir: path.join(assetsDir, 'cutouts'),
    rawDir: path.join(assetsDir, 'photoreal', 'raw'),
    pollMaxMs: opts.pollMaxMs ?? POLL_MAX_MS,
    pick,
    primaryName: pick?.primary.name ?? (pref === 'auto' ? 'meshy' : pref),
    jobs: JobStore.load(path.join(assetsDir, JOBS_FILE)),
    assist: opts.assist ?? null,
    dryRun,
    force: !!opts.force,
    maxSpend,
    spent: 0,
    fatal: null,
  };

  let targets = opts.targets;
  if (targets) targets = targets.filter((t) => (!opts.sku || t.code === opts.sku) && (!opts.category || t.category === opts.category));
  else {
    const db = getDb();
    try {
      targets = await loadTargets(db, { sku: opts.sku, category: opts.category });
    } finally {
      await closeDb();
    }
  }

  const providers = describeProviders(env);
  log(
    `photoreal 3D · ${dryRun ? 'DRY RUN (no network)' : `provider ${ctx.primaryName}${pick?.fallback ? ` (fallback ${pick.fallback.name})` : ''}`} · ${providers.join(', ')}${pickError ? ` · ${pickError}` : ''}`,
  );
  log(
    `  max-spend $${maxSpend.toFixed(2)} this run · ledger so far ≈ $${ctx.jobs.spentUsd().toFixed(2)} · assist: ${ctx.assist?.cutout ? 'cut-out' : 'no cut-out'} / ${ctx.assist?.judge ? 'judge' : 'no judge'}`,
  );

  const plans: SkuPlan[] = [];
  for (const t of targets) plans.push(await planSku(t, ctx));

  // spend guard on the plan, in SKU order
  let planned = 0;
  const results: SkuResult[] = [];
  const toRun: SkuPlan[] = [];
  for (const p of plans) {
    if (p.skip) {
      results.push(planResult(p, 'skipped', p.skip));
      continue;
    }
    if (p.decision === 'skip-done') {
      results.push(planResult(p, 'skipped', `already generated from these inputs (${p.prev?.provider} ${p.prev?.jobId}); use --force to regenerate`));
      continue;
    }
    if (p.decision === 'skip-rejected') {
      results.push(planResult(p, 'skipped', `rejected earlier from these inputs (${p.prev?.reason ?? 'see jobs.json'}); use --force to retry`));
      continue;
    }
    if (p.decision === 'skip-failed') {
      results.push(planResult(p, 'skipped', `failed ${p.prev?.attempts} times from these inputs; use --force to retry`));
      continue;
    }
    if (p.decision === 'submit' && planned + p.cost > maxSpend + 1e-9) {
      results.push(planResult(p, 'skipped', `beyond --max-spend $${maxSpend.toFixed(2)} (planned ≈ $${planned.toFixed(2)})`));
      continue;
    }
    planned += p.cost;
    toRun.push(p);
  }

  if (dryRun) {
    for (const p of toRun)
      results.push(
        planResult(
          p,
          'planned',
          p.decision === 'resume'
            ? `resume ${p.prev?.provider} job ${p.prev?.jobId}`
            : `submit ${p.mode} (${p.images.length} image(s), ${p.cutouts} cut-out(s))`,
        ),
      );
  } else {
    await pool(toRun, opts.concurrency ?? 2, async (p) => {
      if (ctx.fatal) {
        results.push(planResult(p, 'skipped', `run aborted: ${ctx.fatal.message}`));
        return;
      }
      try {
        results.push(await executeSku(p, ctx));
      } catch (e) {
        if (isFatal(e)) ctx.fatal = e as ProviderError;
        results.push({ ...planResult(p, 'failed', msg(e)) });
      }
    });
  }

  results.sort((a, b) => a.sku.localeCompare(b.sku));
  const totals: Record<Outcome, number> = { photoreal: 0, planned: 0, skipped: 0, failed: 0, rejected: 0 };
  for (const r of results) totals[r.outcome]++;
  const report: RunReport = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    provider_pref: pref,
    providers,
    max_spend_usd: maxSpend,
    estimated_spend_usd: dryRun ? planned : ctx.spent,
    ledger_spend_usd: ctx.jobs.spentUsd(),
    results,
    totals,
  };
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, REPORT_FILE), JSON.stringify(report, null, 2));

  for (const r of results)
    log(
      `  ${r.sku.padEnd(26)} ${r.outcome.padEnd(9)} ${(r.mode ?? '-').padEnd(6)} img ${String(r.images.length)}/${r.cutouts} cut  $${r.est_cost_usd.toFixed(2)}  ${r.reason ?? ''}`,
    );
  log(
    `\n${results.length} SKUs · ${totals.photoreal} photoreal · ${totals.planned} planned · ${totals.skipped} skipped · ${totals.rejected} rejected · ${totals.failed} failed · est. spend $${report.estimated_spend_usd.toFixed(2)} → ${path.relative(process.cwd(), path.join(assetsDir, REPORT_FILE))}`,
  );
  if (ctx.fatal) log(`ABORTED: ${ctx.fatal.message}`);
  return report;
}

async function loadAssist(spec: string): Promise<PhotorealAssist | null> {
  const mod = (await import(pathToFileURL(path.resolve(process.cwd(), spec)).href)) as Record<string, unknown>;
  const a = (mod.default ??
    mod.assist ??
    (typeof mod.createAssist === 'function' ? await (mod.createAssist as () => Promise<PhotorealAssist>)() : null)) as PhotorealAssist | null;
  if (!a || (typeof a.cutout !== 'function' && typeof a.judge !== 'function'))
    throw new Error(`--assist ${spec}: export a PhotorealAssist ({ cutout?, judge? }) as default / assist / createAssist()`);
  return a;
}

async function main() {
  const f = flags(process.argv.slice(2));
  const assist = typeof f.assist === 'string' ? await loadAssist(f.assist) : null;
  const report = await runPhotoreal({
    sku: typeof f.sku === 'string' ? f.sku : undefined,
    category: typeof f.category === 'string' ? f.category : undefined,
    force: !!f.force,
    provider: parseProviderPref(typeof f.provider === 'string' ? f.provider : process.env.PHOTOREAL_PROVIDER),
    dryRun: !!f['dry-run'],
    concurrency: Number(f.concurrency ?? 2) || 2,
    maxSpendUsd: f['max-spend'] !== undefined ? Number(f['max-spend']) : undefined,
    assist,
  });
  process.exit(report.totals.failed + report.totals.rejected > 0 ? 1 : 0);
}

if (process.argv[1] && /photoreal[\\/]run\.(ts|js)$/.test(process.argv[1]))
  main().catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  });
