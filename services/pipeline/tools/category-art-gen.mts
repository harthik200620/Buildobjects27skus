/**
 * `npx tsx services/pipeline/tools/category-art-gen.mts [--only slug,slug] [--force] [--sheet]`
 *
 * One premium photograph per category, generated.
 *
 * Thirty-seven categories need a picture and only nine of them sell anything yet, so there was
 * nothing to photograph for twenty-eight — they carried a drawn grid rectangle, and the nine live
 * ones borrowed a product hero, which is why Cement's tile was a bag of one brand and Glass's was
 * a facade. Neither is a picture of the category.
 *
 * Searching the web is the obvious alternative and the wrong one: a search for "bricks" returns
 * brand-stamped product shots, and putting one manufacturer's pallet on the tile that means
 * "bricks" is the same misattribution this repo already spent a pass removing from the SKU images.
 * Generation has no brand to misattribute — every image here is of the *material*, shot the same
 * way, with no logo, no text and no manufacturer.
 *
 * Written through the same mediaStore keys the storefront already reads
 * (`categoryHeroKey(slug, size)`), so no component changes to pick them up. One image call per
 * category, a few cents for all thirty-seven; re-runs skip anything already on disk unless
 * --force, so an interrupted run resumes for free.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { categoryHeroKey, type ImageSize } from '@buildobjects/catalog';
import { categories, closeDb, getDb } from '@buildobjects/db';
import { generateImage, resolveModel } from '@buildobjects/llm';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { mediaStore } from '../src/media/store';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const REGISTRY = path.join(ROOT, 'services', 'pipeline', 'registry');
const OVERRIDES = path.join(REGISTRY, 'category-art-overrides.json');

const SIZES: { size: ImageSize; width: number }[] = [
  { size: 'card', width: 800 },
  { size: 'gallery', width: 1600 },
];
const RATIO = 9 / 16;

/**
 * The art direction every tile shares. Written once, so thirty-seven images read as one set
 * rather than thirty-seven searches. The two constraints that matter commercially are the last
 * two: a logo would attribute the whole category to one manufacturer, and baked-in text would
 * be a second, untranslatable, unfixable caption under the real one.
 */
const DIRECTION = [
  'A premium editorial product photograph for an Indian construction-materials marketplace.',
  'Studio lighting, soft directional key from the upper left, gentle falloff, shallow depth of field.',
  'The material fills the frame and is the only subject; three-quarter view; sharp, tactile surface detail.',
  'Deep desaturated charcoal-teal background that falls off to near black at the edges, so the subject reads against a dark page.',
  'Cool neutral colour grade with a faint teal cast in the shadows. Photorealistic. 16:9 landscape.',
  'Absolutely no logos, no brand marks, no printed labels, no watermarks, no text or lettering of any kind.',
  'No people, no hands, no faces.',
].join(' ');

/**
 * What each category actually is, in the words a photographer would be briefed with. These are
 * deliberately about the material and the trade rather than about a product on a shelf — the
 * tile answers "what is sold here", and the SKU grid behind it answers "by whom".
 */
