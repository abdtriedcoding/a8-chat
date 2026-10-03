"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { threadTitle } from "@/components/thread-list";
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
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "../../convex/_generated/api";

type SearchResult = FunctionReturnType<typeof api.threads.search>[number];

const DEBOUNCE_MS = 250;

const OpenSearchContext = createContext<(() => void) | null>(null);

/**
 * The thread search dialog, opened by Cmd/Ctrl+K or by ThreadSearchButton.
 * It lives outside the sidebar, because on phones the sidebar is a sheet
 * that unmounts when closed. Must be inside SidebarProvider.
 */
export function ThreadSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const closeOnMobile = useCloseSidebarOnMobile();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        // Chrome on Windows would focus the address bar.
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openThread(threadId: string) {
    setOpen(false);
    closeOnMobile();
    router.push(`/c/${threadId}`);
  }

  return (
    <OpenSearchContext value={() => setOpen(true)}>
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
    </OpenSearchContext>
  );
}

/** Opens the search dialog. For phones, where there's no Cmd/Ctrl+K. */
export function ThreadSearchButton() {
  const openSearch = useContext(OpenSearchContext);
  if (!openSearch) {
    throw new Error(
      "ThreadSearchButton must be used within ThreadSearchProvider.",
    );
  }
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
  // Clearing the box clears the results at once, without the debounce.
  const search = query ? debounced : "";
  const { isLoading } = useConvexAuth();
  const results = useQuery(
    api.threads.search,
    // Wait for auth, or the results would come back empty (signed out).
    search && !isLoading ? { query: search } : "skip",
  );
  // Keep showing the last results while the next ones load, so the list
  // doesn't blank out on every keystroke.
  const [lastResults, setLastResults] = useState<SearchResult[]>([]);
  if (results !== undefined && results !== lastResults) {
    setLastResults(results);
  }
  const shown = search ? (results ?? lastResults) : [];
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
