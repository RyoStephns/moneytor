import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { createMoneytorServer } from "./mcp.js";
import { closePool } from "./repository.js";
import { createIpAllowlistMiddleware } from "./network.js";

const app = express();
const mcpPath = `/mcp/${config.mcpSecretSlug}`;

app.set("trust proxy", config.trustProxy);
app.use(express.json({ limit: "1mb" }));

if (config.allowedCidrs.length > 0) {
  app.use(mcpPath, createIpAllowlistMiddleware(config.allowedCidrs));
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "moneytor-mcp" });
});

// Phase 1: the secret-slug path maps to the owner (users.id = 1). Real
// per-user binding from an OAuth bearer token arrives in Phase 4, which will
// resolve userId from req.auth instead of this constant.
const OWNER_USER_ID = 1;

app.all(mcpPath, async (request, response) => {
  const server = createMoneytorServer(OWNER_USER_ID);
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

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const httpServer = app.listen(config.port, () => {
  console.log(`moneytor MCP listening on :${config.port}`);
  console.log(`MCP endpoint: ${mcpPath}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down`);
  httpServer.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
