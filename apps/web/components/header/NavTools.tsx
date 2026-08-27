'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconEstimate } from '@/components/icons';

/**
 * The tool link in the bar, beside the catalogue menu.
 *
 * "See in room" used to sit here too and does not any more. A room view is of A PRODUCT — it needs
 * a SKU to stand in the room — and the chrome has no product, so the link pointed at a hardcoded
 * cement bag. Offering to show a visitor "your room" and then arriving on somebody else's cement
 * is not a feature, it is a demo wired into the masthead. Every real entry point is on a product:
 * the card's "View in room", the gallery's tabs, the buy panel, and the product page's own band.
 *
 * It is a client component only because the current page decides which link is underlined, and
 * `usePathname` is the cheapest way to know. Keeping it out of Header means the header itself
 * stays a server component and the categories it renders are never serialised for the client.
 *
 * The underline is one gesture: a rule that scales in from the left over --dur-3. The page you
 * are on holds it open. Every other accent in the bar was removed to make that one legible.
 */
export default function NavTools() {
  const pathname = usePathname();
  return (
    <Link href="/estimate" className="navlink" aria-current={pathname.startsWith('/estimate') ? 'page' : undefined}>
      <IconEstimate size={17} />
      Estimator
    </Link>
  );
}
