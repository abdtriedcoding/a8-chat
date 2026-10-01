"use client";

import { useState } from "react";
import { GoogleIcon } from "@/components/icons/google-icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

const OAUTH_ERRORS: Record<string, string> = {
  // Account linking is off, so Google can't sign in to an email/password
  // account that uses the same address.
  account_not_linked:
    "That email already has a password account. Sign in with your email and password instead.",
  access_denied: "Google sign-in was cancelled.",
};

/** A readable message for the `?error=` code Better Auth adds after OAuth. */
export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? "Google sign-in didn't complete. Please try again.";
}

export function GoogleButton({
  disabled,
  onError,
}: {
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/chat",
      errorCallbackURL: "/sign-in",
    });
    // On success the browser is already on its way to Google.
    if (error) {
      onError(error.message ?? "Couldn't start Google sign-in. Please try again.");
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      disabled={disabled || pending}
      onClick={signIn}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <GoogleIcon data-icon="inline-start" />
      )}
      Continue with Google
    </Button>
  );
}
