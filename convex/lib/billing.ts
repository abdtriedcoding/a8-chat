/**
 * Plans and the Polar client. Billing is on only for the hosted a8, when
 * BILLING_ENABLED is "true". Everything that needs a user's plan reads it
 * through getPlan, or getPlanTerms in a query.
 */
import { Polar } from "@convex-dev/polar";
import { subscriptionsUpdate } from "@polar-sh/sdk/funcs/subscriptionsUpdate.js";
import { v, type Infer } from "convex/values";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { env, type ActionCtx, type QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { monthlyPeriod } from "./monthlyPeriod";

export const billingEnabled = env.BILLING_ENABLED === "true";

const POLAR_ENV_VARS = [
  "POLAR_ORGANIZATION_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_SERVER",
  "POLAR_PRO_MONTHLY_PRODUCT_ID",
  "POLAR_PRO_YEARLY_PRODUCT_ID",
] as const;

// Convex runs this on deploy, so a hosted deployment missing a Polar
// variable fails to deploy instead of failing at checkout.
if (billingEnabled) {
  const missing = POLAR_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `BILLING_ENABLED is "true", so set ${missing.join(", ")}.`,
    );
  }
  if (env.POLAR_SERVER !== "sandbox" && env.POLAR_SERVER !== "production") {
    throw new Error('POLAR_SERVER must be "sandbox" or "production".');
  }
}

export const PRO_PRODUCTS: Record<BillingInterval, string> = {
  month: env.POLAR_PRO_MONTHLY_PRODUCT_ID ?? "",
  year: env.POLAR_PRO_YEARLY_PRODUCT_ID ?? "",
};

export const vBillingInterval = v.union(v.literal("month"), v.literal("year"));

export type BillingInterval = Infer<typeof vBillingInterval>;

export const polar = new Polar<DataModel>(components.polar, {
  organizationToken: env.POLAR_ORGANIZATION_TOKEN ?? "",
  webhookSecret: env.POLAR_WEBHOOK_SECRET ?? "",
  server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
  // Only polar.api() and the subscription change helpers read the user this
  // way, and a8 calls neither. Its own functions pass the user ID.
  getUserInfo: () => {
    throw new Error("a8 passes the user to Polar itself.");
  },
});

/** What each plan grants a month, in credits. */
export const MONTHLY_CREDITS = { free: 100, pro: 800 } as const;

// Polar keeps a subscription past_due while it retries a failed payment, and
// ends it if the retries fail. The user keeps Pro until then.
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * A plan without its current month's dates, which depend on the clock. A
 * query can't read the clock, so it returns this and its caller passes
 * `periodAnchor` to monthlyPeriod.
 */
export const vPlanTerms = v.object({
  name: v.union(v.literal("free"), v.literal("pro")),
  monthlyCredits: v.number(),
  /** When the first monthly period started, in ms. */
  periodAnchor: v.number(),
  /** Pro only: how often Polar charges. */
  billingInterval: v.union(vBillingInterval, v.null()),
  /** Pro only: when a cancelled subscription ends, or null while it renews. */
  endsAt: v.union(v.number(), v.null()),
});

export type PlanTerms = Infer<typeof vPlanTerms>;

/** A plan with its current monthly period, in ms. Credits reset at periodEnd. */
export type Plan = PlanTerms & { periodStart: number; periodEnd: number };

/**
 * The user's plan, what it grants each month and the current month's
 * dates at `now`, or null when billing is off. Every part of billing reads
 * the plan through this, or through getPlanTerms in a query.
 */
export async function getPlan(
  ctx: QueryCtx | ActionCtx,
  userId: string,
  now: number,
): Promise<Plan | null> {
  const terms = await getPlanTerms(ctx, userId);
  return terms && { ...terms, ...monthlyPeriod(terms.periodAnchor, now) };
}

/**
 * The user's plan without the current month's dates, or null when billing
 * is off. A user without an active Pro subscription is on Free. Polar's
 * webhooks keep the subscriptions current.
 *
 * Free's months count from sign-up and Pro's from the subscription's start,
 * so an upgrade starts a new month that day. Yearly Pro still gets a new
 * month, and a new grant, each month.
 */
export async function getPlanTerms(
  ctx: QueryCtx | ActionCtx,
  userId: string,
): Promise<PlanTerms | null> {
  if (!billingEnabled) return null;
  for (const subscription of await liveSubscriptions(ctx, userId)) {
    const billingInterval = proInterval(subscription.productId);
    if (!billingInterval) continue;
    const endsAt = subscription.cancelAtPeriodEnd
      ? (subscription.endsAt ?? subscription.currentPeriodEnd)
      : null;
    return {
      name: "pro",
      monthlyCredits: MONTHLY_CREDITS.pro,
      periodAnchor: Date.parse(
        subscription.startedAt ?? subscription.currentPeriodStart,
      ),
      billingInterval,
      endsAt: endsAt === null ? null : Date.parse(endsAt),
    };
  }
  const user = await authComponent.getAnyUserById(ctx, userId);
  if (!user) throw new Error(`User ${userId} not found`);
  return {
    name: "free",
    monthlyCredits: MONTHLY_CREDITS.free,
    periodAnchor: user.createdAt,
    billingInterval: null,
    endsAt: null,
  };
}

/** Revokes the user's subscriptions at once, so Polar stops charging. */
export async function revokeSubscriptions(ctx: ActionCtx, userId: string) {
  for (const { id } of await liveSubscriptions(ctx, userId)) {
    const result = await subscriptionsUpdate(polar.polar, {
      id,
      subscriptionUpdate: { revoke: true },
    });
    if (!result.ok) throw result.error;
  }
}

/** The user's subscriptions that Polar hasn't ended. */
async function liveSubscriptions(ctx: QueryCtx | ActionCtx, userId: string) {
  const subscriptions = await ctx.runQuery(
    components.polar.lib.listUserSubscriptions,
    { userId },
  );
  return subscriptions.filter(({ status }) => PRO_STATUSES.has(status));
}

function proInterval(productId: string): BillingInterval | null {
  if (productId === PRO_PRODUCTS.month) return "month";
  if (productId === PRO_PRODUCTS.year) return "year";
  return null;
}
