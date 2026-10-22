import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatHeader } from "@/components/chat/chat-header";
import { PlanCard } from "@/components/settings/plan-card";
import { api } from "../../../../../convex/_generated/api";

export const metadata: Metadata = { title: "Billing" };

// Self-hosted a8 has no plans, so it has no Billing page.
export default async function BillingSettingsPage() {
  if (!(await fetchQuery(api.billing.enabled))) notFound();
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">Billing</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          <PlanCard />
        </div>
      </div>
    </>
  );
}
