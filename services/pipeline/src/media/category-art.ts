/**
 * `pnpm pipeline art:categories` — one tile per category, for the homepage grid and the
 * department sidebar.
 *
 * A live category gets a photograph: the best real hero among its own products, cover-cropped
 * to 16:9 on the store's canvas. That is the honest picture of what the category sells, and it
 * replaces a drawn blueprint motif that had to be run through `filter: invert(1)` in CSS to sit
 * on a light page at all.
 *
 * An upcoming category has no products to photograph, so it gets a drawn tile in the same light
 * palette — a department tint, a construction grid and the category's name. It reads as a place
 * being prepared rather than a broken image, and it never pretends to be a photograph.
 */
import { categoryHeroKey, type ImageSize } from '@buildobjects/catalog';
import { categories, getDb, skuImages, skus } from '@buildobjects/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { mediaStore } from './store';

/** The two renditions the storefront asks for. 16:9 both, so a tile never reflows on load. */
const SIZES: { size: ImageSize; width: number }[] = [
  { size: 'card', width: 800 },
  { size: 'gallery', width: 1600 },
];
const RATIO = 9 / 16;

/** Light palette, straight off packages/ui/src/theme.css — a tile must match the page it sits on. */
const INK = '#0f1111';
const INK_2 = '#565959';
const CANVAS_2 = '#f7f8f8';
const LINE_2 = '#e7e9e9';

/**
 * A tint per department so thirty-seven tiles do not read as one grey block. Every value is a
 * wash of the store's own teal or a neutral beside it — no colour enters the page that the
 * theme has not already licensed.
 */
const DEPARTMENT_TINT: Record<string, [string, string]> = {
  'construction-materials': ['#eef2f2', '#dfe7e7'],
  'building-materials': ['#eef4f4', '#dde9ea'],
  'construction-chemicals': ['#e9f4f4', '#d6ebec'],
  'electrical-items': ['#f2f3ef', '#e6e9df'],
  'solar-energy': ['#f4f2ec', '#eae5d8'],
  'cctv-security': ['#eef1f4', '#dee4ea'],
  'safety-fire': ['#f4efee', '#eaddda'],
  'surveying-equipment': ['#eef3f2', '#dee9e6'],
  'site-structure': ['#f1f2f3', '#e2e5e7'],
  'mep-services': ['#edf3f5', '#daeaee'],
  'site-machinery': ['#f2f1ee', '#e5e2da'],
  'external-works': ['#eff3ef', '#dfe8df'],
  'office-administration': ['#f1f1f3', '#e3e3e8'],
};

/**
 * The ground an upcoming category's tile sits on: its department's tint, a construction grid
 * and four corner marks. Deliberately wordless — the card band beneath it already carries the
 * category name and its status, and the tile printed both again.
 *
 * The mark itself is drawn by the storefront, not baked in here: `CategoryIcon` already holds
 * all thirty-seven glyphs, and a second copy of them in this file would be one to keep in step.
 */
function upcomingSvg(department: string, w: number): string {
  const h = Math.round(w * RATIO);
  const [from, to] = DEPARTMENT_TINT[department] ?? DEPARTMENT_TINT['construction-materials'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 225">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="${INK}" stroke-opacity=".05" stroke-width=".6"/></pattern>
  </defs>
  <rect width="400" height="225" fill="url(#g)"/><rect width="400" height="225" fill="url(#grid)"/>
  <g fill="none" stroke="${INK_2}" stroke-opacity=".22" stroke-width="1"><path d="M14 14h16M14 14v16M386 14h-16M386 14v16M14 211h16M14 211v-16M386 211h-16M386 211v-16"/></g>
</svg>`;
}

/**
 * The best real photograph in a category: the hero that most reads as a product shot, with
 * width as the tie-break. Ordering by width alone gave Cement a high-resolution photograph of
 * a city skyline and Solar Panels a field, because that is what those manufacturers put at the
 * top of their own pages.
 */
async function bestHero(categoryId: number): Promise<string | null> {
  const rows = await getDb()
    .select({ key: skuImages.storageKeyOriginal })
    .from(skuImages)
    .innerJoin(skus, eq(skus.id, skuImages.skuId))
    .where(and(eq(skus.categoryId, categoryId), eq(skuImages.position, 1), eq(skuImages.placeholder, false)))
    .orderBy(desc(skuImages.qualityScore), desc(skuImages.width))
    .limit(1);
  return rows[0]?.key ?? null;
}

export async function generateCategoryArt(log: (s: string) => void = console.log): Promise<void> {
  const db = getDb();
  const store = mediaStore();
  const rows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, department: categories.department, status: categories.status })
    .from(categories)
    .orderBy(asc(categories.displayOrder));

  let photographed = 0;
  let drawn = 0;
  for (const c of rows) {
    const heroKey = c.status === 'live' ? await bestHero(c.id) : null;
    let source: Buffer | null = null;
    if (heroKey) {
      try {
        source = (await store.exists(heroKey)) ? await store.read(heroKey) : null;
      } catch {
        source = null; // a key in the table with no bytes behind it falls back to the drawn tile
      }
    }

    for (const { size, width } of SIZES) {
      const height = Math.round(width * RATIO);
      /* Contained, not cropped. A cement bag and a solar module are portrait and landscape
         respectively; `cover` at 16:9 took the middle out of the bag and lost the frame of
         the module. The product sits whole on the store's own canvas instead. */
      const pad = Math.round(height * 0.08);
      const buf = source
        ? await sharp(source)
            .flatten({ background: CANVAS_2 })
            .resize(width - pad * 2, height - pad * 2, { fit: 'inside', withoutEnlargement: false })
            .extend({ top: pad, bottom: pad, left: pad, right: pad, background: CANVAS_2 })
            .resize(width, height, { fit: 'contain', background: CANVAS_2 })
            .webp({ quality: 84 })
            .toBuffer()
        : await sharp(Buffer.from(upcomingSvg(c.department, width)))
            .webp({ quality: 88 })
            .toBuffer();
      await store.put(categoryHeroKey(c.slug, size), buf, 'image/webp');
    }
    if (source) photographed++;
    else drawn++;
    log(`  ${c.slug.padEnd(24)} ${source ? 'photograph' : c.status === 'live' ? 'drawn (no product photo yet)' : 'drawn'}`);
  }
  log(`\n${photographed} categories illustrated by their own products, ${drawn} drawn · line ${LINE_2} on ${CANVAS_2}`);
}
