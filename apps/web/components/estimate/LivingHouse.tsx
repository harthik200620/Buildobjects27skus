'use client';

import type { EstimateResult, Tier } from '@buildobjects/estimator';
import type React from 'react';

/**
 * The house that builds itself.
 *
 * BO Estimator does the same arithmetic the old calculator did — `estimate(inputs, catalog)` is
 * untouched — but a page of number fields and a donut asks a person to already know what a
 * built-up area is. Most people building one house in their life do not, and they were the
 * customer this product was meant for.
 *
 * So the answer is drawn. Change the plot and the ground widens under a plinth. Add a floor and
 * a slab lands, then walls rise on it, then the openings cut in. Move the finish quality and the
 * walls change material — bare plaster, then paint, then stone. Nothing here is decoration: every
 * element is bound to a field of the same EstimateResult that produces the total, so the picture
 * cannot drift from the figure, and the animation IS the explanation of why the number moved.
 *
 * Drawn as SVG, not canvas or WebGL: it has to be crisp at any size, it has to work in a server-
 * rendered page with no loading state, and every part of it needs a stable identity so CSS can
 * animate it. A hundred and forty elements of SVG do that for nothing.
 */

/** The drawing grid. Everything below is in these units; the viewBox does the scaling. */
const W = 560;
const GROUND_Y = 292;
/* The frame never shows more than 200 units of building above the ground line; past that a
   G+4 would shrink the storeys instead of growing the panel. */
const MAX_SKY = 200;
const FLOOR_H = 44; // one storey, in drawing units
const PLINTH_H = 11;
/*
 * The house is drawn in three-quarter view, not elevation. A flat front is a diagram; two faces
 * and a roof plane is a building, and it costs one vector: every box is its front rectangle plus
 * a side and a top sheared along the same offset. Fixed axonometric, so nothing is projected.
 */
const DEPTH_X = 0.4;
const DEPTH_Y = -0.34;

/**
 * Wall treatment per finish quality — the house is visibly made of something different at each
 * tier, which is the whole reason a picture beats a radio button here. The labels are written
 * for someone who has never specified a building: "Stone cladding, premium fittings", not
 * "Premium tier".
 */
const FINISH: Record<Tier, { wall: string; wall2: string; trim: string; label: string }> = {
  basic: { wall: 'var(--color-surface-2)', wall2: 'var(--color-surface-3)', trim: 'var(--color-line-strong)', label: 'Plaster and paint, standard fittings' },
  medium: { wall: 'var(--color-surface-3)', wall2: 'var(--color-surface-2)', trim: 'var(--color-teal-600)', label: 'Textured finish, branded fittings' },
  premium: { wall: 'var(--color-plate)', wall2: 'var(--color-surface-3)', trim: 'var(--color-brand)', label: 'Stone cladding, premium fittings' },
};

export interface LivingHouseProps {
  result: EstimateResult;
  /** Which ledger row the cursor is on, so the house can point at what it paid for. */
  highlight?: string | null;
}

