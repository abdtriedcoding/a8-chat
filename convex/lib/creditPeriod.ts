// Which credit ledger row covers now, as plain logic. The Billing page
// imports it too, so it imports nothing from Convex.

/** A credit ledger row's period and credits. Times are in ms. */
export type CreditPeriod = {
  periodStart: number;
  periodEnd: number;
  creditsGranted: number;
  creditsUsed: number;
};

/** What the plan grants now: its monthly credits and its current month. */
export type PlanMonth = {
  monthlyCredits: number;
  periodStart: number;
  periodEnd: number;
};

/**
 * Which credit period covers `now`, given the user's latest ledger row:
 * that row (`keeps`), or a new one to open (`opens`). `closesLatestAt` is
 * set when the latest row has to end early.
 *
 * - The latest row stays current until it ends, even if the plan now grants
 *   less, so a downgrade or cancellation waits until the period ends.
 * - A plan that grants more is an upgrade. It ends the latest row and opens
 *   a new period with the full new grant, until the plan's month ends.
 * - Otherwise the new period runs from where the latest row ended, or from
 *   the plan month's start, to the plan month's end.
 */
export function resolveCreditPeriod<Row extends CreditPeriod>(
  latest: Row | null,
  plan: PlanMonth,
  now: number,
): { keeps: Row } | { opens: CreditPeriod; closesLatestAt: number | null } {
  // A row can start a moment after `now`, from a subscription start ahead
  // of this clock. It's still the current row, not one to replace.
  if (latest && now < latest.periodEnd) {
    if (plan.monthlyCredits <= latest.creditsGranted) return { keeps: latest };
    // The subscription can start a moment before the latest row opened,
    // such as when its webhook came late. The upgrade then starts with it.
    const periodStart = Math.max(plan.periodStart, latest.periodStart);
    return {
      opens: freshPeriod(periodStart, plan),
      closesLatestAt: periodStart,
    };
  }
  const periodStart = latest
    ? Math.max(latest.periodEnd, plan.periodStart)
    : plan.periodStart;
  return { opens: freshPeriod(periodStart, plan), closesLatestAt: null };
}

/** The credits left in a period. Below zero once a reply overspent it. */
export function creditsLeft(period: CreditPeriod): number {
  return period.creditsGranted - period.creditsUsed;
}

function freshPeriod(periodStart: number, plan: PlanMonth): CreditPeriod {
  return {
    periodStart,
    periodEnd: plan.periodEnd,
    creditsGranted: plan.monthlyCredits,
    creditsUsed: 0,
  };
}
