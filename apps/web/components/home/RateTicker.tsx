import Link from 'next/link';
import { inr } from '@/lib/media';

export interface Rate {
  sku: string;
  name: string;
  brand: string;
  price: number;
  unit: string;
}

/**
 * The rate ticker — a marquee of what things actually cost this morning.
 *
 * WHAT IT DOES NOT CARRY IS THE POINT.
 *
 * The north star draws this with up and down deltas beside each figure, in green and red, the way
 * a commodity board looks. The store has no price history: the catalogue holds one selling price
 * per SKU and the timestamp it was read, and nothing anywhere records what cement cost yesterday.
 * A ± beside a number is a claim about change over time, and inventing one to make a strip look
 * alive is exactly the decorative lie this storefront has spent three passes removing.
 *
 * A percentage off MRP was the obvious substitute and it is worse. It is a real number — the
 * catalogue holds both figures — but printing "−73% off list" beside a bulb turns a strip whose
 * job is "these are today's rates" into a strip that shouts about discounts, on a store whose
 * entire promise is that the price is the price. The MRP comparison belongs on the product card,
 * next to the thing it describes, with the room to say what it means.
 *
 * So the ticker carries brand, name, price and unit, and nothing else. Six real items at their
 * real prices is already the cheapest possible proof the store is alive.
 *
 * The marquee is two identical halves translated -50%, which is what makes the loop seamless. The
 * second half is aria-hidden and out of the tab order so it is furniture, not content. It stops on
 * hover and under prefers-reduced-motion, because text that will not hold still cannot be read.
 */
export default function RateTicker({ rates }: { rates: Rate[] }) {
  if (rates.length === 0) return null;
  const run = (copy: boolean) =>
    rates.map((r) => (
      <Link
        key={`${copy ? 'b' : 'a'}-${r.sku}`}
        href={`/p/${r.sku.toLowerCase()}`}
        className="tick-item"
        aria-hidden={copy || undefined}
        tabIndex={copy ? -1 : undefined}
      >
        <span className="tick-what">
          <span className="tick-brand">{r.brand}</span> {r.name}
        </span>
        <span className="fig tick-price">{inr(r.price)}</span>
        <span className="tick-unit">/ {r.unit}</span>
      </Link>
    ));

  return (
    <div className="tick">
      <p className="tick-head micro micro--live">Today&rsquo;s rates</p>
      <div className="tick-window">
        <div className="tick-track">
          {run(false)}
          {run(true)}
        </div>
      </div>
    </div>
  );
}
