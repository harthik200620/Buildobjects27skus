import type { Metadata } from 'next';
import BoCart from '@/components/cart/BoCart';
import { loadCalculatorCatalog } from '@/lib/estimator';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'BO Cart — Build Objects Store',
  description: 'Your BO Cart with live product pricing and BO Coins redemption discounts.',
};

export default async function CartPage() {
  const catalog = await loadCalculatorCatalog([]);

  return (
    <div className="page shell">
      <header className="page-head">
        <p className="kicker">BO Commerce · Andhra Pradesh & Telangana</p>
        <h1 className="display page-title">BO Cart & Materials</h1>
        <p className="page-sub max-w-[60ch]">
          Review your selected building materials at verified dealer prices with transparent GST. Redeem your earned BO Coins for instant discounts (1 BO Coin =
          ₹1).
        </p>
      </header>
      <BoCart initialCatalog={catalog} />
    </div>
  );
}
