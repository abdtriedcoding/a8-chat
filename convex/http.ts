import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { signInCallback } from "./connections";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Where an app's authorization server sends the user after they sign in.
http.route({
  path: "/connections/callback",
  method: "GET",
  handler: signInCallback,
});

export default http;
