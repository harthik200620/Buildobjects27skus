/**
 * `npx tsx services/pipeline/tools/house-renders.mts [--only 2-medium] [--force] [--sheet]`
 *
 * The house BO Estimator draws, rendered properly. The first version was an SVG elevation built
 * out of rectangles — honest, every shape bound to a field of the estimate, and it looked like a
 * diagram, which is the one thing a hero product cannot look like.
 *
 * Accurate is not the bar either. The first render pass briefed the literal truth — bare earth,
 * plain plaster, an exposed downpipe — and produced thirty joyless boxes. This is the image a
 * person looks at while deciding to spend thirty lakhs, so it has to show them the home they have
 * been imagining, at their storey count and their finish, with a real number under it.
 *
 * The configuration space that actually changes what a building looks like is small, so the whole
 * matrix is pre-generated and the page swaps between stills — generating on each keystroke would
 * cost twenty seconds and a few paise per drag of a slider.
 *
 *   floors 0 (ground only) … 4 (G+4) · finish basic/medium/premium · solar off/on  =  30 renders
 *
 * Consistency is the whole game: thirty houses that are obviously thirty different houses read as
 * a slideshow rather than as one building changing. It comes from the DIRECTION block below — one
 * camera, one hour, one plot, one colour grade, written identically into every prompt — and NOT
 * from feeding each render the previous one, which was the first attempt: a reference image of a
 * two-storey house overrode every request for five.
 *
 * Deliberately NOT in the render: the compound wall, the car porch and the CCTV. Those are
 * separate line items a person can switch off, and a picture that shows a wall the estimate did
 * not price is a picture that lies. They are named under the image instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateImage, resolveModel } from '@buildobjects/llm';
import sharp from 'sharp';
import { mediaStore } from '../src/media/store';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export type Finish = 'basic' | 'medium' | 'premium';
export const FLOORS = [0, 1, 2, 3, 4] as const;
export const FINISHES: Finish[] = ['basic', 'medium', 'premium'];

/** `estimator/house/2-medium-solar.webp` — the key the storefront asks for. */
export function houseKey(floors: number, finish: Finish, solar: boolean, size: 'card' | 'hero' = 'hero'): string {
  return `estimator/house/${floors}-${finish}${solar ? '-solar' : ''}-${size}.webp`;
}

const SIZES: { size: 'card' | 'hero'; width: number }[] = [
  { size: 'card', width: 720 },
  { size: 'hero', width: 1440 },
];
const RATIO = 10 / 16;

/**
 * The fixed half of every prompt. Camera, hour, ground and grade never change, because they are
 * what makes thirty images read as one building rather than thirty buildings.
 *
 * The first version of this block briefed the truth and got nothing anyone wanted to look at:
 * "bare levelled earth", "nothing else in the frame", "utilitarian", "exposed rainwater
 * downpipe". Every render came back a correct, accurate, joyless box. But nobody spends thirty
 * lakhs on a box — they spend it on the house they have been picturing for ten years, and the
 * whole job of this image is to show them that house with a real number attached to it.
 *
 * So the brief is now the house someone actually wants: golden hour, warm light spilling out of
 * the windows, a planted approach, a wet driveway holding the sky. What it must NOT do is invent
 * line items — no compound wall, no gate, no car, because each of those is something the estimate
 * separately prices and can switch off. Landscaping is not a line item; a boundary wall is.
 */
const DIRECTION = [
  'Award-winning photorealistic architectural visualisation of a beautiful modern family home in India, of the standard published in an architecture magazine.',
  'Three-quarter hero view from a low standing eye level near the corner of the plot: the front elevation reads on the left, the side elevation recedes to the right, slight upward angle so the building feels generous.',
  'Golden hour just after sunset — a deep gradient sky from warm amber at the horizon to deep teal-blue overhead, warm interior light glowing out of every window, soft architectural uplighting grazing the facade, a few thin clouds catching the last light.',
  'Beautifully landscaped: a clean paved driveway of large format stone with wet reflections, a manicured strip of lawn, low ornamental planting and a couple of slender palms framing the composition, warm path lights.',
  'Rich cinematic colour grade with teal shadows and warm highlights, gentle bloom on the light sources, shallow depth of field, immaculate materials, crisp reflections, ray-traced quality.',
  'No compound wall, no boundary fence, no gate, no car, no people, no text, no signage, no watermarks, no house numbers, no brand marks.',
  '16:10 landscape, sharp architectural detail, the whole building comfortably inside the frame with generous headroom above the roofline.',
].join(' ');

