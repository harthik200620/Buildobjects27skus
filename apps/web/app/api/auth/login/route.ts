import { randomBytes } from 'node:crypto';
import { getDb, regions, sessions, users } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { ensurePgSchema, getPg, hasPg, pgSessions, pgUsers } from '@/lib/pg-store';
import { cookieOptions, SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/session';

/**
 * The serviceable regions without asking the database for them.
 *
 * `regions` is catalogue data, and the catalogue is no longer a table the storefront needs — so
 * a deployment with only a runtime store still has to decide which of the six a pincode belongs
 * to. 50xxxx is Telangana, everything else in range is Andhra Pradesh; anything finer than that
 * is what the seeded table is for.
 */
const REGIONS = new Set(['hyd', 'vij', 'vizag', 'wgl', 'gnt', 'tpt']);
function knownRegion(regionId: string, pincode: string): string {
  return REGIONS.has(regionId) ? regionId : pincode.startsWith('50') ? 'hyd' : 'vij';
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? '').replace(/\D/g, '');
  const otp = String(body.otp ?? '').replace(/\D/g, '');
  const pincode = String(body.pincode ?? '').replace(/\D/g, '');
  let regionId = String(body.regionId ?? 'hyd');

  if (!/^[6-9]\d{9}$/.test(phone)) return NextResponse.json({ error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 });
  if (otp !== '000000') return NextResponse.json({ error: 'That code did not match. Demo code is 000000.' }, { status: 401 });
  if (!/^5[0-3]\d{4}$/.test(pincode))
    return NextResponse.json(
      { error: 'We do not deliver to that pincode yet. Today we cover Andhra Pradesh and Telangana — pincodes 50xxxx to 53xxxx.' },
      { status: 400 },
    );

  let uid = 0;
  const sid = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  /*
   * Three ways to sign someone in, in the order of how much they persist.
   *
   * Postgres is what a deployment has (Vercel + Supabase); MySQL is what a machine running the
   * pipeline has; a signed cookie is what is left when neither answers. All three produce the
   * same session — the JWT is self-contained, so the row is for audit and logout, not for auth —
   * which is why a database outage costs you the audit trail and not the sign-in.
   *
   * `getDb()` is inside the try on purpose: `databaseUrl()` throws synchronously when nothing is
   * configured, and when it threw outside the try this handler returned an empty body and the
   * sign-in screen said "Unexpected end of JSON input".
   */
  try {
    if (hasPg()) {
      await ensurePgSchema();
      const db = getPg();
      regionId = knownRegion(regionId, pincode);
      const [u] = await db
        .insert(pgUsers)
        .values({ phone, lastLoginAt: new Date() })
        .onConflictDoUpdate({ target: pgUsers.phone, set: { lastLoginAt: new Date() } })
        .returning({ id: pgUsers.id });
      uid = u?.id ?? 0;
      await db.insert(pgSessions).values({ id: sid, userId: uid, regionId, pincode, expiresAt });
    } else {
      const db = getDb();
      const known = await db.select({ regionId: regions.regionId }).from(regions).where(eq(regions.regionId, regionId)).limit(1);
      if (!known.length) regionId = knownRegion(regionId, pincode);
      await db
        .insert(users)
        .values({ phone, lastLoginAt: new Date() })
        .onDuplicateKeyUpdate({ set: { lastLoginAt: new Date() } });
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      uid = u?.id ?? 0;
      await db.insert(sessions).values({ id: sid, userId: uid, regionId, pincode, expiresAt });
    }
  } catch {
    /* Nothing persisted: the session is a signed JWT, so it needs no row to be valid. */
    regionId = knownRegion(regionId, pincode);
  }

  /* An unconfigured deployment has no key to sign with, and lib/session.ts refuses to fall back
     to the one in the repository. Say so with a status a caller can act on rather than a 500. */
  let token: string;
  try {
    token = await signSession({ sid, uid, phone, regionId, pincode });
  } catch {
    return NextResponse.json({ error: 'Sign-in is unavailable: this deployment has no SESSION_SECRET.' }, { status: 503 });
  }
  const res = NextResponse.json({ ok: true, regionId, pincode });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
