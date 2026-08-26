'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconEstimate, IconRoom } from '@/components/icons';
import { AR_DEMO_HREF } from './types';

/**
 * The two tool links in the bar, beside the catalogue menu.
 *
 * They are a client component only because the current page decides which one is underlined, and
 * `usePathname` is the cheapest way to know. Keeping them out of Header means the header itself
 * stays a server component and the categories it renders are never serialised for the client.
 *
 * The underline is one gesture: a rule that scales in from the left over --dur-3. The page you
 * are on holds it open. Every other accent in the bar was removed to make that one legible.
 */
export default function NavTools() {
  const pathname = usePathname();
  return (
    <>
      <Link href="/estimate" className="navlink" aria-current={pathname.startsWith('/estimate') ? 'page' : undefined}>
        <IconEstimate size={17} />
        Estimator
      </Link>
      <Link href={AR_DEMO_HREF} className="navlink" aria-current={pathname.startsWith('/ar/') ? 'page' : undefined}>
        <IconRoom size={17} />
        See in room
      </Link>
    </>
  );
}
