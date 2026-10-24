"use client";

import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCredits } from "@/hooks/use-credits";
import { usePageRestored } from "@/hooks/use-page-restored";
import { formatCredits, formatDate } from "@/lib/credits";
import { errorMessage } from "@/lib/errors";
import {
  BILLING_INTERVALS,
  PRO_PRICES,
  type BillingInterval,
} from "@/lib/plans";
import { api } from "../../../convex/_generated/api";
import type { PlanTerms } from "../../../convex/lib/billing";
import {
  creditsLeft,
  type CreditPeriod,
} from "../../../convex/lib/creditPeriod";

/**
 * The user's plan and when its credits reset. Free users upgrade from here,
 * and Pro users, or Free users whose Pro payment failed, open Polar's
 * customer portal. Both leave a8 for Polar's pages, and Polar sends them
 * back here.
 */
export function PlanCard() {
  const credits = useCredits();
  const plan = credits?.plan;
  const checkout = useAction(api.billing.checkout);
  const portal = useAction(api.billing.portal);
  // What's opening: a checkout interval or the portal.
  const [opening, setOpening] = useState<BillingInterval | "portal">();
  usePageRestored(() => setOpening(undefined));

  async function open(
    key: BillingInterval | "portal",
    run: () => Promise<{ url: string }>,
  ) {
    setOpening(key);
    try {
      const { url } = await run();
      window.location.assign(url);
    } catch (error) {
      toast.error(errorMessage(error));
      setOpening(undefined);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <CardDescription>
          Credits pay for replies and web searches. They reset each month, and
          leftovers expire.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-4">
        {credits ? (
          <PlanSummary plan={credits.plan} period={credits.period} />
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </CardContent>
      {plan?.name === "free" && !plan.paymentFailed && (
        <CardFooter className="flex-wrap gap-2">
          {BILLING_INTERVALS.map((interval) => (
            <Button
              key={interval}
              variant={interval === "month" ? "default" : "outline"}
              disabled={opening !== undefined}
              onClick={() =>
                void open(interval, () => checkout({ interval }))
              }
            >
              {opening === interval && <Spinner data-icon="inline-start" />}
              Upgrade to Pro, {PRO_PRICES[interval].price}
              {PRO_PRICES[interval].period}
            </Button>
          ))}
        </CardFooter>
      )}
      {(plan?.name === "pro" || plan?.paymentFailed) && (
        <CardFooter>
          <Button
            variant="outline"
            disabled={opening !== undefined}
            onClick={() => void open("portal", () => portal())}
          >
            {opening === "portal" && <Spinner data-icon="inline-start" />}
            {plan.paymentFailed ? "Update card" : "Manage subscription"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function PlanSummary({
  plan,
  period,
}: {
  plan: PlanTerms;
  period: CreditPeriod;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm font-medium">
        {plan.name === "pro" ? "Pro" : "Free"}
        {plan.billingInterval && (
          <Badge variant="secondary">
            {PRO_PRICES[plan.billingInterval].label}
          </Badge>
        )}
      </span>
      <span className="text-sm">
        {formatCredits(creditsLeft(period))} of{" "}
        {formatCredits(period.creditsGranted)} credits left
      </span>
      <span className="text-sm text-muted-foreground">
        {plan.monthlyCredits} credits a month. They reset on{" "}
        {formatDate(period.periodEnd)}.
      </span>
      {plan.paymentFailed && (
        <span className="text-sm text-muted-foreground">
          Your last Pro payment failed. Update your card to get Pro back.
        </span>
      )}
      {plan.endsAt !== null && (
        <span className="text-sm text-muted-foreground">
          Pro ends on {formatDate(plan.endsAt)}, and you move to Free.
        </span>
      )}
    </div>
  );
}
