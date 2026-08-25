import Image from 'next/image';
import Link from 'next/link';
import { mediaUrl } from '@/lib/media';

/**
 * One tile in a catalogue grid — a category on the home page, a product inside a category page.
 *
 * The same card does both levels on purpose: the tree is CATEGORY → PRODUCT → SKU, and the first
 * two levels are the same act of choosing. Giving them different cards is what made the old home
 * page read as two systems bolted together.
 *
 * The photograph is the design. It carries no glyph: every category and every product has real
 * art, and the previous version laid a line drawing over the picture at 34% opacity and then put
 * a second copy of the same drawing in a chip below the name.
 *
 * It shows what the thing is and how much of it there is — never a price. A "from ₹410" here
 * answers a question nobody has asked yet and commits the store to a number before the buyer has
 * chosen anything.
 */
export default function CategoryTile({
  href,
  name,
  heroImageKey,
  meta,
  soon = false,
  priority = false,
}: {
  href: string;
  name: string;
  heroImageKey: string | null;
  /** One line under the name: "3 products · 9 items", or nothing when there is nothing to sell. */
  meta?: React.ReactNode;
  soon?: boolean;
  priority?: boolean;
}) {
  const hero = mediaUrl(heroImageKey);

  return (
    <Link href={href} className={`cat-card${soon ? ' cat-card--soon' : ''}`}>
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
        {soon && <span className="cat-pill">Arriving soon</span>}
      </div>
      <div className="cat-band">
        <span className="cat-name">{name}</span>
        {meta && <span className="cat-meta">{meta}</span>}
      </div>
    </Link>
  );
}
