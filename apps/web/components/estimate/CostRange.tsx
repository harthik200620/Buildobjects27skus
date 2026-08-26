import { inr } from '@/lib/media';

/**
 * Floor, now, ceiling — the estimate's honest span, as one bar.
 *
 * The calculator has always known this number. `accuracy.pct` is 12, and the sentence under the
 * total has always said "Estimate ±12%". A sentence is a thing you read once and forget; a bar
 * with your figure sitting on it is a thing you cannot stop seeing, and what it says is the most
 * important caveat on the page: this is a range, and the single large number above it is the
 * middle of that range rather than a quote.
 *
 * Nothing here is new information and nothing is invented — the two ends are the total ± the
 * model's own published accuracy, and they are labelled as such. Putting the marker at the exact
 * centre is honest for the same reason: the band is symmetric, so a marker anywhere else would be
 * implying a skew the model does not claim.
 */
export default function CostRange({ total, pct }: { total: number; pct: number }) {
  const floor = Math.round(total * (1 - pct / 100));
  const ceiling = Math.round(total * (1 + pct / 100));

  return (
    <div className="range" aria-hidden="true">
      <div className="range-bar">
        <span className="range-mark" />
      </div>
      <div className="range-ends">
        <span>
          <b className="micro">Floor</b>
          <span className="fig">{inr(floor)}</span>
        </span>
        <span className="range-mid">
          <b className="micro">Likely</b>
          <span className="fig">{inr(total)}</span>
        </span>
        <span className="range-top">
          <b className="micro">Ceiling</b>
          <span className="fig">{inr(ceiling)}</span>
        </span>
      </div>
    </div>
  );
}
