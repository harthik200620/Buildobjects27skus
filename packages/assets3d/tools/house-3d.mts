/**
 * `npx tsx packages/assets3d/tools/house-3d.mts [--only 2-medium] [--force] [--dry-run]`
 *
 * Turns the estimator's house renders into 3D models you can walk around.
 *
 * The renders are one camera angle. That is enough to recognise a building and not enough to
 * understand one: nobody buys a house from a single three-quarter photograph, and the whole
 * argument for BO Estimator over a spreadsheet is that you can *see* what the money builds. So
 * each render goes through Meshy image-to-3D and comes back as a GLB, and the page lets you turn
 * it — the same trick the product pages already use for a bulb, applied to the thing the customer
 * actually cares about.
 *
 * The matrix is deliberately smaller than the render matrix:
 *
 *   floors  0 … 4      5
 *   finish  basic / medium / premium   3
 *                     ──
 *                     15 models  (~$6 at Meshy's image-to-3D list price)
 *
 * Solar is not a dimension here. It is a few dark rectangles on a roof that image-to-3D will not
 * resolve at any price, and paying to double the matrix for a detail the geometry cannot carry
 * would be spending money to produce the same mesh twice. The still render keeps showing it.
 *
 * Every model is written to assets/3d/house/{floors}-{finish}.glb and recorded in
 * assets/3d/house/manifest.json with the job id and what it cost, so a re-run never pays twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '@buildobjects/db';
import sharp from 'sharp';
import { ASSETS_DIR, resolveMediaRoot } from '../src/build';
import { compressGlb } from '../src/photoreal/compress';
import { MESHY_COST_USD, MeshyProvider } from '../src/photoreal/meshy';
import { DEFAULT_SUBMIT_OPTIONS, type JobHandle, ProviderError, type SubmitInput } from '../src/photoreal/types';

loadEnv();

const OUT_DIR = path.join(ASSETS_DIR, 'house');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

type Finish = 'basic' | 'medium' | 'premium';
const FLOORS = [0, 1, 2, 3, 4] as const;
const FINISHES: Finish[] = ['basic', 'medium', 'premium'];

const POLL_DELAYS_MS = [6_000, 12_000, 20_000];
const POLL_MAX_MS = 12 * 60_000;

interface Entry {
  id: string;
  floors: number;
  finish: Finish;
  file: string;
  jobId: string;
  costUsd: number;
  triangles?: number;
  bytes: number;
  generatedAt: string;
}
interface Manifest {
  generated_at: string;
  spend_usd: number;
  models: Record<string, Entry>;
}

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST)) return { generated_at: new Date().toISOString(), spend_usd: 0, models: {} };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as Manifest;
}
function saveManifest(m: Manifest): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  m.generated_at = new Date().toISOString();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the job finishes, fails, or the deadline passes. */
async function waitFor(provider: MeshyProvider, handle: JobHandle, log: (s: string) => void): Promise<string> {
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < POLL_MAX_MS) {
    await sleep(POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)]);
    i += 1;
    const st = await provider.poll(handle);
    if (st.state === 'succeeded') {
      const glb = st.modelUrls.glb;
      if (!glb) throw new Error('job succeeded with no GLB url');
      return glb;
    }
    if (st.state === 'failed') throw new Error(st.error ?? 'job failed');
    log(`    ${st.progress}%`);
  }
  throw new Error(`timed out after ${Math.round(POLL_MAX_MS / 1000)} s`);
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf('--only');
  const onlyRaw = argv.find((a) => a.startsWith('--only='))?.slice(7) ?? (onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? '') : '');
  const only = new Set(
    onlyRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');

  const apiKey = process.env.MESHY_API_KEY?.trim();
  if (!apiKey && !dryRun) throw new Error('MESHY_API_KEY is not set');

  /* The renders live on disk under MEDIA_ROOT; this tool reads them directly rather than
     depending on the pipeline package for a file read. */
  const mediaRoot = resolveMediaRoot();
  const manifest = loadManifest();
  const provider = dryRun ? null : new MeshyProvider({ apiKey: apiKey as string });

  const combos = FINISHES.flatMap((finish) => FLOORS.map((floors) => ({ floors, finish, id: `${floors}-${finish}` })));
  let made = 0;
  let skipped = 0;
  const failures: { id: string; why: string }[] = [];

  console.log(`house image-to-3D · ${combos.length} models · ~$${(combos.length * MESHY_COST_USD.single).toFixed(2)} at list price\n`);

  for (const c of combos) {
    if (only.size && !only.has(c.id)) continue;
    const outFile = path.join(OUT_DIR, `${c.id}.glb`);
    if (!force && manifest.models[c.id] && fs.existsSync(outFile)) {
      skipped += 1;
      console.log(`  ${c.id.padEnd(14)} already built (${manifest.models[c.id].jobId})`);
      continue;
    }

    // The source is the same render the page shows, so the model and the still agree.
    const key = `estimator/house/${c.floors}-${c.finish}-hero.webp`;
    const src = path.join(mediaRoot, key);
    if (!fs.existsSync(src)) {
      failures.push({ id: c.id, why: `no render at ${key} — run services/pipeline/tools/house-renders.mts first` });
      console.log(`  ${c.id.padEnd(14)} SKIPPED — no render`);
      continue;
    }
    // Meshy takes PNG/JPEG, and the store holds WebP.
    const png = await sharp(fs.readFileSync(src)).png().toBuffer();

    if (dryRun) {
      console.log(`  ${c.id.padEnd(14)} would submit ${(png.length / 1024).toFixed(0)} KB  $${MESHY_COST_USD.single.toFixed(2)}`);
      continue;
    }

    const input: SubmitInput = {
      sku: `HOUSE-${c.id.toUpperCase()}`,
      images: [{ buffer: png, role: 'front', mime: 'image/png', key }],
      mode: 'single',
      // A building needs the polygons a bulb does not, and it is never symmetric front-to-back.
      opts: { ...DEFAULT_SUBMIT_OPTIONS, polycount: 150_000, symmetry: 'off', targetFormats: ['glb'] },
    };

    try {
      console.log(`  ${c.id.padEnd(14)} submitting…`);
      const handle = await provider!.submit(input);
      const glbUrl = await waitFor(provider!, handle, (s) => console.log(`  ${''.padEnd(14)}${s}`));
      const raw = await provider!.download(glbUrl);
      /* Meshy returns ~19 MB: 138k triangles and 11 MB of uncompressed PNG/JPEG. Fifteen of
         those is 285 MB behind one page, so every model is trimmed before it is written. */
      const c2 = await compressGlb(raw);
      const buf = c2.glb;
      for (const w of c2.warnings) console.log(`  ${''.padEnd(14)}! ${w}`);
      console.log(
        `  ${''.padEnd(14)}${(c2.before.bytes / 1048576).toFixed(1)} MB / ${c2.before.triangles.toLocaleString()} tris → ` +
          `${(c2.after.bytes / 1048576).toFixed(1)} MB / ${c2.after.triangles.toLocaleString()} tris, ${c2.after.textures} textures at ${c2.after.maxTexturePx}px`,
      );
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(outFile, buf);
      manifest.models[c.id] = {
        id: c.id,
        floors: c.floors,
        finish: c.finish,
        file: `house/${c.id}.glb`,
        jobId: handle.id,
        costUsd: MESHY_COST_USD.single,
        triangles: c2.after.triangles,
        bytes: buf.length,
        generatedAt: new Date().toISOString(),
      };
      manifest.spend_usd = Number((manifest.spend_usd + MESHY_COST_USD.single).toFixed(2));
      saveManifest(manifest);
      made += 1;
      console.log(`  ${c.id.padEnd(14)} ${(buf.length / 1024 / 1024).toFixed(1)} MB  ${handle.id}`);
    } catch (e) {
      const why = e instanceof ProviderError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      failures.push({ id: c.id, why });
      console.log(`  ${c.id.padEnd(14)} FAILED — ${why}`);
      // A credit exhaustion or an auth failure will hit every remaining job the same way.
      if (e instanceof ProviderError && (e.code === 'quota' || e.code === 'auth')) {
        console.log('  stopping: the provider will refuse every remaining submission for the same reason');
        break;
      }
    }
  }

  console.log(`\n${made} built, ${skipped} already present, ${failures.length} failed · ledger $${manifest.spend_usd.toFixed(2)}`);
  for (const f of failures) console.log(`  ! ${f.id}: ${f.why}`);
}

await main();
