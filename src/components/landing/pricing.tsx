"use client";

import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { startCheckout } from "@/app/(marketing)/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePageRestored } from "@/hooks/use-page-restored";
import { errorMessage } from "@/lib/errors";
import {
  BILLING_INTERVALS,
  isBillingInterval,
  PRO_PRICES,
  type BillingInterval,
} from "@/lib/plans";
import { GITHUB_URL } from "@/lib/site";
import type { PlanTerms } from "../../../convex/lib/billing";

type PricingPlan = {
  name: string;
  price: string;
  period?: string;
  note?: string;
  description: string;
  features: string[];
  cta: { label: string; href: string; external?: boolean };
  featured?: boolean;
};

// Numbers from the spec's locked decisions: USD for everyone, 1 credit = 1¢.
const FREE: PricingPlan = {
  name: "Free",
  price: "$0",
  period: "/month",
  note: "No card needed",
  description: "For trying it out.",
  features: ["100 credits a month", "All connectors", "Fast, low-cost models"],
  cta: { label: "Start for free", href: "/sign-up" },
};

const PRO_FEATURES = [
  "800 credits a month",
  "All connectors",
  "Every model on OpenRouter",
];

const SELF_HOST: PricingPlan = {
  name: "Self-host",
  price: "Free",
  note: "You pay OpenRouter directly",
  description: "For running it on your own server.",
  features: [
    "Every feature",
    "Your own OpenRouter key",
    "Your own Google and Slack app setup",
  ],
  cta: { label: "Get the code", href: GITHUB_URL, external: true },
};

const INTERVAL_NOTES: Record<BillingInterval, string> = {
  month: `or ${PRO_PRICES.year.price} a year`,
  year: `or ${PRO_PRICES.month.price} a month`,
};

/**
 * The plans. `currentPlan` is the signed-in visitor's plan, or null when
 * signed out or billing is off. Then the plan buttons go to sign-up.
 */
export function Pricing({
  currentPlan,
}: {
  currentPlan: PlanTerms["name"] | null;
}) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [opening, setOpening] = useState(false);
  usePageRestored(() => setOpening(false));

  async function checkout() {
    setOpening(true);
    try {
      const result = await startCheckout(billingInterval);
      if ("url" in result) {
        window.location.assign(result.url);
        return;
      }
      toast.error(result.error);
    } catch (error) {
      // The server function's own failures, such as a dropped connection.
      toast.error(errorMessage(error));
    }
    setOpening(false);
  }

  const pro: PricingPlan = {
    name: "Pro",
    price: PRO_PRICES[billingInterval].price,
    period: PRO_PRICES[billingInterval].period,
    note: INTERVAL_NOTES[billingInterval],
    description: "For using it every day.",
    features: PRO_FEATURES,
    cta: { label: "Get Pro", href: "/sign-up" },
    featured: true,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <PricingCard plan={FREE}>
        {currentPlan === "free" ? (
          <CurrentPlanButton />
        ) : (
          <CtaButton plan={FREE} />
        )}
      </PricingCard>
      <PricingCard
        plan={pro}
        toggle={
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Billing period"
            value={billingInterval}
            onValueChange={(value) => {
              if (isBillingInterval(value)) setBillingInterval(value);
            }}
          >
            {BILLING_INTERVALS.map((interval) => (
              <ToggleGroupItem key={interval} value={interval}>
                {PRO_PRICES[interval].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        {currentPlan === "pro" && <CurrentPlanButton />}
        {currentPlan === "free" && (
          <Button
            size="lg"
            className="w-full"
            disabled={opening}
            onClick={() => void checkout()}
          >
            {opening && <Spinner data-icon="inline-start" />}
            {pro.cta.label}
          </Button>
        )}
        {currentPlan === null && <CtaButton plan={pro} />}
      </PricingCard>
      <PricingCard plan={SELF_HOST}>
        <CtaButton plan={SELF_HOST} />
      </PricingCard>
    </div>
  );
}

function PricingCard({
  plan,
  toggle,
  children,
}: {
  plan: PricingPlan;
  toggle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={cn(plan.featured && "ring-2 ring-primary")}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <h3>{plan.name}</h3>
          {toggle}
        </CardTitle>
        <CardDescription className="text-base">
          {plan.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-6">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-4xl font-bold tracking-tight">
            {plan.price}
          </span>
          {plan.period && (
            <span className="text-muted-foreground">{plan.period}</span>
          )}
          {plan.note && (
            <span className="w-full text-sm text-muted-foreground">
              {plan.note}
            </span>
          )}
        </p>
        <ul className="flex flex-col gap-2.5 text-base">
          {plan.features.map((feature) => (
            <li key={feature} className="flex gap-2.5">
              <CheckIcon className="mt-1 size-4 shrink-0 text-success" />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="mt-auto">{children}</CardFooter>
    </Card>
  );
}

function CtaButton({ plan }: { plan: PricingPlan }) {
  return (
    <Button
      asChild
      size="lg"
      variant={plan.featured ? "default" : "outline"}
      className="w-full"
    >
      {plan.cta.external ? (
        <a href={plan.cta.href}>{plan.cta.label}</a>
      ) : (
        <Link href={plan.cta.href}>{plan.cta.label}</Link>
      )}
    </Button>
  );
}

function CurrentPlanButton() {
  return (
    <Button size="lg" variant="outline" className="w-full" disabled>
      Current plan
    </Button>
  );
}
