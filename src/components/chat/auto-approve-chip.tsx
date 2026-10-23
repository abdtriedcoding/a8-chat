"use client";

import { cn } from "cn";
import { useMutation } from "convex/react";
import { ZapIcon } from "lucide-react";
import { toast } from "sonner";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfirm } from "@/hooks/use-confirm";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { MAX_AUTO_APPROVED_ACTIONS } from "../../../convex/lib/autoApprove";

/**
 * The composer's auto-approve toggle (ADR 0014). Off, it's an icon with a
 * tooltip. On, it's labeled and colored. The first time an account turns it
 * on, a dialog explains the risk first, and Cancel leaves it off. A failed
 * `onChange` shows as a toast.
 */
export function AutoApproveChip({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => Promise<unknown> | void;
  disabled?: boolean;
}) {
  // A copy from the device that says it's seen still shows the warning, in
  // case it was reset.
  const { data: seenWarning, stale: seenStale } = useQueryWithLocalCopy(
    api.autoApprove.hasSeenWarning,
    {},
  );
  const markWarningSeen = useMutation(api.autoApprove.markWarningSeen);
  const [dialog, confirm] = useConfirm();

  async function change(next: boolean) {
    try {
      await onChange(next);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function toggle() {
    // Shown while the answer is still loading too, so it's never skipped.
    if (on || (seenWarning === true && !seenStale)) return change(!on);
    await confirm({
      title: "Auto-approve actions in this chat?",
      description: `An email or page a8 reads could tell it to take an action you didn't ask for, and with auto-approve on, nothing stops that call. Actions in this chat will run without asking you. After ${MAX_AUTO_APPROVED_ACTIONS} in one reply, the rest ask again.`,
      confirmLabel: "Turn on",
      onConfirm: async () => {
        await markWarningSeen();
        await onChange(true);
      },
    });
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <InputGroupButton
            type="button"
            variant="outline"
            size={on ? "sm" : "icon-sm"}
            aria-pressed={on}
            disabled={disabled}
            className={cn(
              on &&
                "border-primary/30 bg-primary/10 text-primary shadow-[inset_0_calc(var(--edge)*-1)_0_0_color-mix(in_oklch,var(--primary)_30%,transparent)] hover:bg-primary/15 hover:text-primary dark:border-primary/40 dark:bg-primary/20 dark:text-blue-300 dark:hover:bg-primary/25 dark:hover:text-blue-300",
            )}
            onClick={() => void toggle()}
          >
            <ZapIcon data-icon={on ? "inline-start" : undefined} />
            {on ? (
              "Auto-approve"
            ) : (
              <span className="sr-only">Auto-approve actions</span>
            )}
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>
          {on
            ? "Turn off auto-approve"
            : "Auto-approve actions, so they run without asking"}
        </TooltipContent>
      </Tooltip>
      {dialog}
    </>
  );
}
