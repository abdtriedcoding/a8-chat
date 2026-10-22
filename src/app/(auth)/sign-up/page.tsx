import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Sign up" };

// Static. proxy.ts sends signed-in users to /chat.
export default function SignUpPage() {
  return <SignUpForm />;
}
