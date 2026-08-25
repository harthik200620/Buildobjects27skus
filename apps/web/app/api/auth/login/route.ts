import { randomBytes } from 'node:crypto';
import { getDb, regions, sessions, users } from '@buildobjects/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { cookieOptions, SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/session';

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
  /*
   * `getDb()` belongs INSIDE the try.
   *
   * It was outside it, and `databaseUrl()` throws synchronously when DATABASE_URL is unset — so
   * on a deployment with no database the handler threw before it could return anything, the
   * response body was empty, and the sign-in screen showed "Unexpected end of JSON input"
   * instead of signing anyone in. The catch below was already written to issue a stateless
   * session; it just never got the chance to run.
   */
  try {
    const db = getDb();
    const known = await db.select({ regionId: regions.regionId }).from(regions).where(eq(regions.regionId, regionId)).limit(1);
    if (!known.length) regionId = pincode.startsWith('50') ? 'hyd' : 'vij';
    await db
      .insert(users)
      .values({ phone, lastLoginAt: new Date() })
      .onDuplicateKeyUpdate({ set: { lastLoginAt: new Date() } });
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    uid = u?.id ?? 0;
    await db.insert(sessions).values({ id: sid, userId: uid, regionId, pincode, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) });
  } catch {
    /* No database: the session is a signed JWT, so it needs nothing persisted to be valid.
       Pick the region from the pincode the way the seeded table would have. */
    if (regionId !== 'hyd' && regionId !== 'vij') regionId = pincode.startsWith('50') ? 'hyd' : 'vij';
  }

  const token = await signSession({ sid, uid, phone, regionId, pincode });
  const res = NextResponse.json({ ok: true, regionId, pincode });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
