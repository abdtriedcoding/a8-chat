import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

// Static. proxy.ts sends signed-in users to /chat.
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
