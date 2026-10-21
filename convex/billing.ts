// The Billing page's functions, checkout and the customer portal. Plans are
// in lib/billing.ts. Polar's webhooks (http.ts) keep the subscriptions
// current, and checkout and the portal happen on Polar's pages.
import { v } from "convex/values";
import { action, env, internalAction, query } from "./_generated/server";
import {
  billingEnabled,
  getPlanTerms,
  polar,
  PRO_PRODUCTS,
  revokeSubscriptions,
  vBillingInterval,
  vPlanTerms,
} from "./lib/billing";
import { appError, ERROR_CODES } from "./lib/errors";
import {
  optionalUser,
  requireIdentity,
  requireIdentityEmail,
} from "./lib/guards";

const BILLING_PATH = "/settings/billing";

/** Whether billing is on. Self-hosted a8 has no plans or Billing page. */
export const enabled = query({
  args: {},
  returns: v.boolean(),
  handler: async () => billingEnabled,
});

/**
 * The signed-in user's plan. Null when signed out or billing is off. The
 * caller works out the current month with monthlyPeriod.
 */
export const plan = query({
  args: {},
  returns: v.union(vPlanTerms, v.null()),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    return await getPlanTerms(ctx, user._id);
  },
});

/**
 * A Polar checkout page for Pro, monthly or yearly. Polar sends the user
 * back to the Billing page once they've paid.
 */
export const checkout = action({
  args: { interval: vBillingInterval },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { interval }) => {
    const { userId, email } = await requireIdentityEmail(ctx);
    const plan = await getPlanTerms(ctx, userId);
    if (!plan) throw billingOff();
    if (plan.name === "pro") {
      throw appError(ERROR_CODES.ALREADY_ON_PLAN, "You're already on Pro.");
    }
    const { url } = await polar.createCheckoutSession(ctx, {
      productIds: [PRO_PRODUCTS[interval]],
      userId,
      email,
      origin: env.SITE_URL,
      successUrl: `${env.SITE_URL}${BILLING_PATH}`,
    });
    return { url };
  },
});

/** Polar's customer portal, where a Pro user manages their subscription. */
export const portal = action({
  args: {},
  returns: v.object({ url: v.string() }),
  handler: async (ctx) => {
    const userId = await requireIdentity(ctx);
    if (!billingEnabled) throw billingOff();
    return await polar.createCustomerPortalSession(ctx, {
      userId,
      returnUrl: `${env.SITE_URL}${BILLING_PATH}`,
    });
  },
});

/**
 * Revokes the deleted user's subscriptions at once, so Polar stops charging
 * them. Called by the deleteUser hook before Better Auth deletes the user.
 */
export const cancelSubscriptions = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if (billingEnabled) await revokeSubscriptions(ctx, userId);
    return null;
  },
});

function billingOff() {
  return appError(
    ERROR_CODES.MISCONFIGURED,
    "Billing isn't set up on this deployment.",
  );
}
