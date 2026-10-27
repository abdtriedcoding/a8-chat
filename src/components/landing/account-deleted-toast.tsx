"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Settings sends the user here with `?deleted=1` once their account is
 * deleted. This says so, then drops the parameter so a reload doesn't show
 * it again.
 */
export function AccountDeletedToast() {
  const deleted = useSearchParams().has("deleted");
  const router = useRouter();

  useEffect(() => {
    if (!deleted) return;
    // The id keeps a second run of this effect from adding another toast.
    toast.success("Your account is deleted.", { id: "account-deleted" });
    router.replace("/", { scroll: false });
  }, [deleted, router]);

  return null;
}
