'use client';

import type React from 'react';

/**
 * THE BALANCE, AS AN ODOMETER.
 *
 * The old balance was one `<p>` whose text was rewritten sixty times a second from a rAF. It
 * counted, and counting is not MOVING: every frame replaced the whole string, so digits that were
 * not changing flickered along with the ones that were, and the figure never held still enough to
 * read while it ran.
 *
 * A real odometer moves only the wheels that have to. Each digit is a column of ten glyphs behind a
 * one-glyph window, translated by `-n × 100%`; the CSS transition interpolates on the compositor,
 * so the whole thing is one style write per digit per change and zero work per frame. 4 → 5 turns
 * one wheel; 99 → 100 turns three and grows a fourth.
 *
 * AND IT ROLLS THE RIGHT WAY — up when you gain, which sounds obvious and is the detail everything
 * of this kind gets wrong: `translateY` DOWN the strip shows a HIGHER digit, because the strip runs
 * 0-9 top to bottom. A wheel spinning the wrong way would read as losing coins on the one screen
 * whose entire job is to say you have won some.
 *
 * Digits are tabular figures at a fixed `ch` width, so the frame does not twitch as the wheels
 * pass through 1.
 */

export interface OdometerProps {
  value: number;
  /** Digits to pad to, so a balance rolling 95 → 135 does not jump width mid-roll. */
  min?: number;
  className?: string;
  'aria-label'?: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export default function Odometer({ value, min = 1, className, 'aria-label': label }: OdometerProps) {
  const safe = Math.max(0, Math.round(value));
  const text = String(safe).padStart(min, '0');

  /* The wheels stagger: the units wheel starts first and each one above it a beat later, which is
     what a mechanical counter does and what makes 199 → 200 read as a carry rather than a jump. */
  return (
    <span className={className ? `odo ${className}` : 'odo'} role="img" aria-label={label ?? `${safe}`}>
      {text.split('').map((d, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the wheel's identity — a digit's position is what makes it the tens wheel rather than the units
          key={i}
          className="odo-wheel"
          style={{ '--n': Number(d), '--i': text.length - 1 - i } as React.CSSProperties}
        >
          <span className="odo-strip">
            {DIGITS.map((g) => (
              <span key={g} className="odo-d">
                {g}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
