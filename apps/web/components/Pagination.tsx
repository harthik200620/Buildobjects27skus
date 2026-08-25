import type { FilterState } from '@buildobjects/catalog';
import Link from 'next/link';
import { toQuery } from '@/lib/filters';
import { IconBack, IconChevron } from './icons';

/** Previous · 1 … 4 5 6 … 12 · Next. Keeps `aria-current="page"` and `rel="prev|next"` for crawlers and tests. */
export default function Pagination({
  pathname,
  state,
  page,
  totalPages,
}: {
  pathname: string;
  state: FilterState & { q: string; page: number; category?: string };
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const link = (p: number) => `${pathname}${toQuery({ ...state, page: p })}`;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2);
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? (
        <Link href={link(page - 1)} className="pager-link" rel="prev">
          <IconBack size={16} /> Previous
        </Link>
      ) : (
        <span className="pager-link" aria-disabled="true">
          <IconBack size={16} /> Previous
        </span>
      )}
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && pages[i - 1] !== p - 1 && (
            <span className="pager-gap" aria-hidden="true">
              …
            </span>
          )}
          <Link href={link(p)} className="pager-link fig" aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}>
            {p}
          </Link>
        </span>
      ))}
      {page < totalPages ? (
        <Link href={link(page + 1)} className="pager-link" rel="next">
          Next <IconChevron size={16} />
        </Link>
      ) : (
        <span className="pager-link" aria-disabled="true">
          Next <IconChevron size={16} />
        </span>
      )}
    </nav>
  );
}
