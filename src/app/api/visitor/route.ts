import { getSessionCookie } from "better-auth/cookies";
import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import type { PlanTerms } from "../../../../convex/lib/billing";

export type Visitor = {
  signedIn: boolean;
  /** Null when signed out or billing is off. */
  plan: PlanTerms["name"] | null;
};

/**
 * Who is looking at the landing page. The page is static HTML, so the
 * browser asks for this after it loads. Only a signed-in visitor costs a
 * Convex call.
 */
export async function GET(request: Request) {
  if (getSessionCookie(request) === null) {
    return Response.json({ signedIn: false, plan: null } satisfies Visitor);
  }
  try {
    const plan = await fetchAuthQuery(api.billing.plan);
    return Response.json({
      signedIn: true,
      plan: plan?.name ?? null,
    } satisfies Visitor);
  } catch {
    return Response.json({ signedIn: true, plan: null } satisfies Visitor);
  }
}
