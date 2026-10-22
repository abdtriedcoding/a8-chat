import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ResetPasswordFormFallback,
  ResetPasswordFormFromUrl,
} from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

// Static. The token is in the URL, so the form renders in the browser.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFormFallback />}>
      <ResetPasswordFormFromUrl />
    </Suspense>
  );
}
