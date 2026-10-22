import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// get_dashboard_link and the new-user setup guidance, driven through a real MCP client.
// Needs MySQL, skips without it.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("dashboard link and setup guidance over MCP (requires MySQL)", () => {
  let pool: import("mysql2/promise").Pool;
  let repo: typeof import("../src/repository.js");
  let client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  let base = "";
  let userId = 0;
  let otherId = 0;

  async function call(args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name: "get_dashboard_link", arguments: args });
    const text = (res.content as { text: string }[])[0].text;
    return { isError: Boolean(res.isError), text, url: res.isError ? null : new URL(JSON.parse(text).url) };
  }

  beforeAll(async () => {
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    base = (await import("../src/config.js")).config.publicBaseUrl.origin;
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    const idFor = async (email: string) => {
      await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES (?, 'active')`, [email]);
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = ?`, [email]);
      return Number(rows[0].id);
    };
    userId = await idFor("dashboard-link@moneytor.test");
    otherId = await idFor("dashboard-link-other@moneytor.test");

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMoneytorServer } = await import("../src/mcp.js");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMoneytorServer(userId).connect(serverSide);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM pay_periods WHERE user_id IN (?, ?)`, [userId, otherId]);
    await pool.execute(`DELETE FROM accounts WHERE user_id IN (?, ?)`, [userId, otherId]);
  });

  afterAll(async () => {
    await client.close();
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [userId, otherId]);
    await pool.end();
    await repo.closePool();
  });

  it("tells the model how to set up someone who joins mid pay period", async () => {
    const guide = client.getInstructions() ?? "";
    expect(guide).toMatch(/add_account/);
    expect(guide).toMatch(/opening_balance/);
    expect(guide).toMatch(/next salary/);
    expect(guide).toMatch(/get_dashboard_link/);
    const tools = (await client.listTools()).tools;
    const desc = (n: string) => tools.find((t) => t.name === n)?.description ?? "";
    expect(desc("add_account")).toMatch(/before recording any transaction/);
    expect(desc("create_pay_period")).toMatch(/next salary/);
  });

  it("links to the plain dashboard when nothing is picked", async () => {
    const { url } = await call();
    expect(url!.origin).toBe(base);
    expect(url!.pathname).toBe("/");
    expect(url!.search).toBe("");
  });

  it("opens a pay period, a date range, or an account", async () => {
    const p = await repo.createPayPeriod(userId, { period_start: "2026-09-25", salary_amount: 9000000 });
    await repo.addAccount(userId, { name: "Bank Jago", type: "bank", opening_balance: 100 });

    expect((await call({ pay_period_id: p.id })).url!.searchParams.get("period")).toBe(String(p.id));

    const range = (await call({ start_date: "2026-10-01", end_date: "2026-10-15" })).url!;
    expect([range.searchParams.get("from"), range.searchParams.get("to")]).toEqual(["2026-10-01", "2026-10-15"]);

    // the dashboard matches account names exactly, so the link carries the stored spelling
    const acc = (await call({ account: "bank jago", pay_period_id: p.id })).url!;
    expect(acc.searchParams.get("account")).toBe("Bank Jago");
    expect(acc.toString()).toContain("account=Bank+Jago");
  });

  it("refuses links the dashboard could not open", async () => {
    const mine = await repo.createPayPeriod(userId, { period_start: "2026-09-25", salary_amount: 9000000 });
    const theirs = await repo.createPayPeriod(otherId, { period_start: "2026-09-25", salary_amount: 9000000 });
    await repo.addAccount(userId, { name: "Tunai", type: "cash" });
    await repo.addAccount(userId, { name: "Lama", type: "cash" });
    await repo.addAccount(otherId, { name: "Punya orang", type: "cash" });
    // with history it is archived, not deleted, and the dashboard no longer lists it
    await repo.transferBetweenAccounts(userId, { from: "Tunai", to: "Lama", amount: 1 });
    expect((await repo.removeAccount(userId, "Lama")).result).toBe("archived");

    expect((await call({ pay_period_id: theirs.id })).text).toMatch(/not one of the user's last 24/);
    expect((await call({ account: "Punya orang" })).text).toMatch(/not an active account/);
    expect((await call({ account: "Lama" })).text).toMatch(/not an active account/);
    expect((await call({ start_date: "2026-10-01" })).text).toMatch(/needs both/);
    expect((await call({ start_date: "2026-10-15", end_date: "2026-10-01" })).text).toMatch(/on or before/);
    expect((await call({ pay_period_id: mine.id, start_date: "2026-10-01", end_date: "2026-10-15" })).text).toMatch(/not both/);
    for (const r of [await call({ pay_period_id: theirs.id }), await call({ account: "Lama" })]) expect(r.isError).toBe(true);
  });
});
