/**
 * pnpm assets:3d [--category c] [--sku CODE] [--force] [--textures-from-orig]
 *
 * Builds assets/3d/placeholders/{SKU}.glb at the SKU's real dimensions and writes
 * assets/3d/manifest.json. When the image stage has produced photo cut-outs
 * (`{n}-cutout.png` under MEDIA_ROOT) the parametric model wears them → `quality: 'textured'`;
 * otherwise it stays a flat-colour `'placeholder'`. A real model at assets/3d/{SKU}.glb wins
 * (`quality: 'photoreal'`, `placeholder: false`) and keeps its photoreal metadata — but only when
 * `assets/3d/review.json` has not rejected it. That file is why nine cartons, rival-brand sacks
 * and one human figure are no longer what this store shows in a customer's room.
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
import { loadReview, modelRejected, photosRejected, productPhotoPosition, type Review } from './review';
import { type BuilderTextures, heroCutoutFor, prepareTextures, usesPhotos } from './textures';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ASSETS_DIR = path.join(ROOT, 'assets', '3d');

/** MEDIA_ROOT is repo-root relative (the convention of .env and services/pipeline/src/config.ts). */
export const resolveMediaRoot = (env: NodeJS.ProcessEnv = process.env): string => path.resolve(ROOT, env.MEDIA_ROOT?.trim() || './storage/media');

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
  /** Which generated models are accepted. Omitted = accept every GLB that exists, the old behaviour. */
  review?: Review | null;
}

export function buildOne(t: BuildTarget, o: BuildOneOptions = {}): { entry: AssetManifestEntry; wrote: boolean; quality: AssetQuality } {
  const dims = dimsFor(t.spec, t.category);
  const builder = BUILDERS[t.category] ?? BUILDERS.generic;
  const { meshes, variant, textured, textureNote } = builder(dims.m, { variant: variantHintFor(t.spec), textures: o.textures ?? null });
  const { glb, triangles, bbox, textures: textureCount } = buildGlb(meshes, t.code);
  const assetsDir = o.assetsDir ?? ASSETS_DIR;
  const realFile = path.join(assetsDir, `${t.code}.glb`);
  /*
   * EXISTING IS NOT THE SAME AS CORRECT, and this line used to treat them as the same thing.
   * Every file under assets/3d was reconstructed from the SKU's position-1 photo by a provider
   * that is faithful to whatever it is given — and the manifest says of 21 of the 28 that the
   * judge never ran. So the store shipped a cardboard carton as the model of a bulb, a Dalmia
   * sack as the model of an Ambuja one, a hand holding a bottle, and a human figure as a tile.
   *
   * A generated model now has to be accepted as well as present. A rejection is not a gap: the
   * parametric builder above has already run, at the SKU's real dimensions, and drawing that is
   * strictly better than drawing the box the product came in.
   */
  const rejected = o.review ? modelRejected(o.review, t.code) : null;
  const real = fs.existsSync(realFile) && !rejected;
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
  /* Last, so it outranks the texture note: why this SKU is drawn parametrically when a generated
     model for it is sitting right there on disk. Without it the manifest looks like the provider
     was never run, and somebody re-runs it. */
  if (rejected) entry.note = `generated model rejected — ${rejected}`;
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
  opts: { fromOrig?: boolean; review?: Review | null } = {},
): Promise<{ textures: BuilderTextures | null; source: 'cutout' | 'orig' | null }> {
  if (!usesPhotos(category)) return { textures: null, source: null };
  /*
   * The same review that gates the model gates the photograph, and it has to: rejecting a bad
   * model only to print the same bad photograph onto the parametric one that replaces it would
   * put a Dalmia sack back on an Ambuja SKU by another route. An unbranded bag at the right size
   * is the honest picture of a cement bag whose only photographs are of somebody else's.
   */
  if (opts.review && photosRejected(opts.review, code)) return { textures: null, source: null };
  /*
   * WHICH position, and this is the whole point of the vision pass. `real.hero` is the row the
   * database calls the hero, and roles are numbered rather than read — so it is position 1 for
   * every SKU in the catalogue, whatever is in the picture. Where the review has looked at the
   * photographs it pins the one that actually shows the product; the database's answer is the
   * fallback for a SKU nothing has read yet.
   */
  const pinned = opts.review ? productPhotoPosition(opts.review, code) : null;
  const heroPos = pinned ?? real.hero;
  /* An angle shot is a SECOND view of the product; when the pinned position is not position 1
     there is no reason to believe the database's `angle` is one, so it is not assumed. */
  const anglePos = pinned === null ? real.angle : null;
  const hero = heroPos !== null ? await heroCutoutFor(code, mediaRoot, { position: heroPos, allowOrig: !!opts.fromOrig }) : null;
  const angle = anglePos !== null ? await heroCutoutFor(code, mediaRoot, { position: anglePos, allowOrig: !!opts.fromOrig }) : null;
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
  const review = loadReview(ASSETS_DIR);
  const assets: Record<string, AssetManifestEntry> = {};
  let built = 0;
  let reused = 0;
  let textured = 0;
  const refused: string[] = [];
  for (const t of targets) {
    const db = realPositions.get(t.code) ?? { hero: null, angle: null };
    /*
     * THE PINNED POSITION WINS OVER THE DATABASE'S "HERO".
     *
     * `loadRealImagePositions` asks the `sku_images` table which row is the hero, and that table
     * assigns roles by POSITION — so it answers 1 for every SKU in the catalogue, whatever is in
     * the frame. `review.json`'s `photo_positions` is the answer a vision pass actually looked at
     * the pictures to get, and for nine SKUs it points at a photograph sourced later and written
     * at position 6. Without this line those photographs exist on disk, are recorded as found,
     * and never reach a model — the texture path would keep printing the carton.
     */
    const pinned = productPhotoPosition(review, t.code);
    const positions = pinned === null ? db : { hero: pinned, angle: db.angle };
    const { textures, source } = await texturesFor(t.code, t.category, mediaRoot, positions, { fromOrig, review });
    const { entry, wrote, quality } = buildOne(
      { code: t.code, category: t.category, spec: (t.spec ?? null) as SpecJson | null },
      { textures, prev: prev?.assets[t.code] ?? null, review },
    );
    assets[t.code] = entry;

    if (wrote) built++;
    else reused++;
    if (modelRejected(review, t.code)) refused.push(t.code);
    if (quality === 'textured') {
      textured++;
      console.log(`  ${t.code.padEnd(26)} textured — ${entry.textures?.count ?? 0} image(s) from ${source}`);
    }
  }
  // the gate-demo product is not a SKU but the AR page can load it by name
  const demo = buildOne({ code: 'DEMO-BATHTUB', category: 'bathtub', spec: null }, { prev: prev?.assets['DEMO-BATHTUB'] ?? null, review });
  assets['DEMO-BATHTUB'] = demo.entry;
  writeManifest(assets);
  /* Named, not counted. A rejection means a generated model exists and is being ignored, which is
     a thing somebody has to be able to see happening rather than infer from a total. */
  for (const code of refused) console.log(`  ${code.padEnd(26)} generated model REFUSED — ${modelRejected(review, code)}`);
  console.log(`${targets.length} SKUs: ${built} built, ${reused} unchanged, ${textured} textured, ${refused.length} refused — manifest written`);
  await closeDb();
}

if (process.argv[1] && /build\.(ts|js)$/.test(process.argv[1]))
  main().catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
