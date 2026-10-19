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
  | "dictate"
  | "help";

/** What the dictation keys do in the message box on screen. */
export type DictationShortcuts = {
  toggle?: () => void;
  /** Set while dictation is on, so Esc stops it before the reply. */
  stop?: () => void;
};

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
  {
    shortcut: "stopReply",
    label: "Stop dictation or the reply",
    keys: ["Esc"],
  },
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
  {
    shortcut: "dictate",
    label: "Start or stop dictation",
    keys: ["Mod", "Shift", "Space"],
  },
  { shortcut: "help", label: "Keyboard shortcuts", keys: ["Mod", "/"] },
];

const SetThreadShortcutsContext = createContext<
  ((shortcuts: ThreadShortcuts) => void) | null
>(null);
const SetDictationShortcutsContext = createContext<
  ((shortcuts: DictationShortcuts) => void) | null
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
  const dictationShortcutsRef = useRef<DictationShortcuts>({});
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
      case "dictate":
        if (!dictationShortcutsRef.current.toggle) return;
        dictationShortcutsRef.current.toggle();
        break;
      case "stopReply":
        // An open dialog, menu or editor takes Esc first and prevents its
        // default.
        if (event.defaultPrevented) return;
        if (dictationShortcutsRef.current.stop) {
          dictationShortcutsRef.current.stop();
        } else if (stopReply) {
          stopReply();
        } else {
          return;
        }
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
      <SetDictationShortcutsContext
        value={(shortcuts) => {
          dictationShortcutsRef.current = shortcuts;
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
      </SetDictationShortcutsContext>
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

/**
 * Lets Ctrl/Cmd+Shift+Space and Esc act on dictation in the caller's message
 * box while it's mounted.
 */
export function useDictationShortcuts(shortcuts: DictationShortcuts) {
  const setShortcuts = useContext(SetDictationShortcutsContext);
  if (!setShortcuts) {
    throw new Error(
      "useDictationShortcuts must be used within KeyboardShortcutsProvider.",
    );
  }
  useEffect(() => {
    setShortcuts(shortcuts);
    return () => setShortcuts({});
  }, [setShortcuts, shortcuts]);
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
      if (key === " ") return "dictate";
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
