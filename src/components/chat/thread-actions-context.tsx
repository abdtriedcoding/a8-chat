"use client";

import { createContext, use, type ReactNode } from "react";

/** Approves or cancels the action waiting on the card with this approval ID. */
export type DecideAction = (
  approvalId: string,
  approve: boolean,
) => Promise<void>;

/**
 * What a thread's messages can do to it, and whether the last prompt's
 * editor is open. A shared snapshot's page sets no actions, so its messages
 * are read-only.
 */
export type ThreadActions = {
  /** Unset where nobody can decide on action cards. */
  decide?: DecideAction;
  /** Replaces the last reply. Unset while the last turn can't be redone. */
  regenerate?: () => Promise<void>;
  /** Edits the last prompt. Unset while the last turn can't be redone. */
  edit?: (prompt: string) => Promise<void>;
  editingLastPrompt: boolean;
  setEditingLastPrompt: (editing: boolean) => void;
  /**
   * Set where the Convex client isn't running yet, in the app's skeleton, so
   * messages leave out what reads from it: the reconnect chips.
   */
  offline?: boolean;
};

const ThreadActionsContext = createContext<ThreadActions | null>(null);

/** Gives every message inside it the thread's actions. */
export function ThreadActionsProvider({
  actions,
  children,
}: {
  actions: ThreadActions;
  children: ReactNode;
}) {
  return (
    <ThreadActionsContext value={actions}>{children}</ThreadActionsContext>
  );
}

export function useThreadActionsContext(): ThreadActions {
  const actions = use(ThreadActionsContext);
  if (!actions) {
    throw new Error(
      "useThreadActionsContext must be used within ThreadActionsProvider.",
    );
  }
  return actions;
}
