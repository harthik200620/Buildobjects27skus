import type { SkuSearchDoc } from '@buildobjects/catalog';
import Link from 'next/link';
import type React from 'react';
import { skuTitle } from '@/lib/label';
import { mediaUrl } from '@/lib/media';
import { plateFor } from '@/lib/plate';
import AddToEstimate from './AddToEstimate';
import Highlight from './Highlight';
import Img from './Img';
import PriceBlock from './PriceBlock';

/**
 * The product card. Seven decisions, all of them documented next to the rules that implement
 * them in store.css: a 4:3.3 photograph on a silver plate with a floor shadow under it, the brand
 * as a tracked micro eyebrow, a title with 44 px reserved so a two-line name does not shift the
 * price, one 34 px teal rule that draws in on hover, the spec line, the price block, the
 * "Estimated price" badge when the price is not fetched, the delivery line when the page knows
 * the pincode, stock as coloured text, and a CTA row that takes zero height until the card is
 * hovered or focused.
 *
 *   grid     — the PLP / search grid and "similar" rows
 *   row      — a 220 px card for scroll-snap rails (home)
 *   compact  — a 64 px thumb + title + price (compare, estimate picks)
 *
 * `highlight` renders Meilisearch's `_formatted.name` (its only markup is `<mark class="hl">`).
 */
export type ProductCardVariant = 'grid' | 'row' | 'compact';
type Doc = SkuSearchDoc & { _formatted?: { name?: string } };

const STOCK: Record<SkuSearchDoc['stock'], { label: string; cls: string }> = {
  in_stock: { label: 'In stock', cls: 'stock--in' },
  low: { label: 'Only a few left', cls: 'stock--low' },
  preorder: { label: 'Pre-order', cls: 'stock--preorder' },
  out_of_stock: { label: 'Currently unavailable', cls: 'stock--out' },
};

export default function ProductCard({
  sku,
  priority = false,
  highlight = false,
  variant = 'grid',
  deliverBy = null,
  className = '',
}: {
  sku: SkuSearchDoc;
  priority?: boolean;
  highlight?: boolean;
  variant?: ProductCardVariant;
  /** A formatted date from lib/delivery `deliverBy()`; omitted on static pages. */
  deliverBy?: string | null;
  className?: string;
}) {
  const href = `/p/${sku.sku_code.toLowerCase()}`;
  const formatted = highlight ? (sku as Doc)._formatted?.name : undefined;
  const specs = (sku.card_specs ?? [])
    .map((c) => c.value)
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');
  const stock = STOCK[sku.stock] ?? STOCK.in_stock;
  const img = sku.hero_image_key ? mediaUrl(sku.hero_image_key) : null;
  const compact = variant === 'compact';
  const sizes = compact ? '64px' : variant === 'row' ? '220px' : '(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 300px';

  return (
    /* `data-reveal` is the whole opt-in: components/Reveal.tsx finds it, and the stagger's own
       delay comes off `--i`, which .stagger sets per position in store.css. No prop, no import,
       no client boundary — a card that arrives is still a server component. */
    <article className={`prod-card prod-card--${variant} ${className}`.trim()} data-sku={sku.sku_code} data-reveal="scale">
      {/* The mount behind the photograph is the colour the photograph is ON — sampled from its own
          border by scripts/blend-skus.mts. Seventeen suppliers shot on the shared silver, seven
          shipped artwork already on dark teal, and three on something else entirely; painting each
          one its own colour is what leaves no rectangle anywhere in the catalogue. */}
      <div className="prod-media" style={plateFor(sku.sku_code) ? ({ '--plate': plateFor(sku.sku_code) } as React.CSSProperties) : undefined}>
        {img ? (
          <Img src={img} alt="" width={480} height={480} sizes={sizes} priority={priority} blurhash={sku.blurhash} />
        ) : (
          <div className="prod-noimg">
            <b>{sku.brand}</b>
            <span>Photo pending from {sku.brand}</span>
          </div>
        )}
        {!compact && sku.price_provenance === 'estimated' && <span className="badge-estimated">Estimated price</span>}
      </div>
      <div className="prod-body">
        {!compact && <span className="prod-brand">{sku.brand}</span>}
        {/* The brand chip above has already said "UltraTech Cement", and the search index glues
            `variant_label` onto `name` — so printing `name` whole under it gave every card the
            brand twice and the pack size twice. lib/label strips both back off for display; the
            full string stays on the link as its title, and a search hit still highlights against
            the untouched `name`. */}
        <h3 className="prod-title">
          <Link href={href} title={sku.name}>
            <Highlight formatted={formatted} fallback={compact ? sku.name : skuTitle(sku.name, sku.brand, sku.variant_label)} />
          </Link>
        </h3>
        {/* The card's one accent gesture — see .prod-rule in store.css. It is decorative
            and carries no information, so it is hidden from assistive tech. */}
        {!compact && <span className="prod-rule" aria-hidden="true" />}
        {!compact && specs && (
          <p className="prod-specs" title={specs}>
            {specs}
          </p>
        )}
        <PriceBlock
          price={sku.selling_price}
          mrp={compact ? null : sku.mrp}
          unit={sku.unit}
          packQty={sku.pack_qty}
          size={variant === 'grid' ? 'card' : 'row'}
        />
        {!compact && deliverBy && (
          <p className="deliver">
            Get it by <b>{deliverBy}</b>
          </p>
        )}
        <p className={`stock ${stock.cls}`}>{stock.label}</p>
        {/* Three elements, and each one does exactly one job — the grid that animates, the
            clip that hides, and the row that lays out and carries the gap. See .prod-cta in
            store.css for why the gap cannot live on the clip. */}
        {!compact && (
          <div className="prod-cta">
            <div className="prod-cta-clip">
              <div className="prod-cta-row">
                <AddToEstimate skuCode={sku.sku_code} size="sm" />
                {sku.ar && (
                  <Link href={`/ar/${sku.sku_code.toLowerCase()}`} className="btn btn-tertiary btn--sm">
                    View in room
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
