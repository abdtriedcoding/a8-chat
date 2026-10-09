"use client";

import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { ConnectResult } from "../../../convex/connectors";
import {
  CONNECTORS,
  findConnector,
  type ConnectError,
} from "../../../convex/lib/connectors";
import { ConnectorCard } from "./connector-card";

/**
 * What the sign-in callback's redirect put in the page's search params: a
 * sign-in to finish, or why it ended early.
 */
export type CallbackParams =
  | { finish: string }
  | { error: ConnectError }
  | undefined;

const ERROR_MESSAGES: Record<ConnectError, string> = {
  cancelled: "Sign-in was cancelled, so nothing was connected.",
  expired: "That sign-in expired. Turn the toggle on to try again.",
  failed: "Couldn't connect. Please try again.",
};

/** A fixed id, so each step of a sign-in replaces the last one's toast. */
const TOAST_ID = "connector-sign-in";

/**
 * The catalog with the user's connection status. Cards render from the
 * catalog right away and pick up their status when the query loads.
 */
export function ConnectorList({
  callbackParams,
}: {
  callbackParams: CallbackParams;
}) {
  const { isLoading } = useConvexAuth();
  const connections = useQuery(api.connectors.list, isLoading ? "skip" : {});
  useFinishSignIn(callbackParams, isLoading);

  return (
    <ul className="flex flex-col gap-4">
      {CONNECTORS.map((connector) => (
        <li key={connector.id}>
          <ConnectorCard
            connector={connector}
            connection={connections?.find(({ id }) => id === connector.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Finishes the sign-in the callback sent the user back with, or shows why
 * it ended early. Then drops the params from the URL.
 */
function useFinishSignIn(callbackParams: CallbackParams, authLoading: boolean) {
  const router = useRouter();
  const finishConnect = useAction(api.connectors.finishConnect);
  // finishConnect deletes the sign-in, so a second call would report it
  // expired. React can run an effect twice in development.
  const handled = useRef<CallbackParams>(undefined);

  useEffect(() => {
    if (!callbackParams || authLoading || handled.current === callbackParams) {
      return;
    }
    handled.current = callbackParams;
    router.replace("/connectors");
    if ("error" in callbackParams) {
      toast.error(ERROR_MESSAGES[callbackParams.error], { id: TOAST_ID });
      return;
    }
    toast.loading("Connecting…", { id: TOAST_ID });
    finishConnect({ state: callbackParams.finish })
      .catch((): ConnectResult => ({ error: "failed" }))
      .then(showResult);
  }, [callbackParams, authLoading, router, finishConnect]);
}

function showResult(result: ConnectResult) {
  if ("error" in result) {
    toast.error(ERROR_MESSAGES[result.error], { id: TOAST_ID });
    return;
  }
  const name = findConnector(result.connected)?.name;
  toast.success(name ? `${name} is connected.` : "Connected.", {
    id: TOAST_ID,
  });
}
