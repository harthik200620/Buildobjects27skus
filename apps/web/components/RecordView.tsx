'use client';

import React from 'react';
import { markViewed } from '@/lib/shopper';

/**
 * Renders nothing; remembers that this device opened this product. It is what makes "New to you"
 * mean anything — a chip that filters to what you have NOT seen needs something to have recorded
 * what you have.
 *
 * The record stays on the device (see lib/shopper.ts) and is never sent anywhere.
 */
export default function RecordView({ sku }: { sku: string }) {
  React.useEffect(() => {
    markViewed(sku);
  }, [sku]);
  return null;
}
