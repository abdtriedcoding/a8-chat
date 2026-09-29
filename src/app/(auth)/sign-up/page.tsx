import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isAuthenticated } from "@/lib/auth-server";
import { safeRedirect } from "@/lib/safe-redirect";
import { api } from "../../../../convex/_generated/api";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage(props: PageProps<"/sign-up">) {
  const { next } = await props.searchParams;
  const redirectTo = safeRedirect(next);
  if (await isAuthenticated()) redirect(redirectTo);

  const providers = await fetchQuery(api.auth.enabledProviders);
  return <SignUpForm next={redirectTo} google={providers.google} />;
}
