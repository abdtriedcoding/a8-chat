"use client";

import { useEffect } from "react";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import {
  mentionOptionId,
  type MentionOption,
} from "@/hooks/use-composer-mentions";

const STATUS_LABELS: Record<MentionOption["status"], string | undefined> = {
  connected: undefined,
  needs_reconnect: "Needs reconnecting",
  disconnected: "Not connected",
};

/**
 * The connectors to pick from after @ in the composer, shown above it.
 * Focus stays in the message box, which is the listbox's combobox and
 * handles the keys (useComposerMentions), so this only shows the selection
 * and takes clicks. `id` is the listbox's, which the message box points
 * at, along with the selected option's mentionOptionId.
 *
 * It's a plain listbox styled like Command, because cmdk sets its own ids
 * on the list and its options, and the message box needs to name them.
 */
export function MentionMenu({
  id,
  options,
  selectedId,
  onSelectedChange,
  onPick,
}: {
  id: string;
  options: MentionOption[];
  selectedId: string;
  onSelectedChange: (id: string) => void;
  onPick: (connector: MentionOption) => void;
}) {
  // Keeps the selected option in view as ↑ and ↓ move past the list's edge.
  useEffect(() => {
    document
      .getElementById(mentionOptionId(id, selectedId))
      ?.scrollIntoView({ block: "nearest" });
  }, [id, selectedId]);

  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 flex w-full flex-col overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-md sm:w-80">
      <div className="no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto">
        <div className="p-1 text-foreground">
          <div
            aria-hidden
            className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
          >
            Connectors
          </div>
          <ul id={id} role="listbox" aria-label="Connectors">
            {options.map((connector) => {
              const selected = connector.id === selectedId;
              const status = STATUS_LABELS[connector.status];
              return (
                <li
                  key={connector.id}
                  id={mentionOptionId(id, connector.id)}
                  role="option"
                  aria-selected={selected}
                  data-selected={selected || undefined}
                  onPointerMove={() => {
                    if (!selected) onSelectedChange(connector.id);
                  }}
                  // Keeps focus in the message box.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(connector)}
                  className="group/option flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-selected:bg-muted data-selected:text-foreground"
                >
                  <ConnectorLogo connector={connector} size="md" />
                  <span className="font-medium">{connector.name}</span>
                  <span className="truncate text-muted-foreground">
                    @{connector.handle}
                  </span>
                  {status && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground group-data-selected/option:text-foreground">
                      {status}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
