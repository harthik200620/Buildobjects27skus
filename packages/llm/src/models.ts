import { type ThinkingConfig, ThinkingLevel } from '@google/genai';
import { geminiClient, hasGemini } from './client';
import { readReport, writeReport } from './paths';

export type ModelKind = 'pro' | 'flash' | 'vision' | 'image' | 'segment';

const FLASH = ['gemini-3-flash-preview', 'gemini-2.5-flash'] as const;

/** Preference order per kind; the first entry listed for the key wins, else the first entry with a warning. */
export const PREFS: Record<ModelKind, readonly string[]> = {
  pro: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'],
  flash: FLASH,
  vision: FLASH,
  image: ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'],
  segment: FLASH,
};

/** The env override consulted for each kind when the caller passes none (GEMINI_DRAWING_MODEL is passed explicitly by the drawing reader). */
export const KIND_ENV: Record<ModelKind, string> = {
  pro: 'GEMINI_PIPELINE_MODEL',
  flash: 'GEMINI_FAST_MODEL',
  vision: 'GEMINI_VISION_MODEL',
  image: 'GEMINI_IMAGE_MODEL',
  segment: 'GEMINI_SEGMENT_MODEL',
};

export const MODELS_CACHE_FILE = 'gemini-models.json';
export const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ModelsCacheFile {
  fetched_at: string;
  models: string[];
}

let memo: Promise<string[]> | null = null;
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[llm] ${message}`);
}

function readFileCache(): string[] | null {
  const text = readReport(MODELS_CACHE_FILE);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ModelsCacheFile>;
    const at = Date.parse(parsed.fetched_at ?? '');
    if (!Number.isFinite(at) || Date.now() - at > MODELS_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.models) ? parsed.models.filter((m): m is string => typeof m === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Model IDs reachable with this key that support `generateContent` (names without the `models/`
 * prefix). Cached per process and in storage/reports/gemini-models.json for 24 h. Returns [] without
 * a key; rejects when the listing fails (callers fall back — see `resolveModel`).
 */
export async function listModels(opts: { force?: boolean } = {}): Promise<string[]> {
  if (!hasGemini()) return [];
  if (!opts.force) {
    if (memo) return memo;
    const file = readFileCache();
    if (file) {
      memo = Promise.resolve(file);
      return memo;
    }
  }
  const pending = (async () => {
    const ai = geminiClient();
    const names: string[] = [];
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      if (!m.name) continue;
      const actions = m.supportedActions ?? [];
      if (actions.length > 0 && !actions.includes('generateContent')) continue;
      names.push(m.name.replace(/^models\//, ''));
    }
    const file: ModelsCacheFile = { fetched_at: new Date().toISOString(), models: names };
    writeReport(MODELS_CACHE_FILE, `${JSON.stringify(file, null, 2)}\n`);
    return names;
  })();
  memo = pending;
  pending.catch(() => {
    if (memo === pending) memo = null; // never cache a failure
  });
  return pending;
}

/** Synchronous pick: explicit override → kind env → first preference. No discovery (web routes that must not await). */
export function defaultModel(kind: ModelKind, envOverride?: string): string {
  const explicit = envOverride?.trim();
  if (explicit) return explicit;
  const fromEnv = process.env[KIND_ENV[kind]]?.trim();
  if (fromEnv) return fromEnv;
  return PREFS[kind][0];
}

/**
 * Explicit override (e.g. `process.env.GEMINI_DRAWING_MODEL`) → the kind's env override → the first
 * preference present in `models.list()` → the first preference with a single logged warning (no
 * key, listing failed, or nothing preferred is listed).
 */
export async function resolveModel(kind: ModelKind, envOverride?: string): Promise<string> {
  const explicit = envOverride?.trim();
  if (explicit) return explicit;
  const fromEnv = process.env[KIND_ENV[kind]]?.trim();
  if (fromEnv) return fromEnv;
  const prefs = PREFS[kind];
  if (!hasGemini()) {
    warnOnce(
      'no-key',
      `GEMINI_API_KEY is not set — model discovery skipped; using default model names (${(Object.keys(PREFS) as ModelKind[]).map((k) => `${k}=${PREFS[k][0]}`).join(', ')})`,
    );
    return prefs[0];
  }
  let available: string[];
  try {
    available = await listModels();
  } catch (err) {
    warnOnce('list-failed', `models.list failed (${String((err as Error)?.message ?? err).slice(0, 160)}) — using default model names`);
    return prefs[0];
  }
  const pick = prefs.find((p) => available.includes(p));
  if (pick) return pick;
  warnOnce(`none-${kind}`, `none of the preferred ${kind} models (${prefs.join(', ')}) is listed for this key — falling back to ${prefs[0]}`);
  return prefs[0];
}

/** Resolves every kind at once (T0 pre-flight, /api/health). */
export async function resolveAllModels(): Promise<Record<ModelKind, string>> {
  const kinds = Object.keys(PREFS) as ModelKind[];
  const picks = await Promise.all(kinds.map((k) => resolveModel(k)));
  return Object.fromEntries(kinds.map((k, i) => [k, picks[i]])) as Record<ModelKind, string>;
}

export type ThinkingIntent =
  | 'extract' // pipeline spec extraction (deep)
  | 'drawing' // calculator drawing reader (deep)
  | 'verify'
  | 'price'
  | 'fill'
  | 'describe'
  | 'canonicalize'
  | 'judge' // image / 3D judges
  | 'live' // AR live scene understanding
  | 'analyze' // AR photo-mode analysis
  | 'segment'
  | 'refine' // estimate AI review
  | 'match';

const DEEP_INTENTS: ReadonlySet<ThinkingIntent> = new Set(['extract', 'drawing']);
const NO_THINK_INTENTS: ReadonlySet<ThinkingIntent> = new Set(['judge', 'fill', 'describe', 'live', 'segment']);

/**
 * Thinking config per model family and intent. Unset GEMINI_THINKING: gemini-3 → LOW except the
 * deep intents (extract, drawing); gemini-2.5-flash(-lite) → budget 0 for judge/fill/describe/live/
 * segment; everything else → model default. GEMINI_THINKING=off|low|default overrides:
 * `off` = cheapest allowed (gemini-3 cannot go below LOW), `low` = LOW everywhere on gemini-3,
 * `default` = never send a thinking config. Image models never get one.
 */
export function thinkingFor(model: string, intent: ThinkingIntent): ThinkingConfig | undefined {
  const mode = (process.env.GEMINI_THINKING ?? '').trim().toLowerCase();
  if (mode === 'default') return undefined;
  if (/-image/.test(model)) return undefined;
  if (/^gemini-3/.test(model)) {
    if (mode === 'off' || mode === 'low') return { thinkingLevel: ThinkingLevel.LOW };
    return DEEP_INTENTS.has(intent) ? undefined : { thinkingLevel: ThinkingLevel.LOW };
  }
  if (/^gemini-2\.5-flash/.test(model)) {
    if (mode === 'off') return { thinkingBudget: 0 };
    return NO_THINK_INTENTS.has(intent) ? { thinkingBudget: 0 } : undefined;
  }
  return undefined; // gemini-2.5-pro and unknown ids: model default (2.5 Pro cannot disable thinking)
}

/** @internal */
export function __resetModelsForTests(): void {
  memo = null;
  warned.clear();
}
