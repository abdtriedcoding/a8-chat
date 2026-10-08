"use client";

import { useAction } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import {
  OUTCOME_KEY,
  REDIRECT_KEY,
  safeReturnPath,
  SIGN_IN_CHANNEL,
  type SignInOutcome,
} from "@/lib/app-sign-in";
import { api } from "../../../convex/_generated/api";

/**
 * Finishes a sign-in and reports it. With a `state`, the server sent back a
 * code, and finishConnect connects the app. Without one, the sign-in ended
 * early with `result`. In the popup, it tells the opening tab, which
 * closes the popup. After a full-page sign-in, it goes back to the page
 * that started it, which shows the outcome.
 */
export function SignInDone(params: {
  state: string | null;
  result: string | null;
  connector: string | null;
  returnPath: string | null;
}) {
  const router = useRouter();
  const finishConnect = useAction(api.connections.finishConnect);
  const [outcome, setOutcome] = useState<SignInOutcome>();
  const [returnPath, setReturnPath] = useState(() =>
    safeReturnPath(params.returnPath),
  );
  // Finish once, even when development mode runs the effect twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function finish() {
      let next: SignInOutcome;
      let path = safeReturnPath(params.returnPath);
      if (params.state) {
        try {
          const finished = await finishConnect({ state: params.state });
          next = { result: finished.result, connector: finished.connector };
          path = safeReturnPath(finished.returnPath);
        } catch {
          next = { result: "failed", connector: params.connector ?? undefined };
        }
      } else {
        // Only finishConnect can say an app connected.
        next = {
          result:
            params.result === "cancelled" || params.result === "expired"
              ? params.result
              : "failed",
          connector: params.connector ?? undefined,
        };
      }
      setOutcome(next);
      setReturnPath(path);

      const name = sessionStorage.getItem(REDIRECT_KEY);
      if (name !== null) {
        sessionStorage.removeItem(REDIRECT_KEY);
        sessionStorage.setItem(OUTCOME_KEY, JSON.stringify({ ...next, name }));
        router.replace(path);
        return;
      }
      // The tab that opened the popup closes it when this arrives.
      const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
      channel.postMessage(next);
      channel.close();
    }
    void finish();
  }, [finishConnect, params, router]);

  // Shown while it finishes, and after if no tab closes the popup.
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      {outcome === undefined ? (
        <p className="flex items-center gap-2">
          <Spinner />
          Connecting
        </p>
      ) : (
        <>
          <p>
            {outcome.result === "connected"
              ? "The app is connected. You can close this window."
              : "The app isn't connected. You can close this window."}
          </p>
          <Link
            href={returnPath}
            className="text-muted-foreground underline underline-offset-3 hover:text-foreground"
          >
            Back to a8
          </Link>
        </>
      )}
    </main>
  );
}
