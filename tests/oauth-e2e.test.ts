import net from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// The whole connector flow over real HTTP, driven by the MCP SDK's own OAuth client:
// 401 -> discovery -> dynamic registration -> /authorize -> sign in + approve -> token -> tools.
// The "browser" part (following /authorize, signing in, pressing Allow) is done with fetch.

const DB = process.env.MYSQL_DATABASE ?? "";
const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && DB && /dev|test/.test(DB));

type Tokens = import("@modelcontextprotocol/sdk/shared/auth.js").OAuthTokens;
type ClientInfo = import("@modelcontextprotocol/sdk/shared/auth.js").OAuthClientInformationMixed;

class TestClientProvider {
  info?: ClientInfo;
  saved?: Tokens;
  verifier = "";
  authUrl?: URL;
  constructor(public readonly metadata: Record<string, unknown>) {}
  get redirectUrl() { return (this.metadata.redirect_uris as string[])[0]; }
  get clientMetadata() { return this.metadata as never; }
  clientInformation() { return this.info; }
  saveClientInformation(info: ClientInfo) { this.info = info; }
  tokens() { return this.saved; }
  saveTokens(t: Tokens) { this.saved = t; }
  redirectToAuthorization(url: URL) { this.authUrl = url; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}

async function freePort(): Promise<number> {
  const s = net.createServer().listen(0);
  await new Promise((r) => s.once("listening", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

describe.skipIf(!HAS_DB)("OAuth connector end to end (requires MySQL)", () => {
  let base = "";
  let server: Server;
  let pool: import("mysql2/promise").Pool;
  let repo: typeof import("../src/repository.js");
  let auth: typeof import("../src/auth.js");
  let sdk: {
    Client: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
    Transport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;
    clientAuth: typeof import("@modelcontextprotocol/sdk/client/auth.js");
  };
  const pw = "correct horse battery";

  const claudeLike = () => new TestClientProvider({
    client_name: "E2E Claude",
    redirect_uris: ["http://127.0.0.1:9/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  // plays the user's browser: follow /authorize to the consent screen, sign in, press Allow
  async function approveInBrowser(authUrl: URL, email: string): Promise<string> {
    const step = await fetch(authUrl, { redirect: "manual" });
    expect(step.status).toBe(302);
    const consent = new URL(step.headers.get("location")!, base);
    expect(consent.pathname).toBe("/oauth/consent");
    const requestId = consent.searchParams.get("request")!;

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const { csrf } = (await login.json()) as { csrf: string };

    const ok = await fetch(`${base}/api/oauth/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: "{}",
    });
    expect(ok.status).toBe(200);
    const back = new URL(((await ok.json()) as { redirect: string }).redirect);
    expect(back.searchParams.get("state")).toBe(authUrl.searchParams.get("state"));
    return back.searchParams.get("code")!;
  }

  // what a connector does: try, get sent to sign in, finish auth, connect for real
  async function connect(provider: TestClientProvider, email: string) {
    const first = new sdk.Transport(new URL(`${base}/mcp`), { authProvider: provider as never });
    await expect(new sdk.Client({ name: "e2e", version: "0" }).connect(first)).rejects.toBeInstanceOf(sdk.clientAuth.UnauthorizedError);
    expect(provider.authUrl).toBeDefined();
    const code = await approveInBrowser(provider.authUrl!, email);
    await first.finishAuth(code);

    const client = new sdk.Client({ name: "e2e", version: "0" });
    await client.connect(new sdk.Transport(new URL(`${base}/mcp`), { authProvider: provider as never }));
    return client;
  }

  const rawMcp = (token: string) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  const text = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    process.env.PUBLIC_BASE_URL = base;
    delete process.env.ALLOWED_CIDRS;
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    auth = await import("../src/auth.js");
    const { createApp } = await import("../src/app.js");
    sdk = {
      Client: (await import("@modelcontextprotocol/sdk/client/index.js")).Client,
      Transport: (await import("@modelcontextprotocol/sdk/client/streamableHttp.js")).StreamableHTTPClientTransport,
      clientAuth: await import("@modelcontextprotocol/sdk/client/auth.js"),
    };
    pool = repo.pool;
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@e2e.test'`);
    for (const email of ["a@e2e.test", "b@e2e.test"]) {
      await pool.execute(`INSERT INTO users (email, password_hash, status) VALUES (?, ?, 'active')`, [email, await auth.hashPassword(pw)]);
    }
    server = createApp().app.listen(port);
    await new Promise((r) => server.once("listening", r));
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@e2e.test'`);
    // every client this file registers is named "E2E …", including ones a failed step never recorded
    await pool.execute(`DELETE FROM oauth_clients WHERE JSON_UNQUOTE(JSON_EXTRACT(client_info, '$.client_name')) LIKE 'E2E %'`);
    await repo.closePool();
  });

  it("a connector goes from 401 to working tools through discovery, registration and consent", async () => {
    const bare = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);

    const provider = claudeLike();
    const client = await connect(provider, "a@e2e.test");
    expect((provider.info as { token_endpoint_auth_method?: string }).token_endpoint_auth_method).toBe("none");
    expect((await client.listTools()).tools).toHaveLength(38);
    expect(text(await client.callTool({ name: "list_accounts", arguments: {} }))).toMatchObject({ accounts: [] });
    await client.close();
  });

  it("two people connected at once only ever see their own data", async () => {
    const a = await connect(claudeLike(), "a@e2e.test");
    const b = await connect(claudeLike(), "b@e2e.test");
    await a.callTool({ name: "add_account", arguments: { name: "E2E Only A", type: "bank" } });

    const namesA = text(await a.callTool({ name: "list_accounts", arguments: {} })).accounts.map((x: { name: string }) => x.name);
    const namesB = text(await b.callTool({ name: "list_accounts", arguments: {} })).accounts.map((x: { name: string }) => x.name);
    expect(namesA).toContain("E2E Only A");
    expect(namesB).not.toContain("E2E Only A");
    await a.close();
    await b.close();
  });

  it("refresh tokens rotate, and replaying an old one shuts the whole grant", async () => {
    const provider = claudeLike();
    const client = await connect(provider, "a@e2e.test");
    await client.close();
    const metadata = await sdk.clientAuth.discoverAuthorizationServerMetadata(new URL(base));
    const first = provider.saved!;

    const second = await sdk.clientAuth.refreshAuthorization(new URL(base), {
      metadata, clientInformation: provider.info!, refreshToken: first.refresh_token!, resource: new URL(`${base}/mcp`),
    });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await rawMcp(second.access_token)).status).toBe(200);

    await expect(sdk.clientAuth.refreshAuthorization(new URL(base), {
      metadata, clientInformation: provider.info!, refreshToken: first.refresh_token!, resource: new URL(`${base}/mcp`),
    })).rejects.toThrow(/already used|invalid_grant|Invalid/i);
    expect((await rawMcp(second.access_token)).status).toBe(401);
  });

  it("revoking, expiring, or retargeting a token ends its access, and the client recovers by refreshing", async () => {
    const provider = claudeLike();
    const client = await connect(provider, "b@e2e.test");
    const access = provider.saved!.access_token;
    expect((await rawMcp(access)).status).toBe(200);

    await pool.execute(`UPDATE oauth_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE token_hash = ?`, [auth.sha256(access)]);
    const expired = await rawMcp(access);
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain("invalid_token");
    // the SDK client refreshes on its own and carries on
    expect((await client.listTools()).tools.length).toBe(38);
    expect(provider.saved!.access_token).not.toBe(access);
    await client.close();

    const fresh = provider.saved!.access_token;
    await pool.execute(`UPDATE oauth_tokens SET resource = 'https://other.example/mcp' WHERE token_hash = ?`, [auth.sha256(fresh)]);
    expect((await rawMcp(fresh)).status).toBe(401);

    const other = claudeLike();
    await (await connect(other, "b@e2e.test")).close();
    const revoke = await fetch(`${base}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: other.saved!.refresh_token!, client_id: (other.info as { client_id: string }).client_id }),
    });
    expect(revoke.status).toBe(200);
    expect((await rawMcp(other.saved!.access_token)).status).toBe(401);
  });

  it("a Gemini-style registration (client_secret_basic, many redirect URIs, offline_access) still completes as a public client", async () => {
    const gemini = new TestClientProvider({
      client_name: "E2E Gemini",
      redirect_uris: Array.from({ length: 6 }, (_, i) => `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-e2e-${i}`),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      scope: "moneytor offline_access",
    });
    const client = await connect(gemini, "a@e2e.test");
    const info = gemini.info as { token_endpoint_auth_method?: string; client_secret?: string };
    expect(info.token_endpoint_auth_method).toBe("none");
    expect(info.client_secret).toBeUndefined();
    expect(gemini.saved!.refresh_token).toBeTruthy();
    expect((await client.listTools()).tools).toHaveLength(38);
    await client.close();
  });
});
