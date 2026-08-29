import fs from 'node:fs';
import path from 'node:path';

let overrideRoot: string | null = null;
let cachedRoot: string | null = null;

/**
 * Repo root = the nearest ancestor of process.cwd() that holds pnpm-workspace.yaml (the pipeline
 * runs from services/pipeline, apps/web from apps/web, tests from packages/llm). Falls back to cwd
 * so nothing here can ever throw.
 */
export function repoRoot(): string {
  if (overrideRoot) return overrideRoot;
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 16; i++) {
    if (safeExists(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** storage/reports under the repo root — model cache, usage log. */
export const reportsDir = (): string => path.join(repoRoot(), 'storage', 'reports');

export const reportPath = (name: string): string => path.join(reportsDir(), name);

/** Best-effort write: creates the directory, swallows every error (an unwritable disk must never fail an LLM call). */
export function writeReport(name: string, data: string, mode: 'write' | 'append' = 'write'): boolean {
  try {
    fs.mkdirSync(reportsDir(), { recursive: true });
    const file = reportPath(name);
    if (mode === 'append') fs.appendFileSync(file, data, 'utf8');
    else fs.writeFileSync(file, data, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function readReport(name: string): string | null {
  try {
    return fs.readFileSync(reportPath(name), 'utf8');
  } catch {
    return null;
  }
}

/** Reads at most the last `maxBytes` of a report (the usage log grows without bound). */
export function readReportTail(name: string, maxBytes: number): string | null {
  let fd: number | null = null;
  try {
    const file = reportPath(name);
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return '';
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    const text = buf.toString('utf8');
    // Drop the (possibly partial) first line when we started mid-file.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** @internal Tests point the storage root at a temp dir so they never touch storage/reports. */
export function __setStorageRootForTests(dir: string | null): void {
  overrideRoot = dir;
  cachedRoot = null;
}
