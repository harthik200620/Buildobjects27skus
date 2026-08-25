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

  const db = getDb();
  let uid = 0;
  const sid = randomBytes(24).toString('base64url');
  try {
    const known = await db.select({ regionId: regions.regionId }).from(regions).where(eq(regions.regionId, regionId)).limit(1);
    if (!known.length) regionId = pincode.startsWith('50') ? 'hyd' : 'vij';
    await db
      .insert(users)
      .values({ phone, lastLoginAt: new Date() })
      .onDuplicateKeyUpdate({ set: { lastLoginAt: new Date() } });
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    uid = u?.id ?? 0;
    await db.insert(sessions).values({ id: sid, userId: uid, regionId, pincode, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) });
  } catch (e) {
    console.warn('[auth/login] db unavailable, issuing stateless session:', (e as Error).message);
  }

  const token = await signSession({ sid, uid, phone, regionId, pincode });
  const res = NextResponse.json({ ok: true, regionId, pincode });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
