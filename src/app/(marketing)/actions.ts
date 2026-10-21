"use server";

import { fetchAuthAction } from "@/lib/auth-server";
import { errorMessage } from "@/lib/errors";
import { isBillingInterval } from "@/lib/plans";
import { api } from "../../../convex/_generated/api";

/**
 * A Polar checkout page for Pro, for the pricing page's signed-in visitor.
 * The landing page has no Convex client, so the checkout goes through here.
 */
export async function startCheckout(
  interval: string,
): Promise<{ url: string } | { error: string }> {
  if (!isBillingInterval(interval)) return { error: "Pick monthly or yearly." };
  try {
    return await fetchAuthAction(api.billing.checkout, { interval });
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
