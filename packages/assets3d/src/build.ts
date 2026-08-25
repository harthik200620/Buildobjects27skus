/**
 * pnpm assets:3d [--category c] [--sku CODE] [--force] [--textures-from-orig]
 *
 * Builds assets/3d/placeholders/{SKU}.glb at the SKU's real dimensions and writes
 * assets/3d/manifest.json. When the image stage has produced photo cut-outs
 * (`{n}-cutout.png` under MEDIA_ROOT) the parametric model wears them → `quality: 'textured'`;
 * otherwise it stays a flat-colour `'placeholder'`. A real model at assets/3d/{SKU}.glb always
 * wins (`quality: 'photoreal'`, `placeholder: false`) and keeps its photoreal metadata.
 *
 * `--textures-from-orig` previews the textured path before cut-outs exist: the original hero on
 * white gets a deterministic near-white knockout. The manifest records `-orig` sources honestly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetManifest, AssetManifestEntry, AssetQuality, SpecJson } from '@buildobjects/catalog';
import { categories, closeDb, type Db, getDb, products, skuImages, skus } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import { BUILDERS } from './builders';
import { dimsFor, variantHintFor } from './dims';
import { buildGlb } from './gltf';
import { type BuilderTextures, heroCutoutFor, prepareTextures, usesPhotos } from './textures';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ASSETS_DIR = path.join(ROOT, 'assets', '3d');

/** MEDIA_ROOT is repo-root relative (the convention of .env and services/pipeline/src/config.ts). */
export function resolveMediaRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(ROOT, env.MEDIA_ROOT?.trim() || './storage/media');
}

export function flags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) {
        out[a.slice(2)] = v;
        i++;
      } else out[a.slice(2)] = true;
    }
  }
  return out;
}

export interface BuildTarget {
  code: string;
  category: string;
  spec: SpecJson | null;
}
export interface RealImagePositions {
  hero: number | null;
  angle: number | null;
}
export interface BuildOneOptions {
  textures?: BuilderTextures | null;
  /** The SKU's previous manifest entry — photoreal metadata survives a rebuild when the real GLB still wins. */
  prev?: AssetManifestEntry | null;
  assetsDir?: string;
}

