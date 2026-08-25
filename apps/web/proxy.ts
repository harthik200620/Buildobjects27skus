import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * The gate. Everything except the front door, auth, media and static assets needs a session.
 * Verification is a signature check — no database on the request path.
 */
const PUBLIC = [
  /^\/welcome(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/health$/,
  /^\/api\/serviceability/,
  /^\/media\//,
  /^\/fonts\//,
  /^\/3d\//,
  /^\/img\//,
  /^\/_next\//,
  /^\/(favicon\.ico|icon\.png|apple-icon\.png|logo-[\w-]+\.png|robots\.txt|manifest\.webmanifest)$/,
];

export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    const res = NextResponse.next();
    res.headers.set('x-bo-region', session.regionId);
    res.headers.set('x-bo-pincode', session.pincode);
    return res;
  }
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/welcome';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
