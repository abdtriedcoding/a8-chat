"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Whether the user has a password, which is whether they have an email
 * account. A Google-only user doesn't. Undefined until it loads.
 */
export function useHasPassword(): boolean | undefined {
  const [hasPassword, setHasPassword] = useState<boolean>();
  useEffect(() => {
    let cancelled = false;
    authClient
      .listAccounts()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setHasPassword(data.some(({ providerId }) => providerId === "credential"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return hasPassword;
}
