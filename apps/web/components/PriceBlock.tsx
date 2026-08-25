import { inr, pctOff } from '@/lib/media';

/**
 * The one way a price is written: a small ₹, the integer in 700, the unit after it ("/bag"),
 * then M.R.P. struck through with the saving beside it, the GST line, and either the "Estimated
 * price" badge or the source host and date.
 *
 * Sizes map to the class contract's `.price--*`: card 20 · row 18 · buybox 24 · pdp 28 · hero 32.
 */
export type PriceSize = 'card' | 'row' | 'buybox' | 'pdp' | 'hero';

/** Built once; `toLocaleString` constructs a formatter per call and a listing renders dozens. */
const whole = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian grouping, integer and paise split so they can be set at different sizes. */
export function splitInr(n: number): { int: string; dec: string | null } {
  const abs = Math.abs(n);
  const hasPaise = Math.round(abs * 100) % 100 !== 0;
  const [int, dec] = (hasPaise ? withPaise : whole).format(abs).split('.');
  return { int: (n < 0 ? '-' : '') + int, dec: dec ?? null };
}

export function Price({ value, unit, size = 'card', className = '' }: { value: number; unit?: string | null; size?: PriceSize; className?: string }) {
  const { int, dec } = splitInr(value);
  return (
    <span className={`price price--${size} ${className}`.trim()}>
      <span className="price-sym">₹</span>
      <span className="price-int">{int}</span>
      {dec && <span className="price-dec">.{dec}</span>}
      {unit && <span className="price-unit">/{unit}</span>}
    </span>
  );
}

export interface PriceBlockProps {
  price: number | null | undefined;
  mrp?: number | null;
  unit?: string | null;
  packQty?: number | null;
  gstRate?: number | null;
  /** `fetched` | `verified` | `estimated` — estimated shows the warn badge, the others show the source line when a host is given. */
  provenance?: string | null;
  sourceHost?: string | null;
  dated?: string | null;
  size?: PriceSize;
  showGst?: boolean;
  showUnit?: boolean;
  className?: string;
}

export default function PriceBlock({
  price,
  mrp,
  unit,
  packQty,
  gstRate,
  provenance,
  sourceHost,
  dated,
  size = 'card',
  showGst = false,
  showUnit = true,
  className = '',
}: PriceBlockProps) {
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  // Null unless there is a real saving to state — pctOff already rejects an MRP at or below price.
  const off = hasPrice ? pctOff(mrp, price) : null;
  return (
    <div className={`price-block price-block--${size} ${className}`.trim()}>
      {hasPrice ? (
        <Price value={price} unit={showUnit ? unit : null} size={size} />
      ) : (
        <span className={`price price--${size} price--na`}>Price on request</span>
      )}
      {off !== null && mrp != null && (
        <span className="price-mrp">
          M.R.P. <s>{inr(mrp)}</s> <span className="price-off">({off}% off)</span>
        </span>
      )}
      {hasPrice && showGst && (
        <span className="price-gst">
          {gstRate != null ? `Inclusive of ${gstRate}% GST` : 'Inclusive of GST'}
          {packQty && packQty > 1 ? ` · pack of ${packQty}` : ''}
        </span>
      )}
      {provenance === 'estimated' ? (
        <span className="badge-estimated">Estimated price</span>
      ) : sourceHost ? (
        <span className="price-src">
          {provenance === 'verified' ? 'Verified at' : 'Fetched from'} {sourceHost}
          {dated ? ` · ${dated}` : ''}
        </span>
      ) : null}
    </div>
  );
}