export default function LivingHouse({ result, highlight = null }: LivingHouseProps) {
  const { inputs, derived } = result;
  const floors = Math.max(0, Math.min(4, inputs.floors));
  const storeys = floors + 1; // "floors: 0" is Ground only — one storey of building
  const tier = inputs.tier;
  const finish = FINISH[tier] ?? FINISH.basic;

  /*
   * The building's footprint on screen, from the real plot. A 30×40 plot and a 60×40 plot must
   * look different or the drawing is a logo, not a model — but a 200 ft frontage cannot be drawn
   * to the same scale as a 20 ft one, so the mapping is a square root: it compresses the range
   * while keeping the order and the visible difference.
   */
  const plotSqft = Math.max(200, derived.plotAreaSqft);
  const frontage = 120 + 190 * Math.min(1, Math.sqrt(plotSqft / 4000));
  const coverage = Math.max(0.4, Math.min(1, inputs.coverage));
  const bodyW = Math.round(frontage * (0.55 + 0.45 * coverage));
  const bodyX = Math.round((W - bodyW) / 2);
  /* Setback. Coverage is the fraction of the plot the building occupies, so the land left over
     is what the compound wall encloses and the car stands on. Drawn at 1.35x the building at
     60% coverage down to 1.06x at full — enough to read as ground, never enough to dwarf it. */
  const plotW = Math.round(bodyW * (1.5 - 0.44 * coverage));
  const plotX = Math.round((W - plotW) / 2);

  const bodyH = storeys * FLOOR_H;
  const bodyTop = GROUND_Y - PLINTH_H - bodyH;

  /* Windows per storey scale with the frontage, so a wider house is not a wider blank wall. */
  const bays = Math.max(2, Math.min(5, Math.round(bodyW / 62)));

  /* The projection offset every side and top face is sheared by. Capped so a wide plot does not
     run the building off the right edge of the frame. */
  const depth = Math.min(78, bodyW * 0.34);
  const dx = Math.round(depth * DEPTH_X * 10) / 10;
  const dy = Math.round(depth * DEPTH_Y * 10) / 10;

  /* The gate sits in the front run of the compound wall, offset from centre so it does not line
     up with the front door — which is how gates actually sit, and stops the drawing looking like
     a symmetrical icon. */
  const gateW = Math.round(Math.min(56, plotW * 0.22));
  const gateX = Math.round(plotX + plotW * 0.62 - gateW / 2);

  /*
   * The frame follows the building. A fixed viewBox left a bungalow marooned under two thirds of
   * empty sky while a G+4 filled it — the same drawing reading as "small and lost" in one case
   * and "considered" in the other. The top of the box tracks the roof (plus whatever is on it),
   * so every house sits in the frame the same way, and the panel visibly grows a storey taller
   * when you add a storey. Clamped so the change is a growth, not a jolt.
   */
  const roofTopY = bodyTop + dy - (inputs.addons.solar ? 10 : 0);
  const vbTop = Math.max(0, Math.min(roofTopY - 34, GROUND_Y - MAX_SKY));
  const vbH = GROUND_Y + 34 - vbTop;

  /*
   * The build sequence. Each element carries a `--i` so one CSS keyframe can stagger the whole
   * house without a timeline in JS: the ground settles, the plinth sets, storeys rise from the
   * bottom, then openings cut in, then the roof lands. Re-keyed on the shape of the building so
   * that changing a floor count re-runs the build and changing the city does not.
   */
  const buildKey = `${storeys}-${bodyW}-${tier}-${inputs.parking ? 'p' : ''}${inputs.compoundWall ? 'w' : ''}${inputs.addons.solar ? 's' : ''}`;

  const storeyList = Array.from({ length: storeys }, (_, i) => i);
  const lit = (k: string) => (highlight ? (highlight.includes(k) ? 1 : 0.28) : 1);

  return (
    <figure className="lh" aria-labelledby="lh-cap">
      <svg
        key={buildKey}
        className="lh-svg"
        viewBox={`0 ${vbTop} ${W} ${vbH}`}
        role="img"
        aria-label={`A ${derived.floorsLabel} house on a ${Math.round(derived.plotAreaSqft)} square foot plot, ${finish.label.toLowerCase()}`}
      >
        <defs>
          <linearGradient id="lh-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-canvas-2)" />
            <stop offset="1" stopColor="var(--color-canvas)" />
          </linearGradient>
          <linearGradient id="lh-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-brand)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-teal-600)" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="lh-wall" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={finish.wall} />
            <stop offset="1" stopColor={finish.wall2} />
          </linearGradient>
        </defs>

        <rect x="0" y={vbTop} width={W} height={vbH} fill="url(#lh-sky)" />

        {/* the plot: the ground you actually bought, in the same projection */}
        <g className="lh-plot" style={{ '--i': 0 } as React.CSSProperties} opacity={lit('land')}>
          <path d={`M${plotX} ${GROUND_Y} l${dx} ${dy} h${plotW} l${-dx} ${-dy} Z`} fill="var(--color-surface)" stroke="var(--color-line)" />
          <line x1="0" y1={GROUND_Y} x2={W} y2={GROUND_Y} stroke="var(--color-line)" strokeWidth="1" />
        </g>

        {/*
         * The compound wall. Two posts at the plot edges read as fins beside the house; a real
         * boundary is a run along the front with a return down each side, and a gate in it. It
         * is drawn low (26 units ≈ 5 ft, which is what the estimate actually prices) so it
         * never hides the ground floor behind it.
         */}
        {inputs.compoundWall && (
          <g className="lh-part" style={{ '--i': 1 } as React.CSSProperties} opacity={lit('boundary')}>
            {/* the two side returns, running back along the projection */}
            <path d={`M${plotX} ${GROUND_Y} v-24 l${dx} ${dy} v24 Z`} fill="var(--color-canvas-2)" stroke="var(--color-line)" />
            <path d={`M${plotX + plotW} ${GROUND_Y} v-24 l${dx} ${dy} v24 Z`} fill="var(--color-canvas-2)" stroke="var(--color-line)" />
            {/* the front run, broken by the gate */}
            <rect x={plotX} y={GROUND_Y - 24} width={gateX - plotX} height="24" fill="var(--color-surface-2)" stroke="var(--color-line)" />
            <rect
              x={gateX + gateW}
              y={GROUND_Y - 24}
              width={plotX + plotW - gateX - gateW}
              height="24"
              fill="var(--color-surface-2)"
              stroke="var(--color-line)"
            />
            {/* the gate itself */}
            <rect x={gateX} y={GROUND_Y - 20} width={gateW} height="20" fill="var(--color-teal-50)" stroke={finish.trim} />
          </g>
        )}

        {/* plinth */}
        <g className="lh-part" style={{ '--i': 2 } as React.CSSProperties} opacity={lit('foundation')}>
          <path
            d={`M${bodyX - 7} ${GROUND_Y - PLINTH_H} l${dx} ${dy} h${bodyW + 14} l${-dx} ${-dy} Z`}
            fill="var(--color-surface-3)"
            stroke="var(--color-line)"
          />
          <path
            d={`M${bodyX + bodyW + 7} ${GROUND_Y - PLINTH_H} l${dx} ${dy} v${PLINTH_H} l${-dx} ${-dy} Z`}
            fill="var(--color-canvas-2)"
            stroke="var(--color-line)"
          />
          <rect x={bodyX - 7} y={GROUND_Y - PLINTH_H} width={bodyW + 14} height={PLINTH_H} fill="var(--color-surface-3)" stroke="var(--color-line)" />
        </g>

        {/* the storeys, bottom-up */}
        {storeyList.map((st) => {
          const y = GROUND_Y - PLINTH_H - (st + 1) * FLOOR_H;
          const isGround = st === 0;
          return (
            <g key={st} className="lh-storey" style={{ '--i': 3 + st } as React.CSSProperties}>
              {/* the side face first, so the front overlaps its seam */}
              <path
                d={`M${bodyX + bodyW} ${y} l${dx} ${dy} v${FLOOR_H} l${-dx} ${-dy} Z`}
                fill="var(--color-canvas-2)"
                stroke="var(--color-line)"
                opacity={lit('wall')}
              />
              <rect x={bodyX} y={y} width={bodyW} height={FLOOR_H} fill="url(#lh-wall)" stroke="var(--color-line)" opacity={lit('wall')} />
              {/* the slab that carries the storey above */}
              <rect x={bodyX - 4} y={y} width={bodyW + 8} height="3.5" fill={finish.trim} opacity={lit('slab') * 0.7} />
              <path d={`M${bodyX + bodyW + 4} ${y} l${dx} ${dy} v3.5 l${-dx} ${-dy} Z`} fill={finish.trim} opacity={lit('slab') * 0.4} />
              {/* openings */}
              <g className="lh-openings" style={{ '--i': 3 + st } as React.CSSProperties} opacity={lit('door')}>
                {Array.from({ length: bays }, (_, b) => {
                  const bw = Math.round((bodyW / bays) * 0.44);
                  const bx = Math.round(bodyX + (bodyW / bays) * (b + 0.5) - bw / 2);
                  // The ground floor's middle bay is the door, not a window.
                  const isDoor = isGround && b === Math.floor(bays / 2);
                  // Keyed on where the opening actually is: two openings never share a position,
                  // and the position is what identifies one across a re-render.
                  return isDoor ? (
                    <rect key={`d${y}-${bx}`} x={bx} y={y + 13} width={bw} height={FLOOR_H - 13} rx="2" fill="var(--color-teal-50)" stroke={finish.trim} />
                  ) : (
                    <rect key={`w${y}-${bx}`} x={bx} y={y + 11} width={bw} height={FLOOR_H - 24} rx="1.5" fill="url(#lh-glass)" stroke={finish.trim} />
                  );
                })}
                {/* one window on the visible side wall, so the depth is inhabited too */}
                <path
                  d={`M${bodyX + bodyW + dx * 0.3} ${y + 11 + dy * 0.3} l${dx * 0.4} ${dy * 0.4} v${FLOOR_H - 24} l${-dx * 0.4} ${-dy * 0.4} Z`}
                  fill="url(#lh-glass)"
                  stroke={finish.trim}
                  opacity="0.85"
                />
              </g>
            </g>
          );
        })}

        {/* roof, and what is on it */}
        <g className="lh-part" style={{ '--i': 3 + storeys } as React.CSSProperties}>
          <path
            d={`M${bodyX - 6} ${bodyTop} l${dx} ${dy} h${bodyW + 12} l${-dx} ${-dy} Z`}
            fill="var(--color-surface-3)"
            stroke="var(--color-line)"
            opacity={lit('roof')}
          />
          <rect x={bodyX - 6} y={bodyTop} width={bodyW + 12} height="6" fill={finish.trim} opacity={lit('roof') * 0.9} />
          <path d={`M${bodyX + bodyW + 6} ${bodyTop} l${dx} ${dy} v6 l${-dx} ${-dy} Z`} fill={finish.trim} opacity={lit('roof') * 0.5} />
          {inputs.addons.solar && (
            <g className="lh-solar" opacity={lit('solar')}>
              {[0, 1, 2].map((i) => {
                const pw = bodyW / 4.4;
                const px = bodyX + 10 + i * (pw + 8);
                return (
                  <path
                    key={i}
                    d={`M${px} ${bodyTop - 1} l${dx * 0.6} ${dy * 0.6} h${pw} l${-dx * 0.6} ${-dy * 0.6} Z`}
                    fill="var(--color-brand)"
                    opacity="0.7"
                    stroke="var(--color-teal-600)"
                  />
                );
              })}
            </g>
          )}
        </g>

        {/* parking, as a porch slab off the ground floor */}
        {inputs.parking && (
          <g className="lh-part" style={{ '--i': 4 + storeys } as React.CSSProperties} opacity={lit('parking')}>
            <path
              d={`M${bodyX - 58} ${GROUND_Y - PLINTH_H - 26} l${dx * 0.7} ${dy * 0.7} h56 l${-dx * 0.7} ${-dy * 0.7} Z`}
              fill="var(--color-surface-2)"
              stroke={finish.trim}
            />
            <line x1={bodyX - 56} y1={GROUND_Y - PLINTH_H - 25} x2={bodyX - 56} y2={GROUND_Y} stroke="var(--color-line-strong)" strokeWidth="2" />
          </g>
        )}

        {/* the CCTV, when it is bought */}
        {inputs.addons.cctv && (
          <g className="lh-part" style={{ '--i': 5 + storeys } as React.CSSProperties} opacity={lit('cctv')}>
            <circle cx={bodyX + 12} cy={bodyTop + 14} r="3.5" fill="var(--color-ink-2)" />
            <path d={`M${bodyX + 12} ${bodyTop + 14} l-15 -5 v 11 z`} fill="var(--color-brand)" opacity="0.16" />
          </g>
        )}
      </svg>

      <figcaption id="lh-cap" className="lh-cap">
        <span className="lh-cap-main">
          <span className="fig">{derived.floorsLabel}</span> on <span className="fig">{Math.round(derived.plotAreaSqft).toLocaleString('en-IN')}</span> sq ft
        </span>
        <span className="lh-cap-sub">{finish.label}</span>
      </figcaption>
    </figure>
  );
}
