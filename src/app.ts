import fs from "node:fs";
import path from "node:path";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { config } from "./config.js";
import { createMoneytorServer } from "./mcp.js";
import { createIpAllowlistMiddleware } from "./network.js";
import { MysqlOAuthProvider } from "./oauthProvider.js";
import { createWebApi } from "./web.js";

// Same cwd convention as scripts/migrate.ts: the server runs from the repo root.
const WEB_DIR = path.resolve("dist/web");

export function createApp() {
  const app = express();
  const mcpUrl = new URL("/mcp", config.publicBaseUrl);
  const provider = new MysqlOAuthProvider(mcpUrl);

  app.set("trust proxy", config.trustProxy);

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "moneytor-mcp" });
  });

  // /authorize, /token, /register, /revoke and both .well-known documents
  app.use(mcpAuthRouter({ provider, issuerUrl: config.publicBaseUrl, resourceServerUrl: mcpUrl, resourceName: "Moneytor" }));

  app.use("/api", createWebApi(provider));

  if (config.allowedCidrs.length > 0) {
    app.use("/mcp", createIpAllowlistMiddleware(config.allowedCidrs));
  }

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    expectedResource: mcpUrl,
  });

  // the user comes from the token, never from anything the client sends
  app.all("/mcp", bearer, express.json({ limit: "1mb" }), async (request, response) => {
    const server = createMoneytorServer(Number(request.auth!.extra!.userId));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({ error: "MCP request failed" });
      }
    }
  });

  if (fs.existsSync(path.join(WEB_DIR, "index.html"))) {
    app.use(express.static(WEB_DIR, { index: false }));
    // client-side routes (/login, /oauth/consent, ...) all boot the same page
    app.get("/{*page}", (request, response, next) => {
      if (!request.accepts("html")) return next();
      response.sendFile(path.join(WEB_DIR, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  return { app, mcpUrl, provider };
}
