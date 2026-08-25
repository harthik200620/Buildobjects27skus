/** Provider selection: PHOTOREAL_PROVIDER=auto|meshy|tripo. `auto` = first provider with a key; the other one is the last-resort retry. */
import type { FetchLike } from './http';
import { MeshyProvider } from './meshy';
import { TripoProvider } from './tripo';
import { type Provider3D, ProviderError, type ProviderName } from './types';

export type ProviderPref = 'auto' | ProviderName;
export const PROVIDER_NAMES: ProviderName[] = ['meshy', 'tripo'];

export function providerKeys(env: NodeJS.ProcessEnv = process.env): Record<ProviderName, string> {
  return { meshy: env.MESHY_API_KEY?.trim() ?? '', tripo: env.TRIPO_API_KEY?.trim() ?? '' };
}

export function parseProviderPref(raw: string | undefined): ProviderPref {
  const v = (raw ?? 'auto').trim().toLowerCase();
  if (v === '' || v === 'auto') return 'auto';
  if (v === 'meshy' || v === 'tripo') return v;
  throw new ProviderError('none', 'bad_request', `PHOTOREAL_PROVIDER / --provider must be auto, meshy or tripo (got "${raw}")`);
}

export function makeProvider(name: ProviderName, env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): Provider3D | null {
  const keys = providerKeys(env);
  if (!keys[name]) return null;
  return name === 'meshy'
    ? new MeshyProvider({ apiKey: keys.meshy, model: env.MESHY_MODEL?.trim() || undefined, fetch: fetchImpl })
    : new TripoProvider({ apiKey: keys.tripo, modelVersion: env.TRIPO_MODEL_VERSION?.trim() || undefined, fetch: fetchImpl });
}

export interface ProviderPick {
  primary: Provider3D;
  fallback: Provider3D | null;
}

/** Throws a ProviderError('auth') when no usable key exists — the runner turns that into a clear exit. */
export function pickProvider(
  pref: ProviderPref = parseProviderPref(process.env.PHOTOREAL_PROVIDER),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): ProviderPick {
  const order: ProviderName[] = pref === 'auto' ? PROVIDER_NAMES : [pref, ...PROVIDER_NAMES.filter((n) => n !== pref)];
  const available = order.map((n) => makeProvider(n, env, fetchImpl)).filter((p): p is Provider3D => p !== null);
  if (!available.length) throw new ProviderError('none', 'auth', 'no 3D provider key: set MESHY_API_KEY and/or TRIPO_API_KEY in .env');
  if (pref !== 'auto' && available[0].name !== pref)
    throw new ProviderError(pref, 'auth', `PHOTOREAL_PROVIDER=${pref} but ${pref.toUpperCase()}_API_KEY is not set`);
  return { primary: available[0], fallback: available[1] ?? null };
}

/** One line per provider for the dry-run / report. */
export function describeProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys = providerKeys(env);
  return PROVIDER_NAMES.map((n) => `${n}: ${keys[n] ? 'key present' : 'no key'}`);
}
