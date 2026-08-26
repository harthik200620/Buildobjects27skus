import type { Metadata } from 'next';
import BoCart from '@/components/cart/BoCart';
import Plate from '@/components/Plate';
import { loadFlagshipSkus } from '@/lib/catalog';
import { loadCalculatorCatalog } from '@/lib/estimator';
import { mediaUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  /* The layout template already appends "· Build Objects" — the old title rendered in the tab as
     "BO Cart — Build Objects Store · Build Objects". */
  title: 'Your cart',
  description: 'The materials you have picked, priced per unit with GST included, and any BO Coins you are putting against the order.',
};

export default async function CartPage() {
  const catalog = await loadCalculatorCatalog([]);

  /*
   * The picture for each line.
   *
   * The cart was the one surface in the store with no product photography on it — a list of
   * names, quantities and figures, which is a receipt rather than a cart. What is missing is
   * exactly what the visitor has been looking at for the whole journey, so it is the SAME
   * picture: the SKU's hero on the same silver plate a card, a search row and the gallery
   * mount it on.
   *
   * It comes down as a map rather than being fetched per line: the cart's contents live in
   * localStorage and the server cannot know them, and twenty-seven keys is smaller than one
   * of the images it names.
   */
  const images = Object.fromEntries((await loadFlagshipSkus()).map((s) => [s.sku_code, s.hero_image_key ? mediaUrl(s.hero_image_key) : null]));

  return (
    <div className="page shell">
      <header className="page-head page-head--plate">
        <Plate name="cart-yard" position="50% 58%" />
        <div className="page-head-in">
          <div>
            {/* "verified dealer prices" was the claim here. They are not verified — several carry
                `price_provenance: 'estimated'`, and the product page each line came from says so
                on the price itself. */}
            <p className="micro sec-eyebrow">Your order</p>
            <h1 className="page-title">Your cart</h1>
            <p className="page-sub estimate-lede">
              Each line is priced per unit with GST included, at the figure on its own product page. BO Coins come off the total at one rupee each.
            </p>
          </div>
        </div>
      </header>
      <BoCart initialCatalog={catalog} images={images} />
    </div>
  );
}
