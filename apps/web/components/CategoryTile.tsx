import Image from 'next/image';
import Link from 'next/link';
import type { CategoryCard } from '@/lib/data';
import { mediaUrl } from '@/lib/media';

/**
 * One category in the home grid.
 *
 * The photograph is the design. All thirty-seven categories have real art, so the tile carries no
 * glyph at all — the previous version laid a line drawing over the picture at 34% opacity on the
 * twenty-eight upcoming tiles and put a second copy of the same drawing in a teal chip below the
 * name. A photograph competing with two diagrams of itself is what made the grid look cheap.
 *
 * It shows what the category is and how much of it there is — never a price. A "from ₹410" here
 * answers a question nobody has asked yet and commits the store to a number before the buyer has
 * picked anything; brands and products is what actually helps someone choose where to look first.
 *
 * One card, one size. Stocked and upcoming differ by a pill and a quieter picture, not by a
 * different component — they are one taxonomy and should read as one.
 */
export default function CategoryTile({ category, priority = false }: { category: CategoryCard; priority?: boolean }) {
  const { slug, name, status, brandCount, stats } = category;
  const skuCount = stats?.sku_count ?? 0;
  const live = status === 'live';
  const hero = mediaUrl(category.heroImageKey);

  return (
    <Link href={`/c/${slug}`} className={`cat-card${live ? '' : ' cat-card--soon'}`}>
      <div className="cat-photo">
        {hero && (
          <Image
            src={hero}
            alt=""
            width={800}
            height={450}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={priority}
            /* Above the fold the browser must not wait to be told the image matters. */
            loading={priority ? 'eager' : 'lazy'}
          />
        )}
        {!live && <span className="cat-pill">Arriving soon</span>}
      </div>
      <div className="cat-band">
        <span className="cat-name">{name}</span>
        {live && (
          <span className="cat-meta">
            <span className="fig">{brandCount}</span> {brandCount === 1 ? 'brand' : 'brands'}
            <span className="cat-dot" aria-hidden>
              ·
            </span>
            <span className="fig">{skuCount}</span> {skuCount === 1 ? 'product' : 'products'}
          </span>
        )}
      </div>
    </Link>
  );
}
