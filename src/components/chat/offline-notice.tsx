"use client";

import { useConvexConnectionState } from "convex/react";
import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * How long the connection has to stay down before the notice shows. The
 * Convex client also drops and reopens the connection for a moment, for
 * example when the tab wakes up, and connects a moment after a page loads.
 */
const SHOW_AFTER_MS = 1500;

/**
 * Says the app is offline while the Convex connection is down, including a
 * page that loads offline. A Send made meanwhile waits in the Convex client
 * and goes once it reconnects.
 *
 * The status region stays on the page, empty while online, since screen
 * readers only announce a change to a region that was already there.
 */
export function OfflineNotice({ className }: { className?: string }) {
  const down = !useConvexConnectionState().isWebSocketConnected;
  const [shown, setShown] = useState(false);
  if (!down && shown) setShown(false);
  useEffect(() => {
    if (!down) return;
    // setState in a timer callback, not the effect body (a React Compiler rule).
    const timeout = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timeout);
  }, [down]);
  const visible = down && shown;
  return (
    <div role="status" className={visible ? className : undefined}>
      {visible && (
        // The region above announces it, so the Alert drops its own role.
        <Alert role={undefined}>
          <WifiOffIcon />
          <AlertTitle>You&apos;re offline</AlertTitle>
          <AlertDescription>It&apos;ll send when you reconnect.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
