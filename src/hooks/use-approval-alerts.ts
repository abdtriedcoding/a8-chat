import { useConvexAuth } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

/** Tailwind's amber-400, the tint of blocked mentions in the composer. */
const DOT_COLOR = "#fbbf24";

/**
 * Tells the user which chats wait on their action cards. A chat that starts
 * waiting gets a toast, unless it's the open chat. The tab title starts with
 * the number of waiting chats, and the favicon gets an amber dot. The first
 * result after load shows no toasts, so a reload doesn't repeat them.
 */
export function useApprovalAlerts() {
  const { isAuthenticated } = useConvexAuth();
  const waiting = useQuery(
    api.pendingActions.listMine,
    isAuthenticated ? {} : "skip",
  );
  const pathname = usePathname();
  const router = useRouter();
  // The thread ids in the last result, or null before the first one.
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (waiting === undefined) return;
    const ids = new Set(waiting.map((thread) => thread.threadId));
    const previous = seen.current;
    seen.current = ids;
    const openId = pathname.startsWith("/c/") ? pathname.slice(3) : null;
    // The open chat shows its own action cards.
    if (openId !== null) toast.dismiss(toastId(openId));
    if (previous === null) return;

    for (const { threadId, title } of waiting) {
      if (previous.has(threadId) || threadId === openId) continue;
      toast.warning("Approval needed", {
        id: toastId(threadId),
        description: title,
        // Stays until the chat stops waiting or the user swipes it away.
        duration: Infinity,
        action: {
          label: "View",
          onClick: () => router.push(`/c/${threadId}`),
        },
      });
    }
    for (const threadId of previous) {
      if (!ids.has(threadId)) toast.dismiss(toastId(threadId));
    }
  }, [waiting, pathname, router]);

  // The toasts last until dismissed, and the Toaster outlives this hook, so
  // they'd stay on the sign-in page after a sign-out.
  useEffect(
    () => () => {
      for (const threadId of seen.current ?? []) {
        toast.dismiss(toastId(threadId));
      }
    },
    [],
  );

  const count = waiting?.length ?? 0;
  useTitleCount(count);
  useFaviconDot(count > 0);
}

function toastId(threadId: string) {
  return `approval-needed:${threadId}`;
}

/**
 * Puts "(count) " before the tab title while count is above 0. Next sets
 * the title again on every navigation, so an observer on <head> puts the
 * prefix back each time.
 */
function useTitleCount(count: number) {
  useEffect(() => {
    if (count === 0) return;
    // The title without the count, and the title as this last wrote it. A
    // regex for the prefix would also strip a chat title that starts with
    // "(1) ".
    let base = document.title;
    let written: string | undefined;
    const apply = () => {
      // The check stops the observer from firing on its own write forever.
      if (document.title === written) return;
      // A navigation removes the old <title> before it adds the new one.
      // Setting the title in between would add a second <title> that Next
      // never removes.
      if (!document.querySelector("title")) return;
      base = document.title;
      document.title = `(${count}) ${base}`;
      // Read back, since the browser collapses whitespace in the title.
      written = document.title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (document.title === written) document.title = base;
    };
  }, [count]);
}

/**
 * Points every icon link at the app icon with an amber dot while `on`, and
 * puts the old hrefs back after. Next can render the links again on
 * navigation, so an observer on <head> swaps new or changed links too.
 */
function useFaviconDot(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const source = document.querySelector<HTMLLinkElement>(
      'link[rel~="icon"][type="image/svg+xml"]',
    );
    if (!source) return;
    let cancelled = false;
    let observer: MutationObserver | undefined;
    const originals = new Map<HTMLLinkElement, string>();

    loadDottedIcon(source.href).then(
      (dotted) => {
        if (cancelled) return;
        const apply = () => {
          const links =
            document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
          for (const link of links) {
            const href = link.getAttribute("href");
            if (href === null || href === dotted) continue;
            originals.set(link, href);
            link.setAttribute("href", dotted);
          }
        };
        apply();
        observer = new MutationObserver(apply);
        observer.observe(document.head, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href"],
        });
      },
      // Without the dotted icon, the tab title still shows the count.
      () => {},
    );

    return () => {
      cancelled = true;
      observer?.disconnect();
      for (const [link, href] of originals) link.setAttribute("href", href);
    };
  }, [on]);
}

let dottedIcon: Promise<string> | undefined;

/**
 * The app icon from `href` (an SVG) with an amber dot in the top right, as
 * a data URL. Built once per page load.
 */
function loadDottedIcon(href: string): Promise<string> {
  dottedIcon ??= fetch(href)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Icon request failed: ${response.status}`);
      }
      return response.text();
    })
    .then((svg) => {
      // The icon's viewBox is 0 0 32 32. The white ring keeps the dot
      // visible on the blue background.
      const dot = `<circle cx="25" cy="7" r="6" fill="${DOT_COLOR}" stroke="#fff" stroke-width="2"/>`;
      const end = svg.lastIndexOf("</svg>");
      if (end === -1) throw new Error("The icon isn't an SVG.");
      const dotted = svg.slice(0, end) + dot + svg.slice(end);
      return `data:image/svg+xml,${encodeURIComponent(dotted)}`;
    })
    .catch((error: unknown) => {
      // Try again on the next call.
      dottedIcon = undefined;
      throw error;
    });
  return dottedIcon;
}
