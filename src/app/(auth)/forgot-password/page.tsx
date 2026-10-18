import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { requireSignedOut } from "@/lib/auth-server";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  await requireSignedOut();
  return <ForgotPasswordForm />;
}
