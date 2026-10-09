import { useAction } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { api } from "../../convex/_generated/api";

/**
 * Starts signing in to a connector. The browser goes to the vendor's
 * sign-in, and comes back to the Connectors page. `connecting` stays true
 * until the browser leaves, or until the start fails and shows a toast.
 */
export function useConnectConnector(connectorId: string) {
  const connect = useAction(api.connectors.connect);
  const [connecting, setConnecting] = useState(false);

  async function startConnect() {
    setConnecting(true);
    try {
      window.location.assign(await connect({ connectorId }));
    } catch (error) {
      toast.error(errorMessage(error));
      setConnecting(false);
    }
  }

  return { connecting, startConnect };
}
