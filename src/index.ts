import { createApp } from "./app.js";
import { config } from "./config.js";
import { purgeExpiredAuth } from "./oauthProvider.js";
import { closePool } from "./repository.js";

const { app, mcpUrl } = createApp();

const httpServer = app.listen(config.port, () => {
  console.log(`moneytor listening on :${config.port}`);
  console.log(`MCP endpoint: ${mcpUrl.href}`);
});

const purge = () => purgeExpiredAuth().catch((e) => console.error("auth purge failed", e));
void purge();
setInterval(purge, 60 * 60 * 1000).unref();

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down`);
  httpServer.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
