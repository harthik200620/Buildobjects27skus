import type { Metadata } from 'next';
import OrderTracker from '@/components/order/OrderTracker';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Where your truck is, who is driving it, and when it reaches your gate.',
};

/**
 * No page head here: the ETA is the title of this page, and it lives in the tracker so it can
 * change. The order itself is read on the client — it was placed on this device and never left it
 * (lib/tracking/orders.ts).
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="page shell order-page">
      <OrderTracker id={id.toUpperCase()} />
    </div>
  );
}
