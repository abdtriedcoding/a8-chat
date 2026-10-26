/**
 * Plans and the Polar client. Billing is on only for the hosted a8, when
 * BILLING_ENABLED is "true". Everything that needs a user's plan reads it
 * through getPlan, or getPlanTerms in a query and in a Send.
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

/** The daily spend ceiling when DAILY_SPEND_CEILING_USD is unset. */
const DEFAULT_DAILY_SPEND_CEILING_USD = 20;

/**
 * The most a8 spends on models across all users in a UTC day, in dollars.
 * checkSpend refuses Sends once the day's spend reaches it. Self-hosted a8 records
 * no spend, so it has no ceiling.
 */
export const dailySpendCeilingUsd = billingEnabled
  ? parseCeiling(env.DAILY_SPEND_CEILING_USD)
  : Infinity;

// Like a missing Polar variable, a ceiling that isn't a number fails the
// deploy, since reading it as 0 would refuse every Send.
function parseCeiling(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_DAILY_SPEND_CEILING_USD;
  }
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error("DAILY_SPEND_CEILING_USD must be a number of dollars above 0.");
  }
  return usd;
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

/**
 * How long before its period's end a subscription has to end to count as
 * revoked, so a cancel that Polar ends a moment early doesn't.
 */
const REVOKE_MARGIN_MS = 60_000;

/** What each plan grants a month, in credits. */
export const MONTHLY_CREDITS = { free: 100, pro: 800 } as const;

/**
 * How much of the daily spend ceiling one user's usage can take on each
 * plan. checkSpend refuses the user's Sends past it, so a few accounts
 * can't lock everyone out until 00:00 UTC.
 */
export const DAILY_SPEND_SHARES = { free: 0.1, pro: 0.25 } as const;

// Polar keeps a subscription past_due while it retries a failed payment, and
// ends it if the retries fail. The user is on Free until a retry goes
// through. Polar can still charge a past_due subscription, so it's live.
const PRO_STATUSES = new Set(["active", "trialing"]);
const LIVE_STATUSES = new Set([...PRO_STATUSES, "past_due"]);

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
  /**
   * Free only: the user has a Pro subscription whose payment failed, which
   * Polar still retries. A new checkout would charge them twice, so they
   * update their card in Polar's portal instead.
   */
  paymentFailed: v.boolean(),
  /**
   * Free only: when the user's last Pro subscription ended before its
   * billing period did, from a revoke or a refund, in ms. Null when it ran
   * to its period's end. The credits Pro granted end there too
   * (resolveCreditPeriod).
   */
  revokedAt: v.union(v.number(), v.null()),
});

export type PlanTerms = Infer<typeof vPlanTerms>;

/** A plan with its current monthly period, in ms. Credits reset at periodEnd. */
export type Plan = PlanTerms & { periodStart: number; periodEnd: number };

/**
 * The user's plan, what it grants each month and the current month's
 * dates at `now`, or null when billing is off. Every part of billing reads
 * the plan through this, or through getPlanTerms and planAt.
 */
export async function getPlan(
  ctx: QueryCtx | ActionCtx,
  userId: string,
  now: number,
): Promise<Plan | null> {
  const terms = await getPlanTerms(ctx, userId);
  return terms && planAt(terms, now);
}

/** The plan with its monthly period at `now`. */
export function planAt(terms: PlanTerms, now: number): Plan {
  return { ...terms, ...monthlyPeriod(terms.periodAnchor, now) };
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
  const live = await liveSubscriptions(ctx, userId);
  // A renewing subscription wins over a cancelled one, so a second
  // subscription that renews doesn't show as ending.
  const subscriptions = live
    .filter(({ status }) => PRO_STATUSES.has(status))
    .sort((a, b) => Number(a.cancelAtPeriodEnd) - Number(b.cancelAtPeriodEnd));
  for (const subscription of subscriptions) {
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
      paymentFailed: false,
      revokedAt: null,
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
    paymentFailed: live.some(
      ({ status, productId }) =>
        status === "past_due" && proInterval(productId) !== null,
    ),
    revokedAt: proRevokedAt(
      await ctx.runQuery(components.polar.lib.listAllUserSubscriptions, {
        userId,
      }),
    ),
  };
}

/**
 * The revoke time for vPlanTerms' `revokedAt`. It looks at the Pro
 * subscription that ended last. Polar ends a cancelled subscription at its
 * period's end. A revoke, like the one a refund or chargeback makes, ends
 * it at once and leaves the period's end as it was. So a subscription that
 * ended before its period's end was revoked.
 */
function proRevokedAt(
  subscriptions: {
    endedAt: string | null;
    currentPeriodEnd: string | null;
    productId: string;
  }[],
): number | null {
  let last: { endedAt: number; periodEnd: number } | null = null;
  for (const { endedAt, currentPeriodEnd, productId } of subscriptions) {
    if (!endedAt || !currentPeriodEnd || proInterval(productId) === null) {
      continue;
    }
    const ended = Date.parse(endedAt);
    if (!last || ended > last.endedAt) {
      last = { endedAt: ended, periodEnd: Date.parse(currentPeriodEnd) };
    }
  }
  return last && last.endedAt < last.periodEnd - REVOKE_MARGIN_MS
    ? last.endedAt
    : null;
}

/**
 * Revokes the user's subscriptions at once, so Polar stops charging. Tries
 * every subscription before throwing the first failure.
 */
export async function revokeSubscriptions(ctx: ActionCtx, userId: string) {
  const errors: unknown[] = [];
  for (const { id } of await liveSubscriptions(ctx, userId)) {
    const result = await subscriptionsUpdate(polar.polar, {
      id,
      subscriptionUpdate: { revoke: true },
    });
    if (!result.ok) errors.push(result.error);
  }
  if (errors.length > 0) throw errors[0];
}

/** The user's subscriptions that Polar hasn't ended. */
async function liveSubscriptions(ctx: QueryCtx | ActionCtx, userId: string) {
  const subscriptions = await ctx.runQuery(
    components.polar.lib.listUserSubscriptions,
    { userId },
  );
  return subscriptions.filter(({ status }) => LIVE_STATUSES.has(status));
}

function proInterval(productId: string): BillingInterval | null {
  if (productId === PRO_PRODUCTS.month) return "month";
  if (productId === PRO_PRODUCTS.year) return "year";
  return null;
}
