import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * The gate. Everything except the front door, auth, media and static assets needs a session.
 * Verification is a signature check — no database on the request path.
 */
/** The one public page with a session rule of its own — see the note in `proxy` below. */
const WELCOME = /^\/welcome(\/|$)/;

const PUBLIC = [
  WELCOME,
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

  /*
   * THE FRONT DOOR SENDS SIGNED-IN VISITORS HOME FROM HERE, NOT FROM THE PAGE.
   *
   * /welcome used to do this itself, and doing it there cost the store its only cacheable page.
   * A page that reads a cookie is `force-dynamic` by definition, so every first-ever visit —
   * the one where nothing is warm, nothing is cached and there is no session to read — waited on
   * a serverless cold start. Measured on production: 6.7 s to load, 5.4 s of it before the first
   * byte, against ~1.2 s for the warm routes behind the gate.
   *
   * The cookie is already being read on this request. Deciding here costs nothing extra and
   * leaves /welcome a static document the CDN can answer from, which is what a landing page
   * should be.
   */
  if (WELCOME.test(pathname)) {
    if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) {
      const url = req.nextUrl.clone();
      /* `?next=` is where the gate was heading before it asked for a pincode — honour it. */
      const next = req.nextUrl.searchParams.get('next');
      url.pathname = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

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

/**
 * Everything the gate has no opinion about is excluded here rather than waved through inside the
 * function, because a `NextResponse.next()` still costs an edge invocation and these are the
 * highest-volume requests the store makes. One home page is thirty-five category images; running
 * the session check thirty-five times to conclude "this is a picture" is thirty-five round trips
 * of latency for nothing.
 *
 * The list mirrors the asset entries in PUBLIC above, which stay where they are: the matcher is
 * the cheap filter, PUBLIC is the correctness one, and a path that slips past the first is still
 * caught by the second.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|media/|fonts/|3d/|img/|favicon.ico|icon.png|apple-icon.png|robots.txt|manifest.webmanifest).*)'],
};
