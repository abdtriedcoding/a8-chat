import type { BillingInterval } from "../../convex/lib/billing";

export type { BillingInterval };

/** The Billing page, where the user sees their credits and upgrades. */
export const BILLING_PATH = "/settings/billing";

/**
 * Pro's prices, shown on the pricing and Billing pages. Polar charges them,
 * and adds sales tax or VAT at checkout by the buyer's address.
 */
export const PRO_PRICES: Record<
  BillingInterval,
  { label: string; price: string; period: string }
> = {
  month: { label: "Monthly", price: "$12", period: "/month" },
  year: { label: "Yearly", price: "$120", period: "/year" },
};

/** Shown next to Pro's price, since Polar's total can be higher. */
export const TAX_NOTE = "Plus tax where applicable.";

export const BILLING_INTERVALS = Object.keys(PRO_PRICES) as BillingInterval[];

export function isBillingInterval(value: string): value is BillingInterval {
  return Object.hasOwn(PRO_PRICES, value);
}
