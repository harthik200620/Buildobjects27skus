/**
 * The Build Objects lockup — the mark, and the word drawn beside it.
 *
 * The wordmark used to be `<span className="wordmark">Build Objects</span>` set in Audiowide,
 * written out by hand in four different places at four different sizes, none of which lined up
 * with the 32 px mark it sat next to. Three problems came out of that: the word was smaller than
 * the mark, it was set in a face that shared nothing with the mark's drawing, and the O of
 * OBJECTS was the same silver as every other letter.
 *
 * So it is drawn here instead, once.
 *
 *   · MONOLINE, because the mark is. The mark is three parallel strokes and a stroked bowl of
 *     even weight — so the letters are single-weight geometric capitals of the same weight,
 *     built from straight lines and circular arcs and nothing else. A proportional text face
 *     beside a monoline mark is two drawings; this is one.
 *   · CAP HEIGHT = MARK HEIGHT. The letters and the mark are cut from the same square, so the
 *     word is exactly as tall as the logo at every size the lockup is used.
 *   · THE O IS THE BRAND. OBJECTS carries the only O in the name, it is a true circle at full
 *     cap height, and it is --color-brand — the same teal as the mark, the same optical size.
 *     It is the one coloured thing in the word and it reads as a second mark.
 *
 * Because it is vector, the third webfont the store used to ship (Audiowide, ~19 KB, loaded on
 * every page to set two words) is gone.
 */

/** Cap height of the drawn letters, in the SVG's own units. Everything else derives from it. */
const CAP = 72;
/** Monoline stroke weight, matched by eye to the mark's own strokes at the same cap height. */
const SW = 9.5;
const H = SW / 2; // stroke centres are inset by half the weight so the glyph fills the cap exactly
const TOP = H;
const BOT = CAP - H;
const MID = CAP / 2;

/**
 * The alphabet, as [path, advance]. Only the eleven capitals the name needs are drawn — an
 * unused glyph is a glyph nobody checks. Every curve is a circular arc; the O is the only
 * true circle, and it is the only one the brand colour is spent on.
 */
const GLYPHS: Record<string, { d: string; w: number }> = {
  /* B and D are drawn as ONE continuous path each, doubling back through the stem, so every
     corner is a stroke join. Drawn as a stem plus separate bowls, the flat cap at the end of the
     stem met the flat cap at the end of a bar and left a half-stroke notch bitten out of the
     bottom-left corner of both Bs — visible at any size above about 20 px. */
  B: { d: `M${H} ${MID}H22A15.63 15.63 0 0 0 22 ${TOP}H${H}V${BOT}H24A15.63 15.63 0 0 0 24 ${MID}H${H}`, w: 46 },
  U: { d: `M${H} ${TOP}V47A16.5 16.5 0 0 0 37.75 47V${TOP}`, w: 47 },
  I: { d: `M${H} ${TOP}V${BOT}`, w: 16 },
  L: { d: `M${H} ${TOP}V${BOT}H33`, w: 39 },
  D: { d: `M${H} ${BOT}V${TOP}H16A31.25 31.25 0 0 1 16 ${BOT}Z`, w: 53 },
  J: { d: `M31 ${TOP}V49A14 14 0 0 1 3 49`, w: 38 },
  E: { d: `M35 ${TOP}H${H}V${BOT}H35M${H} ${MID}H29`, w: 41 },
  C: { d: `M47 16A26 31.25 0 1 0 47 56`, w: 54 },
  T: { d: `M${H} ${TOP}H39.25M22 ${TOP}V${BOT}`, w: 44 },
  S: { d: `M34.51 12.55A15.6 15.6 0 1 0 21 ${MID}A15.6 15.6 0 1 1 7.49 59.45`, w: 42 },
  /* The hero. A true circle, so its width equals the cap height. */
  O: { d: `M${H} ${MID}A${MID - H} ${MID - H} 0 1 1 ${CAP - H} ${MID}A${MID - H} ${MID - H} 0 1 1 ${H} ${MID}`, w: CAP + 4 },
};

const TRACK = 5; // letter-spacing, in the same units
const WORD_GAP = 26; // the space between BUILD and OBJECTS

type Laid = { ch: string; x: number; g: { d: string; w: number } };

function layout(text: string): { glyphs: Laid[]; width: number } {
  const glyphs: Laid[] = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') {
      x += WORD_GAP;
      continue;
    }
    const g = GLYPHS[ch];
    if (!g) continue; // the name is fixed; an unknown character is a typo, not a fallback case
    glyphs.push({ ch, x, g });
    x += g.w + TRACK;
  }
  return { glyphs, width: x - TRACK };
}

const LOCKUP = layout('BUILD OBJECTS');

export type WordmarkVariant = 'full' | 'word' | 'mark';

/**
 * @param size  Height of the mark, in CSS pixels. The word matches it exactly.
 * @param variant `full` = mark + word (header, footer, front door), `word` = the word alone,
 *                `mark` = the mark alone (favicon-scale chrome, the cart).
 * @param tone  `brand` keeps the word silver with a teal O — the default, and the only treatment
 *              used on a store surface. `mono` renders the whole word in currentColor for the
 *              places a lockup has to survive one ink (print, an OG image, a dark chip).
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
  const scale = size / CAP;
  const gap = Math.round(size * 0.34);
  const wordW = LOCKUP.width * scale;

  const word = (
    <svg
      width={wordW}
      height={size}
      viewBox={`0 0 ${LOCKUP.width} ${CAP}`}
      fill="none"
      role="img"
      aria-label="Build Objects"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <g strokeWidth={SW} strokeLinecap="butt" strokeLinejoin="round">
        {LOCKUP.glyphs.map((l) => (
          /* The x offset is unique per glyph and never reorders, so it is the stable key. */
          <path
            key={`${l.ch}${l.x}`}
            d={l.g.d}
            transform={`translate(${l.x} 0)`}
            stroke={l.ch === 'O' && tone === 'brand' ? 'var(--color-brand)' : 'currentColor'}
          />
        ))}
      </g>
    </svg>
  );

  const mark = <img src="/logo-mark.png" width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ display: 'block' }} />;

  if (variant === 'mark') return <span className={className}>{mark}</span>;
  if (variant === 'word') return <span className={className}>{word}</span>;
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {mark}
      {word}
    </span>
  );
}
