import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import BoPassport from '@/components/account/BoPassport';
import Plate from '@/components/Plate';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your BO Passport',
  description: 'Your Build Objects builder identity — name, address, contact and passport number, held in this browser.',
};

/**
 * The account page, and the only thing on it is the passport.
 *
 * The account has been a header MENU up to now — a name, a coin balance and three links. That is
 * the right shape for something you reach for mid-task and the wrong shape for something you
 * read, and the passport is something you read: eight fields, a photograph and a number.
 *
 * The session is verified here rather than trusted from the client because the passport NUMBER is
 * derived from it. A number derived from a claim the browser makes about itself is a number
 * anybody can mint by editing localStorage.
 */
export default async function AccountPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) redirect('/welcome');

  return (
    <div className="page shell">
      <header className="page-head page-head--plate">
        <Plate name="interior-warm" position="50% 55%" />
        <div className="page-head-in">
          <div>
            <p className="micro sec-eyebrow">Your account</p>
            <h1 className="page-title">BO Passport</h1>
            <p className="page-sub estimate-lede">
              Your builder identity at Build Objects. The number is yours for good — it is worked out from the account itself, not stored, so it is the same on
              every device you sign in from.
            </p>
          </div>
        </div>
      </header>

      <section className="account-main" aria-label="BO Passport">
        <BoPassport uid={session.uid} phone={session.phone} />
      </section>
    </div>
  );
}
