import { redirect } from 'next/navigation';
import Footer from '@/components/Footer';
import Header from '@/components/header/Header';
import NavStrip from '@/components/header/NavStrip';
import Reveal from '@/components/Reveal';
import ScrollProgress from '@/components/ScrollProgress';
import SkipLink from '@/components/SkipLink';
import ToastHost from '@/components/Toast';
import { allCategories } from '@/lib/catalog';
import { loadSession, serviceability } from '@/lib/data';

/**
 * Every page behind the door shares the shell: skip link, the sticky header (deliver-to,
 * search, estimate, account), the category nav strip, main, footer. The proxy already gated
 * the request; this second check covers the case where the proxy matcher is bypassed.
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
      <NavStrip categories={categories} />
      <main id="main">{children}</main>
      <Footer categories={categories} />
      <ToastHost />
    </>
  );
}
