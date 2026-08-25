import Link from 'next/link';
import { IconChevron } from './icons';

export interface Crumb {
  label: string;
  /** Omitted on the last crumb — the page you are already on is not a link to itself. */
  href?: string;
}

/**
 * The trail at the top of a category, product or room-view page.
 *
 * Four pages each wrote this out by hand as `<nav className="crumbs text-[12px] mt-5">` with a
 * `<span className="mx-2" style={{ color: 'var(--ink-3)' }}>/</span>` between every pair — the
 * same six lines, four times, with the separator's colour set inline in each of them. It is one
 * component now, and the separator is a drawn chevron rather than a typed slash, so it takes the
 * ink colour and the stroke weight of everything else in the chrome.
 *
 * `aria-current="page"` on the last crumb is what tells a screen reader the trail has ended;
 * without it the final item reads as one more link that happens not to be a link.
 */
export default function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => (
          <li key={c.href ?? c.label}>
            {i > 0 && <IconChevron size={13} className="crumb-sep" />}
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
