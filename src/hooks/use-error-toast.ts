import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { errorMessage, isOutOfCredits } from "@/lib/errors";
import { BILLING_PATH } from "@/lib/plans";

/**
 * Shows an error as a toast with errorMessage. A Send refused for no
 * credits gets a button to the Billing page, where the user can upgrade.
 */
export function useErrorToast() {
  const router = useRouter();
  return (error: unknown) => {
    toast.error(
      errorMessage(error),
      isOutOfCredits(error)
        ? {
            action: {
              label: "Billing",
              onClick: () => router.push(BILLING_PATH),
            },
          }
        : undefined,
    );
  };
}
