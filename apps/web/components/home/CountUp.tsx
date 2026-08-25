'use client';

import React from 'react';

/**
 * A number that counts up to its value the first time it is scrolled into view.
 *
 * The server renders the final figure as the element's text, so the correct number is in the
 * HTML, in the accessibility tree and in the page source before any script runs — this only ever
 * animates a number that is already there. If JS never arrives, or the reader has asked for no
 * motion, the figure simply sits at its value.
 *
 * `tabular-nums` on the class is what makes it usable: without it the box changes width on almost
 * every frame and drags the words after it around the line.
 */
export default function CountUp({ to, duration = 900, className = 'fig' }: { to: number; duration?: number; className?: string }) {
  const ref = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (to <= 0) return;

    let frame = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const run = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          /* Ease-out cubic: fast at the top, settling onto the real figure rather than
             arriving at it at full speed and stopping dead. */
          const eased = 1 - (1 - t) ** 3;
          el.textContent = String(Math.round(eased * to));
          if (t < 1) frame = requestAnimationFrame(run);
        };
        frame = requestAnimationFrame(run);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {to}
    </span>
  );
}
