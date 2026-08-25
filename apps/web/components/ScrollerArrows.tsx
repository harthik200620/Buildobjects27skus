'use client';

import React from 'react';
import { IconBack, IconChevron } from './icons';

/**
 * Two arrows that page the sibling `.scroller-track` by 80 % of its width. Each hides when there
 * is nothing further in its direction; CSS hides both on touch, where the rail just swipes.
 */
export default function ScrollerArrows({ label = 'row' }: { label?: string }) {
  const host = React.useRef<HTMLDivElement | null>(null);
  const [state, setState] = React.useState({ left: false, right: false });
  const track = React.useCallback(() => host.current?.parentElement?.querySelector<HTMLElement>('.scroller-track') ?? null, []);

  React.useEffect(() => {
    const el = track();
    if (!el) return;
    const update = () => setState({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [track]);

  const page = (dir: 1 | -1) => {
    const el = track();
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div ref={host} className="scroller-arrows">
      <button type="button" className="scroller-arrow scroller-arrow--l" aria-label={`Scroll ${label} left`} hidden={!state.left} onClick={() => page(-1)}>
        <IconBack size={20} />
      </button>
      <button type="button" className="scroller-arrow scroller-arrow--r" aria-label={`Scroll ${label} right`} hidden={!state.right} onClick={() => page(1)}>
        <IconChevron size={20} />
      </button>
    </div>
  );
}
