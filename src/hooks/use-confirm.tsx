"use client";

import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/errors";

type ConfirmOptions = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /**
   * Runs on confirm. The dialog stays open with a spinner until it finishes.
   * If it throws, the dialog shows the error as a toast and stays open.
   */
  onConfirm: () => Promise<unknown>;
};

/**
 * Asks the user to confirm an action. `confirm` opens the dialog and resolves
 * true once the user confirms and `onConfirm` succeeds, false when they cancel
 * or dismiss it. Render `dialog` once in the component that calls `confirm`.
 */
export function useConfirm() {
  const [promise, setPromise] = useState<{
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  // Kept after the dialog closes, so its text doesn't blank mid-animation.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [pending, setPending] = useState(false);

  function confirm(next: ConfirmOptions) {
    promise?.resolve(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => setPromise({ resolve }));
  }

  function settle(confirmed: boolean) {
    promise?.resolve(confirmed);
    setPromise(null);
  }

  async function handleConfirm() {
    setPending(true);
    try {
      await options?.onConfirm();
      settle(true);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const dialog = (
    <AlertDialog
      open={promise !== null}
      onOpenChange={(open) => {
        if (!open && !pending) settle(false);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {options?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={options?.destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={(event) => {
              // Stay open until onConfirm lands, so a failure can show.
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {options?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [dialog, confirm] as const;
}