/**
 * How many storeys — said first, said in three ways, and said again at the end of the prompt.
 *
 * The first version said it once, politely, in the middle ("A 5-storey house (ground floor plus
 * 4 upper floors)"), and handed the model a reference image of a two-storey house at the same
 * time. Every render came back two storeys: the picture won. The count is the single most
 * important variable in this matrix, so it is now stated as a level count, as a G+N label, and
 * as a number of window rows to draw — three descriptions of one fact that can only agree.
 */
function storeysOf(floors: number): string {
  const levels = floors + 1;
  if (floors === 0) {
    return [
      'EXACTLY ONE STOREY. A single-storey bungalow: a ground floor and nothing above it.',
      'The building is one level tall — one row of windows across the front, and above that only the flat RCC roof and its low parapet.',
      'There is NO upper floor, NO first floor, NO staircase block above roof level.',
    ].join(' ');
  }
  return [
    `EXACTLY ${levels} STOREYS, stacked vertically. A "G+${floors}" building: a ground floor plus ${floors} upper ${floors === 1 ? 'floor' : 'floors'}.`,
    `Count the levels from the ground up and there must be ${levels} of them, each the same height, each separated from the one below by a horizontal slab band running across the facade.`,
    `The front facade therefore shows ${levels} rows of windows, one row per level, evenly stacked.`,
    floors >= 3
      ? `This is a tall building — noticeably taller than it is wide, ${levels} floors rising above a narrow urban plot.`
      : 'Flat RCC roof with a low parapet above the top floor.',
  ].join(' ');
}

/**
 * What each finish quality buys — written as three houses a person would be happy to own, not as
 * three budget brackets. The tier is what the estimate prices, so the difference has to be
 * visible; but "basic" has to mean "a clean, well-proportioned home" rather than "a cheap one",
 * because a customer looking at the entry tier is still looking at their own house.
 */
const FINISH_BRIEF: Record<Finish, string> = {
  basic:
    'A clean, handsome contemporary home. Smooth white and warm sand-toned rendered walls in simple bold blocks, generous square windows with slim dark frames, a projecting flat slab canopy over the entrance, a neat teak-toned front door, simple horizontal wood-slat screen beside the entry. Uncluttered and well proportioned rather than expensive.',
  medium:
    'A warm contemporary home with real material contrast. Off-white render against a full-height band of split-face stone, large aluminium-framed picture windows, a projecting cantilevered balcony with a slim black metal railing, a wood-slat soffit over the entrance porch lit warmly from within, decorative jaali screen panel to one side.',
  premium:
    'A luxury architect-designed villa. Floor-to-ceiling glazing in slim black frames spanning whole bays, large-format travertine and dark granite cladding, a dramatic double-height entrance with a cantilevered concrete canopy, frameless glass balustrades on every balcony, a reflecting water feature beside the entrance path, continuous recessed cove lighting washing every slab edge, a sculptural feature staircase visible through the glass.',
};

const SOLAR_ON =
  'A neat array of dark monocrystalline solar panels on slim aluminium rails on the flat roof, tilted, clearly visible above the parapet and integrated as part of the design rather than bolted on.';
const SOLAR_OFF = 'The flat roof is clean and bare — no solar panels, no water tank, no rooftop equipment, no clutter.';

export function promptFor(floors: number, finish: Finish, solar: boolean): string {
  const levels = floors + 1;
  return [
    storeysOf(floors),
    FINISH_BRIEF[finish],
    solar ? SOLAR_ON : SOLAR_OFF,
    DIRECTION,
    // Last word, because it is the one that gets ignored.
    `Again, and most importantly: the building must be exactly ${levels} ${levels === 1 ? 'storey' : 'storeys'} tall — ${levels} ${levels === 1 ? 'level' : 'levels'}, ${levels} ${levels === 1 ? 'row' : 'rows'} of windows.`,
  ].join(' ');
}

