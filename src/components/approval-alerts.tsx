"use client";

import { useApprovalAlerts } from "@/hooks/use-approval-alerts";

/** Runs useApprovalAlerts for the signed-in app. Renders nothing. */
export function ApprovalAlerts() {
  useApprovalAlerts();
  return null;
}
