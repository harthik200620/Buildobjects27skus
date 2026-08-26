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
      trigger?.current?.focus();
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
 * Stops the page behind a modal from scrolling while it is open, and gives back the scrollbar
 * width as padding so the layout does not jump sideways on desktop.
 */
export function useScrollLock(locked: boolean): void {
  React.useEffect(() => {
    if (!locked) return;
    const { body, documentElement } = document;
    const gutter = window.innerWidth - documentElement.clientWidth;
    const overflow = body.style.overflow;
    const paddingRight = body.style.paddingRight;

    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => {
      body.style.overflow = overflow;
      body.style.paddingRight = paddingRight;
    };
  }, [locked]);
}
