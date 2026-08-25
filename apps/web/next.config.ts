import type { NextConfig } from 'next';

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
    deviceSizes: [240, 480, 1080, 2048],
    /* 400 is the category renditions' smallest width; without it in the ladder next/image
       never asks for one and every tile falls back to the 800 px card. */
    imageSizes: [240, 400, 480],
  },
  experimental: {
    optimizePackageImports: ['three'],
  },
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
    return [
      { source: '/fonts/:path*', headers: immutable },
      { source: '/media/:path*', headers: immutable },
      { source: '/3d/:path*', headers: oneDay },
    ];
  },
};

export default nextConfig;
