import { useEffect, useState } from "react";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { api } from "../../convex/_generated/api";
import type { PlanTerms } from "../../convex/lib/billing";
import {
  creditPeriodAt,
  type CreditPeriod,
} from "../../convex/lib/creditPeriod";
import { monthlyPeriod } from "../../convex/lib/monthlyPeriod";

const MINUTE_MS = 60_000;

/** The signed-in user's plan and the credit period that covers now. */
export type Credits = {
  plan: PlanTerms;
  period: CreditPeriod;
  /** Set while either comes from the device's copy (lib/local-copy). */
  stale: boolean;
};

/**
 * The user's Credits. Undefined while loading, and null when signed out or
 * billing is off.
 *
 * The clock moves on each minute, so a page left open past the reset shows
 * the new period, even before a reply opens its row.
 */
export function useCredits(): Credits | null | undefined {
  // From the device's copy until they load. The server checks credits on
  // every Send anyway.
  const { data: plan, stale: planStale } = useQueryWithLocalCopy(
    api.billing.plan,
    {},
  );
  const { data: latestCredits, stale: creditsStale } = useQueryWithLocalCopy(
    api.billing.latestCredits,
    {},
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  if (plan === undefined || latestCredits === undefined) return undefined;
  if (plan === null) return null;
  const period = creditPeriodAt(
    latestCredits,
    { ...plan, ...monthlyPeriod(plan.periodAnchor, now) },
    now,
  );
  return { plan, period, stale: planStale || creditsStale };
}
