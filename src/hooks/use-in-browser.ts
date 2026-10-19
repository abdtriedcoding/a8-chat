import { useSyncExternalStore } from "react";

/** Whether this render runs in the browser: false on the server render. */
export function useInBrowser() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function subscribeToNothing() {
  return () => {};
}
