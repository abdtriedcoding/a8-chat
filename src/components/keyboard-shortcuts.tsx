"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useThreadSearch } from "@/components/thread-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";

type Shortcut =
  | "search"
  | "newChat"
  | "toggleSidebar"
  | "stopReply"
  | "editLastPrompt"
  | "copyLastReply"
  | "help";

/**
 * What the open thread lets the shortcuts do. ThreadView sets each one only
 * while it can run.
 */
export type ThreadShortcuts = {
  stopReply?: () => void;
  editLastPrompt?: () => void;
  copyLastReply?: () => void;
};

// "Mod" is Cmd on a Mac and Ctrl elsewhere.
const HELP: { shortcut: Shortcut; label: string; keys: string[] }[] = [
  { shortcut: "search", label: "Search chats", keys: ["Mod", "K"] },
  { shortcut: "newChat", label: "New chat", keys: ["Mod", "Shift", "O"] },
  { shortcut: "toggleSidebar", label: "Toggle sidebar", keys: ["Mod", "B"] },
  { shortcut: "stopReply", label: "Stop the reply", keys: ["Esc"] },
  {
    shortcut: "editLastPrompt",
    label: "Edit your last message, from an empty message box",
    keys: ["↑"],
  },
  {
    shortcut: "copyLastReply",
    label: "Copy the last reply",
    keys: ["Mod", "Shift", "C"],
  },
  { shortcut: "help", label: "Keyboard shortcuts", keys: ["Mod", "/"] },
];

const SetThreadShortcutsContext = createContext<
  ((shortcuts: ThreadShortcuts) => void) | null
>(null);
const OpenHelpContext = createContext<(() => void) | null>(null);

/**
 * The chat's keyboard shortcuts, all handled here, and the dialog that lists
 * them. Must be inside SidebarProvider and ThreadSearchProvider.
 */
export function KeyboardShortcutsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const threadShortcutsRef = useRef<ThreadShortcuts>({});
  const router = useRouter();
  const { toggleSearch } = useThreadSearch();
  const { toggleSidebar } = useSidebar();
  const closeOnMobile = useCloseSidebarOnMobile();

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const { stopReply, editLastPrompt, copyLastReply } =
      threadShortcutsRef.current;
    switch (shortcutFor(event)) {
      case "search":
        toggleSearch();
        break;
      case "newChat":
        closeOnMobile();
        router.push("/chat");
        break;
      case "toggleSidebar":
        toggleSidebar();
        break;
      case "help":
        setHelpOpen((wasOpen) => !wasOpen);
        break;
      case "copyLastReply":
        // Blocks the browser's own Ctrl+Shift+C even with nothing to copy.
        copyLastReply?.();
        break;
      case "stopReply":
        // An open dialog, menu or editor takes Esc first and prevents its
        // default.
        if (event.defaultPrevented || !stopReply) return;
        stopReply();
        break;
      case "editLastPrompt":
        if (!isEmptyComposer(event.target) || !editLastPrompt) return;
        editLastPrompt();
        break;
      case null:
        return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SetThreadShortcutsContext
      value={(shortcuts) => {
        threadShortcutsRef.current = shortcuts;
      }}
    >
      <OpenHelpContext value={() => setHelpOpen(true)}>
        {children}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Keyboard shortcuts</DialogTitle>
              <DialogDescription>
                They work anywhere in your chats.
              </DialogDescription>
            </DialogHeader>
            <ShortcutList />
          </DialogContent>
        </Dialog>
      </OpenHelpContext>
    </SetThreadShortcutsContext>
  );
}

/** Lets the shortcuts act on the open thread while the caller is mounted. */
export function useThreadShortcuts(shortcuts: ThreadShortcuts) {
  const setThreadShortcuts = useContext(SetThreadShortcutsContext);
  if (!setThreadShortcuts) {
    throw new Error(
      "useThreadShortcuts must be used within KeyboardShortcutsProvider.",
    );
  }
  useEffect(() => {
    setThreadShortcuts(shortcuts);
    return () => setThreadShortcuts({});
  }, [setThreadShortcuts, shortcuts]);
}

/** Opens the shortcuts dialog. */
export function useOpenShortcutsHelp() {
  const openHelp = useContext(OpenHelpContext);
  if (!openHelp) {
    throw new Error(
      "useOpenShortcutsHelp must be used within KeyboardShortcutsProvider.",
    );
  }
  return openHelp;
}

function shortcutFor(event: KeyboardEvent): Shortcut | null {
  // While an IME is composing, keys pick and confirm words.
  if (event.isComposing || event.altKey) return null;
  // Chrome sends autofill keydowns with no key.
  const key = event.key?.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    // Some keyboard layouts need Shift to type "/".
    if (key === "/") return "help";
    if (event.shiftKey) {
      if (key === "o") return "newChat";
      if (key === "c") return "copyLastReply";
      return null;
    }
    if (key === "k") return "search";
    if (key === "b") return "toggleSidebar";
    return null;
  }
  if (event.shiftKey) return null;
  if (key === "escape") return "stopReply";
  if (key === "arrowup") return "editLastPrompt";
  return null;
}

/** Whether the key was pressed in the message box, and it holds nothing. */
function isEmptyComposer(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.matches("[data-composer][data-empty]")
  );
}

function ShortcutList() {
  // Only rendered in the open dialog, so never on the server.
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const keyLabels: Record<string, string> = isMac
    ? { Mod: "⌘", Shift: "⇧" }
    : { Mod: "Ctrl" };

  return (
    <dl className="flex flex-col gap-3">
      {HELP.map(({ shortcut, label, keys }) => (
        <div
          key={shortcut}
          className="flex items-center justify-between gap-4"
        >
          <dt>{label}</dt>
          <dd className="shrink-0">
            <KbdGroup>
              {keys.map((key) => (
                <Kbd key={key}>{keyLabels[key] ?? key}</Kbd>
              ))}
            </KbdGroup>
          </dd>
        </div>
      ))}
    </dl>
  );
}
