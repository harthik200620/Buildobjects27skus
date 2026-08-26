import Link from 'next/link';
import SearchBar from '@/components/SearchBar';
import Wordmark from '@/components/Wordmark';
import AccountMenu from './AccountMenu';
import CartButton from './CartButton';
import CategoryMenu from './CategoryMenu';
import DeliverTo from './DeliverTo';
import NavTools from './NavTools';
import type { NavCategory } from './types';

/**
 * The header, in one row.
 *
 *   the lockup · | · Catalogue ▾ · Estimator · —— · ⌘K · —— · coins · cart · account
 *
 * It was two rows and 104 px, plus a 40 px category strip under it: 144 px of chrome above every
 * page. The reason was arithmetic rather than taste — Audiowide is a very wide face, the lockup
 * measured 392 px at a 30 px cap, and a lockup plus an 860 px search field cannot share a row. So
 * the mark was cut to 22 px and the store's own name was the least legible thing on the screen.
 *
 * Moving search into a ⌘K overlay (see components/SearchBar.tsx) removes the constraint rather
 * than trading against it. The mark goes to 44 px — a third larger than it has ever been — the
 * category strip folds into the row as a mega menu on "Catalogue", and the whole thing lands at
 * 76 px, condensing to 62 px once the page scrolls under it.
 *
 * It is a floating glass bar, inset from the top edge, not flush chrome. That is a real
 * difference and not a decoration: flush chrome has to be darker than everything to stay
 * separate, which is why the old header carried its own near-black palette and its own two white
 * hairlines. A bar that floats is separated by its edge and its shadow, so it can be the same
 * family of teal as the page and the store stops having two colour systems.
 *
 * Deliver-to keeps its own strip below. It sets the pincode that every price on the site is
 * quoted against, which makes it the one piece of chrome that is worth a line of its own.
 */
export default function Header({
  pincode,
  phone,
  regionName,
  deliveryDays,
  categories,
}: {
  pincode: string;
  phone: string;
  regionName: string;
  deliveryDays: number | null;
  categories: NavCategory[];
}) {
  return (
    <>
      <header className="header" id="top">
        <div className="header-bar">
          <Link href="/" className="header-logo" aria-label="Build Objects home">
            {/* Sized entirely by --wm-size on .header-logo in store.css: 44, stepping down by width. */}
            <Wordmark />
          </Link>
          <span className="header-div" aria-hidden="true" />
          <nav className="header-nav" aria-label="Main">
            <CategoryMenu categories={categories} variant="all" />
            <NavTools />
          </nav>
          {/* TWO spacers, one either side of search: equal flex, so the field lands in the middle
              of the row rather than wherever the left-hand group happens to end. */}
          <span className="header-spacer" />
          <SearchBar categories={categories} />
          <span className="header-spacer" />
          <CartButton />
          <AccountMenu phone={phone} />
        </div>
      </header>
      <div className="deliver-strip">
        <div className="shell">
          <DeliverTo pincode={pincode} regionName={regionName} deliveryDays={deliveryDays} variant="strip" />
        </div>
      </div>
    </>
  );
}
