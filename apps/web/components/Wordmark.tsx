import type React from 'react';

/**
 * The Build Objects lockup — the mark, and the brand name beside it in Audiowide. This is the one
 * component that sets the brand name, so:
 *
 *   · AUDIOWIDE, always, wherever the name appears — header, footer, front door, cart.
 *   · CAP HEIGHT = MARK HEIGHT. The capitals are exactly as tall as the logo at every size.
 *   · THE O IS TEAL. OBJECTS carries the only O in the name, at the mark's own colour and size.
 *
 * Audiowide has no rupee glyph and must never set a price — see the type program in layout.tsx.
 *
 * `size` publishes `--wm-size` rather than baking width and font-size into inline styles.
 * Everything derived from it — the mark's box, the cap height, the gap — is computed in theme.css
 * from that one number, so a media query moves all three, and omitting the prop hands the decision
 * to CSS entirely.
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
