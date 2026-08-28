'use client';

import React from 'react';

/**
 * A measuring tape you scroll, for a dimension in feet.
 *
 * ── WHY A RULER AND NOT A NUMBER FIELD ──────────────────────────────────────────────────────
 * A plot's length is a MEASUREMENT, and a number field asks the reader to have already decided
 * one. Most people know their plot as "about thirty by forty" and want to feel the difference
 * between 30 and 32 rather than type it. A tape gives them that: the ticks pass under the needle,
 * the total above changes as they go, and 40 is a place on a scale rather than a value in a box.
 *
 * ── IT IS A SCROLLER, WHICH IS THE POINT AND ALSO THE RISK ───────────────────────────────────
 * Native overflow scrolling, so a trackpad flick and a thumb swipe both have real momentum and
 * neither costs a line of JavaScript. Three details keep that from leaking into the page:
 *
 *   `overscroll-behavior-x: contain` — the tape running out does not start scrolling the page
 *     behind it, which is the single most irritating failure mode of a horizontal strip.
 *   `scroll-snap-type: x mandatory` — it always comes to rest ON a foot, never between two.
 *   The value is read in a rAF, not on every scroll event, so a fast flick does not re-render
 *     the whole estimate sixty times a second.
 *
 * ── AND IT IS STILL TYPEABLE ────────────────────────────────────────────────────────────────
 * The figure above the tape is an input. Somebody who knows their plot is 33.5 ft should not
 * have to scroll to it, and somebody on a keyboard should not have to scroll at all — the tape
 * itself is a `slider` with arrow keys, Home and End, and the readout is a plain number field.
 * Scrolling writes the figure; typing scrolls the tape. Neither is the primary.
 */

export interface RulerInputProps {
  label: React.ReactNode;
  value: number;
  min?: number;
  max?: number;
  /** Feet between ticks. A whole foot is the honest resolution for a plot boundary. */
  step?: number;
  /** How often a tick is labelled and drawn tall. */
  major?: number;
  unit?: string;
  onChange: (v: number) => void;
}

export default function RulerInput({ label, value, min = 5, max = 100, step = 1, major = 10, unit = 'ft', onChange }: RulerInputProps) {
  const tape = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef(0);
  /* True while the tape itself is driving the value, so the effect below does not fight it by
     scrolling back to where it already is. */
  const fromScroll = React.useRef(false);
  const [typed, setTyped] = React.useState<string | null>(null);

  const count = Math.round((max - min) / step) + 1;

  /* Put the tape where the value is — on mount, and whenever the value changes from anywhere
     that is not the tape itself: a drawing was read, the figure was typed, an estimate was
     shared in. Guarded by `fromScroll`, or every scroll would be answered by a scroll back. */
  React.useEffect(() => {
    const el = tape.current;
    if (!el) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const i = Math.max(0, Math.min(count - 1, Math.round((value - min) / step)));
    const tick = el.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (tick) el.scrollTo({ left: tick.offsetLeft - el.clientWidth / 2 + tick.offsetWidth / 2, behavior: 'auto' });
  }, [value, min, step, count]);

  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = tape.current;
      const first = el?.firstElementChild?.firstElementChild as HTMLElement | undefined;
      if (!el || !first) return;
      /* Off the real tick geometry, not off a scrollLeft ratio. The strip is padded by half the
         viewport at each end so the first and last foot can reach the needle, and any ratio that
         ignores that padding is wrong at both ends and only right in the middle. */
      const w = first.offsetWidth;
      if (!w) return;
      const centre = el.scrollLeft + el.clientWidth / 2;
      const i = Math.max(0, Math.min(count - 1, Math.round((centre - first.offsetLeft - w / 2) / w)));
      const next = Math.round((min + i * step) * 100) / 100;
      if (next !== value) {
        fromScroll.current = true;
        onChange(next);
      }
    });
  };

  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const nudge = (by: number) => onChange(Math.max(min, Math.min(max, Math.round((value + by) * 100) / 100)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') nudge(step);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') nudge(-step);
    else if (k === 'PageUp') nudge(major * step);
    else if (k === 'PageDown') nudge(-major * step);
    else if (k === 'Home') onChange(min);
    else if (k === 'End') onChange(max);
    else return;
    e.preventDefault();
  };

  /*
   * The field's spoken name, whatever shape the visible label is.
   *
   * `label` is a ReactNode because the Length ruler decorates it with "from your drawing"; a
   * string is the common case and a fragment is the awkward one. Taking the first string child is
   * enough for both, and the unit turns "Length" into "Length, ft" — the two things a person
   * needs to know before they type a number into it.
   */
  const name = React.useMemo(() => {
    const first = (node: React.ReactNode): string => {
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(first).find(Boolean) ?? '';
      if (React.isValidElement(node)) return first((node.props as { children?: React.ReactNode }).children);
      return '';
    };
    const base = first(label).trim() || 'Value';
    return unit ? `${base}, ${unit}` : base;
  }, [label, unit]);

  const commit = (raw: string) => {
    const n = Number(raw);
    setTyped(null);
    if (Number.isFinite(n) && n > 0) onChange(Math.max(min, Math.min(max, n)));
  };

  return (
    <div className="ruler">
      <div className="ruler-head">
        <span className="wz-label">{label}</span>
        <span className="ruler-value">
          {/* The visible label belongs to the whole ruler, not to this field, so the field says its
              own name — "Length, ft". It used to, but only when `label` happened to be a string,
              and the Length ruler passes a fragment (it carries a "from your drawing" note), so
              that one input announced nothing at all. `name` below is derived either way. */}
          <input
            aria-label={name}
            className="ruler-field fig"
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={typed ?? value}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="ruler-unit">{unit}</span>
        </span>
      </div>

      {/* A range input cannot be a tape: no ticks, no labels, no momentum. This carries the
          slider role and the whole keyboard contract itself. */}
      <div
        ref={tape}
        className="ruler-tape"
        role="slider"
        tabIndex={0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} ${unit}`}
        aria-label={typeof label === 'string' ? label : undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        <div className="ruler-strip">
          {Array.from({ length: count }, (_, i) => {
            const v = Math.round((min + i * step) * 100) / 100;
            const isMajor = Number.isInteger(v) && v % major === 0;
            return (
              <span key={v} data-i={i} className={`ruler-tick${isMajor ? ' is-major' : ''}`}>
                {isMajor && <span className="ruler-num fig">{v}</span>}
              </span>
            );
          })}
        </div>
      </div>
      <span className="ruler-needle" aria-hidden="true" />
    </div>
  );
}
