import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  creditPeriodAt,
  type CreditPeriod,
} from "../../convex/lib/creditPeriod";
import { monthlyPeriod } from "../../convex/lib/monthlyPeriod";

export type PlanTerms = NonNullable<FunctionReturnType<typeof api.billing.plan>>;

const MINUTE_MS = 60_000;

/**
 * The signed-in user's plan and the credit period that covers now.
 * Undefined while loading, and null when signed out or billing is off.
 *
 * The clock moves on each minute, so a page left open past the reset shows
 * the new period, even before a reply opens its row.
 */
export function useCredits():
  | { plan: PlanTerms; period: CreditPeriod }
  | null
  | undefined {
  const plan = useQuery(api.billing.plan);
  const latestCredits = useQuery(api.billing.latestCredits);
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
  return { plan, period };
}
