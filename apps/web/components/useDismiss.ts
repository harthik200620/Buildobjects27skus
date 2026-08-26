'use client';

import React from 'react';

/**
 * Close-on-Escape and close-on-outside-click for an overlay, with focus returned to whatever
 * opened it.
 *
 * Five components had grown their own copy of this effect and two more had none at all — the
 * mobile filter sheet and the rewards modal could not be closed from a keyboard. Keeping it in
 * one place is what makes "every overlay dismisses the same way" a property of the app rather
 * than a thing each component remembers.
 *
 *   const panel = React.useRef<HTMLDivElement>(null);
 *   const trigger = React.useRef<HTMLButtonElement>(null);
 *   useDismiss(open, () => setOpen(false), { panel, trigger });
 *
 * Listening on `mousedown` rather than `click` matters: a `click` listener fires after the
 * target has already handled the press, so a control inside the panel that unmounts itself
 * would close the panel a second time.
 */
type Ref = React.RefObject<HTMLElement | null>;

export interface DismissRefs {
  /**
   * The overlay. A press outside it closes; a press inside is ignored.
   *
   * Takes a LIST when the overlay is not one box. A panel rendered through a portal is no
   * longer a descendant of the control that opened it, so "inside" is two subtrees rather than
   * one — and passing only the panel makes pressing the trigger close and immediately reopen,
   * which is a toggle that cannot be toggled off.
   */
  panel?: Ref | Ref[];
  /** The control that opened it. Focus returns here on Escape, so tab order is not lost. */
  trigger?: Ref;
}

export function useDismiss(open: boolean, close: () => void, { panel, trigger }: DismissRefs = {}): void {
  // Read the latest `close` from a ref so callers can pass an inline arrow without the effect
  // tearing down and re-subscribing on every render.
  const closeRef = React.useRef(close);
  closeRef.current = close;

  React.useEffect(() => {
    if (!open) return;

    const panels = panel ? (Array.isArray(panel) ? panel : [panel]) : [];
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!panels.some((r) => r.current?.contains(e.target as Node))) closeRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
      /* preventScroll: the page is where the reader left it, and the trigger is on screen. */
      trigger?.current?.focus({ preventScroll: true });
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, panel, trigger]);
}

/**
 * Stops the page behind a modal from scrolling while it is open.
 *
 * It used to hand back the scrollbar's width as padding on <body>, to stop the page jumping
 * sideways when the scrollbar disappeared. That fixed one jump and caused another: the header is
 * a full-width sticky bar in body's flow, so padding on body narrowed the whole bar by fifteen
 * pixels every time any modal opened. The scrollbar's space is reserved permanently now —
 * `scrollbar-gutter: stable` on <html> — so there is nothing to compensate for and nothing moves.
 *
 * EVERY overlay that covers the viewport has to call this. An overlay that does not lets the page
 * keep scrolling behind it, which is the commonest scroll complaint there is: the reader turns the
 * wheel expecting the dialog to move and the page underneath moves instead.
 */
export function useScrollLock(locked: boolean): void {
  React.useEffect(() => {
    if (!locked) return;
    const { body } = document;
    const y = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };

    /*
     * PIN THE BODY, DO NOT HIDE THE OVERFLOW.
     *
     * `overflow: hidden` is the obvious lock and it loses the reader's place. Measured, both
     * ways round: hiding <body>'s overflow propagates the value to the viewport and reassigns
     * which element owns the scroll, dropping the offset — ⌘K opened at 300px down put the page
     * at 0. Hiding the ROOT's overflow does the same, and once it is hidden there is no
     * scrollable overflow left, so `scrollTo` cannot put the offset back either. Closing the
     * dialog then returned the reader to the top of a page they were halfway through.
     *
     * Pinning the body holds the exact pixel: the page is lifted by the scroll offset it already
     * had, so it does not appear to move, and the offset is a number we still hold and can hand
     * back on release. It is also the only form of this that works on iOS Safari.
     *
     * The header keeps working. It is `position: sticky` inside body, and body's box still spans
     * the viewport's top edge, so the bar stays stuck where it was.
     *
     * Nothing shifts sideways when the page's scrollbar goes away, because <html> reserves its
     * space permanently — see `scrollbar-gutter: stable` in the theme.
     */
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, y);
    };
  }, [locked]);
}
