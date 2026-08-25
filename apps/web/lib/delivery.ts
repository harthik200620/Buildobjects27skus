/**
 * "Get it by Tue, 26 Aug" — the delivery date for a lead time, counted in IST.
 *
 * Sundays are not delivery days, so they are skipped when counting and never returned as the
 * date itself. `null` when the pincode is not served, which is how callers decide whether to
 * print a promise at all.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;
const SUNDAY = 0;

const formatter = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function deliverBy(deliveryDays: number | null | undefined, now: Date = new Date()): string | null {
  if (deliveryDays === null || deliveryDays === undefined || !Number.isFinite(deliveryDays)) return null;

  // Shift into IST and read with the UTC accessors, so the calendar day is the Indian one
  // regardless of the server's timezone. Midday avoids any DST/rounding edge at the boundary.
  const date = new Date(now.getTime() + IST_OFFSET_MS);
  date.setUTCHours(12, 0, 0, 0);

  let remaining = Math.max(0, Math.round(deliveryDays));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== SUNDAY) remaining -= 1;
  }
  // A zero-day promise made on a Sunday still has to land on Monday.
  if (date.getUTCDay() === SUNDAY) date.setUTCDate(date.getUTCDate() + 1);

  return formatter.format(date);
}
