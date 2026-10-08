"use client";

import { useAction } from "convex/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isSignInOutcome,
  OUTCOME_KEY,
  REDIRECT_KEY,
  SIGN_IN_CHANNEL,
  type SignInOutcome,
} from "@/lib/app-sign-in";
import { errorMessage } from "@/lib/errors";
import { api } from "../../convex/_generated/api";

const POPUP_NAME = "a8-app-sign-in";
const POPUP_FEATURES = "popup,width=520,height=720";
const POPUP_POLL_MS = 500;
// After the user closes the popup, how long to wait for a message that was
// already on its way before calling the sign-in cancelled.
const CLOSED_GRACE_MS = 1500;

type Connector = { handle: string; name: string };

/**
 * Connects apps. `connect` opens the app's sign-in in a popup, or sends the
 * whole tab there when popups are blocked. `waiting` is the handle of the
 * app whose sign-in is open, until it reports back, the popup closes, or
 * the user cancels.
 */
export function useConnectApp(connectors: readonly Connector[]) {
  const startConnect = useAction(api.connections.connect);
  const [waiting, setWaitingState] = useState<string | null>(null);
  // The same as `waiting`, for the popup watch's timers to read.
  const waitingFor = useRef<string | null>(null);
  const popupWatch = useRef<number>(undefined);
  // The sign-in popup. This tab closes it when it reports back, since the
  // page in it can't close itself after the app's pages.
  const popupRef = useRef<Window | null>(null);

  function setWaiting(handle: string | null) {
    waitingFor.current = handle;
    setWaitingState(handle);
  }

  function stopWaiting() {
    window.clearInterval(popupWatch.current);
    setWaiting(null);
  }

  const showOutcome = useEffectEvent((outcome: SignInOutcome) => {
    const name =
      outcome.name ??
      connectors.find(({ handle }) => handle === outcome.connector)?.name ??
      "The app";
    toastOutcome(outcome, name);
  });

  const onPopupMessage = useEffectEvent((outcome: SignInOutcome) => {
    stopWaiting();
    popupRef.current?.close();
    popupRef.current = null;
    showOutcome(outcome);
  });

  useEffect(() => {
    // Back from a full-page sign-in.
    const saved = sessionStorage.getItem(OUTCOME_KEY);
    if (saved) {
      sessionStorage.removeItem(OUTCOME_KEY);
      const outcome: unknown = JSON.parse(saved);
      if (isSignInOutcome(outcome)) showOutcome(outcome);
    }
    // A popup finishing.
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (isSignInOutcome(data)) onPopupMessage(data);
    };
    return () => {
      channel.close();
      window.clearInterval(popupWatch.current);
    };
  }, []);

  /** Treats the popup closing with no message as a cancelled sign-in. */
  function watchPopup(popup: Window, connector: Connector) {
    window.clearInterval(popupWatch.current);
    popupWatch.current = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(popupWatch.current);
      window.setTimeout(() => {
        if (waitingFor.current !== connector.handle) return;
        setWaiting(null);
        toastOutcome({ result: "cancelled" }, connector.name);
      }, CLOSED_GRACE_MS);
    }, POPUP_POLL_MS);
  }

  /** Call from a click, so the browser lets the popup open. */
  async function connect(connector: Connector) {
    // The popup gets a copy of this tab's sessionStorage, so clear a
    // full-page sign-in that never came back first.
    sessionStorage.removeItem(REDIRECT_KEY);
    // Open the popup now, while the click still counts as the user's. The
    // sign-in URL comes after a round trip, which would be too late.
    const popup = window.open("", POPUP_NAME, POPUP_FEATURES);
    popupRef.current = popup;
    setWaiting(connector.handle);
    try {
      const started = await startConnect({
        connector: connector.handle,
        returnPath: window.location.pathname,
      });
      if ("code" in started) {
        popup?.close();
        stopWaiting();
        toast.error(started.message);
      } else if (popup && !popup.closed) {
        // The app's page gets no handle back to this tab.
        popup.opener = null;
        popup.location.href = started.authorizationUrl;
        watchPopup(popup, connector);
      } else {
        sessionStorage.setItem(REDIRECT_KEY, connector.name);
        window.location.assign(started.authorizationUrl);
      }
    } catch (error) {
      popup?.close();
      stopWaiting();
      toast.error(errorMessage(error));
    }
  }

  return { connect, waiting, cancel: stopWaiting };
}

function toastOutcome({ result }: SignInOutcome, name: string) {
  switch (result) {
    case "connected":
      toast.success(`${name} is connected.`);
      break;
    case "cancelled":
      toast.error(`Sign-in cancelled. ${name} isn't connected.`);
      break;
    case "expired":
      toast.error("That sign-in expired. Please connect again.");
      break;
    case "failed":
      toast.error(`Couldn't connect ${name}. Please try again.`);
      break;
  }
}
