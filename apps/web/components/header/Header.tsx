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
 * It was two rows at 104px plus a 40px category strip: 144px of chrome above every page, for a
 * reason that was arithmetic rather than taste. Audiowide is very wide — the lockup measured 392px
 * at a 30px cap — and a lockup plus an 860px search field cannot share a row, so the mark was cut
 * to 22px and the store's own name was the least legible thing on the screen. Moving search into a
 * ⌘K overlay (components/SearchBar.tsx) removes the constraint instead of trading against it: the
 * mark goes to 44px, the strip folds into "Catalogue" as a mega menu, and the bar lands at 76px,
 * condensing to 62px once the page scrolls under it.
 *
 * It floats, inset from the top edge. Flush chrome has to be darker than everything to stay
 * separate, which is why the old header carried its own near-black palette and two white
 * hairlines; a bar separated by its edge and its shadow can be the page's own teal, so the store
 * stops having two colour systems. Deliver-to keeps its own strip below — it sets the pincode
 * every price on the site is quoted against.
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
