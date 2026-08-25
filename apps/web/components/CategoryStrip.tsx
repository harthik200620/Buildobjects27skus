import Link from 'next/link';
import type { CategoryRef } from '@/lib/catalog';
import { CategoryIcon } from './icons';

/**
 * Sideways between the categories that stock something: a scrolling row of chips, the current
 * one selected. Phone and tablet only — above 1024 px the full tree is in the rail beside the
 * results, and two copies of the same navigation on one screen is one too many.
 *
 * Only live categories appear. Thirty-seven chips is not a strip, and twenty-eight of them
 * would lead to a shelf with nothing on it.
 */
export default function CategoryStrip({ categories, current }: { categories: CategoryRef[]; current?: string }) {
  const live = categories.filter((c) => c.status === 'live');
  return (
    <nav className="chip-row lg:hidden" aria-label="Categories">
      {live.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`} className="chip" aria-current={c.slug === current ? 'page' : undefined}>
          <CategoryIcon icon={c.icon ?? 'cement'} size={16} /> {c.name}
        </Link>
      ))}
    </nav>
  );
}
