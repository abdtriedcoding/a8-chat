import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PlanCard } from "@/components/settings/plan-card";
import { api } from "../../../../../convex/_generated/api";

export const metadata: Metadata = { title: "Billing" };

// Self-hosted a8 has no plans, so it has no Billing page.
export default async function BillingSettingsPage() {
  if (!(await fetchQuery(api.billing.enabled))) notFound();
  return (
    <PageShell title="Billing">
      <PlanCard />
    </PageShell>
  );
}
