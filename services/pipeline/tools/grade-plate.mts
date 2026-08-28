/**
 * npx tsx services/pipeline/tools/grade-plate.mts <source.jpg> <plate-name>
 *
 * Grade a generated frame into the backplate set, and write it as the named plate.
 *
 * `design-system/art/MANIFEST.md` says the seven plates were "graded to the canvas and optimised"
 * and never says how, which was fine until somebody had to add an eighth: the only way to match the
 * set was then to eyeball it, and that is how a set stops being a set. A backplate two stops
 * brighter and half a hue warmer than its neighbours reads as a page assembled by more than one
 * person. So the house style, measured off the seven that shipped, is written down:
 *
 *     mean rgb  32, 59, 60      blue ≥ green > red — everything sits in the canvas's own hue
 *     median    46              dark; the copy on top is the brightest thing in the frame
 *     p90       95              and the highlights stay well below white
 *
 * A raw generation lands nowhere near it — the frame this was written for measured 62, 87, 82 at a
 * median of 78. Per-channel linear gain, solved rather than guessed: measure, compute the gain that
 * lands each channel on its target, apply, measure again, repeat. Three passes gets inside a couple
 * of levels on every channel, and the loop reports what it converged to, so the result is checkable
 * rather than trusted. Only gain — no curve, no saturation push, no vignette — because the plates
 * carry their own light, and a second grade on top of the generator's is how a photograph starts
 * looking like a filter.
 *
 * The target defaults to the whole set's average. Pass a plate name that already exists and it
 * matches THAT plate instead, which is what you want when replacing one in the same slot: the
 * hero is the brightest of the seven on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/*
 * sharp keeps decoded files in an internal cache and, on Windows, keeps their handles with them.
 * This tool READS the plate it is about to overwrite — to take the target statistics off it — so
 * with the cache on, the write fails with "unable to open for write: Invalid argument" and the
 * subsequent unlink with EPERM. Both read like a permissions problem and neither is one.
 */
sharp.cache(false);

const here = path.dirname(fileURLToPath(import.meta.url));
const ART = path.resolve(here, '..', '..', '..', 'design-system', 'art');

interface Stats {
  r: number;
  g: number;
  b: number;
  median: number;
  p90: number;
}

/** Channel means and the luminance distribution, off a 160×90 sample. Fast, and enough. */
async function measure(input: string | Buffer): Promise<Stats> {
  const raw = await sharp(input).resize(160, 90, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let r = 0;
  let g = 0;
  let b = 0;
  const lum: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    r += raw[i];
    g += raw[i + 1];
    b += raw[i + 2];
    lum.push(0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]);
  }
  const n = raw.length / 3;
  lum.sort((a, c) => a - c);
  return { r: r / n, g: g / n, b: b / n, median: lum[Math.floor(n / 2)], p90: lum[Math.floor(n * 0.9)] };
}

const [source, name] = process.argv.slice(2);
if (!source || !name) {
  console.error('usage: grade-plate.mts <source.jpg> <plate-name>');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`no such file: ${source}`);
  process.exit(1);
}

/* The target: the plate being replaced if there is one, otherwise the set's average. */
const target = path.join(ART, `${name}.webp`);
let want: Stats;
if (fs.existsSync(target)) {
  want = await measure(target);
  console.log(`matching the plate it replaces — ${name}.webp`);
} else {
  const others = fs.readdirSync(ART).filter((f) => f.endsWith('.webp'));
  const all = await Promise.all(others.map((f) => measure(path.join(ART, f))));
  const avg = (k: keyof Stats) => all.reduce((n, s) => n + s[k], 0) / all.length;
  want = { r: avg('r'), g: avg('g'), b: avg('b'), median: avg('median'), p90: avg('p90') };
  console.log(`matching the set's average of ${others.length} plates`);
}
const show = (s: Stats) => `rgb ${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)}  med ${Math.round(s.median)}  p90 ${Math.round(s.p90)}`;
console.log(`  target   ${show(want)}`);
console.log(`  source   ${show(await measure(source))}`);

/*
 * Solve the gain. Each pass measures what the current gain actually produced and corrects it,
 * because a linear gain on an 8-bit image does not move the mean linearly — the shoulder clips
 * and the toe does not. Damped at 0.85 so it converges instead of oscillating.
 */
let gain: [number, number, number] = [1, 1, 1];
for (let pass = 1; pass <= 4; pass += 1) {
  const got = await measure(await sharp(source).linear(gain, [0, 0, 0]).toBuffer());
  const err: [number, number, number] = [want.r / got.r, want.g / got.g, want.b / got.b];
  console.log(`  pass ${pass}   ${show(got)}   gain ${gain.map((x) => x.toFixed(3)).join(' ')}`);
  if (Math.max(...err.map((e) => Math.abs(1 - e))) < 0.01) break;
  gain = gain.map((x, i) => x * (1 + (err[i] - 1) * 0.85)) as [number, number, number];
}

/*
 * The originals are 2752px JPEGs; the plate ships as WebP at the same pixel size and the stager
 * cuts the 640/1280/2560 ladder from it. Quality 86 matches the rest of the set.
 *
 * Written to a temporary name and then moved into place. When the target already exists this
 * tool has just READ it to take its statistics, and on Windows sharp still holds that handle —
 * writing over it fails with "unable to open for write: Invalid argument", which reads like a
 * permissions problem and is not one.
 */
const out = path.join(ART, `${name}.webp`);
const tmp = path.join(ART, `.${name}.grading.webp`);
await sharp(source).linear(gain, [0, 0, 0]).webp({ quality: 86 }).toFile(tmp);
fs.renameSync(tmp, out);

const final = await measure(out);
const meta = await sharp(out).metadata();
console.log(`\n  ${name}.webp   ${meta.width}×${meta.height}   ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
console.log(`  graded   ${show(final)}`);
console.log('\nnow run: pnpm --filter @buildobjects/web stage');
