"use client";

import { useMutation } from "convex/react";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";

type TemporaryThreadContextValue = {
  open: (threadId: string) => void;
  leave: () => Promise<void>;
};

const TemporaryThreadContext =
  createContext<TemporaryThreadContextValue | null>(null);

/**
 * Deletes the tab's temporary thread when the user leaves it: when the
 * route moves off the thread's page, or the chat pages unmount. The tab's
 * sessionStorage keeps the thread's ID, so a full page load of another
 * page, such as /chat, deletes it too, and a reload of the thread's page
 * keeps it. The idle cron (deleteIdleTemporaryThreads) deletes a thread
 * whose tab was closed, or whose delete failed.
 *
 * This watches the route here rather than in the thread page's effect
 * cleanup, since Strict Mode runs effect cleanups on mount in development.
 * It holds one thread per tab, so a temporary thread in another tab is left
 * alone.
 */
export function TemporaryThreadProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const removeThread = useMutation(api.threads.remove);
  const openId = useRef<string | null>(null);

  function setOpenId(threadId: string | null) {
    openId.current = threadId;
    saveOpenThreadId(threadId);
  }

  // A failed delete leaves the thread to the idle cron.
  async function deleteOpenThread() {
    const threadId = openId.current;
    if (!threadId) return;
    setOpenId(null);
    await removeThread({ threadId }).catch(() => {});
  }

  const onRouteChange = useEffectEvent((pathname: string) => {
    const threadId = openId.current;
    if (threadId && pathname !== `/c/${threadId}`) void deleteOpenThread();
  });
  const onUnmount = useEffectEvent(() => void deleteOpenThread());
  // Deletes the thread this tab had open before the page loaded, unless
  // this is its page. There the thread page opens it again.
  const onMount = useEffectEvent(() => {
    const threadId = readOpenThreadId();
    if (threadId && !openId.current && pathname !== `/c/${threadId}`) {
      saveOpenThreadId(null);
      void removeThread({ threadId }).catch(() => {});
    }
  });

  useEffect(() => onMount(), []);
  useEffect(() => onRouteChange(pathname), [pathname]);
  // Strict Mode's extra unmount runs before any thread opens, so this
  // deletes nothing then.
  useEffect(() => () => onUnmount(), []);

  return (
    <TemporaryThreadContext
      value={{
        open: (threadId) => {
          // Leaving a thread deletes it before another opens, so this
          // only catches a thread the route change missed.
          if (openId.current !== threadId) void deleteOpenThread();
          setOpenId(threadId);
        },
        leave: deleteOpenThread,
      }}
    >
      {children}
    </TemporaryThreadContext>
  );
}

// sessionStorage belongs to this tab and goes when the tab closes. Reads and
// writes can throw, for example when storage is blocked, and then a full
// page load leaves the thread to the idle cron.
const OPEN_THREAD_KEY = "a8:temporary-thread";

function readOpenThreadId(): string | null {
  try {
    return sessionStorage.getItem(OPEN_THREAD_KEY);
  } catch {
    return null;
  }
}

function saveOpenThreadId(threadId: string | null) {
  try {
    if (threadId) sessionStorage.setItem(OPEN_THREAD_KEY, threadId);
    else sessionStorage.removeItem(OPEN_THREAD_KEY);
  } catch {}
}

function useTemporaryThreadContext() {
  const value = useContext(TemporaryThreadContext);
  if (!value) {
    throw new Error(
      "Temporary thread hooks must be used within TemporaryThreadProvider.",
    );
  }
  return value;
}

/**
 * Marks a temporary thread as the tab's open one, so leaving its page
 * deletes it. New chat calls this before it opens the thread, and the
 * thread page calls it again, after a reload.
 */
export function useOpenTemporaryThread() {
  return useTemporaryThreadContext().open;
}

/**
 * Deletes the tab's temporary thread, if it has one, and resolves once the
 * delete is done or failed. Sign-out calls this first, since it reloads the
 * page.
 */
export function useLeaveTemporaryThread() {
  return useTemporaryThreadContext().leave;
}
