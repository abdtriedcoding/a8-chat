import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { requireSignedOut } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage() {
  await requireSignedOut();
  return <SignUpForm />;
}
