import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Starts the real app on a random port and talks to it over HTTP, cookies and all.
// Rewrites the seeded owner row during the setup test, so it only runs on a dev/test DB.

const DB = process.env.MYSQL_DATABASE ?? "";
const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && DB && /dev|test/.test(DB));

type Res = { status: number; body: any; cookie: string | null; setCookie: string };

describe.skipIf(!HAS_DB)("web API over HTTP (requires MySQL)", () => {
  let auth: typeof import("../src/auth.js");
  let repo: typeof import("../src/repository.js");
  let appMod: typeof import("../src/app.js");
  let pool: import("mysql2/promise").Pool;
  let server: Server;
  let base = "";
  let provider: InstanceType<typeof import("../src/oauthProvider.js").MysqlOAuthProvider>;
  let original: { email: string; password_hash: string | null };

  const pw = "correct horse battery";

  async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string | null; csrf?: string; type?: string; accept?: string } = {}): Promise<Res> {
    const headers: Record<string, string> = { "content-type": opts.type ?? "application/json" };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
    if (opts.accept) headers.accept = opts.accept;
    const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
    const res = await fetch(base + path, {
      method,
      headers,
      body: method === "GET" ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {}),
    });
    const setCookie = res.headers.getSetCookie().join("; ");
    const m = setCookie.match(/moneytor_session=([^;]*)/);
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, body, cookie: m && m[1] ? `moneytor_session=${m[1]}` : null, setCookie };
  }

  async function makeUser(email: string, owner = false) {
    await pool.execute(`INSERT INTO users (email, password_hash, is_owner, status) VALUES (?, ?, ?, 'active')`, [email, await auth.hashPassword(pw), owner ? 1 : 0]);
  }

  async function signIn(email: string) {
    const r = await call("/api/auth/login", { body: { email, password: pw } });
    expect(r.status).toBe(200);
    return { cookie: r.cookie!, csrf: r.body.csrf as string };
  }

  async function boot() {
    const { app, provider: p } = appMod.createApp();
    provider = p;
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    process.env.SETUP_TOKEN = "web-setup-token";
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    auth = await import("../src/auth.js");
    appMod = await import("../src/app.js");
    pool = repo.pool;
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT email, password_hash FROM users WHERE id = 1`);
    original = { email: rows[0].email, password_hash: rows[0].password_hash };
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@web.test'`);
    await pool.execute(`DELETE FROM oauth_clients WHERE client_id LIKE 'zz-web-%'`);
    await makeUser("owner@web.test", true);
    await makeUser("plain@web.test");
    await boot();
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await pool.execute(`UPDATE users SET email = ?, password_hash = ? WHERE id = 1`, [original.email, original.password_hash]);
    // the setup test signs in as the owner row; those sessions must not outlive the restore
    await pool.execute(`DELETE FROM sessions WHERE user_id = 1`);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@web.test'`);
    await pool.execute(`DELETE FROM oauth_clients WHERE client_id LIKE 'zz-web-%'`);
    await repo.closePool();
  });

  it("signs in with a hardened cookie, keeps the session, and signs out for real", async () => {
    expect((await call("/api/auth/session")).body).toMatchObject({ user: null, csrf: null });

    const login = await call("/api/auth/login", { body: { email: "OWNER@web.test", password: pw } });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: "owner@web.test", is_owner: true });
    expect(login.setCookie).toMatch(/HttpOnly/);
    expect(login.setCookie).toMatch(/Secure/);
    expect(login.setCookie).toMatch(/SameSite=Lax/);

    const me = await call("/api/auth/session", { cookie: login.cookie });
    expect(me.body).toMatchObject({ user: { email: "owner@web.test" }, csrf: login.body.csrf });

    expect((await call("/api/auth/logout", { body: {}, cookie: login.cookie })).status).toBe(403);
    expect((await call("/api/auth/logout", { body: {}, cookie: login.cookie, csrf: "x".repeat(43) })).status).toBe(403);
    const out = await call("/api/auth/logout", { body: {}, cookie: login.cookie, csrf: login.body.csrf });
    expect(out.status).toBe(204);
    expect(out.setCookie).toMatch(/moneytor_session=;/);
    expect((await call("/api/auth/session", { cookie: login.cookie })).body.user).toBeNull();
  });

  it("rejects wrong passwords with one message and refuses non-JSON posts", async () => {
    const a = await call("/api/auth/login", { body: { email: "owner@web.test", password: "nope nope" } });
    const b = await call("/api/auth/login", { body: { email: "ghost@web.test", password: pw } });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error).toBe(b.body.error);
    expect(a.cookie).toBeNull();

    const form = await call("/api/auth/login", { body: `email=owner%40web.test&password=${encodeURIComponent(pw)}`, type: "application/x-www-form-urlencoded" });
    expect(form.status).toBe(415);
    expect((await call("/api/auth/login", { body: { email: "not-an-email", password: pw } })).body.error).toBe("Enter a valid email address.");
    expect((await call("/api/auth/login", { body: "{oops", type: "application/json" })).status).toBe(400);
  });

  it("locks an account after five misses, even for the right password", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call("/api/auth/login", { body: { email: "plain@web.test", password: `wrong ${i}` } })).status).toBe(401);
    }
    const locked = await call("/api/auth/login", { body: { email: "plain@web.test", password: pw } });
    expect(locked.status).toBe(429);
    expect((await call("/api/auth/login", { body: { email: "owner@web.test", password: pw } })).status).toBe(200);
  });

  it("admin is owner-only, and invites need the CSRF token", async () => {
    const plain = await signIn("plain@web.test");
    expect((await call("/api/admin/users", { cookie: plain.cookie })).status).toBe(403);
    expect((await call("/api/admin/invites", { body: {}, cookie: plain.cookie, csrf: plain.csrf })).status).toBe(403);
    expect((await call("/api/admin/users")).status).toBe(401);

    const owner = await signIn("owner@web.test");
    expect((await call("/api/admin/invites", { body: {}, cookie: owner.cookie })).status).toBe(403);
    const made = await call("/api/admin/invites", { body: { days: 3 }, cookie: owner.cookie, csrf: owner.csrf });
    expect(made.status).toBe(201);
    expect(made.body.code).toMatch(/^inv_/);

    const listed = await call("/api/admin/invites", { cookie: owner.cookie });
    expect(listed.body.find((i: any) => i.id === made.body.id)).toMatchObject({ status: "pending" });
    expect(JSON.stringify(listed.body)).not.toContain(made.body.code);

    const signup = await call("/api/auth/signup", { body: { email: "fresh@web.test", password: pw, code: made.body.code } });
    expect(signup.status).toBe(201);
    expect(signup.cookie).not.toBeNull();
    expect((await call("/api/auth/session", { cookie: signup.cookie })).body.user).toMatchObject({ email: "fresh@web.test", is_owner: false });

    const spare = await call("/api/admin/invites", { body: {}, cookie: owner.cookie, csrf: owner.csrf });
    expect((await call(`/api/admin/invites/${spare.body.id}/revoke`, { body: {}, cookie: owner.cookie, csrf: owner.csrf })).status).toBe(204);
    expect((await call(`/api/admin/invites/${spare.body.id}/revoke`, { body: {}, cookie: owner.cookie, csrf: owner.csrf })).status).toBe(404);
    expect((await call("/api/auth/signup", { body: { email: "late@web.test", password: pw, code: spare.body.code } })).status).toBe(400);

    const users = await call("/api/admin/users", { cookie: owner.cookie });
    expect(users.body.map((u: any) => u.email)).toEqual(expect.arrayContaining(["owner@web.test", "fresh@web.test"]));
  });

  it("consent API: needs a session, describes the request, and approve needs CSRF", async () => {
    const client = (await provider.clientsStore.registerClient!({
      client_id: "zz-web-claude", client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none",
    } as never)) as import("@modelcontextprotocol/sdk/shared/auth.js").OAuthClientInformationFull;
    let location = "";
    await provider.authorize(client, { redirectUri: client.redirect_uris[0], codeChallenge: "c", state: "st", scopes: [] }, { redirect: (_s: number, u: string) => { location = u; } } as never);
    expect(location).toMatch(/^\/oauth\/consent\?request=/);
    const id = new URL(location, base).searchParams.get("request");

    expect((await call(`/api/oauth/requests/${id}`)).status).toBe(401);
    const s = await signIn("plain@web.test");
    expect((await call(`/api/oauth/requests/${id}`, { cookie: s.cookie })).body).toMatchObject({ client_name: "Claude", redirect_host: "claude.ai", redirect_kind: "claude" });
    expect((await call(`/api/oauth/requests/${id}/approve`, { body: {}, cookie: s.cookie })).status).toBe(403);

    const ok = await call(`/api/oauth/requests/${id}/approve`, { body: {}, cookie: s.cookie, csrf: s.csrf });
    const back = new URL(ok.body.redirect);
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(back.searchParams.get("state")).toBe("st");
    expect((await call(`/api/oauth/requests/${id}`, { cookie: s.cookie })).status).toBe(410);
  });

  it("setup through the API claims the owner row once", async () => {
    await pool.execute(`UPDATE users SET password_hash = NULL WHERE id = 1`);
    expect((await call("/api/auth/session")).body.setup).toBe("needed");
    expect((await call("/api/auth/setup", { body: { token: "wrong", email: "me@web.test", password: pw } })).status).toBe(400);
    const done = await call("/api/auth/setup", { body: { token: "web-setup-token", email: "me@web.test", password: pw } });
    expect(done.status).toBe(201);
    expect(done.body.user).toEqual({ id: 1, email: "me@web.test", is_owner: true });
    expect((await call("/api/auth/session")).body.setup).toBe("done");
    expect((await call("/api/auth/setup", { body: { token: "web-setup-token", email: "me2@web.test", password: pw } })).body.error).toMatch(/already complete/);
  });

  it("without SETUP_TOKEN the setup route does not exist", async () => {
    await new Promise((r) => server.close(r));
    vi.resetModules();
    delete process.env.SETUP_TOKEN;
    const bareApp = await import("../src/app.js");
    const bareRepo = await import("../src/repository.js");
    try {
      const { app } = bareApp.createApp();
      server = app.listen(0);
      await new Promise((r) => server.once("listening", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await pool.execute(`UPDATE users SET password_hash = NULL WHERE id = 1`);
      expect((await call("/api/auth/setup", { body: { token: "x", email: "me@web.test", password: pw } })).status).toBe(404);
      expect((await call("/api/auth/session")).body.setup).toBe("unavailable");
    } finally {
      await bareRepo.closePool();
      process.env.SETUP_TOKEN = "web-setup-token";
    }
  });

  it("serves the built page for client routes and JSON 404s for unknown API paths", async () => {
    const page = await call("/oauth/consent?request=abc", { accept: "text/html" });
    expect(page.status).toBe(200);
    expect(String(page.body)).toContain('<div id="root"></div>');
    expect((await call("/api/nothing-here")).body).toEqual({ error: "Not found" });
    expect((await call("/health")).body).toMatchObject({ ok: true });
  });
});
