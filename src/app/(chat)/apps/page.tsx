import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppsPage } from "@/components/apps/apps-page";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Apps" };

export default async function Apps() {
  if (!(await isAuthenticated())) redirect("/sign-in");
  return <AppsPage />;
}
