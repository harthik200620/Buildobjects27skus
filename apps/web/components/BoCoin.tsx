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

/** The device struck into both faces: the B and the O of the wordmark, as one figure. */
function BoCoinMark() {
  return (
    <svg viewBox="0 0 48 48" className="bocoin-mark" fill="none" aria-hidden="true">
      <title>BO</title>
      <path
        d="M13 12h9.4a5.6 5.6 0 0 1 0 11.2H13zM13 23.2h10.2a6.4 6.4 0 0 1 0 12.8H13z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <circle cx="35.2" cy="24" r="7.6" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}
