import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  if (await isAuthenticated()) redirect("/chat");
  const { error } = await props.searchParams;
  return <SignInForm oauthError={typeof error === "string" ? error : undefined} />;
}
