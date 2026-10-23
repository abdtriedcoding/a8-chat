import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ResetPasswordForm,
  ResetPasswordHeading,
} from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

// Static. The token is in the URL, so the form renders in the browser.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordHeading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
