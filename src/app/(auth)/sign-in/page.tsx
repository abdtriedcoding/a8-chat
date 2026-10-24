import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm, SignInFormFromUrl } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

// Static. proxy.ts sends signed-in users to `?next=` or /chat. The static
// HTML has the form with no notice, and the browser reads the URL once it
// loads.
export default function SignInPage() {
  return (
    <Suspense fallback={<SignInForm />}>
      <SignInFormFromUrl />
    </Suspense>
  );
}
