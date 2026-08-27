import type { Metadata } from 'next';
import WelcomeGate from '@/components/WelcomeGate';
import { loadRegions } from '@/lib/data';

export const metadata: Metadata = { title: 'Welcome' };

/**
 * The front door, and the only page in the store that is a plain static document.
 *
 * It reads no cookie and takes no search param, so Next prerenders it at build time and the CDN
 * answers every first-ever visit from the edge. That is the whole point: this is the page a
 * visitor with no session sees, which means it is the page that gets the cold start, and a cold
 * start measured 5.4 s to first byte on production. A static document has none.
 *
 * Two things used to make it dynamic and both moved rather than being dropped:
 *   - the "already signed in, go home" redirect is in proxy.ts, which was reading that same
 *     cookie on the same request anyway;
 *   - `?next=` is read on the client by WelcomeGate, because a query string is not part of a
 *     prerendered document. It is only ever used to build the post-sign-in destination, and
 *     WelcomeGate already validates it.
 */
export const revalidate = 3600;

export default async function WelcomePage() {
  const regions = await loadRegions();
  /* The seg control fits three names; the pincode field accepts any AP/TS pincode. */
  const shown = regions.filter((r) => ['hyd', 'vij', 'vizag'].includes(r.region_id));
  return <WelcomeGate regions={shown.length ? shown : regions} />;
}
