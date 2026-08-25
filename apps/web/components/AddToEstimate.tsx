'use client';

import React from 'react';
import { addPick, readPicks } from '@/lib/picks';
import { IconCheck } from './icons';
import { useToast } from './Toast';

/** "Add to Estimate": writes this device's picks, then toasts the running count. Sizes follow the button contract. */
export default function AddToEstimate({
  skuCode,
  qty = 1,
  size = 'default',
  variant = 'primary',
  block = false,
  label = 'Add to Estimate',
  className = '',
}: {
  skuCode: string;
  qty?: number;
  size?: 'sm' | 'md' | 'default' | 'lg';
  variant?: 'primary' | 'secondary';
  block?: boolean;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [added, setAdded] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onClick = () => {
    addPick({ sku_code: skuCode, qty: Math.max(1, Math.round(qty)) });
    const n = readPicks().reduce((s, p) => s + p.qty, 0);
    toast(`Added to your estimate · ${n} ${n === 1 ? 'item' : 'items'}`);
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1400);
  };

  const cls = ['btn', variant === 'primary' ? 'btn-primary' : 'btn-secondary', size !== 'default' ? `btn--${size}` : '', block ? 'btn--block' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onClick}>
      {added ? (
        <>
          <IconCheck size={16} /> Added
        </>
      ) : (
        label
      )}
    </button>
  );
}
