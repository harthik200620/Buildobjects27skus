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
 *   · CAP HEIGHT = MARK HEIGHT. The font size is derived from the face's cap-height ratio, so
 *     the capitals are exactly as tall as the logo at every size the lockup is used.
 *   · THE O IS TEAL. OBJECTS carries the only O in the name and it is --color-brand: the mark's
 *     own colour, at the mark's own size.
 *
 * Audiowide has no ₹ glyph. It must never be used for a price — see the type program in
 * app/layout.tsx.
 */

/**
 * Audiowide's cap height as a fraction of the em. The font size is `size / CAP_RATIO` so the
 * capitals — not the em box — match the mark.
 */
const CAP_RATIO = 0.715;

export type WordmarkVariant = 'full' | 'word' | 'mark';

/**
 * @param size  Height of the mark in CSS pixels; the capitals match it exactly.
 * @param variant `full` = mark + name, `word` = the name alone, `mark` = the mark alone.
 * @param tone  `brand` keeps the name in the current ink with a teal O — the default. `mono`
 *              renders all of it in currentColor, for the places a lockup has to survive one ink.
 */
export default function Wordmark({
  size = 32,
  variant = 'full',
  tone = 'brand',
  className,
}: {
  size?: number;
  variant?: WordmarkVariant;
  tone?: 'brand' | 'mono';
  className?: string;
}) {
  const fontSize = size / CAP_RATIO;
  const gap = Math.round(size * 0.42);

  const word = (
    <span className="wordmark" role="img" aria-label="Build Objects" style={{ fontSize, lineHeight: 1 }}>
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

  const mark = <img src="/logo-mark.png" width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ display: 'block', flex: 'none' }} />;

  if (variant === 'mark') return <span className={className}>{mark}</span>;
  if (variant === 'word') return <span className={className}>{word}</span>;
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {mark}
      {word}
    </span>
  );
}
