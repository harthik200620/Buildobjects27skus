import Image from 'next/image';

/**
 * A photographic backplate: the frame behind a page's opening section. Seven ship in
 * `design-system/art/`, one per surface (see that folder's MANIFEST.md). They are never foreground
 * images — full-bleed, under a scrim, copy on top, never at full brightness.
 *
 * THE SCRIM IS TWO LAYERS AND BOTH ARE LOAD-BEARING. The vertical one fades the plate into the
 * canvas at the section's bottom edge so the photograph ends without a seam. The horizontal one
 * darkens the LEFT, where every headline on this site sits; without it the copy fights the
 * photograph at exactly the width most people browse at — legible in a screenshot, unreadable on a
 * real monitor at 1440.
 *
 * The plates are 16:9 and most slots are wider, so the crop is centre-weighted and shifted down.
 * `object-position: 50% 62%` holds the subject in frame to about 1100px, which matters most on the
 * home hero: its top edge carries the mumty and the water tank, the details that make the house
 * read as Indian rather than as stock photography.
 *
 * `-2560` in the src is the ladder's top rung, not a fixed size — lib/image-loader.ts rewrites the
 * width segment per candidate, so a phone fetches the 640 (about 16 KB) and a 2× desktop the 2560.
 */
export type PlateName = 'home-hero' | 'catalogue-aisle' | 'site-materials' | 'construct-frame' | 'cart-yard' | 'interior-warm' | 'pdp-stage';

export default function Plate({
  name,
  priority = false,
  position = '50% 62%',
  className,
}: {
  name: PlateName;
  /** True only for the plate a page opens on — it is that page's largest paint. */
  priority?: boolean;
  position?: string;
  className?: string;
}) {
  return (
    <div className={className ? `plate ${className}` : 'plate'} aria-hidden="true">
      <Image
        src={`/art/${name}-2560.webp`}
        alt=""
        fill
        sizes="100vw"
        priority={priority}
        /* Nothing here is content: a photograph behind a scrim behind a headline has no
           information in it that the headline does not already carry. */
        aria-hidden="true"
        style={{ objectPosition: position }}
      />
      <span className="plate-scrim" />
    </div>
  );
}
