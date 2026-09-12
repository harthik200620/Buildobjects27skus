import { loadEnv } from '@buildobjects/db';
import type { NextConfig } from 'next';

/*
 * The repo-root `.env`, loaded once before anything reads it.
 *
 * Next looks for env files in `apps/web` and this monorepo keeps one at the root, so until now
 * the root file reached the server only as a side effect: `@buildobjects/db` calls `loadEnv()` at
 * module scope, and that mutates `process.env` for the WHOLE process — so whether a variable was
 * visible depended on whether a route importing the database package had been hit yet.
 *
 * Which made authentication order-dependent. A cold server asked the proxy to verify a cookie
 * before any such route had run, so the proxy read `SESSION_SECRET` as undefined; one request to
 * /api/auth/login later, the same cookie verified. Both halves silently fell back to the same
 * development key, so nothing looked wrong until the fallback was removed.
 *
 * The config module runs once, in Node, before the server takes a request.
 */
loadEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@buildobjects/catalog',
    '@buildobjects/db',
    '@buildobjects/estimator',
    '@buildobjects/ar-engine',
    '@buildobjects/ui',
    '@buildobjects/llm',
  ],
  serverExternalPackages: ['mysql2', 'postgres', 'sharp'],
  images: {
    // Media is pre-derived by the pipeline into exact sizes; the loader picks the right
    // rendition, so Next's optimiser never re-encodes a catalogue image.
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
    /*
     * These two lists must be DISJOINT. next/image concatenates them for any image that carries
     * a `sizes` attribute and does not deduplicate, so 240 and 480 appearing in both was putting
     * every category tile's srcset out with seven candidates of which two were literal repeats:
     *
     *   hero-thumb…?w=240 240w, hero-thumb…?w=240 240w, hero-thumb…?w=400 400w,
     *   hero-card…?w=480 480w,  hero-card…?w=480 480w,  hero-gallery…?w=1080 1080w, …
     *
     * Next's own rule is that every imageSizes value is smaller than the smallest deviceSizes
     * value, which the old pair also broke (480 was in both, and 400 sat above 240). Split at
     * 480: the small end covers thumbnails and tiles, the large end covers viewport-width art.
     */
    /*
     * 800 is here because of a hole that cost the home page most of its image weight.
     *
     * The ladder ran 480 → 1080 with nothing between. A category tile renders about 254 CSS px
     * wide in a four-column grid, and on a retina screen — every modern laptop, every phone —
     * that is 508 device pixels. The smallest candidate covering 508 was 1080, which the loader
     * resolves to `hero-gallery`: a 1600 px file weighing 131 KB, fetched to fill a 254 px box.
     * Thirty-five of them. The measurement that caught it read 401 KB of images on a page whose
     * tiles need about 90 KB in total.
     *
     * 800 maps to `hero-card` (46 KB) and covers everything up to a 3× phone. The gap was
     * invisible at devicePixelRatio 1, which is why it survived: it only appears on the hardware
     * everybody actually owns.
     */
    deviceSizes: [480, 800, 1080, 2048],
    /* 400 is the category renditions' smallest width; without it next/image never asks for one
       and every tile falls back to the 800 px card. 160 is the hero panel's product shot. */
    imageSizes: [160, 240, 400],
  },
  experimental: {
    optimizePackageImports: ['three'],
  },
  /*
   * ── WHO GETS THE DESCRIPTION IN <head> ─────────────────────────────────────────────────────
   *
   * Every page under (app) sits behind a loading boundary, which is deliberate and is what makes
   * the first byte fast: the document is sent the moment the root layout renders, without waiting
   * on the session, serviceability and catalogue reads (see app/loading.tsx). The cost is that
   * `generateMetadata` resolves AFTER the head has been flushed, so Next streams the metadata into
   * the body and React hoists it on the client.
   *
   * Which is fine for anything that runs JavaScript, and silently wrong for anything that does
   * not. Measured on the built server: `/c/bulbs` and `/p/cem-ult-ppc50` both emitted
   * `<meta name="description">` into the BODY for every user agent, Googlebot included — so a
   * product link pasted into WhatsApp, Slack or X previewed with a title and no description, and
   * Lighthouse scored the category page 91 on SEO for a description it could not find.
   *
   * This is the documented control. A user agent matching it gets blocking metadata — a slightly
   * later first byte, and a complete <head>. The list is the crawlers that matter to this store
   * and NOT a general "if it looks like a bot": every entry here is paying for its head with
   * latency, and a human should never be on it.
   *
   * WhatsApp is first because it is how a link is shared in this market.
   */
  htmlLimitedBots:
    /WhatsApp|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|TelegramBot|Discordbot|Googlebot|bingbot|Applebot|Slurp|DuckDuckBot|SkypeUriPreview|redditbot|Pinterest/,
  async headers() {
    // Media and models are staged into public/ before the build (scripts/stage-media.mts) so a CDN
    // serves them; without a rule here they would go out as `max-age=0, must-revalidate`, which is
    // a conditional request per photograph per page view.
    //
    // A path rule cannot distinguish a 200 from a 404, so whatever it says is also said about a
    // miss. That decides the two values below:
    //
    //   · /media is immutable. A key only ever reaches a browser because a row in `sku_images` or
    //     `categories` names it, and those rows exist because the file does — so a 404 here is not
    //     a state the storefront can produce. Renditions are replaced under a new key, never edited.
    //     This is the same bargain Next makes for /_next/static.
    //
    //   · /3d is a day, matching what the route handler already returns. A miss there IS reachable:
    //     seven SKUs still have no photoreal model and fall back to a generated placeholder that is
    //     not in the repository. Caching that 404 for a year would hide the model for a year; for a
    //     day it corrects itself.
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }];
    const oneDay = [{ key: 'Cache-Control', value: 'public, max-age=86400' }];

    /*
     * ── THE SECURITY HEADERS ────────────────────────────────────────────────────────────────
     *
     * There were none. Not a weak set — none: no CSP, no HSTS, no nosniff, no Referrer-Policy,
     * no Permissions-Policy, nothing saying whether this store may be framed. Every one of these
     * is a header a browser will enforce for free if you send it, and a header a browser cannot
     * guess if you do not.
     *
     * They are set here rather than in `proxy.ts` on purpose. The proxy runs per REQUEST and only
     * on paths its matcher does not exclude — which deliberately excludes /_next, /media, /fonts
     * and /3d, i.e. most of what the store actually serves. `headers()` is applied by the CDN to
     * everything, costs no invocation, and cannot be skipped by a route that returns early.
     */
    const security = [
      /* Two years, subdomains included, and preload-eligible. Vercel terminates TLS, so every
         request that reaches us is already HTTPS; this is about the NEXT visit, made by typing
         the host without a scheme. */
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      /* A JPEG that sniffs as HTML is a stored XSS. `/media` serves user-visible files under keys
         the catalogue chose, and this is what stops any of them being executed as something else. */
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      /* A pincode and a SKU are on almost every URL in this store. Cross-origin referrers get the
         origin only; same-origin navigation keeps the full path, which is what analytics of our
         own would need. */
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      /*
       * THE CAMERA IS NOT BLANKET-DENIED, because the store genuinely uses it: "see it in your
       * room" is a live camera feed (components/ar/camera). `self` is the narrowest grant that
       * keeps that working — the page may ask, an embedded third party never can.
       *
       * Everything else the store has no business asking for is denied outright rather than left
       * to the browser's default, so an injected script cannot quietly start geolocating people.
       */
      {
        key: 'Permissions-Policy',
        value: [
          'accelerometer=(self)',
          'camera=(self)',
          'gyroscope=(self)',
          'geolocation=()',
          'microphone=()',
          'payment=()',
          'usb=()',
          'interest-cohort=()',
        ].join(', '),
      },
      /* Clickjacking. `frame-ancestors` in the CSP below is the modern control and this is the
         same statement for anything that only understands the old header. */
      { key: 'X-Frame-Options', value: 'DENY' },
      /* A cross-origin opener cannot reach into this window. */
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      {
        key: 'Content-Security-Policy',
        /*
         * WHAT THIS DOES AND DOES NOT COVER — worth being exact about, because a CSP that is
         * described as stronger than it is, is worse than none.
         *
         * `script-src` carries 'unsafe-inline'. It has to: the store is statically rendered and
         * CDN-cached, Next injects its own inline bootstrap into every document, and layout.tsx
         * adds one more (lib/reveal-bootstrap.ts) that must run before first paint. The strict
         * alternative is a per-request nonce, and a nonce makes every page dynamic — it would
         * trade the CDN, and the load time this upgrade is meant to improve, for the hardening.
         * That is the wrong trade for a storefront with no user-generated content: there is no
         * path by which a stranger's markup reaches these pages.
         *
         * So this is NOT XSS-proof, and the directives that are doing real work are the others:
         *
         *   default-src 'self'      nothing loads from anywhere else by default
         *   connect-src 'self'      an injected script cannot exfiltrate to its own server; every
         *                           AI call in this app is made server-side, so the browser has no
         *                           legitimate cross-origin fetch to make
         *   frame-ancestors 'none'  the store cannot be framed — clickjacking
         *   base-uri 'self'         a <base> tag cannot repoint every relative URL on the page
         *   form-action 'self'      a form cannot be made to POST a pincode and phone elsewhere
         *   object-src 'none'       no Flash-era plugin surface
         *
         * blob: and data: appear on img-src and media-src because the AR view is built on them —
         * the camera frame, the composite the shopper saves, and the USDZ handed to Quick Look
         * are all object URLs.
         *
         * tile.openstreetmap.org is the one third-party origin: the order-tracking map's tiles.
         * Leaflet itself is bundled and the road geometry is a static file in the repo, so no
         * script, style or connection leaves 'self' for the map — only the pictures of the roads.
         */
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://tile.openstreetmap.org",
          "media-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "worker-src 'self' blob:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; '),
      },
    ];

    return [
      { source: '/:path*', headers: security },
      { source: '/fonts/:path*', headers: immutable },
      { source: '/media/:path*', headers: immutable },
      { source: '/3d/:path*', headers: oneDay },
    ];
  },
};

export default nextConfig;
