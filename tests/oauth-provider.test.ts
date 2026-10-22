import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Drives the provider the way the SDK handlers do (clients store, authorize, challenge,
// exchange, verify) against a real MySQL. The PKCE math itself belongs to the SDK token
// handler, so the full HTTP round trip is covered in the end-to-end test.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("oauth provider (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let mod: typeof import("../src/oauthProvider.js");
  let sha256: (s: string) => string;
  let provider: InstanceType<typeof import("../src/oauthProvider.js").MysqlOAuthProvider>;
  let pool: import("mysql2/promise").Pool;
  let userId = 0;

  const RESOURCE = new URL("https://moneytor.test/mcp");
  const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

  type Client = import("@modelcontextprotocol/sdk/shared/auth.js").OAuthClientInformationFull;

  async function makeClient(redirect = CLAUDE_CB, name = "Claude"): Promise<Client> {
    const info = {
      client_id: `zz-${crypto.randomUUID()}`,
      client_name: name,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    } as Client;
    return (await provider.clientsStore.registerClient!(info)) as Client;
  }

  async function authorize(client: Client, over: { redirectUri?: string; state?: string; scopes?: string[]; resource?: URL } = {}) {
    let location = "";
    const res = { redirect: (_s: number, url: string) => { location = url; } } as never;
    await provider.authorize(client, {
      redirectUri: over.redirectUri ?? client.redirect_uris[0],
      codeChallenge: "challenge-abc",
      state: over.state,
      scopes: over.scopes ?? [],
      resource: over.resource,
    }, res);
    return new URL(location, "https://x.test").searchParams.get("request")!;
  }

  async function getCode(client: Client, over: Parameters<typeof authorize>[1] = {}) {
    const url = new URL(await provider.approveAuthRequest(await authorize(client, over), userId));
    return { code: url.searchParams.get("code")!, redirectUri: client.redirect_uris[0], url };
  }

  async function login(client: Client, over: Parameters<typeof authorize>[1] = {}) {
    const { code, redirectUri } = await getCode(client, over);
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, redirectUri);
    return { tokens, code };
  }

  beforeAll(async () => {
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    mod = await import("../src/oauthProvider.js");
    sha256 = (await import("../src/auth.js")).sha256;
    provider = new mod.MysqlOAuthProvider(RESOURCE);
    pool = repo.pool;
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@oauth.test'`);
    await pool.execute(`DELETE FROM oauth_clients WHERE client_id LIKE 'zz-%'`);
    await pool.execute(`INSERT INTO users (email, status) VALUES ('a@oauth.test', 'active')`);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = 'a@oauth.test'`);
    userId = Number(rows[0].id);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@oauth.test'`);
    await pool.execute(`DELETE FROM oauth_clients WHERE client_id LIKE 'zz-%'`);
    await repo.closePool();
  });

  it("stores a registered client and reads it back whole", async () => {
    const client = await makeClient();
    const got = await provider.clientsStore.getClient(client.client_id);
    expect(got).toMatchObject({ client_id: client.client_id, client_name: "Claude", redirect_uris: [CLAUDE_CB] });
    expect(await provider.clientsStore.getClient("zz-unknown")).toBeUndefined();
  });

  it("registers every client as public, even one asking for client_secret_basic like Gemini", async () => {
    const asked = {
      client_id: `zz-${crypto.randomUUID()}`,
      client_name: "Gemini",
      redirect_uris: Array.from({ length: 6 }, (_, i) => `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-${i}`),
      token_endpoint_auth_method: "client_secret_basic",
      client_secret: "would-be-secret",
      client_secret_expires_at: 1,
      scope: "moneytor offline_access",
    } as Client;
    const got = (await provider.clientsStore.registerClient!(asked)) as Client;
    expect(got.token_endpoint_auth_method).toBe("none");
    expect(got.client_secret).toBeUndefined();
    expect(got.client_secret_expires_at).toBeUndefined();
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT client_info FROM oauth_clients WHERE client_id = ?`, [asked.client_id]);
    expect(JSON.stringify(rows[0].client_info)).not.toContain("would-be-secret");
    expect(got.redirect_uris).toHaveLength(6);
  });

  it("authorize parks the request and the consent screen can describe it", async () => {
    const claude = await makeClient();
    const local = await makeClient("http://127.0.0.1:53123/callback", "Claude Code");
    const rogue = await makeClient("https://evil.example/cb", "Totally Claude");

    const id = await authorize(claude, { scopes: ["claudeai"] });
    expect(await provider.getAuthRequest(id)).toEqual({
      client_name: "Claude", redirect_host: "claude.ai", redirect_kind: "claude", scopes: ["claudeai"],
    });
    expect((await provider.getAuthRequest(await authorize(local)))?.redirect_kind).toBe("local");
    const gemini = await makeClient("https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-123-moneytor_test", "Gemini");
    expect((await provider.getAuthRequest(await authorize(gemini)))?.redirect_kind).toBe("gemini");
    const otherGoogle = await makeClient("https://oauth-redirect.googleusercontent.com/r/some-other-project", "Gemini");
    expect((await provider.getAuthRequest(await authorize(otherGoogle)))?.redirect_kind).toBe("other");
    expect(await provider.getAuthRequest(await authorize(rogue))).toMatchObject({ redirect_host: "evil.example", redirect_kind: "other" });

    await pool.execute(`UPDATE oauth_auth_requests SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?`, [id]);
    expect(await provider.getAuthRequest(id)).toBeNull();
    expect(await provider.getAuthRequest("no-such-request")).toBeNull();
  });

  it("approve and deny each resolve a request once, and carry state back", async () => {
    const client = await makeClient();
    const ok = new URL(await provider.approveAuthRequest(await authorize(client, { state: "xyz" }), userId));
    expect(ok.origin + ok.pathname).toBe(CLAUDE_CB);
    expect(ok.searchParams.get("state")).toBe("xyz");
    expect(ok.searchParams.get("code")).toMatch(/.{20,}/);

    const id = await authorize(client, { state: "s2" });
    const denied = new URL(await provider.denyAuthRequest(id));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("state")).toBe("s2");
    expect(denied.searchParams.get("code")).toBeNull();
    await expect(provider.approveAuthRequest(id, userId)).rejects.toThrow(/expired/);
    await expect(provider.denyAuthRequest(id)).rejects.toThrow(/expired/);
  });

  it("refuses an authorize request aimed at another resource, and binds tokens to ours when none is given", async () => {
    const client = await makeClient();
    await expect(authorize(client, { resource: new URL("https://other.example/mcp") })).rejects.toMatchObject({ errorCode: "invalid_target" });
    const { tokens } = await login(client);
    expect((await provider.verifyAccessToken(tokens.access_token)).resource?.href).toBe(RESOURCE.href);
  });

  it("exchanges a code for tokens, keeps only hashes, and resolves the token to its user", async () => {
    const client = await makeClient();
    const { code, redirectUri } = await getCode(client, { scopes: ["claudeai"] });
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe("challenge-abc");

    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, redirectUri, RESOURCE);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "claudeai" });
    expect(tokens.access_token.startsWith("at_")).toBe(true);
    expect(tokens.refresh_token?.startsWith("rt_")).toBe(true);

    const [stored] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT token_hash FROM oauth_tokens WHERE user_id = ?`, [userId]);
    const hashes = stored.map((r) => r.token_hash);
    expect(hashes).toHaveLength(2);
    expect(hashes).toContain(sha256(tokens.access_token));
    expect(JSON.stringify(hashes)).not.toContain(tokens.access_token);

    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info).toMatchObject({ clientId: client.client_id, scopes: ["claudeai"], extra: { userId } });
    expect(info.expiresAt! - Math.floor(Date.now() / 1000)).toBeGreaterThan(3590);
  });

  it("a code works once; replaying it revokes what it produced", async () => {
    const client = await makeClient();
    const { code, redirectUri } = await getCode(client);
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, redirectUri);
    await provider.verifyAccessToken(tokens.access_token);

    await expect(provider.exchangeAuthorizationCode(client, code, undefined, redirectUri)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toMatchObject({ errorCode: "invalid_grant" });
  });

  it("rejects wrong redirect_uri, expired codes, and another client's code", async () => {
    const client = await makeClient();
    const other = await makeClient();

    const a = await getCode(client);
    await expect(provider.exchangeAuthorizationCode(client, a.code, undefined, "https://evil.example/cb")).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.exchangeAuthorizationCode(client, a.code, undefined, undefined)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.exchangeAuthorizationCode(other, a.code, undefined, a.redirectUri)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.challengeForAuthorizationCode(other, a.code)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.exchangeAuthorizationCode(client, a.code, undefined, a.redirectUri)).resolves.toBeDefined();

    const b = await getCode(client);
    await pool.execute(`UPDATE oauth_auth_codes SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE user_id = ? AND used_at IS NULL`, [userId]);
    await expect(provider.challengeForAuthorizationCode(client, b.code)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.exchangeAuthorizationCode(client, b.code, undefined, b.redirectUri)).rejects.toMatchObject({ errorCode: "invalid_grant" });

    const c = await getCode(client);
    await expect(provider.exchangeAuthorizationCode(client, c.code, undefined, c.redirectUri, new URL("https://other.example/mcp"))).rejects.toMatchObject({ errorCode: "invalid_target" });
  });

  it("rotates refresh tokens, and reusing an old one kills the whole family", async () => {
    const client = await makeClient();
    const first = (await login(client)).tokens;

    const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.access_token).not.toBe(first.access_token);
    await provider.verifyAccessToken(second.access_token);

    await expect(provider.exchangeRefreshToken(client, first.refresh_token!)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.verifyAccessToken(second.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });
    await expect(provider.exchangeRefreshToken(client, second.refresh_token!)).rejects.toMatchObject({ errorCode: "invalid_grant" });
  });

  it("refresh cannot widen scope, can narrow it, and belongs to its client", async () => {
    const client = await makeClient();
    const other = await makeClient();
    const { tokens } = await login(client, { scopes: ["a", "b"] });

    await expect(provider.exchangeRefreshToken(other, tokens.refresh_token!)).rejects.toMatchObject({ errorCode: "invalid_grant" });
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!, ["a", "admin"])).rejects.toMatchObject({ errorCode: "invalid_scope" });
    const narrowed = await provider.exchangeRefreshToken(client, tokens.refresh_token!, ["a"]);
    expect(narrowed.scope).toBe("a");
  });

  it("stops honoring access tokens that expired, were revoked, belong to a disabled user, or target another resource", async () => {
    const client = await makeClient();

    const expired = (await login(client)).tokens;
    await pool.execute(`UPDATE oauth_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE type = 'access' AND user_id = ?`, [userId]);
    await expect(provider.verifyAccessToken(expired.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });

    const revoked = (await login(client)).tokens;
    await provider.verifyAccessToken(revoked.access_token);
    await provider.revokeToken(client, { token: revoked.refresh_token! });
    await expect(provider.verifyAccessToken(revoked.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });

    const disabled = (await login(client)).tokens;
    await pool.execute(`UPDATE users SET status = 'disabled' WHERE id = ?`, [userId]);
    await expect(provider.verifyAccessToken(disabled.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });
    await pool.execute(`UPDATE users SET status = 'active' WHERE id = ?`, [userId]);
    await provider.verifyAccessToken(disabled.access_token);

    await pool.execute(`UPDATE oauth_tokens SET resource = 'https://other.example/mcp' WHERE token_hash = ?`, [sha256(disabled.access_token)]);
    await expect(provider.verifyAccessToken(disabled.access_token)).rejects.toMatchObject({ errorCode: "invalid_token" });
    await expect(provider.verifyAccessToken("at_never-issued")).rejects.toMatchObject({ errorCode: "invalid_token" });
  });

  it("a client cannot revoke another client's token", async () => {
    const client = await makeClient();
    const other = await makeClient();
    const { tokens } = await login(client);
    await provider.revokeToken(other, { token: tokens.refresh_token! });
    await provider.verifyAccessToken(tokens.access_token);
  });

  it("purge removes what is long dead and keeps what is live", async () => {
    const live = await makeClient();
    const idle = await makeClient();
    const { tokens } = await login(live);
    await authorize(idle);
    await pool.execute(`UPDATE oauth_clients SET created_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE client_id IN (?, ?)`, [live.client_id, idle.client_id]);
    await pool.execute(`UPDATE oauth_auth_requests SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE client_id LIKE 'zz-%'`);
    await pool.execute(
      `INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at, last_used_at) VALUES (?, ?, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE), UTC_TIMESTAMP(3))`,
      [crypto.randomBytes(32).toString("hex"), userId, "x".repeat(43)]
    );

    await mod.purgeExpiredAuth();

    expect(await provider.clientsStore.getClient(idle.client_id)).toBeUndefined();
    expect(await provider.clientsStore.getClient(live.client_id)).toBeDefined();
    await provider.verifyAccessToken(tokens.access_token);
    const [left] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM oauth_auth_requests WHERE client_id LIKE 'zz-%') AS requests, (SELECT COUNT(*) FROM sessions WHERE user_id = ?) AS sessions`,
      [userId]
    );
    expect(left[0]).toMatchObject({ requests: 0, sessions: 0 });
  });
});
