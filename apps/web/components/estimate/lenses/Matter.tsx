'use client';

import { formatRupees } from '@buildobjects/catalog';
import type { EstimateResult } from '@buildobjects/estimator';
import { HUMAN_HEIGHT_M, type MaterialPile, materialise } from '@buildobjects/estimator';
import React from 'react';

/**
 * MATTER — what your money physically is.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────────────────────
 * TRUE SCALE, ALWAYS. Every pile below is drawn at the size it will actually occupy on the plot,
 * in the same metre-space as the house and the human figure. Nothing is exaggerated to look
 * impressive and nothing is shrunk to fit the frame.
 *
 * Some of it comes out enormous — the sand for an 1,800 sqft house is seven lorry loads and it is
 * taller than a person. Some of it comes out tiny — six tonnes of TMT steel is a cube under a
 * metre on a side, which surprises everybody. BOTH DIRECTIONS ARE THE POINT. A buyer who watches
 * this and later stands beside the real delivery has to find that it matches.
 *
 * ── WHY IT IS AN SVG AND NOT A CANVAS ───────────────────────────────────────────────────────
 * This is the representation at EVERY tier, not the fallback. One `viewBox` in metres does the
 * scaling; the geometry is a few dozen nodes; it is crisp at any zoom, it costs no WebGL context,
 * it prints, and a screen reader can be given the same numbers. The 3D lens adds a camera to this
 * information — it does not add information.
 *
 * ── THE HUMAN FIGURE IS NOT DECORATION ──────────────────────────────────────────────────────
 * Without a body in frame, "42 cubic metres" is a number and not a quantity. The figure is 5' 6"
 * — the median adult height in India — and it is always present in this lens.
 */

const SCALE = 26; /* px per metre. One number, and everything in the scene obeys it. */
const GROUND_Y = 300;
const PAD = 28;

export interface MatterProps {
  result: EstimateResult;
  /** Bidirectional hover: the table lights a pile, a pile lights the table row. */
  active: string | null;
  onActive: (key: string | null) => void;
}

/** A heap of bulk material, drawn as the cone section it actually forms at its angle of repose. */
function Heap({ pile, x }: { pile: MaterialPile; x: number }) {
  const w = pile.box.l * SCALE;
  const h = (pile.heap?.height ?? pile.box.h) * SCALE;
  return <path d={`M ${x} ${GROUND_Y} L ${x + w / 2} ${GROUND_Y - h} L ${x + w} ${GROUND_Y} Z`} />;
}

/**
 * A stack, drawn as the courses it is actually built in.
 *
 * Capped at forty drawn courses — beyond that the lines are closer together than a pixel and the
 * browser is asked to paint sixty thousand invisible strokes. The BOX is still true scale; only
 * the texture inside it stops subdividing.
 */
function Stack({ pile, x }: { pile: MaterialPile; x: number }) {
  const w = pile.box.l * SCALE;
  const h = pile.box.h * SCALE;
  const layers = Math.min(40, pile.grid?.layers ?? 1);
  const step = h / Math.max(1, layers);
  const courses: React.ReactNode[] = [];
  for (let i = 1; i < layers; i += 1) {
    const y = GROUND_Y - i * step;
    courses.push(<line key={i} x1={x} y1={y} x2={x + w} y2={y} className="matter-course" />);
  }
  return (
    <g>
      <rect x={x} y={GROUND_Y - h} width={w} height={h} />
      {courses}
    </g>
  );
}

function Bundle({ pile, x }: { pile: MaterialPile; x: number }) {
  /* A bundle lies down: twelve metres long and a few hundred millimetres thick. */
  const w = pile.box.l * SCALE;
  const h = Math.max(3, pile.box.h * SCALE);
  return <rect x={x} y={GROUND_Y - h} width={w} height={h} rx={2} />;
}

