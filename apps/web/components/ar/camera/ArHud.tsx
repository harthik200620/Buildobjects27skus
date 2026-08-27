'use client';

import { type Nudge, type PlacementRule, type ProductDims, SURFACE_LABEL, type Surface } from '@buildobjects/ar-engine';
import React from 'react';
import { IconCamera, IconCart, IconClose, IconFlipCamera, IconMove, IconRuler, IconSeeking, IconSpark, IconTarget } from '@/components/icons';

/**
 * THE VIEW IN ROOM, AS A THING SOMEBODY LOOKS AT.
 *
 * What this replaces was eleven floating elements: four pills across the top, a coloured banner, a
 * tip, a nudge, and four more pills along the bottom, each with its own inline styles, all
 * competing for the same attention at the same weight. Nothing was primary. The product's own name
 * was truncated to "UltraTech C..." while "Drag to move · rotate below" got a full-width chip, and
 * the price of the thing you were looking at appeared nowhere at all.
 *
 * The shape here is the one every good camera product converges on, for the same reason: the
 * picture is the content, so chrome lives at the two edges and gets out of the way in between.
 *
 *   TOP        one row. Close, what you are looking at, flip. Nothing else, ever.
 *   MIDDLE     empty, unless there is something to say. Coaching appears while the view is still
 *              looking for a surface and leaves once it has one; the nudge appears only when the
 *              product is off screen. Neither is permanent furniture.
 *   BOTTOM     a sheet, in the order a person needs it: what it is and what it costs, then the
 *              controls that change it, then what to do about it.
 *
 * The controls themselves moved from buttons to gestures — pinch to size, twist to turn, drag to
 * move — because that is what hands do on a camera view, and a pair of +/- buttons stepping 0.2 at
 * a time is a spreadsheet. The buttons remain underneath as the accessible path, which is why they
 * are still here.
 */

export interface ArHudProps {
  name: string;
  brand: string;
  category: string;
  dims: ProductDims;
  rule: PlacementRule;
  price: number | null;
  unit: string;
  thumbnail: string | null;
  pdpHref: string | null;

  camStatus: string;
  modelState: 'loading' | 'ready' | 'failed';
  /** The one sentence over the feed, from the engine. */
  prompt: { tone: 'seek' | 'seeking' | 'ok'; text: string };
  surface: Surface;
  scaleMult: number;
  enlarged: boolean;
  yaw: number;
  nudge: Nudge;
  oversized: boolean;
  /** "this cement bag" — the engine's noun, already articled. */
  noun: string;
  /** Live readout while a two-finger gesture is in flight. */
  gesture: { kind: 'scale' | 'rotate'; value: string } | null;
  /** True once the product has been placed and is on screen: the coaching layer stands down. */
  settled: boolean;

