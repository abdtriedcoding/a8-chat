import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";
import { requireSignedOut } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  await requireSignedOut();
  const { error } = await props.searchParams;
  return <SignInForm oauthError={typeof error === "string" ? error : undefined} />;
}
