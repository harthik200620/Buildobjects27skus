import 'server-only';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves a storage directory configured by an env var (MEDIA_ROOT, ASSETS_3D_ROOT).
 *
 * Relative values are **repo-root relative** — the convention of `.env` and the pipeline
 * (`MEDIA_ROOT=./storage/media`). The web app's cwd is `apps/web` under `next dev`,
 * `next start` and turbo, so a relative path is searched upward from cwd until it exists.
 * Absolute values are used as-is; `fallback` is the repo-relative default when the var is unset.
 */
export function resolveStorageDir(envValue: string | undefined, fallback: string): string {
  const configured = envValue?.trim() || fallback;
  if (path.isAbsolute(configured)) return configured;
  let dir = /* turbopackIgnore: true */ process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(/* turbopackIgnore: true */ dir, configured);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}
