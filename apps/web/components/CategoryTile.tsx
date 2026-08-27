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
 *
 * `compact` is the same tile at the size a shelf that is not stocked yet deserves. Twenty-six of
 * the thirty-five categories in this catalogue are still being filled, and drawn at full size
 * they made the front door read as a store with the lights off — twenty-six large photographs,
 * each dimmed, each wearing an "Arriving soon" pill, outnumbering the nine that sell three to
 * one. Compact keeps every one of them on the page, which is the honest thing, and gives them
 * the weight of a list rather than of a shelf.
 */
/**
 * How wide the tile will actually be drawn, so the browser can pick the right file.
 *
 * These track the grid in styles/home.css and are wrong the moment it changes — which is exactly
 * what happened when the stocked grid went from four columns to three: the hint still said 23vw
 * for a tile now drawn at 31, so the browser confidently fetched a file a third too small and
 * every photograph on the front door came back soft. A `sizes` that lies costs sharpness or
 * bandwidth, silently, and nothing in a build ever fails.
 *
 *   full     3 up over 1100px · 2 up under it
 *   compact  6 up over 1100px · 4 up to 768 · 3 up below
 */
const SIZES = {
  full: '(max-width: 1100px) 46vw, 31vw',
  compact: '(max-width: 768px) 31vw, (max-width: 1100px) 23vw, 15vw',
} as const;

export default function CategoryTile({
  href,
  name,
  heroImageKey,
  meta,
  soon = false,
  priority = false,
  compact = false,
}: {
  href: string;
  name: string;
  heroImageKey: string | null;
  /** One line under the name: "9 items · from ₹410", or nothing when there is nothing to sell. */
  meta?: React.ReactNode;
  soon?: boolean;
  priority?: boolean;
  compact?: boolean;
}) {
  const hero = mediaUrl(heroImageKey);
  const cls = ['cat-card', 'lift', soon && 'cat-card--soon', compact && 'cat-card--compact'].filter(Boolean).join(' ');

  return (
    <Link href={href} className={cls} data-reveal="scale">
      <div className="cat-photo">
        {hero && (
          <Image
            src={hero}
            alt=""
            width={800}
            height={450}
            sizes={compact ? SIZES.compact : SIZES.full}
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
      {/* Last in the DOM, first on the card. When it sat inside .cat-photo it was read out — by a
          screen reader, and by anything else parsing the page — as "Arriving soon, Safety Tools &
          Equipment". The name comes first now; the pill is still pinned to the top-left corner,
          because .cat-card is the positioning context either way.

          A compact tile never wears it: the heading over that grid already says these shelves are
          being filled, and twenty-six copies of the same sentence is not twenty-six facts. */}
      {soon && !compact && <span className="cat-pill">Arriving soon</span>}
    </Link>
  );
}
