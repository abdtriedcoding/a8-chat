import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { api } from "../../convex/_generated/api";
import { planIncludes, type Model } from "../../convex/lib/models";

/**
 * Whether the signed-in user's plan leaves a model out, for the pickers.
 * Nothing is locked while the plan loads, when signed out, or when billing
 * is off.
 */
export function useIsModelLocked(): (model: Model) => boolean {
  const { data: plan } = useQueryWithLocalCopy(api.billing.plan, {});
  return (model) =>
    plan !== undefined && !planIncludes(plan?.name ?? null, model);
}
