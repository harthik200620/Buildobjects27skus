'use client';

import { decode } from 'blurhash';
import Image from 'next/image';
import React from 'react';

/**
 * next/image with a blurhash placeholder painted on a canvas until the rendition lands. The
 * loader picks the pre-derived size, so no byte is ever re-encoded on the way to the screen.
 */
export default function Img({
  src,
  alt,
  width,
  height,
  sizes,
  priority,
  blurhash,
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
  blurhash?: string | null;
  className?: string;
  style?: React.CSSProperties;
  fill?: boolean;
}) {
  const [dataUrl, setDataUrl] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!blurhash) return;
    try {
      const px = decode(blurhash, 32, 32);
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(32, 32);
      img.data.set(px);
      ctx.putImageData(img, 0, 0);
      setDataUrl(c.toDataURL());
    } catch {
      /* a bad hash just means no placeholder */
    }
  }, [blurhash]);
  const common = {
    src,
    alt,
    sizes,
    priority,
    className,
    style: { ...style, background: dataUrl ? `url(${dataUrl}) center / cover` : undefined },
    placeholder: 'empty' as const,
  };
  if (fill) return <Image {...common} fill />;
  return <Image {...common} width={width ?? 480} height={height ?? 480} />;
}
