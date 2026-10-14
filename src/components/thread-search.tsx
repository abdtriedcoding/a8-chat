"use client";

import type { FunctionReturnType } from "convex/server";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuthQuery } from "@/hooks/use-auth-query";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

type SearchResult = FunctionReturnType<typeof api.threads.search>[number];

const DEBOUNCE_MS = 250;
// One shared empty list. ThreadSearch compares lists by reference, so a new
// [] on each render would loop.
const NO_RESULTS: SearchResult[] = [];

type ThreadSearchControls = {
  openSearch: () => void;
  toggleSearch: () => void;
};

const ThreadSearchContext = createContext<ThreadSearchControls | null>(null);

/**
 * The thread search dialog, opened by Cmd/Ctrl+K (see
 * KeyboardShortcutsProvider) or by ThreadSearchButton. It lives outside the
 * sidebar, because on phones the sidebar is a sheet that unmounts when
 * closed. Must be inside SidebarProvider.
 */
export function ThreadSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const closeOnMobile = useCloseSidebarOnMobile();

  function openThread(threadId: string) {
    setOpen(false);
    closeOnMobile();
    router.push(`/c/${threadId}`);
  }

  return (
    <ThreadSearchContext
      value={{
        openSearch: () => setOpen(true),
        toggleSearch: () => setOpen((wasOpen) => !wasOpen),
      }}
    >
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search chats"
        description="Find a chat by its title or by text in its messages."
        className="sm:max-w-lg"
      >
        <ThreadSearch onSelect={openThread} />
      </CommandDialog>
    </ThreadSearchContext>
  );
}

/** Opens or toggles the search dialog. */
export function useThreadSearch() {
  const controls = useContext(ThreadSearchContext);
  if (!controls) {
    throw new Error("useThreadSearch must be used within ThreadSearchProvider.");
  }
  return controls;
}

/** The sidebar's button for the search dialog. Phones have no Cmd/Ctrl+K. */
export function ThreadSearchButton() {
  const { openSearch } = useThreadSearch();
  return (
    <Button variant="ghost" className="justify-start" onClick={openSearch}>
      <SearchIcon data-icon="inline-start" />
      Search chats
    </Button>
  );
}

/**
 * The search box and its results. The dialog unmounts it when closed, so
 * each opening starts with an empty box.
 */
function ThreadSearch({ onSelect }: { onSelect: (threadId: string) => void }) {
  const [input, setInput] = useState("");
  const query = input.trim();
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  // What the server searches for. Clearing the box clears the results at
  // once, without the debounce.
  const serverQuery = query ? debounced : "";
  const results = useAuthQuery(
    api.threads.search,
    serverQuery ? { query: serverQuery } : "skip",
  );
  // Keep showing the last results while the next ones load, so the list
  // doesn't blank out on every keystroke.
  const [lastResults, setLastResults] = useState<SearchResult[]>(NO_RESULTS);
  if (results !== undefined && results !== lastResults) {
    setLastResults(results);
  }
  const shown = serverQuery ? (results ?? lastResults) : NO_RESULTS;
  const settled = results !== undefined && debounced === query;

  return (
    // The server already matched the results, so cmdk mustn't filter them.
    <Command shouldFilter={false}>
      <CommandInput
        value={input}
        onValueChange={setInput}
        placeholder="Search chats…"
      />
      <CommandList>
        {shown.length > 0 ? (
          <CommandGroup heading="Chats">
            {shown.map((result) => (
              <CommandItem
                key={result.threadId}
                value={result.threadId}
                onSelect={() => onSelect(result.threadId)}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {threadTitle(result)}
                  </span>
                  {result.snippet && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {result.snippet}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : (
          query &&
          settled && (
            <CommandEmpty>No chats match &ldquo;{query}&rdquo;.</CommandEmpty>
          )
        )}
      </CommandList>
    </Command>
  );
}
