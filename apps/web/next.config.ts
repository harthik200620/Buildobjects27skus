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
  serverExternalPackages: ['mysql2', 'sharp'],
  images: {
    // Media is pre-derived by the pipeline into exact sizes; the loader picks the right
    // rendition, so Next's optimiser never re-encodes a catalogue image.
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
    deviceSizes: [240, 480, 1080, 2048],
    imageSizes: [240, 480],
  },
  experimental: {
    optimizePackageImports: ['three'],
  },
  async headers() {
    // /media/* and /3d/* set their own Cache-Control inside the route handlers — on 200 only.
    // A config-level header would also stamp 404s as immutable, and browsers would cache a
    // missing image for a year.
    return [{ source: '/fonts/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }];
  },
};

export default nextConfig;
