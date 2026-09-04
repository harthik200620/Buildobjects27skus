'use client';

import React from 'react';
import { rate, readShopper, SHOPPER_EVENT, toggleLove } from '@/lib/shopper';

/**
 * What this person thinks of this product: stars out of five, and a heart.
 *
 * IT IS THEIRS, AND IT SAYS SO. There is no community rating in this store — nobody has left one,
 * and a number invented to fill the space would be the one thing on a product page that nothing
 * stands behind. So this is labelled "Your rating" and read back only to the person who set it.
 * It is what the "Rating 4.0+" chip filters on, and what the heart feeds to "Loved by friends"
 * once a list is shared.
 *
 * Kept on the device, sent nowhere. See lib/shopper.ts.
 */
const STARS = [1, 2, 3, 4, 5];

export default function YourVerdict({ sku }: { sku: string }) {
  const [stars, setStars] = React.useState(0);
  const [loved, setLoved] = React.useState(false);
  const [hover, setHover] = React.useState(0);

  React.useEffect(() => {
    const read = () => {
      const you = readShopper();
      setStars(you.rated[sku] ?? 0);
      setLoved(Boolean(you.loved[sku]));
    };
    read();
    window.addEventListener(SHOPPER_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(SHOPPER_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, [sku]);

  const shown = hover || stars;

  return (
    <div className="verdict">
      <div className="verdict-stars" role="group" aria-label="Your rating out of five">
        <span className="verdict-label">Your rating</span>
        <div className="verdict-row" onMouseLeave={() => setHover(0)}>
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              className="verdict-star"
              aria-label={`${n} out of 5`}
              aria-pressed={stars === n}
              data-on={n <= shown ? '' : undefined}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              /* Pressing the star you already gave takes the rating off, which is the only way
                 back to "not rated" once you have set one. */
              onClick={() => rate(sku, stars === n ? 0 : n)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M12 3.4l2.6 5.7 6.2.7-4.6 4.2 1.2 6.1L12 17.1l-5.4 3 1.2-6.1-4.6-4.2 6.2-.7z" />
              </svg>
            </button>
          ))}
          <span className="verdict-said fig">{stars ? `${stars}/5` : 'not rated'}</span>
        </div>
      </div>

      <button type="button" className="verdict-love" aria-pressed={loved} onClick={() => toggleLove(sku)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 20.3l-1.5-1.4C5.4 14.3 2.5 11.7 2.5 8.5 2.5 6 4.5 4 7 4c1.7 0 3.3.8 4.3 2.1L12 7l.7-.9C13.7 4.8 15.3 4 17 4c2.5 0 4.5 2 4.5 4.5 0 3.2-2.9 5.8-8 10.4z" />
        </svg>
        {loved ? 'Loved' : 'Love it'}
      </button>
    </div>
  );
}
