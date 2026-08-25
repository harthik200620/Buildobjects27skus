import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { serviceability } from '@/lib/data';
import { cookieOptions, SESSION_COOKIE, signSession, verifySession } from '@/lib/session';

export async function GET() {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return NextResponse.json({ authenticated: false }, { status: 401 });
  const svc = await serviceability(claims.pincode);
  return NextResponse.json({ authenticated: true, phone: claims.phone, regionId: claims.regionId, pincode: claims.pincode, serviceability: svc });
}

/** Change the delivery pincode for this session (re-signs the cookie). */
export async function PATCH(req: Request) {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const pincode = String(body.pincode ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(pincode)) return NextResponse.json({ error: 'Enter a 6-digit pincode' }, { status: 400 });
  const svc = await serviceability(pincode);
  const token = await signSession({ ...claims, pincode, regionId: svc.regionId ?? claims.regionId });
  const res = NextResponse.json({ ok: true, pincode, serviceability: svc });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
}
