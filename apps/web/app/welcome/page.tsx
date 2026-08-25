import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WelcomeGate from '@/components/WelcomeGate';
import { loadRegions } from '@/lib/data';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

export const metadata: Metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const jar = await cookies();
  if (await verifySession(jar.get(SESSION_COOKIE)?.value)) redirect('/');
  const { next } = await searchParams;
  const regions = await loadRegions();
  /* The seg control fits three names; the pincode field accepts any AP/TS pincode. */
  const shown = regions.filter((r) => ['hyd', 'vij', 'vizag'].includes(r.region_id));
  return <WelcomeGate regions={shown.length ? shown : regions} next={next?.startsWith('/') ? next : '/'} />;
}
