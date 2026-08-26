/**
 * MAKE EVERY PRODUCT PHOTOGRAPH SIT ON ONE COLOUR, SO THE MOUNT CAN BE THAT COLOUR.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────────────────────
 * The 27 SKUs were photographed by 27 different suppliers. Their studio sweeps are #efefef,
 * #f3f3f2, #d3d4d5, #b2b5ae and #fffefe, and the store paints one silver gradient behind all of
 * them. Every mismatch is a visible rectangle: the photograph's own background against the mount's,
 * two greys apart, with a hard edge between them. That edge is the single thing that makes this
 * catalogue read as assembled rather than made.
 *
 * ── WHAT WAS TRIED FIRST, AND WHY IT IS NOT HERE ────────────────────────────────────────────
 * Keying the sweep to transparency, so the product would sit on the teal page directly. It is the
 * better answer when it works and it does not work on this set. Two contact sheets said so: the
 * flood fill escapes through white products and shreds a cement sack into slivers of print; it
 * cannot tell a marketing collage's white gutter from a sweep and leaves orange diagonals behind;
 * and sweep the product encloses — the arc under a fire extinguisher's hose — stays behind as a
 * bright blob on the dark page. Twenty of twenty-five came out well, which is not a number you
 * can ship a catalogue on.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────────────────────
 * Recolours the sweep, and touches nothing else. Every pixel within tolerance of the photograph's
 * own background colour becomes ONE agreed colour; pixels a little further out are eased toward
 * it so there is no ring; everything else is left exactly as photographed.
 *
 * There is no flood fill, so there is no geometry to get wrong: nothing can shred, nothing can
 * leak, and a product that touches all four edges is handled like any other. Sweep the product
 * encloses is recoloured too — the same tolerance, the same colour — so the trapped blobs that
 * defeated the matte simply become part of the mount.
 *
 * The cost is honest and small: a part of a PRODUCT that is within tolerance of its own sweep is
 * flattened into the mount as well. That is a white object on a white background, which was
 * already indistinguishable before this ran.
 *
 * ── AND THE MOUNT IS NOW THAT COLOUR ────────────────────────────────────────────────────────
 * theme.css sets --plate-1 to the same value. Photograph and mount become one surface with no
 * seam anywhere in the catalogue, and the mount's edges are dissolved into the card in CSS, so
 * what is left is a product floating on the page rather than a picture in a box.
 *
 * ── THE ONES THAT ARE NOT PHOTOGRAPHS ───────────────────────────────────────────────────────
 * Some suppliers ship a marketing composite as the product's first image: the bag on a red
 * sunburst, the carton on a gold field. Recolouring those would be vandalism, so this leaves them
 * exactly as they are — and then gives each one a mount of ITS OWN colour, written out to
 * lib/plate-colors.ts and set on the card as a custom property.
 *
 * So there is no seam anywhere, on any tile, without a single pixel of artwork being touched: a
 * studio shot sits on the shared silver, and a composite sits on the colour it was drawn on.
 *
 *   pnpm --filter @buildobjects/web blend            writes in place
 *   pnpm --filter @buildobjects/web blend -- --dry   reports and writes nothing
 *   pnpm --filter @buildobjects/web blend -- --sheet out.png   a contact sheet to look at
 *
 * Idempotent: an image already sitting on the target colour is recognised and skipped.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * storage/media is the tracked original; apps/web/public/media is hard-linked from it by
 * stage-media.mts at build time and is gitignored. Writing to the derived copy edits a build
 * artefact and breaks the link — run `pnpm stage` after this to relink.
 */
const ROOT = path.resolve(process.cwd(), '..', '..', 'storage', 'media', 'skus');
const DRY = process.argv.includes('--dry');
const SHEET = process.argv.includes('--sheet') ? (process.argv[process.argv.indexOf('--sheet') + 1] ?? null) : null;

/**
 * THE ONE COLOUR. A silver with a teal cast in it, so the mount belongs to the page's palette
 * instead of being the one neutral thing on a teal screen. Keep this and --plate-1 in theme.css
 * identical; they are the two halves of one surface.
 */
