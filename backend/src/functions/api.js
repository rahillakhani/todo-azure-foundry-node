import { expressApp } from "@azure/functions-extensions-express";
import { app as todoApp } from "../../server.js";

// host.json sets extensions.http.routePrefix to "", so this route is the
// function's actual public path (matching what the Static Web App forwards
// under /api/*, and what frontend/app.js's default apiBaseUrl calls).
expressApp("api", todoApp, {
  route: "api/{*path}",
  basePath: "/api",
});