const SUBJECT: Record<string, string> = {
  // ── construction materials ──────────────────────────────────────────────────
  cement: 'A stack of plain unmarked grey cement sacks on a pallet, one sack open with fine grey powder spilling, a steel trowel resting against it.',
  'bricks-and-blocks': 'A neatly stacked wall of red clay bricks beside a stack of grey AAC blocks, showing the texture and mortar bed of both.',
  steel: 'A bundle of ribbed TMT steel reinforcement bars stacked end-on, showing the deformed ribs and cut ends, with a coil of binding wire.',
  // ── building materials ──────────────────────────────────────────────────────
  tiles: 'A fanned arrangement of large-format porcelain floor tiles in matt stone and polished marble finishes, edges catching the light.',
  glass: 'Stacked panes of architectural float glass seen edge-on, the green edge of the glass glowing, with one clear pane standing upright.',
  roofing: 'A section of profiled metal roofing sheet overlapping terracotta roof tiles, showing both profiles and their interlock.',
  painting: 'Open paint tins in muted interior shades with a loaded roller and a brush, and a swatch board of brushed-out colour.',
  'internal-works': 'A cutaway of gypsum plasterboard on a metal stud frame with a length of decorative cornice and a jointing knife.',
  'kitchen-ware': 'A brushed stainless steel kitchen sink with a modern pull-out tap and a stone worktop offcut.',
  // ── construction chemicals ──────────────────────────────────────────────────
  epoxy: 'A two-part epoxy grout kit, unmarked base and hardener tins with a mixing paddle, and a glossy poured epoxy surface sample.',
  waterproofing: 'A roller applying an elastomeric waterproof membrane to a concrete slab, water beading on the finished half.',
  // ── electrical ──────────────────────────────────────────────────────────────
  bulbs: 'Several unbranded LED bulbs of different shapes on a dark surface, one lit and glowing warm, showing the diffuser and B22 cap.',
  // ── solar ───────────────────────────────────────────────────────────────────
  'solar-panels': 'A monocrystalline solar module seen at a three-quarter angle, the cell grid and busbars crisp, sky reflecting off the glass.',
  // ── security ────────────────────────────────────────────────────────────────
  cctv: 'A white dome CCTV camera and a bullet camera mounted on a bracket, lenses catching a highlight, cabling neatly dressed.',
  // ── safety and fire ─────────────────────────────────────────────────────────
  'fire-extinguishers': 'A red ABC dry-powder fire extinguisher with its pressure gauge, hose and squeeze grip, on a wall bracket.',
  'safety-equipment': 'A yellow hard hat, clear safety goggles, a reflective vest and a pair of work gloves arranged as a set.',
  // ── surveying ───────────────────────────────────────────────────────────────
  'total-stations': 'A robotic total station on a yellow tripod, its objective lens and keypad in focus, set up on open ground.',
  'drafting-measurement': 'A steel measuring tape, a laser distance meter, a spirit level and a set square on a rolled architectural drawing.',
  // ── site and structure ──────────────────────────────────────────────────────
  excavation: 'The articulated arm and toothed bucket of a hydraulic excavator biting into earth at a foundation trench.',
  centering: 'Steel formwork panels and adjustable props assembled for a slab pour, tie rods and wing nuts visible.',
  railings: 'A stainless steel and toughened glass balustrade on a balcony edge, with a mild steel railing section beside it.',
  // ── MEP ─────────────────────────────────────────────────────────────────────
  plumbing: 'CPVC and PPR pipes of several diameters with elbows, tees and brass fittings arranged on a dark bench.',
  'hvac-materials': 'A run of insulated copper refrigerant pipe, a length of rectangular galvanised duct and a ceiling air diffuser.',
  'lift-elevators': 'The polished stainless steel doors and call panel of a passenger lift, with a length of steel hoist rope.',
  // ── plant and machinery ─────────────────────────────────────────────────────
  'heavy-equipment': 'A wheel loader and a backhoe on a construction site at dusk, silhouetted against a dark sky.',
  'transport-systems': 'A tipper truck and a transit concrete mixer drum, the drum mid-rotation, on a site haul road.',
  machineries: 'A concrete mixer, a plate compactor and a bar-bending machine grouped as site plant.',
  // ── external works ──────────────────────────────────────────────────────────
  'external-works': 'Interlocking paver blocks laid in a herringbone pattern with a kerb edge and a strip of turf alongside.',
  // ── office and administration ───────────────────────────────────────────────
  branding: 'A brushed metal signage plate, an embossed rubber stamp and a blank site hoarding panel, all unlettered.',
  administration: 'A desk organiser with box files, a punched lever-arch folder and a stack of blank forms.',
  stationery: 'Pens, markers, clips, a stapler and a measuring scale arranged neatly on a dark desk.',
  'paper-sheet': 'A ream of A4 paper, a roll of plotter paper and a stack of tracing sheets seen edge-on.',
  'electronic-printing': 'A large-format plotter printing a rolled drawing, with a desktop multifunction printer beside it.',
  'communication-furniture': 'A site-office desk with an ergonomic chair, a desk phone and a stacking visitor chair.',
  'finance-accounting': 'A hardbound ledger, a calculator, a cash box and a bound invoice book on a desk.',
  'storage-packaging': 'Stretch-wrapped pallets, corrugated cartons and a steel storage rack in a materials store.',
  presentation: 'A whiteboard with a rolled projection screen, a flip chart stand and a laser pointer.',
};

type Override = { prompt?: string; url?: string; why: string };

function loadOverrides(): Record<string, Override> {
  if (!fs.existsSync(OVERRIDES)) return {};
  const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) as { categories?: Record<string, Override> };
  return doc.categories ?? {};
}

/**
 * Both renditions from one generated frame, cover-cropped to 16:9, written to the store under a
 * content-versioned key — and then pointed at from the database.
 *
 * Writing the files was never the whole job. The first version of this tool wrote them and
 * stopped, leaving `categories.hero_image_key` pointing wherever the previous run had left it, so
 * the store kept rendering older artwork from a URL that had quietly changed underneath it. The
 * key, the bytes and the row now move together or not at all.
 */
