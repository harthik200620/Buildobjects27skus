import { redirect } from 'next/navigation';
import ChatPanel from '@/components/ChatPanel';
import Footer from '@/components/Footer';
import Header from '@/components/header/Header';
import Reveal from '@/components/Reveal';
import ScrollProgress from '@/components/ScrollProgress';
import SkipLink from '@/components/SkipLink';
import ToastHost from '@/components/Toast';
import { allCategories } from '@/lib/catalog';
import { loadSession, serviceability } from '@/lib/data';

/**
 * Every page behind the door shares the shell: skip link, the floating header bar, the
 * deliver-to strip, main, footer. The proxy already gated the request; this second check covers
 * the case where the proxy matcher is bypassed.
 *
 * The 40 px category strip that used to sit under the header is gone — the catalogue tree it
 * carried is the header's own mega menu now, and two rows of navigation for one taxonomy was the
 * chrome equivalent of saying everything twice.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await loadSession();
  if (!session) redirect('/welcome');
  const [svc, cats] = await Promise.all([serviceability(session.pincode), allCategories()]);
  const categories = cats.map((c) => ({ slug: c.slug, name: c.name, nameTe: c.nameTe, icon: c.icon, department: c.department, status: c.status }));
  return (
    <>
      <SkipLink />
      <ScrollProgress />
      <Reveal />
      <Header pincode={session.pincode} phone={session.phone} regionName={svc.name} deliveryDays={svc.deliveryDays} categories={categories} />
      <main id="main">{children}</main>
      <Footer categories={categories} />
      {/* The assistant docks to the corner of every page inside the store, because the question it
          answers — "what does this cost" — is one people have while looking at something else. */}
      <ChatPanel />
      <ToastHost />
    </>
  );
}
