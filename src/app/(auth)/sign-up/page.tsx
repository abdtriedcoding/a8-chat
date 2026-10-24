import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpForm, SignUpFormFromUrl } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Sign up" };

// Static. proxy.ts sends signed-in users to `?next=` or /chat. The static
// HTML has the form for /chat, and the browser reads the URL's next once it
// loads.
export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpForm />}>
      <SignUpFormFromUrl />
    </Suspense>
  );
}