async function writeRenditions(slug: string, source: Buffer): Promise<string> {
  const store = mediaStore();
  const version = createHash('sha1').update(source).digest('hex').slice(0, 10);
  for (const { size, width } of SIZES) {
    const height = Math.round(width * RATIO);
    const buf = await sharp(source).resize(width, height, { fit: 'cover', position: 'centre' }).webp({ quality: 86 }).toBuffer();
    await store.put(categoryHeroKey(slug, size, version), buf, 'image/webp');
  }
  const cardKey = categoryHeroKey(slug, 'card', version);
  await getDb().update(categories).set({ heroImageKey: cardKey }).where(eq(categories.slug, slug));
  return cardKey;
}

async function main() {
  const argv = process.argv.slice(2);
  /* `argv.indexOf('--only') + 1` is 0 when the flag is absent, so a bare `--force` was read as
     the value of --only and filtered every category out. Only look for a value when the flag
     is actually there. */
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

  const taxonomy = JSON.parse(fs.readFileSync(path.join(REGISTRY, 'taxonomy.json'), 'utf8')) as { categories: { slug: string; name?: string }[] };
  const overrides = loadOverrides();
  const store = mediaStore();
  const model = await resolveModel('image');
  console.log(`generating category art with ${model}\n`);

  const done: { slug: string; buf: Buffer }[] = [];
  let made = 0;
  let skipped = 0;
  const failures: { slug: string; why: string }[] = [];

  for (const c of taxonomy.categories) {
    const slug = c.slug;
    if (only.size && !only.has(slug)) continue;
    /* Resume check: has anything been generated for this slug at all? The key is versioned now,
       so the question is about the directory rather than about one filename. */
    const dir = path.join(ROOT, 'storage', 'media', 'categories', slug);
    const already = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith('hero-gallery-'));
    if (!force && already) {
      skipped += 1;
      done.push({ slug, buf: await store.read(key) });
      console.log(`  ${slug.padEnd(26)} already generated`);
      continue;
    }
    const subject = overrides[slug]?.prompt ?? SUBJECT[slug];
    if (!subject) {
      failures.push({ slug, why: 'no subject written for this category' });
      console.log(`  ${slug.padEnd(26)} SKIPPED — no subject written`);
      continue;
    }
    try {
      const res = await generateImage({ caller: 'category-art', model, parts: [`${subject} ${DIRECTION}`] });
      const raw = Buffer.from(res.image.base64, 'base64');
      await writeRenditions(slug, raw);
      done.push({ slug, buf: raw });
      made += 1;
      const meta = await sharp(raw).metadata();
      console.log(`  ${slug.padEnd(26)} ${meta.width}×${meta.height}  ${(raw.length / 1024).toFixed(0)} KB  ${(res.latencyMs / 1000).toFixed(1)} s`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      failures.push({ slug, why });
      console.log(`  ${slug.padEnd(26)} FAILED — ${why}`);
    }
  }

  console.log(`\n${made} generated, ${skipped} already present, ${failures.length} failed`);
  for (const f of failures) console.log(`  ! ${f.slug}: ${f.why}`);

  /*
   * The contact sheet. Thirty-seven generated images is thirty-seven chances for the model to
   * have produced something confidently wrong — a "brick" that is a paving slab, an "epoxy" that
   * is a paint tin. One sheet is how a person checks all of them in a glance and names the ones
   * to re-prompt through category-art-overrides.json.
   */
  if (wantSheet && done.length) {
    const TILE = 320;
    const COLS = 5;
    const TH = Math.round(TILE * RATIO);
    const rows = Math.ceil(done.length / COLS);
    const composites = await Promise.all(
      done.map(async (d, i) => ({
        input: await sharp(d.buf)
          .resize(TILE - 8, TH - 8, { fit: 'cover' })
          .png()
          .toBuffer(),
        top: ((i / COLS) | 0) * (TH + 26) + 4,
        left: (i % COLS) * TILE + 4,
      })),
    );
    const labels = done.map((d, i) => ({
      input: Buffer.from(`<svg width="${TILE}" height="24"><text x="6" y="16" font-family="Arial" font-size="13" fill="#eaf2f3">${i} · ${d.slug}</text></svg>`),
      top: ((i / COLS) | 0) * (TH + 26) + TH,
      left: (i % COLS) * TILE,
    }));
    const out = path.join(ROOT, 'storage', 'reports', 'category-art-sheet.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp({ create: { width: COLS * TILE, height: rows * (TH + 26), channels: 3, background: '#06181d' } })
      .composite([...composites, ...labels])
      .png()
      .toFile(out);
    console.log(`\ncontact sheet → ${path.relative(ROOT, out)}`);
  }
}

await main();
await closeDb();
