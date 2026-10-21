"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
import { errorMessage } from "@/lib/errors";
import {
  BILLING_INTERVALS,
  PRO_PRICES,
  type BillingInterval,
} from "@/lib/plans";
import { api } from "../../../convex/_generated/api";
import { monthlyPeriod } from "../../../convex/lib/monthlyPeriod";

type PlanTerms = NonNullable<FunctionReturnType<typeof api.billing.plan>>;

/**
 * The user's plan and when its credits reset. Free users upgrade from here,
 * and Pro users open Polar's customer portal. Both leave a8 for Polar's
 * pages, and Polar sends them back here.
 */
export function PlanCard() {
  const plan = useQuery(api.billing.plan);
  const checkout = useAction(api.billing.checkout);
  const portal = useAction(api.billing.portal);
  // What's opening: a checkout interval or the portal.
  const [opening, setOpening] = useState<BillingInterval | "portal">();

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
        {plan ? <PlanSummary plan={plan} /> : <Skeleton className="h-12 w-full" />}
      </CardContent>
      {plan?.name === "free" && (
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
      {plan?.name === "pro" && (
        <CardFooter>
          <Button
            variant="outline"
            disabled={opening !== undefined}
            onClick={() => void open("portal", () => portal())}
          >
            {opening === "portal" && <Spinner data-icon="inline-start" />}
            Manage subscription
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function PlanSummary({ plan }: { plan: PlanTerms }) {
  // The reset date as of opening the page. A page left open past it shows
  // the old date until a reload.
  const [now] = useState(Date.now);
  const { periodEnd } = monthlyPeriod(plan.periodAnchor, now);
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
      <span className="text-sm text-muted-foreground">
        {plan.monthlyCredits} credits a month. They reset on{" "}
        {formatDate(periodEnd)}.
      </span>
      {plan.endsAt !== null && (
        <span className="text-sm text-muted-foreground">
          Pro ends on {formatDate(plan.endsAt)}, and you move to Free.
        </span>
      )}
    </div>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}
