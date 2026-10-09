"use client";

import Image from "next/image";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { ConnectorStatus } from "../../../convex/connectors";

const STATUS_LABELS: Record<ConnectorStatus["status"], string | undefined> = {
  connected: undefined,
  needs_reconnect: "Needs reconnecting",
  disconnected: "Not connected",
};

/**
 * The connectors to pick from after @ in the composer, shown above it.
 * Focus stays in the message box, which handles the keys
 * (useComposerMentions), so this only shows the selection and takes clicks.
 */
export function MentionMenu({
  options,
  selectedId,
  onSelectedChange,
  onPick,
}: {
  options: ConnectorStatus[];
  selectedId: string;
  onSelectedChange: (id: string) => void;
  onPick: (connector: ConnectorStatus) => void;
}) {
  return (
    <Command
      value={selectedId}
      onValueChange={onSelectedChange}
      shouldFilter={false}
      className="absolute bottom-full left-0 z-10 mb-2 size-auto w-full rounded-xl border shadow-md sm:w-80"
    >
      <CommandList>
        <CommandGroup heading="Connectors">
          {options.map((connector) => (
            <CommandItem
              key={connector.id}
              value={connector.id}
              onSelect={() => onPick(connector)}
              // Keeps focus in the message box.
              onMouseDown={(event) => event.preventDefault()}
            >
              {/* Logos are drawn for a light background, so they get a white one in both themes. */}
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-foreground/10">
                <Image src={connector.logo} alt="" width={16} height={16} />
              </span>
              <span className="font-medium">{connector.name}</span>
              <span className="truncate text-muted-foreground">
                @{connector.handle}
              </span>
              {STATUS_LABELS[connector.status] && (
                <CommandShortcut className="shrink-0 tracking-normal">
                  {STATUS_LABELS[connector.status]}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
