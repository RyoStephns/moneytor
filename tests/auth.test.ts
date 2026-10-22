import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Needs a real MySQL and skips without one. The setup tests rewrite the seeded owner
// row (id 1), so they only run on a dev/test database and put the row back afterwards.

const DB = process.env.MYSQL_DATABASE ?? "";
const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && DB && /dev|test/.test(DB));

describe.skipIf(!HAS_DB)("auth accounts (requires MySQL)", () => {
  let auth: typeof import("../src/auth.js");
  let repo: typeof import("../src/repository.js");
  let pool: import("mysql2/promise").Pool;
  let owner = 0;
  let original: { email: string; password_hash: string | null };

  const pw = "correct horse battery";

  async function makeUser(email: string, opts: { owner?: boolean; password?: string | null; status?: string } = {}) {
    const hash = opts.password === null ? null : await auth.hashPassword(opts.password ?? pw);
    await pool.execute(`INSERT INTO users (email, password_hash, is_owner, status) VALUES (?, ?, ?, ?)`, [
      email, hash, opts.owner ? 1 : 0, opts.status ?? "active",
    ]);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = ?`, [email]);
    return Number(rows[0].id);
  }

  beforeAll(async () => {
    process.env.SETUP_TOKEN = "test-setup-token";
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    auth = await import("../src/auth.js");
    pool = repo.pool;
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT email, password_hash FROM users WHERE id = 1`);
    original = { email: rows[0].email, password_hash: rows[0].password_hash };
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@auth.test'`);
    owner = await makeUser("owner@auth.test", { owner: true });
  });

  afterEach(async () => {
    await pool.execute(`UPDATE users SET email = ?, password_hash = ? WHERE id = 1`, [original.email, original.password_hash]);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@auth.test'`);
    await repo.closePool();
  });

  it("hashes with a random salt and verifies only the right password", async () => {
    const a = await auth.hashPassword(pw);
    const b = await auth.hashPassword(pw);
    expect(a).not.toBe(b);
    expect(a).not.toContain(pw);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await auth.verifyPassword(pw, a)).toBe(true);
    expect(await auth.verifyPassword("wrong password", a)).toBe(false);
    expect(await auth.verifyPassword(pw, "plaintext")).toBe(false);
  });

  it("login says the same thing for a wrong password, unknown email, no password, and disabled user", async () => {
    await makeUser("nopass@auth.test", { password: null });
    await makeUser("off@auth.test", { status: "disabled" });

    const ok = await auth.loginWithPassword("  OWNER@auth.test ", pw);
    expect(ok).toEqual({ id: owner, email: "owner@auth.test", is_owner: true });

    const msgs = await Promise.all(
      [["owner@auth.test", "nope nope nope"], ["ghost@auth.test", pw], ["nopass@auth.test", pw], ["off@auth.test", pw]].map(
        async ([e, p]) => (await auth.loginWithPassword(e, p).catch((err) => err.message)) as string
      )
    );
    expect(new Set(msgs)).toEqual(new Set(["Invalid email or password."]));
  });

  it("only the owner can manage invites and see users", async () => {
    const plain = await makeUser("plain@auth.test");
    await expect(auth.createInvite(plain)).rejects.toThrow(/Owner access required/);
    await expect(auth.listInvites(plain)).rejects.toThrow(/Owner access required/);
    await expect(auth.revokeInvite(plain, 1)).rejects.toThrow(/Owner access required/);
    await expect(auth.listUsers(plain)).rejects.toThrow(/Owner access required/);
    expect((await auth.listUsers(owner)).some((u) => u.email === "owner@auth.test" && u.is_owner)).toBe(true);
  });

  it("an invite signs up exactly one account and the table never holds the plain code", async () => {
    const inv = await auth.createInvite(owner);
    const [raw] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT code_hash FROM invite_codes WHERE id = ?`, [inv.id]);
    expect(raw[0].code_hash).toBe(auth.sha256(inv.code));
    expect(raw[0].code_hash).not.toContain(inv.code);

    const user = await auth.signUpWithInvite({ email: "New@auth.test", password: pw, code: inv.code });
    expect(user).toMatchObject({ email: "new@auth.test", is_owner: false });
    expect((await auth.loginWithPassword("new@auth.test", pw)).id).toBe(user.id);

    await expect(auth.signUpWithInvite({ email: "again@auth.test", password: pw, code: inv.code })).rejects.toThrow(/Invalid or expired/);
    const row = (await auth.listInvites(owner)).find((i) => i.id === inv.id);
    expect(row).toMatchObject({ status: "used", used_by: "new@auth.test" });
  });

  it("expired, revoked and unknown codes are refused", async () => {
    const expired = await auth.createInvite(owner);
    await pool.execute(`UPDATE invite_codes SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id = ?`, [expired.id]);
    const revoked = await auth.createInvite(owner);
    expect(await auth.revokeInvite(owner, revoked.id)).toBe(true);
    expect(await auth.revokeInvite(owner, revoked.id)).toBe(false);

    for (const code of [expired.code, revoked.code, "inv_nothing"]) {
      await expect(auth.signUpWithInvite({ email: "x@auth.test", password: pw, code })).rejects.toThrow(/Invalid or expired/);
    }
    const statuses = Object.fromEntries((await auth.listInvites(owner)).map((i) => [i.id, i.status]));
    expect(statuses[expired.id]).toBe("expired");
    expect(statuses[revoked.id]).toBe("revoked");
  });

  it("a failed sign-up leaves the invite usable", async () => {
    const inv = await auth.createInvite(owner);
    await expect(auth.signUpWithInvite({ email: "owner@auth.test", password: pw, code: inv.code })).rejects.toThrow(/already exists/);
    await expect(auth.signUpWithInvite({ email: "short@auth.test", password: "short", code: inv.code })).rejects.toThrow(/at least 8/);
    expect((await auth.listInvites(owner)).find((i) => i.id === inv.id)?.status).toBe("pending");
    await expect(auth.signUpWithInvite({ email: "fine@auth.test", password: pw, code: inv.code })).resolves.toMatchObject({ email: "fine@auth.test" });
  });

  it("setup fills the seeded owner row once, and only with the right token", async () => {
    await pool.execute(`UPDATE users SET password_hash = NULL WHERE id = 1`);

    await expect(auth.setupOwner({ token: "wrong", email: "me@auth.test", password: pw })).rejects.toThrow(/Invalid setup token/);
    await expect(auth.setupOwner({ token: "test-setup-token", email: "me@auth.test", password: "short" })).rejects.toThrow(/at least 8/);
    const [still] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT password_hash FROM users WHERE id = 1`);
    expect(still[0].password_hash).toBeNull();

    const me = await auth.setupOwner({ token: "test-setup-token", email: "Me@auth.test", password: pw });
    expect(me).toEqual({ id: 1, email: "me@auth.test", is_owner: true });
    expect((await auth.loginWithPassword("me@auth.test", pw)).id).toBe(1);

    await expect(auth.setupOwner({ token: "test-setup-token", email: "other@auth.test", password: pw })).rejects.toThrow(/already complete/);
    const [users] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users WHERE email = 'other@auth.test'`);
    expect(Number(users[0].n)).toBe(0);
  });

  it("setup is switched off when SETUP_TOKEN is not configured", async () => {
    await pool.execute(`UPDATE users SET password_hash = NULL WHERE id = 1`);
    vi.resetModules();
    delete process.env.SETUP_TOKEN;
    const bare = await import("../src/auth.js");
    const bareRepo = await import("../src/repository.js");
    try {
      await expect(bare.setupOwner({ token: "", email: "me@auth.test", password: pw })).rejects.toThrow(/Setup is disabled/);
    } finally {
      await bareRepo.closePool();
      process.env.SETUP_TOKEN = "test-setup-token";
    }
  });
});
