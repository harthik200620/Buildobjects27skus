import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __resetClientForTests } from '../src/client';
import { __resetUsageForTests } from '../src/cost';
import { __resetGenerateForTests } from '../src/generate';
import { __resetGuardsForTests } from '../src/guard';
import { __resetModelsForTests } from '../src/models';
import { __setStorageRootForTests } from '../src/paths';
import * as mock from './genai-mock';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_PIPELINE_MODEL',
  'GEMINI_FAST_MODEL',
  'GEMINI_VISION_MODEL',
  'GEMINI_IMAGE_MODEL',
  'GEMINI_SEGMENT_MODEL',
  'GEMINI_DRAWING_MODEL',
  'GEMINI_THINKING',
  'GEMINI_GROUNDED_STRICT_JSON',
  'GEMINI_CONCURRENCY',
  'GEMINI_RPM',
  'GEMINI_TIMEOUT_MS',
  'GEMINI_DAILY_CALL_CAP',
  'GEMINI_PRICE_JSON',
];

/** Clean env + module state + a temp storage root (so tests never touch storage/reports). Returns the temp dir. */
export function freshState(opts: { key?: boolean } = {}): string {
  for (const k of ENV_KEYS) delete process.env[k];
  if (opts.key !== false) process.env.GEMINI_API_KEY = 'test-key-not-real';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bo-llm-'));
  __setStorageRootForTests(tmp);
  __resetClientForTests();
  __resetGenerateForTests();
  __resetModelsForTests();
  __resetUsageForTests();
  __resetGuardsForTests({ seedDaily: 0 });
  mock.generateContent.mockReset();
  mock.list.mockReset();
  mock.ctor.mockReset();
  return tmp;
}

export function cleanup(tmp: string): void {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  __setStorageRootForTests(null);
}

export const reportFile = (tmp: string, name: string) => path.join(tmp, 'storage', 'reports', name);
