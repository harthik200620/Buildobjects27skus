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
 * art, and an earlier version laid a line drawing over the picture at 34% opacity and then put a
 * second copy of the same drawing in a chip below the name.
 *
 * `meta` is one line of substance under the name. It used to read "1 product · 3 on the shelf" on
 * every stocked tile — nine tiles, nine identical strings, and "1 product" is a fact about how
 * the catalogue is filed rather than about what is for sale. It now says how many items are on
 * the shelf and what the cheapest of them costs, which are the two things a buyer is deciding on.
 *
 * Elevation comes from `.lift` in theme.css — the one hover rule every card in the store shares.
 * The teal edge and the photograph's scale are the only motion this tile owns.
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
  /** One line under the name: "9 items · from ₹410", or nothing when there is nothing to sell. */
  meta?: React.ReactNode;
  soon?: boolean;
  priority?: boolean;
}) {
  const hero = mediaUrl(heroImageKey);

  return (
    <Link href={href} className={`cat-card lift${soon ? ' cat-card--soon' : ''}`}>
      <div className="cat-photo">
        {hero && (
          <Image
            src={hero}
            alt=""
            width={800}
            height={450}
            sizes="(max-width: 640px) 46vw, (max-width: 1100px) 31vw, 23vw"
            priority={priority}
            /* Above the fold the browser must not wait to be told the image matters. */
            loading={priority ? 'eager' : 'lazy'}
          />
        )}
      </div>
      <div className="cat-band">
        <span className="cat-name">{name}</span>
        {meta && <span className="cat-meta">{meta}</span>}
      </div>
      {/* Last in the DOM, first on the card. Twenty-six of the thirty-five tiles carry this, and
          when it sat inside .cat-photo every one of them was read out — by a screen reader, and
          by anything else parsing the page — as "Arriving soon, Safety Tools & Equipment". The
          name comes first now; the pill is still pinned to the top-left corner, because .cat-card
          is the positioning context either way. */}
      {soon && <span className="cat-pill">Arriving soon</span>}
    </Link>
  );
}
