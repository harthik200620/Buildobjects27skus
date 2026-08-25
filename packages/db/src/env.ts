/**
 * Loads the repo-root `.env` no matter which package the process was started from: walk up
 * from cwd (and from this file) until a `.env` is found. Existing process env always wins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

let loaded = false;
export function loadEnv(): string | null {
  if (loaded) return null;
  loaded = true;
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const f = path.join(dir, '.env');
      if (fs.existsSync(f)) {
        dotenv.config({ path: f, override: false });
        return f;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
loadEnv();
