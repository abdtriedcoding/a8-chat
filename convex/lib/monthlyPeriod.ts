// Plan periods, as plain date math. The Billing page imports it too, so it
// imports nothing from Convex.

/**
 * The monthly period that holds `now`, for months that start on `start`'s
 * day and time. In a month without that day, such as the 31st in April, the
 * period starts on the month's last day.
 */
export function monthlyPeriod(
  start: number,
  now: number,
): { periodStart: number; periodEnd: number } {
  const anchor = new Date(start);
  // A start a moment in the future, such as from clock skew, is the first
  // period, not the one before it.
  const at = new Date(Math.max(start, now));
  let months =
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    at.getUTCMonth() -
    anchor.getUTCMonth();
  if (addMonths(anchor, months) > at.getTime()) months -= 1;
  return {
    periodStart: addMonths(anchor, months),
    periodEnd: addMonths(anchor, months + 1),
  };
}

function addMonths(anchor: Date, months: number): number {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  // Day 0 of the next month is this month's last day.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  );
}
