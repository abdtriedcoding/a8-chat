import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    GOOGLE_CLIENT_ID: v.string(),
    GOOGLE_CLIENT_SECRET: v.string(),
    ANTHROPIC_API_KEY: v.string(),
    // Optional. Without it, the model gets no web search tool.
    TAVILY_API_KEY: v.optional(v.string()),
    // Base64-encoded 32-byte key that encrypts connection tokens. Generate
    // one with `openssl rand -base64 32`.
    CONNECTION_ENCRYPTION_KEY: v.string(),
    // Optional. Comma-separated origins besides SITE_URL that may call the
    // auth API, such as a preview or staging domain.
    TRUSTED_ORIGINS: v.optional(v.string()),
    RESEND_API_KEY: v.string(),
    // Sender for auth emails, such as "a8 <noreply@your-domain.com>".
    EMAIL_FROM: v.string(),
    // Optional. Resend test mode only delivers to resend.dev test addresses.
    // Set to "true" to stay in test mode. Unset or any other value sends to
    // real addresses.
    RESEND_TEST_MODE: v.optional(v.string()),
    // Optional. The Google Cloud project's OAuth client for Google's MCP
    // servers (ADR 0007, docs/connectors/google.md). Without both, the
    // Google connectors show as not set up.
    GOOGLE_MCP_CLIENT_ID: v.optional(v.string()),
    GOOGLE_MCP_CLIENT_SECRET: v.optional(v.string()),
    // Optional. Deepgram's key for Dictation (ADR 0012). It needs the Member
    // role or higher to mint the browser's short-lived tokens. Without it,
    // the composer shows no mic.
    DEEPGRAM_API_KEY: v.optional(v.string()),
    // Optional. "true" turns on plans and billing through Polar, for the
    // hosted a8. Unset or any other value runs a8 self-hosted, with no plans.
    // When it's "true", the deploy fails unless every POLAR_* variable below
    // is set (convex/lib/billing.ts).
    BILLING_ENABLED: v.optional(v.string()),
    // Polar's organization access token, and the secret of the webhook that
    // points at <CONVEX_SITE_URL>/polar/events.
    POLAR_ORGANIZATION_TOKEN: v.optional(v.string()),
    POLAR_WEBHOOK_SECRET: v.optional(v.string()),
    // "sandbox" or "production", the Polar server the token belongs to.
    POLAR_SERVER: v.optional(v.string()),
    // The Polar product IDs of Pro monthly and Pro yearly.
    POLAR_PRO_MONTHLY_PRODUCT_ID: v.optional(v.string()),
    POLAR_PRO_YEARLY_PRODUCT_ID: v.optional(v.string()),
  },
});

app.use(betterAuth);
app.use(agent);
app.use(rateLimiter);
app.use(resend);
app.use(polar);

export default app;