export function buildOne(t: BuildTarget, o: BuildOneOptions = {}): { entry: AssetManifestEntry; wrote: boolean; quality: AssetQuality } {
  const dims = dimsFor(t.spec, t.category);
  const builder = BUILDERS[t.category] ?? BUILDERS.generic;
  const { meshes, variant, textured, textureNote } = builder(dims.m, { variant: variantHintFor(t.spec), textures: o.textures ?? null });
  const { glb, triangles, bbox, textures: textureCount } = buildGlb(meshes, t.code);
  const assetsDir = o.assetsDir ?? ASSETS_DIR;
  const realFile = path.join(assetsDir, `${t.code}.glb`);
  const real = fs.existsSync(realFile);
  let wrote = false;
  if (!real) {
    const dir = path.join(assetsDir, 'placeholders');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${t.code}.glb`), glb);
    wrote = true;
  }
  const keep = real && o.prev && o.prev.file === `${t.code}.glb` ? o.prev : null;
  const quality: AssetQuality = real ? (keep?.quality ?? 'photoreal') : textured ? 'textured' : 'placeholder';
  const now = new Date().toISOString();
  const entry: AssetManifestEntry = {
    file: real ? `${t.code}.glb` : `placeholders/${t.code}.glb`,
    category: t.category,
    placeholder: !real,
    dims_mm: dims.mm,
    bbox_m: keep?.bbox_m ?? { x: bbox.max[0] - bbox.min[0], y: bbox.max[1] - bbox.min[1], z: bbox.max[2] - bbox.min[2] },
    triangles: keep?.triangles ?? triangles,
    builder: real ? (keep?.builder ?? 'supplied') : BUILDERS[t.category] ? t.category : 'generic',
    variant: real ? keep?.variant : variant,
    usdz: keep?.usdz ?? null,
    quality,
    provider: real ? (keep?.provider ?? 'supplied') : 'parametric',
    generated_at: keep?.generated_at ?? now,
  };
  if (keep) {
    for (const k of ['source_images', 'job_id', 'axis_map', 'front_yaw_deg', 'quality_report', 'textures', 'note'] as const) {
      if (keep[k] !== undefined) (entry as unknown as Record<string, unknown>)[k] = keep[k];
    }
  } else if (!real && textured && o.textures) {
    const mean = o.textures.mean;
    entry.textures = {
      count: textureCount,
      max_px: 1024,
      sources: o.textures.sources,
      ...(mean ? { mean_colour: [mean[0], mean[1], mean[2]] as [number, number, number] } : {}),
    };
    entry.source_images = o.textures.sources;
    if (textureNote) entry.note = textureNote;
  }
  return { entry, wrote, quality };
}

/**
 * Textures for one SKU from the media on disk. Only `{n}-cutout.png` files count by default;
 * `fromOrig` also accepts the original hero with a near-white knockout (preview mode).
 */
export async function texturesFor(
  code: string,
  category: string,
  mediaRoot: string,
  real: RealImagePositions,
  opts: { fromOrig?: boolean } = {},
): Promise<{ textures: BuilderTextures | null; source: 'cutout' | 'orig' | null }> {
  if (!usesPhotos(category)) return { textures: null, source: null };
  const hero = real.hero !== null ? await heroCutoutFor(code, mediaRoot, { position: real.hero, allowOrig: !!opts.fromOrig }) : null;
  const angle = real.angle !== null ? await heroCutoutFor(code, mediaRoot, { position: real.angle, allowOrig: !!opts.fromOrig }) : null;
  if (!hero && !angle) return { textures: null, source: null };
  const textures = await prepareTextures(category, {
    hero: hero ? { buffer: hero.buffer, key: hero.key } : null,
    angle: angle ? { buffer: angle.buffer, key: angle.key } : null,
  });
  return { textures, source: (hero ?? angle)!.source };
}

/** Positions of the real (non-placeholder) hero / angle rows per SKU. */
export async function loadRealImagePositions(db: Db): Promise<Map<string, RealImagePositions>> {
  const rows = await db
    .select({ code: skus.skuCode, position: skuImages.position, role: skuImages.role })
    .from(skuImages)
    .innerJoin(skus, eq(skuImages.skuId, skus.id))
    .where(eq(skuImages.placeholder, false));
  const out = new Map<string, RealImagePositions>();
  for (const r of rows) {
    const e = out.get(r.code) ?? { hero: null, angle: null };
    if (r.role === 'hero' && e.hero === null) e.hero = r.position;
    if (r.role === 'angle' && e.angle === null) e.angle = r.position;
    out.set(r.code, e);
  }
  return out;
}

export function readManifest(assetsDir = ASSETS_DIR): AssetManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(assetsDir, 'manifest.json'), 'utf8')) as AssetManifest;
  } catch {
    return null;
  }
}

export function writeManifest(assets: Record<string, AssetManifestEntry>, assetsDir = ASSETS_DIR): AssetManifest {
  fs.mkdirSync(assetsDir, { recursive: true });
  const prev = readManifest(assetsDir);
  const manifest: AssetManifest = { generated_at: new Date().toISOString(), assets: { ...(prev?.assets ?? {}), ...assets } };
  fs.writeFileSync(path.join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(assetsDir, 'README.md'),
    `# 3D assets

One GLB per SKU, metres, Y up, standing on y = 0 and centred on x / z, front facing +Z, at the SKU's real dimensions.

- \`placeholders/{SKU_CODE}.glb\` — generated parametric models (\`pnpm assets:3d\`). \`quality: 'textured'\` when they wear the SKU's photo cut-outs, \`'placeholder'\` when flat-coloured; \`placeholder: true\` either way.
- \`{SKU_CODE}.glb\` — a photoreal model (\`pnpm assets:3d:photoreal\`, Meshy / Tripo, normalised to true dimensions) or a brand model dropped in by hand. Re-run \`pnpm assets:3d\`; the manifest flips to \`placeholder: false\`, \`quality: 'photoreal'\`, and the web app serves it at \`/3d/{SKU_CODE}.glb\` with zero code change.
- \`jobs.json\` / \`photoreal-report.json\` — provider job ledger (never pays twice for the same inputs) and the last run's outcomes.
- USDZ for iOS Quick Look is exported client-side from the GLB on demand unless a \`{SKU_CODE}.usdz\` is listed.
`,
  );
  return manifest;
}

async function main() {
  const f = flags(process.argv.slice(2));
  const fromOrig = !!f['textures-from-orig'];
  const db = getDb();
  const rows = await db
    .select({ code: skus.skuCode, category: categories.slug, spec: skus.specJson })
    .from(skus)
    .innerJoin(products, eq(skus.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id));
  const targets = rows.filter((r) => (!f.category || r.category === f.category) && (!f.sku || r.code === f.sku));
  const realPositions = await loadRealImagePositions(db);
  const prev = readManifest();
  const mediaRoot = resolveMediaRoot();
  const assets: Record<string, AssetManifestEntry> = {};
  let built = 0;
  let reused = 0;
  let textured = 0;
  for (const t of targets) {
    const positions = realPositions.get(t.code) ?? { hero: null, angle: null };
    const { textures, source } = await texturesFor(t.code, t.category, mediaRoot, positions, { fromOrig });
    const { entry, wrote, quality } = buildOne(
      { code: t.code, category: t.category, spec: (t.spec ?? null) as SpecJson | null },
      { textures, prev: prev?.assets[t.code] ?? null },
    );
    assets[t.code] = entry;

    if (wrote) built++;
    else reused++;
    if (quality === 'textured') {
      textured++;
      console.log(`  ${t.code.padEnd(26)} textured — ${entry.textures?.count ?? 0} image(s) from ${source}`);
    }
  }
  // the gate-demo product is not a SKU but the AR page can load it by name
  const demo = buildOne({ code: 'DEMO-BATHTUB', category: 'bathtub', spec: null }, { prev: prev?.assets['DEMO-BATHTUB'] ?? null });
  assets['DEMO-BATHTUB'] = demo.entry;
  writeManifest(assets);
  console.log(`${targets.length} SKUs: ${built} built, ${reused} unchanged, ${textured} textured — manifest written`);
  await closeDb();
}

if (process.argv[1] && /build\.(ts|js)$/.test(process.argv[1]))
  main().catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
