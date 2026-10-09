import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { callback as connectorCallback } from "./connectors";
import { CALLBACK_PATH } from "./lib/connectorAuth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: CALLBACK_PATH,
  method: "GET",
  handler: connectorCallback,
});

export default http;