  onExit: () => void;
  onFlip: () => void;
  onSurface: (s: Surface) => void;
  onScale: (m: number) => void;
  onTrueSize: () => void;
  onYaw: (deg: number) => void;
  onRecentre: () => void;
  onCapture: () => void;
  onMakeReal: () => void;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "this cement bag" -> "cement bag". */
const bare = (noun: string) => noun.replace(/^this /, '');

/**
 * The name, with the brand taken off the front when it is already there.
 *
 * Half this catalogue names its products with the brand included — brand "Hikvision", name
 * "Hikvision DS-2CE76D0T-ITPFS"; brand "UltraTech Cement", name "UltraTech Portland Pozzolana
 * Cement". Printing the two fields next to each other, which is the obvious thing to do, gives
 * "Hikvision Hikvision DS-…" on the one surface where the product is supposed to be identified.
 */
function withoutBrand(name: string, brand: string): string {
  const b = brand.trim();
  if (!b) return name;
  const n = name.trim();
  if (n.toLowerCase().startsWith(`${b.toLowerCase()} `)) return n.slice(b.length).trim();
  /* Brands like "UltraTech Cement" against a name starting "UltraTech": drop the shared head. */
  const first = b.split(/\s+/)[0];
  if (first.length > 3 && n.toLowerCase().startsWith(`${first.toLowerCase()} `)) return n.slice(first.length).trim();
  return n;
}

export default function ArHud(props: ArHudProps) {
  const { rule, dims, scaleMult, enlarged, surface, nudge, oversized, noun, prompt, modelState, camStatus, gesture, settled } = props;
  const [sheetOpen, setSheetOpen] = React.useState(true);

  /*
   * Coaching earns its place or leaves. It shows while the model is arriving, while the view is
   * still looking for a surface, and while the product is somewhere you are not pointing — and in
   * no other state, because a permanent instruction is just something to read past.
   */
  const coaching = nudge
    ? /* An arrow pointing off screen and a line saying "drag it to move it" are two instructions
         about the same product at the same moment, and only one of them is actionable. */
      null
    : modelState === 'loading'
      ? { tone: 'seeking' as const, text: `Loading ${bare(noun)} in 3D` }
      : modelState === 'failed'
        ? { tone: 'seek' as const, text: 'That 3D model could not be loaded — reopen this view to try again' }
        : camStatus !== 'streaming'
          ? null
          : !settled
            ? prompt
            : null;

  const sizeLabel = `${Math.round(scaleMult * 100)}%${enlarged ? ' auto' : ''}`;
  const trueSize = Math.abs(scaleMult - 1) < 0.01;

  return (
    <>
      {/* ── Top: close, what you are looking at, flip. ─────────────────────── */}
      <div className="arv-top">
        <button type="button" className="arv-icon" onClick={props.onExit} aria-label="Close the room view">
          <IconClose size={17} />
        </button>

        <div className="arv-ident">
          <span className="arv-ident-name">{props.name}</span>
          <span className="arv-ident-meta">
            {dims.w_mm}×{dims.h_mm} mm
            {/*
             * The badge IS the control. It already shows the number that matters, so putting a
             * separate "True size" button in the action row was a second copy of the same idea
             * competing for space with the shutter — and at 350 px the row overflowed and the
             * buttons overlapped each other.
             */}
            <button
              type="button"
              className={`arv-truth${trueSize ? ' arv-truth--exact' : ''}`}
              onClick={props.onTrueSize}
              disabled={trueSize}
              aria-label={trueSize ? 'Shown at true size' : `Shown at ${sizeLabel} — tap for true size`}
            >
              {trueSize ? 'true size' : sizeLabel}
            </button>
          </span>
        </div>

        <button type="button" className="arv-icon" onClick={props.onFlip} aria-label="Switch camera">
          <IconFlipCamera size={17} />
        </button>
      </div>

      {/* ── Middle: only when there is something to say. ───────────────────── */}
      <div className="arv-middle" aria-live="polite">
        {coaching && (
          <div className={`arv-coach arv-coach--${coaching.tone}`}>
            {coaching.tone === 'seeking' ? <IconSeeking size={15} /> : coaching.tone === 'ok' ? <IconMove size={15} /> : <IconTarget size={15} />}
            <span>{coaching.text}</span>
          </div>
        )}

        {/*
         * The reticle is the promise that something is about to happen. It pulses while the view is
         * hunting for a surface and disappears the moment it has one — so it reads as progress
         * rather than as a permanent crosshair, which is what a fixed reticle would be.
         */}
        {camStatus === 'streaming' && modelState === 'ready' && !settled && (
          <div className="arv-reticle" aria-hidden="true">
            <span className="arv-reticle-ring" />
            <span className="arv-reticle-dot" />
          </div>
        )}

        {nudge && (
          <button type="button" className="arv-nudge" onClick={props.onRecentre}>
            <span className={`arv-nudge-arrow arv-nudge-arrow--${nudge}`} aria-hidden="true" />
            <span>
              {oversized
                ? `Too close to fit — tilt ${nudge} for the whole ${bare(noun)}`
                : `${cap(bare(noun))} is ${nudge === 'up' ? 'above' : nudge === 'down' ? 'below' : `to the ${nudge}`}`}
            </span>
            <span className="arv-nudge-cta">Bring it here</span>
          </button>
        )}

        {/* Live readout for a gesture in flight — a number under your fingers, then gone. */}
        {gesture && (
          <div className="arv-readout" aria-hidden="true">
            {gesture.kind === 'scale' ? <IconRuler size={14} /> : <IconMove size={14} />}
            <span>{gesture.value}</span>
          </div>
        )}
      </div>

      {/* ── Bottom: what it is, what changes it, what to do about it. ──────── */}
      <section className={`arv-sheet${sheetOpen ? '' : ' arv-sheet--closed'}`} aria-label="Product and placement controls">
        <button
          type="button"
          className="arv-grip"
          onClick={() => setSheetOpen((o) => !o)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Hide the controls' : 'Show the controls'}
        >
          <span />
        </button>

        <div className="arv-product">
          {props.thumbnail ? (
            <img className="arv-thumb" src={props.thumbnail} alt="" aria-hidden="true" />
          ) : (
            <div className="arv-thumb arv-thumb--blank" aria-hidden="true" />
          )}
          <div className="arv-product-text">
            {/* `name` already carries the brand — printing both gave "UltraTech Cement UltraTech
                Cement UltraTech Portland…", which is the sort of thing nobody notices until it is
                on a phone in front of a customer. */}
            <p className="arv-product-name">
              <span className="arv-brand">{props.brand}</span> {withoutBrand(props.name, props.brand)}
            </p>
            <p className="arv-product-meta">
              {props.price != null ? (
                <>
                  <span className="arv-price fig">{inr(props.price)}</span>
                  <span className="arv-unit">per {props.unit}</span>
                </>
              ) : (
                <span className="arv-unit">Price on request</span>
              )}
            </p>
          </div>
        </div>

        <div className="arv-rail">
          {/*
           * Where it sits. One control per surface the rule allows, so a cement bag offers floor
           * and open ground and a CCTV camera offers wall and ceiling — rather than the fixed
           * Wall/Ceiling pair that used to be wrong for twenty-four of twenty-seven products.
           */}
          {rule.surfaces.length > 1 && (
            <div className="arv-seg" role="group" aria-label="Surface">
              {rule.surfaces.map((sf) => (
                <button key={sf} type="button" className="arv-seg-opt" aria-pressed={surface === sf} onClick={() => props.onSurface(sf)}>
                  {SURFACE_LABEL[sf] ?? sf}
                </button>
              ))}
            </div>
          )}

          <label className="arv-slider">
            <span className="arv-slider-label">
              Size
              <span className="arv-slider-value fig">{sizeLabel}</span>
            </span>
            {/*
             * A slider with a detent at true size, not a pair of buttons stepping 0.2. The detent
             * is the point: 100 % is the whole claim of the feature, so it is a place the control
             * physically stops at rather than a number you have to land on by counting taps.
             */}
            <input
              type="range"
              min={40}
              max={400}
              step={1}
              value={Math.round(scaleMult * 100)}
              onChange={(e) => {
                const v = Number(e.target.value);
                props.onScale(Math.abs(v - 100) <= 6 ? 1 : v / 100);
              }}
              aria-label="Size, as a percentage of true size"
            />
          </label>

          <label className="arv-slider">
            <span className="arv-slider-label">
              Turn
              <span className="arv-slider-value fig">{Math.round(((props.yaw % 360) + 360) % 360)}°</span>
            </span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={((props.yaw % 360) + 360) % 360}
              onChange={(e) => props.onYaw(Number(e.target.value))}
              aria-label="Rotation in degrees"
            />
          </label>
        </div>

        <div className="arv-actions">
          <button type="button" className="arv-shutter" onClick={props.onCapture} aria-label="Take a photo of this view">
            <IconCamera size={22} />
          </button>
          <button type="button" className="arv-action" onClick={props.onMakeReal}>
            <IconSpark size={15} /> Make it real
          </button>
          {props.pdpHref ? (
            <a className="arv-action arv-action--buy" href={props.pdpHref}>
              <IconCart size={15} /> View product
            </a>
          ) : null}
        </div>

        <p className="arv-hint">
          <IconMove size={12} /> Drag to move · pinch to size · twist to turn
        </p>
      </section>
    </>
  );
}
