import Link from 'next/link';
import BoCoinWheel from '@/components/BoCoinWheel';
import SearchBar from '@/components/SearchBar';
import Wordmark from '@/components/Wordmark';
import AccountMenu from './AccountMenu';
import CartButton from './CartButton';
import CategoryMenu from './CategoryMenu';
import DeliverTo from './DeliverTo';
import EstimateButton from './EstimateButton';
import type { NavCategory } from './types';

/**
 * The sticky header, in two rows.
 *
 *   row 1 (56 px)  ≡ · the lockup · Deliver to · ——— · Cart · Estimator · Account
 *   row 2 (48 px)  Search, with the width it needs
 *
 * One row could not hold both a legible logo and a usable search field. Audiowide is a very wide
 * face: at a 30 px cap the lockup measured 392 px and squeezed search — the store's most-used
 * control — down to 210 px, which is why the mark spent months at 22 px and was hard to read.
 * Two rows end the argument: the lockup gets 34 px and search gets its full 860 px.
 *
 * The mechanism is the one the mobile header already used — `flex-wrap` on `.header-in` with the
 * search field at `flex-basis: 100%` — so phones and desktops now run the same layout rather than
 * two that have to be kept in step.
 *
 * Search sits last in the DOM because it sits last on the screen; a tab order that jumps up to
 * row 1 after row 2 is the kind of thing that only shows up on a keyboard.
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
        <div className="header-in shell">
          <CategoryMenu categories={categories} variant="icon" />
          <Link href="/" className="header-logo" aria-label="Build Objects home">
            {/* Sized entirely by --wm-size on .header-logo in store.css: 34 / 28 / 26 by width. */}
            <Wordmark />
          </Link>
          <DeliverTo pincode={pincode} regionName={regionName} deliveryDays={deliveryDays} variant="header" />
          <div className="header-spacer" />
          <CartButton />
          <EstimateButton />
          <AccountMenu phone={phone} />
          <SearchBar categories={categories} />
        </div>
      </header>
      <div className="deliver-strip">
        <div className="shell">
          <DeliverTo pincode={pincode} regionName={regionName} deliveryDays={deliveryDays} variant="strip" />
        </div>
      </div>
      <BoCoinWheel />
    </>
  );
}
