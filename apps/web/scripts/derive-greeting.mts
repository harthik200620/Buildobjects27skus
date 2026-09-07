/**
 * pnpm --filter @buildobjects/web greet:derive
 *
 * Cut the city photographs the sign-in greeting uses out of the originals in `generated images/`,
 * and write them to `public/greet/`.
 *
 * WHY TWO CROPS AND NOT ONE. The Tirupati original is 1584 x 672 — two and a third to one, which
 * is a landscape and nothing else. Covering a phone with it means showing about a fifth of its
 * width blown up two and a half times, and a 2.5x upscale of a JPEG is visibly soft in exactly
 * the place a "premium" screen cannot afford to be. So the wide file stays as it is for a landscape
 * viewport, and a portrait crop is made for a narrow one, centred on the gopuram and enlarged once,
 * here, with a good resampler and a measured sharpen rather than by the browser.
 *
 * THE CENTRE IS MEASURED, NOT GUESSED. The crop is centred on where the light actually is: the
 * brightest column of the frame, found by summing luminance down each column across the band the
 * temple occupies. It prints what it found, so a re-run on a different photograph is checkable
 * rather than hopeful.
 *
 * Not part of `next build`. Run it when a photograph changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const OUT = path.join(web, 'public', 'greet');
const SOURCES = path.resolve(web, '..', '..', 'generated images');

interface City {
  /** The file stem written into public/greet. */
  out: string;
  /** The original, under `generated images/`. */
  from: string;
}

const CITIES: City[] = [{ out: 'tirupati', from: 'Generated Image September 07, 2026 - 11_40AM.jpg' }];

/** sRGB to relative luminance, per WCAG — the same sum the contrast gate uses. */
const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/**
 * The column the eye goes to: brightest by a wide margin in this kind of photograph, where the
 * subject is lit and the hills around it are not. Measured over the middle vertical band so a
 * bright patch of sky cannot pull the crop off the building.
 */
async function focalColumn(file: string): Promise<{ x: number; width: number; height: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const top = Math.round(info.height * 0.2);
  const bottom = Math.round(info.height * 0.95);
  const columns = new Float64Array(info.width);
  for (let y = top; y < bottom; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      columns[x] += lum(data[i], data[i + 1], data[i + 2]);
    }
  /* A window as wide as the crop will be, so the answer is "where is the light densest" rather
     than "which single column has the brightest pixel". */
  const win = Math.round(info.width * 0.12);
  let best = 0;
  let bestSum = -1;
  let running = 0;
  for (let x = 0; x < info.width; x++) {
    running += columns[x];
    if (x >= win) running -= columns[x - win];
    if (x >= win - 1 && running > bestSum) {
      bestSum = running;
      best = x - Math.floor(win / 2);
    }
  }
  return { x: best, width: info.width, height: info.height };
}

fs.mkdirSync(OUT, { recursive: true });

for (const city of CITIES) {
  const src = path.join(SOURCES, city.from);
  if (!fs.existsSync(src)) {
    console.error(`missing original: ${src}`);
    process.exit(1);
  }
  const focal = await focalColumn(src);
  console.log(`${city.out}: ${focal.width} x ${focal.height}, light densest at x ${focal.x} (${((focal.x / focal.width) * 100).toFixed(1)}% across)`);

  /* Landscape: the original, unchanged in shape. Nothing is gained by resizing a photograph to a
     size no viewport asks for, and everything is lost by upscaling it. */
  const wideBase = sharp(src);
  await wideBase
    .clone()
    .webp({ quality: 82, effort: 6 })
    .toFile(path.join(OUT, `${city.out}-wide.webp`));
  await wideBase
    .clone()
    .jpeg({ quality: 80, progressive: true, mozjpeg: true })
    .toFile(path.join(OUT, `${city.out}-wide.jpg`));

  /*
   * Portrait: four by five, full height, centred on the light. Enlarged 1.5x with Lanczos and a
   * small unsharp mask — a phone at 2x asks for about 780 device pixels across a full-width panel
   * and the crop is 538, so the enlargement happens either way. Doing it here, once, with a
   * resampler chosen for it, beats every browser doing it again on every load.
   */
  const cropW = Math.round(focal.height * 0.8);
  const left = Math.max(0, Math.min(focal.width - cropW, focal.x - Math.round(cropW / 2)));
  const tallW = Math.round(cropW * 1.5);
  const tall = sharp(src)
    .extract({ left, top: 0, width: cropW, height: focal.height })
    .resize(tallW, Math.round(focal.height * 1.5), { kernel: 'lanczos3' })
    .sharpen({ sigma: 0.7, m1: 0.4, m2: 0.9 });
  await tall
    .clone()
    .webp({ quality: 84, effort: 6 })
    .toFile(path.join(OUT, `${city.out}-tall.webp`));
  await tall
    .clone()
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toFile(path.join(OUT, `${city.out}-tall.jpg`));

  console.log(`  portrait crop ${cropW} x ${focal.height} from x ${left}, enlarged to ${tallW} wide`);
  for (const f of [`${city.out}-wide.webp`, `${city.out}-wide.jpg`, `${city.out}-tall.webp`, `${city.out}-tall.jpg`]) {
    const { size } = fs.statSync(path.join(OUT, f));
    console.log(`  ${f.padEnd(24)} ${(size / 1024).toFixed(1)} KB`);
  }
}
