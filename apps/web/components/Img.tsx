import Image from 'next/image';
import type React from 'react';

/**
 * next/image at the pre-derived rendition size, so no byte is re-encoded on the way to the screen.
 *
 * NO BLURHASH PLACEHOLDER, DELIBERATELY. This used to decode `sku.blurhash` onto a 32 px canvas
 * and paint it as the <img>'s own background. The card already paints the RIGHT ground underneath
 * — `.prod-media::before` fills with `--plate`, the colour sampled from this very photograph's
 * border by scripts/blend-skus.mts — and the <img> sits above it at z-index 2, so the placeholder
 * covered the exact answer with an approximation of it.
 *
 * On a product shot that approximation is not close. A blurhash is a 4x3 DCT: one large saturated
 * subject bleeds into every cell, so Ambuja's yellow bag hashed to an amber field (#ad8650) and
 * painted the whole card amber until the rendition landed — over a photograph whose own background
 * is #082229. Backgrounds paint into the padding box, so the 9 % padding spread it wider still.
 * The flat plate is both correct and instant: it is CSS, so it costs no decode, no effect and no
 * client boundary, which is why this file is no longer 'use client'.
 *
 * The hash still earns its keep in the gallery, where every frame has one and there is no
 * per-frame table to read instead — see lib/plate.ts.
 */
export default function Img({
  src,
  alt,
  width,
  height,
  sizes,
  priority,
  className,
  style,
  fill,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
  fill?: boolean;
}) {
  const common = { src, alt, sizes, priority, className, style };
  if (fill) return <Image {...common} fill />;
  return <Image {...common} width={width ?? 480} height={height ?? 480} />;
}
