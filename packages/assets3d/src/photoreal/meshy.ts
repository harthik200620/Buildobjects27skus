/**
 * Meshy adapter — https://api.meshy.ai/openapi/v1
 *   POST /image-to-3d         { image_url: data-URI, ai_model, should_texture, enable_pbr, … } → { result: taskId }
 *   POST /multi-image-to-3d   { image_urls: [≤ 4 data-URIs], … }                                → { result: taskId }
 *   GET  /{kind}/{taskId}     → { status: PENDING|IN_PROGRESS|SUCCEEDED|FAILED|CANCELED, progress, model_urls: { glb, usdz, … }, thumbnail_url, task_error }
 * Auth: `Authorization: Bearer MESHY_API_KEY`. Images go inline as data URIs (no upload step).
 */
import { dataUri, type FetchLike, fetchBuffer, requestJson, resolveFetch } from './http';
import { type JobHandle, type JobState, type JobStatus, type Provider3D, ProviderError, type SubmitInput } from './types';

export const MESHY_BASE_URL = 'https://api.meshy.ai/openapi/v1';
/** ≈ 20 / 30 credits per task at ≈ $0.02 per credit (Pro plan list price, Aug 2026). Estimate only — feeds --max-spend. */
export const MESHY_COST_USD = { single: 0.4, multi: 0.6 } as const;
export const MESHY_DEFAULT_MODEL = 'meshy-7';

const STATE: Record<string, JobState> = {
  PENDING: 'pending',
  IN_PROGRESS: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  CANCELLED: 'canceled',
  EXPIRED: 'expired',
};

export interface MeshyConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export class MeshyProvider implements Provider3D {
  readonly name = 'meshy' as const;
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  constructor(private readonly cfg: MeshyConfig) {
    if (!cfg.apiKey) throw new ProviderError('meshy', 'auth', 'MESHY_API_KEY is not set');
    this.fetchImpl = resolveFetch(cfg.fetch);
    this.base = (cfg.baseUrl ?? MESHY_BASE_URL).replace(/\/$/, '');
  }
  get model(): string {
    return this.cfg.model ?? (process.env.MESHY_MODEL?.trim() || MESHY_DEFAULT_MODEL);
  }
  private headers() {
    return { Authorization: `Bearer ${this.cfg.apiKey}` };
  }
  private kind(mode: 'single' | 'multi') {
    return mode === 'multi' ? 'multi-image-to-3d' : 'image-to-3d';
  }

  isMulti(input: Pick<SubmitInput, 'mode' | 'images'>): boolean {
    return input.mode === 'multi' && input.images.length >= 2;
  }

  async submit(input: SubmitInput): Promise<JobHandle> {
    if (!input.images.length) throw new ProviderError('meshy', 'bad_request', `${input.sku}: no images to submit`);
    const multi = this.isMulti(input);
    const urls = input.images.slice(0, 4).map((i) => dataUri(i.buffer, i.mime));
    const o = input.opts;
    const common = {
      ai_model: this.model,
      should_texture: o.texture,
      enable_pbr: o.pbr && o.texture,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: o.polycount,
      symmetry_mode: o.symmetry,
      target_formats: o.targetFormats,
    };
    const body = multi ? { image_urls: urls, ...common } : { image_url: urls[0], ...common };
    const res = await requestJson<{ result?: string }>('meshy', this.fetchImpl, `${this.base}/${this.kind(multi ? 'multi' : 'single')}`, {
      method: 'POST',
      headers: this.headers(),
      json: body,
    });
    if (typeof res.result !== 'string' || !res.result)
      throw new ProviderError('meshy', 'server', `meshy: submit returned no task id (${JSON.stringify(res).slice(0, 200)})`);
    return { provider: 'meshy', id: res.result, mode: multi ? 'multi' : 'single' };
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    type Task = { status?: string; progress?: number; model_urls?: Record<string, string>; thumbnail_url?: string; task_error?: { message?: string } | null };
    const t = await requestJson<Task>('meshy', this.fetchImpl, `${this.base}/${this.kind(handle.mode)}/${handle.id}`, {
      method: 'GET',
      headers: this.headers(),
    });
    const state = STATE[String(t.status ?? '').toUpperCase()] ?? 'running';
    const urls = t.model_urls ?? {};
    return {
      handle,
      state,
      progress: Number(t.progress ?? 0),
      modelUrls: {
        ...(urls.glb ? { glb: urls.glb } : {}),
        ...(urls.usdz ? { usdz: urls.usdz } : {}),
        ...(urls.fbx ? { fbx: urls.fbx } : {}),
        ...(urls.obj ? { obj: urls.obj } : {}),
      },
      previewUrl: t.thumbnail_url ?? null,
      error: t.task_error?.message ?? (state === 'failed' ? 'task failed' : null),
      raw: t,
    };
  }

  download(url: string): Promise<Buffer> {
    return fetchBuffer('meshy', this.fetchImpl, url);
  }

  estimateCostUsd(input: Pick<SubmitInput, 'mode' | 'images' | 'opts'>): number {
    return this.isMulti(input) ? MESHY_COST_USD.multi : MESHY_COST_USD.single;
  }
}
