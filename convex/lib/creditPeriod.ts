// Which credit ledger row covers now, as plain logic. The Billing page
// imports it too, so it imports nothing from Convex.

/** A credit ledger row's period and credits. Times are in ms. */
export type CreditPeriod = {
  periodStart: number;
  periodEnd: number;
  creditsGranted: number;
  creditsUsed: number;
  /** Set on a row an upgrade opened: the credits used in the row it ended. */
  creditsUsedBefore?: number;
};

/** What the plan grants now: its monthly credits and its current month. */
export type PlanMonth = {
  monthlyCredits: number;
  periodStart: number;
  periodEnd: number;
  /**
   * When a revoke or refund ended Pro early (vPlanTerms in lib/billing.ts).
   * Unset in a copy of the plan saved before a8 had it.
   */
  revokedAt?: number | null;
};

/**
 * Which credit period covers `now`, given the user's latest ledger row:
 * that row (`keeps`), or a new one to open (`opens`). `closesLatestAt` is
 * set when the latest row has to end early.
 *
 * - The latest row stays current until it ends, even if the plan now grants
 *   less, so a downgrade or cancellation waits until the period ends.
 * - A revoke or refund doesn't wait. It ends the latest row where Pro
 *   ended, and opens one with the new grant until the plan's month ends.
 *   That row starts with the credits the latest row used, plus the ones
 *   used before the upgrade when that was in this month of the plan.
 * - A plan that grants more is an upgrade. It ends the latest row and opens
 *   a new period with the full new grant, until the plan's month ends.
 *   The new row records what the latest row used, for a later revoke.
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
    const revokedAt = plan.revokedAt ?? null;
    if (
      revokedAt !== null &&
      revokedAt >= latest.periodStart &&
      plan.monthlyCredits < latest.creditsGranted
    ) {
      const usedBefore =
        plan.periodStart <= latest.periodStart
          ? (latest.creditsUsedBefore ?? 0)
          : 0;
      return {
        opens: {
          ...freshPeriod(revokedAt, plan),
          creditsUsed: latest.creditsUsed + usedBefore,
        },
        closesLatestAt: revokedAt,
      };
    }
    if (plan.monthlyCredits <= latest.creditsGranted) return { keeps: latest };
    // The subscription can start a moment before the latest row opened,
    // such as when its webhook came late. The upgrade then starts with it.
    const periodStart = Math.max(plan.periodStart, latest.periodStart);
    return {
      opens: {
        ...freshPeriod(periodStart, plan),
        creditsUsedBefore: latest.creditsUsed,
      },
      closesLatestAt: periodStart,
    };
  }
  const periodStart = latest
    ? Math.max(latest.periodEnd, plan.periodStart)
    : plan.periodStart;
  return { opens: freshPeriod(periodStart, plan), closesLatestAt: null };
}

/**
 * The credit period that covers `now`: the latest row, or the one that
 * would open (resolveCreditPeriod). For reading the balance without
 * opening a row.
 */
export function creditPeriodAt(
  latest: CreditPeriod | null,
  plan: PlanMonth,
  now: number,
): CreditPeriod {
  const resolved = resolveCreditPeriod(latest, plan, now);
  return "keeps" in resolved ? resolved.keeps : resolved.opens;
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
