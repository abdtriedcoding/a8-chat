import type { BillingInterval } from "../../convex/lib/billing";

export type { BillingInterval };

/** The Billing page, where the user sees their credits and upgrades. */
export const BILLING_PATH = "/settings/billing";

/** Pro's prices, shown on the pricing and Billing pages. Polar charges them. */
export const PRO_PRICES: Record<
  BillingInterval,
  { label: string; price: string; period: string }
> = {
  month: { label: "Monthly", price: "$12", period: "/month" },
  year: { label: "Yearly", price: "$120", period: "/year" },
};

export const BILLING_INTERVALS = Object.keys(PRO_PRICES) as BillingInterval[];

export function isBillingInterval(value: string): value is BillingInterval {
  return Object.hasOwn(PRO_PRICES, value);
}
