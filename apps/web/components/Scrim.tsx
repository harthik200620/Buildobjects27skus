'use client';

/**
 * The dimmed backdrop behind a popover or sheet.
 *
 * It is decoration, not a control: a pointer user presses it to dismiss, a keyboard user presses
 * Escape (see `useDismiss`), and a screen reader should never meet it at all. Hence `aria-hidden`
 * and no key handler — adding one would put an unlabelled, unreachable element in the tab order
 * to satisfy a rule rather than a person.
 *
 * Having it in one place means that reasoning is written down once instead of at each backdrop.
 */
export default function Scrim({ className = '', onDismiss }: { className?: string; onDismiss: () => void }) {
  return <div className={`scrim ${className}`.trim()} aria-hidden="true" onClick={onDismiss} />;
}
