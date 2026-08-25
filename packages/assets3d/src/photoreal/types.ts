/**
 * Photoreal 3D: the provider-neutral contract. Meshy and Tripo adapters implement `Provider3D`;
 * the runner talks to nothing else. `PhotorealAssist` is the seam the LLM track fills in later
 * (segmentation cut-outs + the vision judge) — this package compiles and runs without it.
 */
export type ProviderName = 'meshy' | 'tripo';
export type ViewRole = 'front' | 'left' | 'back' | 'right' | 'extra';

export interface SubmitImage {
  buffer: Buffer;
  role: ViewRole;
  mime: 'image/png' | 'image/jpeg';
  /** Media key (or a name) for the audit trail. */
  key?: string;
}
export interface SubmitOptions {
  pbr: boolean;
  texture: boolean;
  targetFormats: ('glb' | 'usdz')[];
  /** Face budget requested from the provider (the normaliser enforces ≤ 100k afterwards anyway). */
  polycount: number;
  symmetry: 'auto' | 'on' | 'off';
  /** `retry` re-rolls a rejected generation (new seed where the provider supports one). */
  variant: 'primary' | 'retry';
}
export interface SubmitInput {
  sku: string;
  images: SubmitImage[];
  mode: 'single' | 'multi';
  opts: SubmitOptions;
}
export const DEFAULT_SUBMIT_OPTIONS: SubmitOptions = {
  pbr: true,
  texture: true,
  targetFormats: ['glb', 'usdz'],
  polycount: 100_000,
  symmetry: 'auto',
  variant: 'primary',
};

export interface JobHandle {
  provider: ProviderName;
  id: string;
  mode: 'single' | 'multi';
}
export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired';
export interface JobStatus {
  handle: JobHandle;
  state: JobState;
  /** 0–100 */
  progress: number;
  modelUrls: Partial<Record<'glb' | 'usdz' | 'fbx' | 'obj', string>>;
  /** Provider preview render (thumbnail / rendered_image) for the judge. */
  previewUrl: string | null;
  error: string | null;
  raw?: unknown;
}

export interface Provider3D {
  readonly name: ProviderName;
  submit(input: SubmitInput): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobStatus>;
  download(url: string): Promise<Buffer>;
  /** Rough list-price estimate (USD) for one submission — only feeds the --max-spend guard and the dry-run. */
  estimateCostUsd(input: Pick<SubmitInput, 'mode' | 'images' | 'opts'>): number;
}

export type ProviderErrorCode = 'auth' | 'quota' | 'rate_limit' | 'bad_request' | 'server' | 'network' | 'task_failed' | 'unsupported';
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    public readonly provider: ProviderName | 'none',
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = code === 'rate_limit' || code === 'server' || code === 'network';
  }
}

export interface JudgeVerdict {
  /** 0–1; below JUDGE_MIN the model is rejected. */
  overall: number;
  defects: string[];
  same_product?: boolean;
  silhouette?: number;
  colour?: number;
  branding?: number;
}
export const JUDGE_MIN = 0.6;

/**
 * Optional helpers injected by the caller (the LLM track wires Gemini here). When absent the
 * runner uses the cut-outs already on disk and skips the judge with a note in the manifest.
 */
export interface PhotorealAssist {
  /** Segment a product photo → RGBA PNG cut-out, or null when it cannot be segmented cleanly. */
  cutout?(image: Buffer, ctx: { sku: string; role: string; position: number; key: string }): Promise<Buffer | null>;
  /** Compare the hero photo with the provider's preview render. */
  judge?(hero: Buffer, preview: Buffer, ctx: { sku: string; name: string; brand: string; category: string }): Promise<JudgeVerdict>;
}
