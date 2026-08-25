import Link from 'next/link';
import { Suspense } from 'react';
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
 * The sticky header: BO Logo · Deliver to · Search · BO Cart · BO Estimator · BO Account.
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
            {/* 22, not 30. Audiowide is a very wide face: at a 30 px cap the lockup measured 392 px and
              squeezed the search field — the store's most-used control — down to 210 px. The rule
              that the capitals match the mark is kept; the whole lockup is just smaller here. */}
            <Wordmark size={22} />
          </Link>
          <DeliverTo pincode={pincode} regionName={regionName} deliveryDays={deliveryDays} variant="header" />
          <Suspense fallback={<div className="search" aria-hidden="true" />}>
            <SearchBar categories={categories} />
          </Suspense>
          <CartButton />
          <EstimateButton />
          <AccountMenu phone={phone} />
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
