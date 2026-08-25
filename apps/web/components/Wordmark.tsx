import type React from 'react';

/**
 * The Build Objects lockup — the mark, and the brand name beside it in Audiowide.
 *
 * Three attempts got here, and the last one was a mistake worth recording.
 *
 * The original set the name in Audiowide but wrote it out by hand in four different places at
 * four different sizes, none of which lined up with the 32 px mark it sat next to, and with the
 * O of OBJECTS the same silver as every other letter.
 *
 * The second replaced Audiowide with hand-drawn monoline capitals, on the argument that a
 * webfont loaded to set two words is a webfont loaded for a picture. The argument was tidy and
 * the result was wrong: hand-cut letterforms carry none of the optical correction a real face
 * does, so it read as a wireframe of the name rather than as the name.
 *
 * The third set it in Encode Sans. Legible, and anonymous — the brand's voice replaced by the
 * price font.
 *
 * Audiowide is the brand's face. This is the one component that sets it, so:
 *
 *   · AUDIOWIDE, always, wherever the brand name appears — header, footer, front door, cart.
 *   · CAP HEIGHT = MARK HEIGHT. The capitals are exactly as tall as the logo at every size.
 *   · THE O IS TEAL. OBJECTS carries the only O in the name and it is --color-brand: the mark's
 *     own colour, at the mark's own size.
 *
 * Audiowide has no ₹ glyph. It must never be used for a price — see the type program in
 * app/layout.tsx.
 *
 * `size` is published as the `--wm-size` custom property rather than baked into inline width and
 * font-size. Everything derived from it — the mark's box, the cap height, the gap — is computed in
 * theme.css from that one number, so a media query moves all three by redefining it, and a caller
 * that omits the prop hands that decision to CSS entirely.
 */
export type WordmarkVariant = 'full' | 'word' | 'mark';

/**
 * @param size  Height of the mark in CSS pixels; the capitals match it exactly. Omit it to let
 *              an ancestor's `--wm-size` decide, which is what the header does.
 * @param variant `full` = mark + name, `word` = the name alone, `mark` = the mark alone.
 * @param tone  `brand` keeps the name in the current ink with a teal O — the default. `mono`
 *              renders all of it in currentColor, for the places a lockup has to survive one ink.
 */
export default function Wordmark({
  size,
  variant = 'full',
  tone = 'brand',
  className,
}: {
  size?: number;
  variant?: WordmarkVariant;
  tone?: 'brand' | 'mono';
  className?: string;
}) {
  /*
   * No `size` means "whoever mounts me decides, in CSS".
   *
   * An inline custom property beats every selector, so a header that has to shrink its lockup at
   * three breakpoints cannot do it while the size arrives as a style attribute. Omitting the prop
   * leaves --wm-size to cascade from an ancestor (see .header-logo in store.css); passing one is
   * for the places that want a fixed size and no breakpoints — the footer, the front door.
   */
  const style = size === undefined ? undefined : ({ '--wm-size': `${size}px` } as React.CSSProperties);

  const word = (
    <span className="wordmark" role="img" aria-label="Build Objects">
      Build{' '}
      {tone === 'brand' ? (
        <>
          <span className="wordmark-o">O</span>bjects
        </>
      ) : (
        'Objects'
      )}
    </span>
  );

  {
    /* The 128 px rendition, not the 815 px one. The header draws this at 34 px, which is 68 px on
       a 2× screen — the large file was 187 KB shipped to paint a mark the size of a fingernail. */
  }
  const mark = <img className="wordmark-mark" src="/logo-mark-128.png" width={128} height={128} alt="" aria-hidden="true" draggable={false} />;

  const cls = `lockup${className ? ` ${className}` : ''}`;
  if (variant === 'mark')
    return (
      <span className={cls} style={style}>
        {mark}
      </span>
    );
  if (variant === 'word')
    return (
      <span className={cls} style={style}>
        {word}
      </span>
    );
  return (
    <span className={cls} style={style}>
      {mark}
      {word}
    </span>
  );
}
