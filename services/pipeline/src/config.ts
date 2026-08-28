import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@buildobjects/db';

loadEnv();

/** Repo-relative paths. The pipeline runs from services/pipeline; everything else is addressed from the repo root. */
const here = path.dirname(fileURLToPath(import.meta.url));
export const PIPELINE_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(PIPELINE_ROOT, '..', '..');
export const REGISTRY_DIR = path.join(PIPELINE_ROOT, 'registry');
export const CURATED_DIR = path.join(PIPELINE_ROOT, 'data', 'curated');
export const SHEET_PATH = path.join(REPO_ROOT, 'WHOLE_PRODUCT_LIST_BO_PRODUCT_CALENDAR.xlsx');
export const RAW_DIR = path.join(REPO_ROOT, 'storage', 'raw');
export const ASSETS_3D_DIR = path.join(REPO_ROOT, 'assets', '3d');

const intEnv = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const numEnv = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : dflt;
};

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  meiliHost: process.env.MEILI_HOST ?? 'http://127.0.0.1:7700',
  meiliKey: process.env.MEILI_MASTER_KEY ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  queueDriver: (process.env.QUEUE_DRIVER ?? 'auto') as 'auto' | 'bullmq' | 'local',
  mediaRoot: path.resolve(REPO_ROOT, process.env.MEDIA_ROOT ?? './storage/media'),
  mediaBaseUrl: process.env.MEDIA_BASE_URL ?? '/media',
  mediaStore: (process.env.MEDIA_STORE ?? 'local') as 'local' | 's3',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Read at call time by @buildobjects/llm — mirrored here only for the banner; never logged. */
  get geminiKey(): string {
    return (process.env.GEMINI_API_KEY ?? '').trim();
  },
  concurrency: intEnv('PIPELINE_CONCURRENCY', 6),
  politenessMs: intEnv('PIPELINE_POLITENESS_MS', 1500),
  fetchTimeoutMs: intEnv('PIPELINE_FETCH_TIMEOUT_MS', 25_000),
};

/** Image pipeline knobs (images v2). Every served image is a real photo; these decide what "real enough" means. */
export const IMAGE = {
  /** Long edge a hero / angle shot needs (the zoom pane is hidden under 1600 — see `soft`). */
  minHeroPx: intEnv('IMAGE_MIN_HERO_PX', 1000),
  /** Long edge for in-context / detail / pack shots. */
  minOtherPx: intEnv('IMAGE_MIN_OTHER_PX', 600),
  /** Judge score floor (0–1) an image must reach to be stored. */
  judgeMin: numEnv('IMAGE_JUDGE_MIN', 0.55),
  /** Background the card/thumb/gallery/zoom webp ladder is flattened on — only when the source has alpha (cut-outs keep alpha). */
  bg: (process.env.IMAGE_BG ?? '#ffffff').trim() || '#ffffff',
  /** Sources with a long edge below this are stored `soft` (served as-is, never enlarged; lens hidden). */
  softPx: intEnv('IMAGE_SOFT_PX', 1600),
  /** Candidate URLs fetched per SKU after ordering (curated + name-affine official assets first). */
  maxCandidates: intEnv('IMAGE_MAX_CANDIDATES', 40),
  /** Source bytes cap per image download. */
  maxBytes: intEnv('IMAGE_MAX_BYTES', 40 * 1024 * 1024),
  /** A captured page smaller than this (KB) is "thin" → Playwright render. */
  thinPageKb: intEnv('IMAGE_THIN_PAGE_KB', 20),
  /** Seconds a failed / disallowed URL stays negative-cached in storage/raw/{SKU}/img/index.json. */
  negativeCacheS: intEnv('IMAGE_NEGATIVE_CACHE_S', 7 * 24 * 3600),
} as const;

export const hasAnthropic = () => env.anthropicKey.length > 0;
/** True when GEMINI_API_KEY is present (the live provider, judge and cut-out masks). */
export const hasGemini = () => env.geminiKey.length > 0;

/** Per-SKU stages in run order. */
export const STAGES = ['fetch', 'extract', 'verify', 'fill', 'images', 'brochures', 'describe'] as const;
export type Stage = (typeof STAGES)[number];
export const MODEL = process.env.PIPELINE_MODEL ?? 'claude-opus-5';