const TARGET: [number, number, number] = [0xe6, 0xed, 0xee];

/** Inside this of the photograph's own background: it IS the background. */
const T0 = 20;
/** Beyond this: left exactly as photographed. Between the two: eased, so there is no ring. */
const T1 = 46;
/** How much of the border ring one colour has to hold before there is a sweep to recolour. */
const RING_SHARE = 0.3;
/** A photographic sweep is light and near-neutral. Below this, what is behind the product is
    part of the picture — a lifestyle shot, a render, a screenshot — and is left alone. */
const STUDIO_MIN_LEVEL = 150;
const STUDIO_MAX_CAST = 26;
/** Already on the target, to within a rounding error of the encoder. */
const DONE = 5;

const cheb = (r: number, g: number, b: number, c: readonly [number, number, number]) => Math.max(Math.abs(r - c[0]), Math.abs(g - c[1]), Math.abs(b - c[2]));

interface Report {
  file: string;
  action: 'blended' | 'already' | 'no-studio-background';
  from?: string;
  share?: number;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (/\.(webp|avif|png)$/i.test(name)) out.push(full);
  }
  return out;
}

const sheet: Buffer[] = [];

async function blend(file: string): Promise<Report> {
  /* Read the bytes ourselves rather than handing sharp the path. On Windows a sharp instance
     created from a path keeps that file open, and writing back to it fails with "unable to open
     for write" — silently, per file, so a run reports a third of the work it thinks it did. */
  const input = await readFile(file);
  const meta = await sharp(input).metadata();
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const at = (x: number, y: number) => (y * W + x) * 4;

  const ring: number[] = [];
  for (let x = 0; x < W; x += 1) ring.push(at(x, 0), at(x, H - 1));
  for (let y = 1; y < H - 1; y += 1) ring.push(at(0, y), at(W - 1, y));

  /* The border's modal colour, quantised to 8 levels a channel so near-identical greys agree. */
  const bins = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (const i of ring) {
    const k = `${data[i] >> 5}.${data[i + 1] >> 5}.${data[i + 2] >> 5}`;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    bins.set(k, { n: e.n + 1, r: e.r + data[i], g: e.g + data[i + 1], b: e.b + data[i + 2] });
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  const bg: [number, number, number] = [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];

  const share = ring.filter((i) => cheb(data[i], data[i + 1], data[i + 2], bg) <= T0).length / ring.length;
  const level = Math.min(bg[0], bg[1], bg[2]);
  const cast = Math.max(bg[0], bg[1], bg[2]) - level;

  /* The card, the search row and the PDP hero all show image ONE, so image one's background is
     the colour its mount has to be. Recorded before the recolour, and only when the border
     really is one colour — a border that is half product has no mount colour to give. */
  if (file.endsWith(`1-card.webp`) && share >= RING_SHARE) {
    const sku = path.relative(ROOT, file).split(path.sep)[1];
    if (sku) mounts.set(sku, hex(bg));
  }
  if (share < RING_SHARE || level < STUDIO_MIN_LEVEL || cast > STUDIO_MAX_CAST) return { file, action: 'no-studio-background', from: bg.join(',') };
  if (cheb(bg[0], bg[1], bg[2], TARGET) <= DONE) return { file, action: 'already' };

  for (let p = 0; p < W * H; p += 1) {
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    const d = cheb(data[i], data[i + 1], data[i + 2], bg);
    if (d >= T1) continue;
    /* 1 at the background colour, easing to 0 by T1 — so the recolour has no edge of its own. */
    const t = d <= T0 ? 1 : 1 - (d - T0) / (T1 - T0);
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(data[i + c] + (TARGET[c] - data[i + c]) * t);
  }

  if (SHEET) {
    sheet.push(
      await sharp(data, { raw: { width: W, height: H, channels: 4 } })
        .resize(240, 240, { fit: 'contain', background: { r: TARGET[0], g: TARGET[1], b: TARGET[2], alpha: 1 } })
        .png()
        .toBuffer(),
    );
    return { file, action: 'blended', from: bg.join(','), share };
  }
  if (!DRY) {
    const img = sharp(data, { raw: { width: W, height: H, channels: 4 } });
    const out =
      meta.format === 'avif'
        ? await img.avif({ quality: 60, effort: 4 }).toBuffer()
        : meta.format === 'png'
          ? await img.png({ compressionLevel: 9 }).toBuffer()
          : await img.webp({ quality: 82, effort: 4 }).toBuffer();
    await writeFile(file, out);
  }
  return { file, action: 'blended', from: bg.join(','), share };
}

/** sku_code -> the colour its FIRST image sits on, for the mount behind it. */
const mounts = new Map<string, string>();
const hex = (c: readonly [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const files = (await walk(ROOT)).filter((f) => (SHEET ? f.endsWith('-gallery.webp') : true));
const reports: Report[] = [];
for (const f of files) {
  try {
    reports.push(await blend(f));
  } catch (e) {
    console.log(`  !  ${path.relative(ROOT, f)} — ${(e as Error).message}`);
  }
}

const by = (a: Report['action']) => reports.filter((r) => r.action === a);
console.log(`\n${files.length} images under storage/media/skus\n`);
console.log(`  blended onto the mount   ${by('blended').length}`);
console.log(`  already on it            ${by('already').length}`);
console.log(`  left as photographed     ${by('no-studio-background').length}`);
const sweeps = new Map<string, number>();
for (const r of by('blended')) sweeps.set(r.from as string, (sweeps.get(r.from as string) ?? 0) + 1);
if (sweeps.size)
  console.log(
    `\n  sweeps found: ${[...sweeps.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c, n]) => `${c} (${n})`)
      .join(', ')}`,
  );
const untouched = new Map<string, number>();
for (const r of by('no-studio-background')) untouched.set(path.relative(ROOT, r.file).split(path.sep)[1] ?? '?', 0);
if (untouched.size) console.log(`  left alone: ${[...untouched.keys()].join(', ')}`);
const rejected = new Map<string, number>();
for (const r of by('no-studio-background')) rejected.set(r.from as string, (rejected.get(r.from as string) ?? 0) + 1);
if (rejected.size)
  console.log(
    `  their border colours: ${[...rejected.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([c, n]) => `${c}x${n}`)
      .join('  ')}`,
  );

if (!DRY && !SHEET && mounts.size) {
  const rows = [...mounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  await writeFile(
    path.resolve(process.cwd(), 'lib', 'plate-colors.ts'),
    `/**
 * GENERATED by scripts/blend-skus.mts — do not edit by hand.
 *
 * The colour each SKU's first image sits on, sampled from its own border. It is painted behind
 * that product wherever the product appears, so the photograph's background and the mount behind
 * it are the same colour and there is no rectangle. Most are the shared silver the blend pass
 * put them on; the outliers are suppliers who shipped a marketing composite rather than a
 * photograph, and those keep the colour their artwork was drawn on.
 */
export const PLATE_COLORS: Record<string, string> = {
${rows.map(([k, v]) => `  '${k}': '${v}',`).join('\n')}
};

/** The mount for a SKU, or null to fall back to the shared --plate-1. */
export const plateFor = (sku: string): string | null => PLATE_COLORS[sku] ?? null;
`,
    'utf8',
  );
  console.log(`\n  mounts written for ${rows.length} SKUs -> lib/plate-colors.ts`);
  const odd = rows.filter(([, v]) => v.toLowerCase() !== '#e6edee');
  if (odd.length) console.log(`  not on the shared silver: ${odd.map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

if (SHEET && sheet.length) {
  const COLS = 10;
  const rows = Math.ceil(sheet.length / COLS);
  await sharp({ create: { width: COLS * 240, height: rows * 240, channels: 4, background: { r: 0x0e, g: 0x2a, b: 0x33, alpha: 1 } } })
    .composite(sheet.map((input, i) => ({ input, left: (i % COLS) * 240, top: Math.floor(i / COLS) * 240 })))
    .png()
    .toFile(SHEET);
  console.log(`\ncontact sheet: ${sheet.length} images on the mount, over the card -> ${SHEET}`);
} else console.log(DRY ? '\ndry run — nothing was written' : '\nwritten in place');
