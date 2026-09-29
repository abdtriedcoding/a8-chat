import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isAuthenticated } from "@/lib/auth-server";
import { safeRedirect } from "@/lib/safe-redirect";
import { api } from "../../../../convex/_generated/api";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const { next, error } = await props.searchParams;
  const redirectTo = safeRedirect(next);
  if (await isAuthenticated()) redirect(redirectTo);

  const providers = await fetchQuery(api.auth.enabledProviders);
  return (
    <SignInForm
      next={redirectTo}
      google={providers.google}
      oauthError={typeof error === "string" ? error : undefined}
    />
  );
}
