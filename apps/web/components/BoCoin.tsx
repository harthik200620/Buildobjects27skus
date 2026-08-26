/**
 * A BO Coin as a real object, not a glyph.
 *
 * Two faces on a rotating card, a milled rim on a layer 7px behind them, and a glint that travels
 * across the face as it comes back round. It is CSS 3D and no images: a coin drawn as a flat
 * circle is a token, and a token is what a currency must not look like.
 *
 * THE SPIN DWELLS. A linear 360° loop spends half its time edge-on, which means half the time the
 * thing the panel is about is a gold sliver. This one holds face-on at 0° and at 180° and transits
 * the edge quickly, so the coin is a readable object for most of the loop and the rim is a detail
 * you catch rather than a state you wait out.
 *
 * Amber is the coin's and only the coin's. Nothing else in the store may use it except warnings —
 * a currency in the brand colour reads as a feature rather than as money.
 *
 * Under prefers-reduced-motion it stops face-on, which is the frame that carries the meaning.
 */
export default function BoCoin({ size = 120, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `bocoin ${className}` : 'bocoin'} style={{ width: size, height: size }} aria-hidden="true">
      <span className="bocoin-spin">
        {/* The rim sits behind both faces, so it is what shows through as the coin turns edge-on.
            A conic gradient of alternating light and dark is milling — the ridges a real coin has
            so it cannot be shaved. */}
        <span className="bocoin-rim" />
        <span className="bocoin-face">
          <BoCoinMark />
        </span>
        <span className="bocoin-face bocoin-face--b">
          <BoCoinMark />
        </span>
        <span className="bocoin-glint" />
      </span>
    </span>
  );
}

/**
 * The device struck into both faces: the Build Objects mark itself.
 *
 * It used to be a hand-drawn B and O — two stroked bowls and a circle, redrawn here in an SVG
 * that lived nowhere else. It was a reasonable likeness and it was not the logo: the real mark
 * has three ruled strokes leading into the bowl, and none of them survived the redrawing. A
 * currency that carries an approximation of the brand's mark is a currency that looks
 * counterfeit, which is the one thing this component exists to avoid.
 *
 * So it is the mark, from the same 128px file the header uses, as a MASK over currentColor. That
 * matters twice over: the geometry is the artwork rather than a copy of it, and because the
 * colour is painted rather than baked, the face keeps its struck-metal treatment — the amber it
 * already had, with the two drop shadows in store.css that read as an engraving.
 */
function BoCoinMark() {
  return <span className="bocoin-mark" aria-hidden="true" />;
}
