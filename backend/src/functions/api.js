import { expressApp } from "@azure/functions-extensions-express";
import { app as todoApp } from "../../server.js";

// Static Web Apps requires managed Functions apps to keep the default
// host.json http.routePrefix ("api") — it rejects a build that overrides
// it. So this route is registered WITHOUT an "api/" prefix; the Functions
// host prepends it, giving the function's real path as /api/{path}, which
// matches what the Static Web App forwards under /api/* and what
// frontend/app.js's default apiBaseUrl calls.
expressApp("api", todoApp, {
  route: "{*path}",
  basePath: "/api",
});
