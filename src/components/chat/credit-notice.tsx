"use client";

import { cn } from "cn";
import { CircleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Credits } from "@/hooks/use-credits";
import { formatCredits, formatDate } from "@/lib/credits";
import { BILLING_PATH } from "@/lib/plans";
import { creditsLeft } from "../../../convex/lib/creditPeriod";

/** The share of the period's grant below which the low-credits notice shows. */
const LOW_CREDITS_SHARE = 0.1;

/**
 * Where a dismissed low-credits notice is remembered: the start of the
 * period it was dismissed in, so it shows again in the next period.
 */
const DISMISSED_KEY = "a8:low-credits-dismissed";

/**
 * The credit notices above the composer on the hosted a8. One shows while
 * the user has no credits left, until the balance is above zero again. A
 * warning shows below LOW_CREDITS_SHARE of the period's grant, and the user
 * can dismiss it until the next period. Both link to the Billing page.
 * `credits` is useCredits'. Shows nothing while they load, when signed out
 * or when billing is off.
 */
export function CreditNotice({
  credits,
  className,
}: {
  credits: Credits | null | undefined;
  className?: string;
}) {
  const dismissedPeriod = useSyncExternalStore(
    subscribeToDismissed,
    readDismissed,
    () => null,
  );
  if (!credits) return null;
  const { plan, period } = credits;
  const left = creditsLeft(period);
  const resets = `They reset on ${formatDate(period.periodEnd)}.`;
  const billingLink = (
    <Button asChild variant="outline" size="sm">
      <Link href={BILLING_PATH}>
        {plan.name === "free" ? "Upgrade" : "Billing"}
      </Link>
    </Button>
  );

  if (left <= 0) {
    return (
      <Alert role="status" className={cn("pr-28", className)}>
        <CircleAlertIcon />
        <AlertTitle>You&apos;re out of credits</AlertTitle>
        <AlertDescription>
          {plan.name === "free" ? `Upgrade to Pro, or wait. ${resets}` : resets}
        </AlertDescription>
        <AlertAction>{billingLink}</AlertAction>
      </Alert>
    );
  }
  if (
    left >= period.creditsGranted * LOW_CREDITS_SHARE ||
    dismissedPeriod === String(period.periodStart)
  ) {
    return null;
  }
  return (
    <Alert role="status" className={cn("pr-36", className)}>
      <CircleAlertIcon />
      <AlertTitle>{formatCredits(left)} credits left</AlertTitle>
      <AlertDescription>{resets}</AlertDescription>
      <AlertAction className="flex items-center gap-1">
        {billingLink}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => dismiss(period.periodStart)}
        >
          <XIcon />
          <span className="sr-only">Dismiss</span>
        </Button>
      </AlertAction>
    </Alert>
  );
}

const dismissedListeners = new Set<() => void>();

// Where the dismissal lives when the browser has no storage, so the button
// still hides the notice until the page reloads.
let dismissedInMemory: string | null = null;

function subscribeToDismissed(listener: () => void) {
  dismissedListeners.add(listener);
  // Another tab dismissed it.
  window.addEventListener("storage", listener);
  return () => {
    dismissedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? dismissedInMemory;
  } catch {
    return dismissedInMemory;
  }
}

function dismiss(periodStart: number) {
  dismissedInMemory = String(periodStart);
  try {
    localStorage.setItem(DISMISSED_KEY, dismissedInMemory);
  } catch {
    // dismissedInMemory holds it.
  }
  for (const listener of dismissedListeners) listener();
}
