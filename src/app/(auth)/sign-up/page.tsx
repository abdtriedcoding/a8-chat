import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isAuthenticated } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage() {
  if (await isAuthenticated()) redirect("/chat");
  return <SignUpForm />;
}