async function writeRenditions(floors: number, finish: Finish, solar: boolean, source: Buffer): Promise<void> {
  const store = mediaStore();
  for (const { size, width } of SIZES) {
    const height = Math.round(width * RATIO);
    const buf = await sharp(source).resize(width, height, { fit: 'cover', position: 'centre' }).webp({ quality: 88 }).toBuffer();
    await store.put(houseKey(floors, finish, solar, size), buf, 'image/webp');
  }
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
  const wantSheet = argv.includes('--sheet');

  const store = mediaStore();
  const model = await resolveModel('image');
  console.log(`rendering the estimator house matrix with ${model}\n`);

  /*
   * No reference image.
   *
   * The obvious way to keep thirty renders consistent is to hand each one the first render and
   * ask it to match. That was tried and it is why the first pass produced a two-storey bungalow
   * and a two-storey G+4: given a picture of a two-storey house and a sentence asking for five
   * storeys, the picture wins every time. Consistency comes from the fixed DIRECTION block
   * instead — one camera, one hour, one plot, one grade, written identically into every prompt —
   * which held the style across all thirty without ever constraining the geometry.
   */
  const combos: { floors: number; finish: Finish; solar: boolean; id: string }[] = [];
  for (const finish of FINISHES)
    for (const floors of FLOORS) for (const solar of [false, true]) combos.push({ floors, finish, solar, id: `${floors}-${finish}${solar ? '-solar' : ''}` });

  const done: { id: string; buf: Buffer }[] = [];
  let made = 0;
  let skipped = 0;
  const failures: { id: string; why: string }[] = [];

  for (const c of combos) {
    if (only.size && !only.has(c.id)) continue;
    const key = houseKey(c.floors, c.finish, c.solar, 'hero');
    if (!force && (await store.exists(key))) {
      const buf = await store.read(key);
      done.push({ id: c.id, buf });
      skipped += 1;
      console.log(`  ${c.id.padEnd(20)} already rendered`);
      continue;
    }
    try {
      const res = await generateImage({ caller: 'house-render', model, parts: [promptFor(c.floors, c.finish, c.solar)] });
      const raw = Buffer.from(res.image.base64, 'base64');
      await writeRenditions(c.floors, c.finish, c.solar, raw);
      done.push({ id: c.id, buf: raw });
      made += 1;
      const meta = await sharp(raw).metadata();
      console.log(`  ${c.id.padEnd(20)} ${meta.width}×${meta.height}  ${(raw.length / 1024).toFixed(0)} KB  ${(res.latencyMs / 1000).toFixed(1)} s`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      failures.push({ id: c.id, why });
      console.log(`  ${c.id.padEnd(20)} FAILED — ${why}`);
    }
  }

  console.log(`\n${made} rendered, ${skipped} already present, ${failures.length} failed`);
  for (const f of failures) console.log(`  ! ${f.id}: ${f.why}`);

  if (wantSheet && done.length) {
    const TILE = 400;
    const TH = Math.round(TILE * RATIO);
    const COLS = 5;
    done.sort((a, b) => a.id.localeCompare(b.id));
    const rows = Math.ceil(done.length / COLS);
    const tiles = await Promise.all(
      done.map(async (d, i) => ({
        input: await sharp(d.buf)
          .resize(TILE - 6, TH - 6, { fit: 'cover' })
          .png()
          .toBuffer(),
        top: ((i / COLS) | 0) * (TH + 22) + 3,
        left: (i % COLS) * TILE + 3,
      })),
    );
    const labels = done.map((d, i) => ({
      input: Buffer.from(`<svg width="${TILE}" height="20"><text x="5" y="15" font-family="Arial" font-size="13" fill="#eaf2f3">${d.id}</text></svg>`),
      top: ((i / COLS) | 0) * (TH + 22) + TH,
      left: (i % COLS) * TILE,
    }));
    const out = path.join(ROOT, 'storage', 'reports', 'house-renders-sheet.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp({ create: { width: COLS * TILE, height: rows * (TH + 22), channels: 3, background: '#06181d' } })
      .composite([...tiles, ...labels])
      .png()
      .toFile(out);
    console.log(`\ncontact sheet → ${path.relative(ROOT, out)}`);
  }
}

await main();
