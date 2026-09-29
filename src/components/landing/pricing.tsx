import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

type Plan = {
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
const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    note: "No card needed",
    description: "For trying it out.",
    features: ["100 credits a month", "All connectors", "Fast, low-cost models"],
    cta: { label: "Start for free", href: "/sign-up" },
  },
  {
    name: "Pro",
    price: "$12",
    period: "/month",
    note: "or $120 a year",
    description: "For using it every day.",
    features: ["800 credits a month", "All connectors", "Every model on OpenRouter"],
    cta: { label: "Get Pro", href: "/sign-up" },
    featured: true,
  },
  {
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
  },
];

export function Pricing() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {PLANS.map((plan) => (
        <Card
          key={plan.name}
          className={cn(plan.featured && "ring-2 ring-primary")}
        >
          <CardHeader>
            <CardTitle className="text-lg">
              <h3>{plan.name}</h3>
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
          <CardFooter className="mt-auto">
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
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
