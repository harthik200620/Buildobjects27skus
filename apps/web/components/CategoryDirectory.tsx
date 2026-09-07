import Link from 'next/link';
import CategoryTile from '@/components/CategoryTile';
import { IconArrow } from '@/components/icons';
import type { CategoryGroup } from '@/lib/data';

/**
 * The catalogue's top level: what is on the shelf, then what is not yet.
 *
 * ONE COMPONENT, TWO PAGES. The front door and the catalogue both answer "what does this store
 * sell", and they were answering it differently — the home page drew categories and `/search`
 * drew all twenty-eight products in a flat grid with a text sidebar. That is the store's own
 * taxonomy contradicted by its own catalogue page, and it is the defect this component exists to
 * make impossible: the split, the ordering, the tile and the counts are decided here once, so the
 * two surfaces cannot drift again.
 *
 * THE SPLIT IS THE DESIGN. Nine of the thirty-six categories have something to sell and
 * twenty-seven do not. Drawn at one size and shuffled together they read as a store with the
 * lights off, so what sells leads at full size and what is coming follows at the weight of a
 * list. Nothing is hidden — an empty shelf a buyer can see is a promise; an empty shelf removed
 * from the page is a lie by omission.
 *
 * AND IT CARRIES NO PRICES. A category is not a thing with a price, and "from ₹410" under one
 * answers a question nobody asked at this level. Counts only.
 */
export default function CategoryDirectory({
  categories,
  itemCount,
  headingId,
  /** The eyebrow and heading over the stocked grid; the catalogue and the front door word it differently. */
  eyebrow,
  title,
  sub,
  /** The quiet link beside the heading — where "more of this" goes. */
  moreHref,
  moreLabel,
  /**
   * The flat every-item list, offered as a button under the whole directory.
   *
   * The catalogue offers it; the FRONT DOOR DOES NOT. The home page ends on its categories, and
   * it already points at the catalogue twice — from the hero and from the heading beside this
   * grid. A third link to the same place is not a third way in.
   */
  flatHref,
  flatLabel,
}: {
  categories: CategoryGroup[];
  itemCount: number;
  headingId: string;
  eyebrow: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  moreHref?: string;
  moreLabel?: string;
  flatHref?: string;
  flatLabel?: string;
}) {
  const stocked = categories.filter((c) => c.status === 'live');
  const coming = categories.filter((c) => c.status !== 'live');

  return (
    <>
      <section className="shell sec" aria-labelledby={headingId}>
        <div className="sec-head" data-reveal>
          <div>
            <p className="micro sec-eyebrow">{eyebrow}</p>
            <h2 id={headingId} className="d2">
              {title}
            </h2>
            {sub && <p className="lede sec-sub">{sub}</p>}
          </div>
          {moreHref && (
            <Link href={moreHref} className="sec-more">
              {moreLabel} <IconArrow size={16} />
            </Link>
          )}
        </div>

        <ul className="cat-grid stagger">
          {stocked.map((c, i) => (
            /* --i drives the stagger: four columns, so the modulo makes each row cascade
               left-to-right rather than the whole row arriving at once.

               NO TILE IS EAGER, and `priority` is deliberately not passed. Neither surface puts
               this grid on the first screen at any width, and preloading a row of invisible
               thumbnails would compete with the photograph that IS the largest contentful paint. */
            <li key={c.slug} style={{ '--i': i % 4 } as React.CSSProperties}>
              <CategoryTile
                href={`/c/${c.slug}`}
                name={c.name}
                heroImageKey={c.heroImageKey}
                meta={c.skuCount > 0 ? `${c.skuCount} ${c.skuCount === 1 ? 'item' : 'items'}` : undefined}
              />
            </li>
          ))}
        </ul>
      </section>

      {coming.length > 0 && (
        <section className="shell sec sec--last" aria-labelledby={`${headingId}-soon`}>
          <div className="sec-head sec-head--tight" data-reveal>
            <div>
              <p className="micro sec-eyebrow">Filling next</p>
              {/* .h3, not .d3: a footnote to the section above it, and a seventeenth type size on
                  the front door is what scale:audit is there to catch. */}
              <h2 id={`${headingId}-soon`} className="h3">
                <span className="fig">{coming.length}</span> more shelves, on the way
              </h2>
              <p className="lede sec-sub">Open any of them and it will tell you plainly where it stands — nothing here pretends to be in stock.</p>
            </div>
          </div>
          <ul className="cat-grid cat-grid--compact stagger">
            {coming.map((c, i) => (
              <li key={c.slug} style={{ '--i': i % 4 } as React.CSSProperties}>
                <CategoryTile href={`/c/${c.slug}`} name={c.name} heroImageKey={c.heroImageKey} soon compact />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The flat list, kept one click away rather than deleted. Somebody who wants to see all
          twenty-seven things at once is a real shopper with a real question, and the answer to
          "show me everything" should not be "pick a category first". */}
      {flatHref && (
        <section className="shell sec--last cat-dir-all">
          <Link href={flatHref} className="btn btn-secondary btn--lg">
            {flatLabel ?? `See all ${itemCount} items in one list`} <IconArrow size={16} />
          </Link>
        </section>
      )}
    </>
  );
}
