import Link from 'next/link';
import { Suspense } from 'react';
import BoCoinWheel from '@/components/BoCoinWheel';
import SearchBar from '@/components/SearchBar';
import AccountMenu from './AccountMenu';
import CartButton from './CartButton';
import CategoryMenu from './CategoryMenu';
import DeliverTo from './DeliverTo';
import EstimateButton from './EstimateButton';
import type { NavCategory } from './types';

/**
 * The sticky header: BO Logo · Deliver to · Search · BO Cart · BO Calculator · BO Account.
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
          <Link href="/" className="header-logo" aria-label="Build Objects Home">
            <img src="/logo-mark-128.png" width={32} height={32} alt="" />
            <span className="wordmark">Build Objects</span>
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
