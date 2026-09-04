import type React from 'react';
import {
  MARK_AXIS,
  MARK_BAND,
  MARK_RING_INNER,
  MARK_RING_OUTER,
  MARK_SPINE_INNER,
  MARK_SPINE_OUTER,
  MARK_SPINE_STROKE,
  MARK_STEM,
  MARK_STEMS,
  MARK_VIEW,
} from '@/lib/mark-paths';
import { SPLASH_ID } from '@/lib/splash';
import { SPLASH_FADE_MS, SPLASH_SEQUENCE_MS } from '@/lib/splash-timing';

/**
 * The loading overlay: the mark igniting, drawn over the whole viewport while a page arrives.
 *
 * THE SEQUENCE. A star lights at the centre of the middle stem. Its light runs out along the
 * stem's own lean, both ways, until it leaves the page through the top and bottom edges — a sharp
 * white line inside a band as wide as the three stems together. It comes back to exactly the
 * length of the stems; as it lands, the middle stem lights, then the two beside it. Then the bowl
 * is drawn round from where it meets the stems to where it ends, a glint riding its leading edge,
 * and the whole mark settles from white-hot to the brand teal and breathes there until the page
 * is ready. About a second and a half; app/styles/splash.css holds the timing.
 *
 * NO JAVASCRIPT IN THE PICTURE. This is a server component: plain markup and CSS keyframes, so it
 * is painting from the document's first frame — long before any bundle has arrived — and it costs
 * nothing to hydrate. The only script involved decides when it may leave (lib/splash.ts).
 *
 * THE GEOMETRY IS THE ARTWORK. Every path here is traced from public/logo-mark.png by
 * scripts/trace-mark.mts, and the beam's origin, lean and width are read off the same trace, so
 * the light really does run down the middle stem. Nothing is eyeballed.
 *
 * WHY THE BEAM IS HTML AND THE MARK IS SVG. The mark is small and detailed, which is what SVG is
 * for. The beam is a viewport-wide gradient that only ever changes its scale, which is what a
 * composited element is for: three divs, each a gradient, each animating one property the
 * compositor owns. Filters and blurs sit only on the small SVG, and only on static copies whose
 * opacity animates — never on anything that moves.
 */
export default function Splash() {
  const pct = (n: number) => `${(n / MARK_VIEW) * 100}%`;
  const style = {
    '--splash-seq': `${SPLASH_SEQUENCE_MS}ms`,
    '--splash-fade': `${SPLASH_FADE_MS}ms`,
    '--beam-x': pct(MARK_AXIS.x),
    '--beam-y': pct(MARK_AXIS.y),
    '--beam-angle': `${MARK_AXIS.angle}deg`,
    '--beam-len': MARK_AXIS.length / MARK_VIEW,
    '--beam-band': MARK_BAND / MARK_VIEW,
    '--beam-stem': MARK_STEM / MARK_VIEW,
  } as React.CSSProperties;
  const axis = `path("M${MARK_AXIS.from[0]} ${MARK_AXIS.from[1]} L${MARK_AXIS.to[0]} ${MARK_AXIS.to[1]}")`;
  const mark = (
    <>
      <use href="#bo-stem-1" />
      <use href="#bo-stem-2" />
      <use href="#bo-stem-3" />
      <use href="#bo-ring-o" />
      <use href="#bo-ring-i" />
    </>
  );

  return (
    <div id={SPLASH_ID} className="splash splash--on" aria-hidden="true" style={style}>
      <div className="splash-stage">
        <div className="splash-beam splash-beam--halo" />
        <div className="splash-beam splash-beam--core" />
        <div className="splash-beam splash-beam--edge" />
        <svg className="splash-mark" aria-hidden="true" viewBox={`0 0 ${MARK_VIEW} ${MARK_VIEW}`} overflow="visible">
          <defs>
            <path id="bo-stem-1" d={MARK_STEMS[0]} />
            <path id="bo-stem-2" d={MARK_STEMS[1]} />
            <path id="bo-stem-3" d={MARK_STEMS[2]} />
            <path id="bo-ring-o" d={MARK_RING_OUTER} />
            <path id="bo-ring-i" d={MARK_RING_INNER} />
            {/* The bowl is revealed by stroking its own spine: dashoffset runs the stroke round it. */}
            <mask id="bo-draw" maskUnits="userSpaceOnUse" x="0" y="0" width={MARK_VIEW} height={MARK_VIEW}>
              <path className="splash-draw" d={MARK_SPINE_OUTER} pathLength={1} strokeWidth={MARK_SPINE_STROKE} />
              <path className="splash-draw splash-draw--inner" d={MARK_SPINE_INNER} pathLength={1} strokeWidth={MARK_SPINE_STROKE} />
            </mask>
            <radialGradient id="bo-halo">
              <stop className="splash-halo-in" offset="0" />
              <stop className="splash-halo-mid" offset="0.38" />
              <stop className="splash-halo-out" offset="1" />
            </radialGradient>
            <filter id="bo-bloom" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>

          {/* The unlit mark, so the light has something to be in the middle of. */}
          <g className="splash-ghost">{mark}</g>

          {/* Soft light behind the lit parts — static blurs whose opacity is what animates. */}
          <g className="splash-bloom splash-bloom--stems" filter="url(#bo-bloom)">
            <use href="#bo-stem-1" />
            <use href="#bo-stem-2" />
            <use href="#bo-stem-3" />
          </g>
          <g className="splash-bloom splash-bloom--bowl" filter="url(#bo-bloom)">
            <use href="#bo-ring-o" />
            <use href="#bo-ring-i" />
          </g>

          <g className="splash-stem splash-stem--1">
            <use href="#bo-stem-1" />
          </g>
          <g className="splash-stem splash-stem--2">
            <use href="#bo-stem-2" />
          </g>
          <g className="splash-stem splash-stem--3">
            <use href="#bo-stem-3" />
          </g>
          <g className="splash-bowl" mask="url(#bo-draw)">
            <use href="#bo-ring-o" />
            <use href="#bo-ring-i" />
          </g>

          {/* The glint that leads the drawing of the bowl. */}
          <g className="splash-head" style={{ offsetPath: `path("${MARK_SPINE_OUTER}")` }}>
            <circle r="34" fill="url(#bo-halo)" />
            <circle className="splash-glint" r="9" />
          </g>
          {/* And the one that keeps running up the middle stem while the page is still loading. */}
          <g className="splash-sweep" style={{ offsetPath: axis }}>
            <circle r="30" fill="url(#bo-halo)" />
            <circle className="splash-glint" r="6" />
          </g>

          {/* The star, at the middle stem's centre; its long rays lie along the stem. */}
          <g className="splash-star" transform={`translate(${MARK_AXIS.x} ${MARK_AXIS.y})`}>
            <circle className="splash-star-halo" r="150" fill="url(#bo-halo)" />
            <g className="splash-star-rays" transform={`rotate(${MARK_AXIS.angle + 90})`}>
              <path className="splash-ray" d="M0 -170 L7 0 L0 170 L-7 0 Z" />
              <path className="splash-ray splash-ray--short" d="M-92 0 L0 5.5 L92 0 L0 -5.5 Z" />
            </g>
            <circle className="splash-star-core" r="8" />
          </g>
        </svg>
      </div>
    </div>
  );
}
