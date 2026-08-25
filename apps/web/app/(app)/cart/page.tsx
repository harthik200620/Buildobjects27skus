import type { Metadata } from 'next';
import BoCart from '@/components/cart/BoCart';
import { loadCalculatorCatalog } from '@/lib/estimator';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  /* The layout template already appends "· Build Objects" — the old title rendered in the tab as
     "BO Cart — Build Objects Store · Build Objects". */
  title: 'Your cart',
  description: 'The materials you have picked, priced per unit with GST included, and any BO Coins you are putting against the order.',
};

export default async function CartPage() {
  const catalog = await loadCalculatorCatalog([]);

  return (
    <div className="page shell">
      <header className="page-head">
        {/* "verified dealer prices" was the claim here. They are not verified — several carry
            `price_provenance: 'estimated'`, and the product page each line came from says so on
            the price itself. */}
        <p className="kicker">Your order</p>
        <h1 className="display page-title">Your cart</h1>
        <p className="page-sub estimate-lede">
          Each line is priced per unit with GST included, at the figure on its own product page. BO Coins come off the total at one rupee each.
        </p>
      </header>
      <BoCart initialCatalog={catalog} />
    </div>
  );
}
