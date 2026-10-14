import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { forgetConnectReturn, savedDraftFor } from "@/lib/connect-return";

/**
 * On mount, passes `setText` the text a sign-in from this page saved
 * (ConnectReturn), then forgets the sign-in so the text comes back once.
 * Session storage only exists in the browser, so this waits for the first
 * render there, after hydration. It runs only on mount, because a sign-in
 * started from the composer saves its text while the composer is still
 * here. It matches on the pathname Next is rendering, since right after the
 * Connectors page's router.replace, window.location can still be
 * /connectors.
 */
export function useRestoredDraft(setText: (text: string) => void) {
  const pathname = usePathname();
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [draftCheckedFor, setDraftCheckedFor] = useState<string>();
  if (inBrowser && draftCheckedFor === undefined) {
    setDraftCheckedFor(pathname);
    const draft = savedDraftFor(pathname);
    if (draft) setText(draft);
  }
  useEffect(() => {
    if (draftCheckedFor !== undefined) forgetConnectReturn(draftCheckedFor);
  }, [draftCheckedFor]);
}

/** For useSyncExternalStore, to tell the browser from the server render. */
function subscribeToNothing() {
  return () => {};
}
