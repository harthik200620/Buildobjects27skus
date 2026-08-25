import Link from 'next/link';
import type { CategoryCard } from '@/lib/data';
import { mediaUrl } from '@/lib/media';
import { CategoryIcon, IconArrow } from './icons';

/**
 * One category in the homepage grid and the department pages.
 *
 * It shows what the category is and how much of it there is — never a price. A "from ₹410"
 * on a tile answers a question nobody asked at this level and quietly commits the store to a
 * number before the buyer has picked a product; the count of brands and products is what
 * actually helps someone choose where to look first.
 */
export default function CategoryTile({ category, size = 'lg' }: { category: CategoryCard; size?: 'lg' | 'sm' }) {
  const { slug, name, icon, status, brandCount, stats } = category;
  const skuCount = stats?.sku_count ?? 0;
  const live = status === 'live';
  const hero = mediaUrl(category.heroImageKey);

  return (
    <Link href={`/c/${slug}`} className={`cat-card lift${live ? '' : ' cat-card--soon'}${size === 'sm' ? ' cat-card--sm' : ''}`}>
      <div className="cat-photo">
        {hero && <img src={hero} alt="" loading="lazy" decoding="async" />}
        {/* A category with nothing to photograph gets its ground from the tile and its mark from
            here, so the thirty-seven glyphs live in one place. `hero` is absent only before
            `pnpm pipeline art:categories` has run. */}
        {(!live || !hero) && (
          <span className="cat-photo-mark">
            <CategoryIcon icon={icon ?? 'cement'} size={size === 'sm' ? 44 : 66} strokeWidth={1} />
          </span>
        )}
      </div>
      <div className="cat-band">
        <span className="cat-icon">
          <CategoryIcon icon={icon ?? 'cement'} size={size === 'sm' ? 18 : 20} />
        </span>
        <span className="cat-text">
          <span className="cat-name" title={name}>
            {name}
          </span>
          <span className="cat-meta">
            {live ? (
              <>
                <span className="fig">{brandCount}</span> {brandCount === 1 ? 'brand' : 'brands'}
                <span className="cat-dot" aria-hidden>
                  ·
                </span>
                <span className="fig">{skuCount}</span> {skuCount === 1 ? 'product' : 'products'}
              </>
            ) : (
              'Arriving soon'
            )}
          </span>
        </span>
        <span className="cat-arrow">
          <IconArrow size={size === 'sm' ? 16 : 18} />
        </span>
      </div>
    </Link>
  );
}
