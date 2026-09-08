'use client';

import Link from 'next/link';
import type { CategoryRef } from '@/lib/catalog';
import { CategoryIcon } from './icons';
import { useEdgeFade } from './useEdgeFade';

/**
 * Sideways between the categories that stock something: a scrolling row of chips, the current
 * one selected. Phone and tablet only — above 1024 px the full tree is in the rail beside the
 * results, and two copies of the same navigation on one screen is one too many.
 *
 * Only live categories appear. Thirty-seven chips is not a strip, and twenty-eight of them
 * would lead to a shelf with nothing on it.
 *
 * IT FADES AT THE EDGE IT CONTINUES OVER. On a phone this row is wider than the screen, and it
 * used to end by slicing whichever chip reached the edge — "Solar Pane" — which reads as broken
 * rather than as "swipe for more". See useEdgeFade.ts and `.edge-fade` in theme.css. Being a
 * client component costs nothing here: the markup is the same, and the chips are links either
 * way.
 */
export default function CategoryStrip({ categories, current }: { categories: CategoryRef[]; current?: string }) {
  const live = categories.filter((c) => c.status === 'live');
  const row = useEdgeFade<HTMLElement>();
  return (
    <nav ref={row} className="chip-row edge-fade lg:hidden" aria-label="Categories">
      {live.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`} className="chip" aria-current={c.slug === current ? 'page' : undefined}>
          <CategoryIcon icon={c.icon ?? 'cement'} size={16} /> {c.name}
        </Link>
      ))}
    </nav>
  );
}
