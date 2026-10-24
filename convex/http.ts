import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { callback as connectorCallback } from "./connectors";
import { billingEnabled, polar } from "./lib/billing";
import { CALLBACK_PATH } from "./lib/connectorAuth";
import { SHARED_FILES_PATH } from "./lib/sharedFiles";
import { serveSharedFile } from "./sharedSnapshots";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Polar's webhooks, at /polar/events. They keep the component's products
// and subscriptions current, and a8 reads the plan from them.
if (billingEnabled) polar.registerRoutes(http);

http.route({
  path: CALLBACK_PATH,
  method: "GET",
  handler: connectorCallback,
});

http.route({
  pathPrefix: SHARED_FILES_PATH,
  method: "GET",
  handler: serveSharedFile,
});

export default http;
