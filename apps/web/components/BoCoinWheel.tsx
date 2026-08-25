'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { hasSpunWheel } from '@/lib/coins';
import { useDismiss, useScrollLock } from './useDismiss';

/**
 * The wheel is 1,378 lines and it is mounted by the header, which means it was in the initial
 * client bundle of every route in the store — a page of cement bags paying for a reward
 * animation it will not show unless the visitor has never spun. It loads when it opens.
 */
const RewardEngine = dynamic(() => import('./RewardEngine/RewardEngine'), { ssr: false });

/** How long a first-time visitor gets to look at the page before the wheel offers itself. */
const FIRST_VISIT_DELAY_MS = 1_200;

/**
 * The BO Coins wheel in a modal.
 *
 * Two ways in, and they are deliberately different: the header mounts one with no props, which
 * opens itself once per visitor who has never spun; the cart and account menus mount one with
 * `forceOpen` because the user asked for it. The controlled case opens on the first render
 * rather than through an effect, so it never flashes an empty frame.
 */
export default function BoCoinWheel({ forceOpen = false, onClose }: { forceOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = React.useState(forceOpen);
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (forceOpen) return;
    const timer = setTimeout(() => {
      if (!hasSpunWheel()) setOpen(true);
    }, FIRST_VISIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [forceOpen]);

  const close = React.useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useDismiss(open, close, { panel });
  useScrollLock(open);

  if (!open) return null;

  return (
    <div className="modal-scrim">
      <div ref={panel} className="modal-panel fade-up" role="dialog" aria-modal="true" aria-label="BO Coins reward wheel">
        <RewardEngine onClose={close} />
      </div>
    </div>
  );
}
