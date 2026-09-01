/**
 * `npx tsx services/pipeline/tools/judge-models.mts [--only SKU,SKU] [--write]`
 *
 * Compares each generated 3D model with the photograph it was built from, and says whether it is
 * the product.
 *
 * The photoreal runner does this inline when an assist is wired, and it should stay there. This
 * exists because it is the only way to judge a model WITHOUT paying to build it again: the
 * provider's own preview render is already in `assets/3d/jobs.json`, so a model that shipped
 * unjudged — four did, when the judge threw on a colour space and the runner recorded
 * `judge skipped` — can be checked afterwards for nothing.
 *
 * It also makes the check re-runnable. A judgement is a reading, and a reading can be repeated
 * when the prompt improves; being able to re-ask about thirty models without thirty more
 * submissions is the difference between a gate and a one-off.
 *
 * `--write` records each verdict on its manifest entry, replacing the `judge skipped` note that
 * was standing in for one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '@buildobjects/db';
import { ASSETS_3D_DIR, env, REGISTRY_DIR } from '../src/config';
import { hasVision, judgeModelMatch, type ProductIdentity } from '../src/media/vision';

loadEnv();

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: false,
  options: { only: { type: 'string' }, write: { type: 'boolean' } },
});
const only = String(values.only ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (!hasVision()) {
  console.error('No vision key. Set BO_CHAT_API_KEY (or ANTHROPIC_API_KEY) in .env.');
  process.exit(1);
}

/** The runner's own floor: below this a model is rejected and another provider is tried. */
const JUDGE_MIN = 0.6;

interface JobRecord {
  sku: string;
  previewUrl?: string;
  state?: string;
}
const jobs = JSON.parse(fs.readFileSync(path.join(ASSETS_3D_DIR, 'jobs.json'), 'utf8')) as { jobs?: Record<string, JobRecord> } & Record<string, JobRecord>;
const jobRows: Record<string, JobRecord> = (jobs.jobs ?? jobs) as Record<string, JobRecord>;

const content = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, 'image-content.json'), 'utf8')) as {
  skus: Record<string, { brand: string; name: string; category: string; product_photo: number | null }>;
};

const manifestFile = path.join(ASSETS_3D_DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { assets: Record<string, Record<string, unknown>> };

const imageDir = (code: string): string | null => {
  const root = path.join(env.mediaRoot, 'skus');
  for (const sh of fs.readdirSync(root)) {
    const dir = path.join(root, sh, code, 'img');
    if (fs.existsSync(dir)) return dir;
  }
  return null;
};
const origFor = (dir: string, position: number): string | null => {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(dir, `${position}-orig.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
};

let judged = 0;
let failed = 0;
const notes: Record<string, string> = {};

for (const [code, job] of Object.entries(jobRows)) {
  if (only.length && !only.includes(code)) continue;
  if (!job.previewUrl) continue;
  const rec = content.skus[code];
  if (!rec || rec.product_photo === null) continue;
  const dir = imageDir(code);
  const hero = dir ? origFor(dir, rec.product_photo) : null;
  if (!hero) continue;

  let preview: Buffer;
  try {
    const res = await fetch(job.previewUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`preview ${res.status}`);
    preview = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`  ${code.padEnd(26)} preview unavailable — ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }

  const identity: ProductIdentity = { sku: code, brand: rec.brand, name: rec.name, category: rec.category };
  try {
    const m = await judgeModelMatch(fs.readFileSync(hero), preview, identity);
    judged++;
    const verdict = m.overall >= JUDGE_MIN ? 'PASS' : 'REJECT';
    if (verdict === 'REJECT') failed++;
    notes[code] =
      `judge ${m.overall.toFixed(2)} (silhouette ${m.silhouette.toFixed(2)}, colour ${m.colour.toFixed(2)}, branding ${m.branding.toFixed(2)})` +
      `${m.defects.length ? ` — ${m.defects.join('; ')}` : ''}`;
    console.log(`  ${code.padEnd(26)} ${verdict}  ${m.overall.toFixed(2)}  same=${m.same_product}  ${m.defects.slice(0, 2).join('; ').slice(0, 90)}`);
  } catch (e) {
    console.log(`  ${code.padEnd(26)} judge failed — ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
  }
}

console.log(`\n${judged} models judged · ${failed} below the ${JUDGE_MIN} floor`);

if (values.write) {
  for (const [code, note] of Object.entries(notes)) if (manifest.assets[code]) manifest.assets[code].note = note;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest notes written for ${Object.keys(notes).length} models`);
}