export default function Matter({ result, active, onActive }: MatterProps) {
  const piles = React.useMemo(() => materialise(result), [result]);

  /* Lay the piles along the ground with a metre of clearance, in the order the engine gave them
     (largest volume first), so the scene reads left to right from "most of your money" down. */
  const laid = React.useMemo(() => {
    let x = PAD + HUMAN_HEIGHT_M * SCALE + 24;
    return piles.map((p) => {
      const w = Math.max(p.box.l * SCALE, 34);
      const at = x;
      x += w + 18;
      return { pile: p, x: at, w };
    });
  }, [piles]);

  const width = laid.length ? laid[laid.length - 1].x + laid[laid.length - 1].w + PAD : 600;
  const tallest = Math.max(GROUND_Y - 40, ...laid.map((l) => l.pile.box.h * SCALE + 60));

  return (
    <div className="matter">
      <p className="matter-lede">
        Everything below is drawn at the size it will actually be on your plot — the same scale as the figure on the left, who is 5&nbsp;ft&nbsp;6&nbsp;in.
        Nothing here is exaggerated, and nothing is shrunk to fit.
      </p>
      <div className="matter-stage" role="img" aria-label={`Materials for this house at true scale: ${piles.map((p) => `${fmtQty(p)} ${p.label}`).join(', ')}`}>
        <svg viewBox={`0 0 ${width} ${tallest + 70}`} width={width} height={tallest + 70} aria-hidden="true">
          <title>Materials at true scale</title>
          {/* The ground the whole scene stands on. Everything else is measured from it. */}
          <line x1={0} y1={GROUND_Y} x2={width} y2={GROUND_Y} className="matter-ground" />

          {/* 5' 6". The reason any of the sizes above mean anything. */}
          <g className="matter-human" transform={`translate(${PAD} 0)`}>
            <title>An adult, 5 ft 6 in</title>
            <circle cx={9} cy={GROUND_Y - HUMAN_HEIGHT_M * SCALE + 6} r={6} />
            <path
              d={`M 9 ${GROUND_Y - HUMAN_HEIGHT_M * SCALE + 13} L 9 ${GROUND_Y - 16} M 9 ${GROUND_Y - 16} L 2 ${GROUND_Y} M 9 ${GROUND_Y - 16} L 16 ${GROUND_Y} M 2 ${GROUND_Y - HUMAN_HEIGHT_M * SCALE + 22} L 16 ${GROUND_Y - HUMAN_HEIGHT_M * SCALE + 22}`}
            />
          </g>

          {laid.map(({ pile, x, w }) => {
            const on = active === pile.key;
            return (
              <g
                key={pile.key}
                className={`matter-pile matter-pile--${pile.shape}${on ? ' is-on' : ''}${active && !on ? ' is-off' : ''}`}
                onMouseEnter={() => onActive(pile.key)}
                onMouseLeave={() => onActive(null)}
                onFocus={() => onActive(pile.key)}
                onBlur={() => onActive(null)}
                tabIndex={0}
                role="button"
                aria-label={`${pile.label}: ${fmtQty(pile)}, ${formatRupees(pile.amount)}`}
              >
                {pile.shape === 'heap' ? <Heap pile={pile} x={x} /> : pile.shape === 'bundle' ? <Bundle pile={pile} x={x} /> : <Stack pile={pile} x={x} />}
                <text x={x + w / 2} y={GROUND_Y + 20} className="matter-name">
                  {pile.label}
                </text>
                <text x={x + w / 2} y={GROUND_Y + 36} className="matter-qty fig">
                  {fmtQty(pile)}
                </text>
                {pile.tipperLoads !== null && (
                  <text x={x + w / 2} y={GROUND_Y + 52} className="matter-sub">
                    {pile.tipperLoads} lorry {pile.tipperLoads === 1 ? 'load' : 'loads'}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* The same information as a table, which is what a screen reader and a printer get, and
          what a buyer hovers to light a pile. */}
      <div className="matter-table-wrap">
        <table className="matter-table">
          <caption className="micro">Every physical thing this house buys, and the space it takes</caption>
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Quantity</th>
              <th scope="col">Volume</th>
              <th scope="col">Size</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {piles.map((p) => (
              <tr
                key={p.key}
                className={active === p.key ? 'is-on' : active ? 'is-off' : undefined}
                onMouseEnter={() => onActive(p.key)}
                onMouseLeave={() => onActive(null)}
              >
                <th scope="row">{p.label}</th>
                <td className="fig">{fmtQty(p)}</td>
                <td className="fig">{p.cum} m³</td>
                <td className="matter-size">{sizeNote(p)}</td>
                <td className="fig">{formatRupees(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="matter-basis micro">
        Volumes from published unit weights and standard Indian trade sizes — 50 kg cement bag, 230 × 110 × 70 mm brick, TMT at 7,850 kg/m³, sand at 1,600 kg/m³
        bulk. A lorry load is 300 cft.
      </p>
    </div>
  );
}

function fmtQty(p: MaterialPile): string {
  const n = p.qty >= 1000 ? Math.round(p.qty).toLocaleString('en-IN') : Math.round(p.qty * 10) / 10;
  return `${n} ${p.unit}`;
}

/**
 * The one line that makes a volume legible.
 *
 * A cube side for the dense things, because "six tonnes of steel" means nothing and "a cube 0.9 m
 * on a side" means everything; a footprint for the things that spread out, because that is the
 * question a buyer is actually asking about sand — where am I going to put it.
 */
function sizeNote(p: MaterialPile): string {
  if (p.shape === 'heap') return `a heap ${p.box.l} m across and ${p.box.h} m high`;
  if (p.shape === 'bundle') return `bundles ${p.box.l} m long, ${p.cubeSideM} m cube of metal`;
  return `${p.box.l} × ${p.box.w} m, stacked ${p.box.h} m high`;
}
