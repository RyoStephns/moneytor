import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Drives the account tools the way an LLM client does: through an MCP client
// linked in memory to the real server, so tool names, zod schemas, and error
// text are all exercised. Needs MySQL, skips without it.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("account tools over MCP (requires MySQL)", () => {
  let pool: import("mysql2/promise").Pool;
  let repo: typeof import("../src/repository.js");
  let client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  let userId = 0;

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0].text;
    return { isError: Boolean(res.isError), text, json: res.isError ? null : JSON.parse(text) };
  }

  beforeAll(async () => {
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });
    await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES ('account-tools@moneytor.test', 'active')`);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = 'account-tools@moneytor.test'`);
    userId = Number(rows[0].id);

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMoneytorServer } = await import("../src/mcp.js");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMoneytorServer(userId).connect(serverSide);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM transactions WHERE user_id = ?`, [userId]);
    await pool.execute(`DELETE FROM accounts WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    await client.close();
    await pool.execute(`DELETE FROM users WHERE id = ?`, [userId]);
    await pool.end();
    await repo.closePool();
  });

  it("registers the nine account tools next to the old ones", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(33);
    expect(names).toEqual(expect.arrayContaining([
      "list_accounts", "add_account", "update_account", "set_default_account", "remove_account",
      "transfer_between_accounts", "list_transfers", "delete_transfer", "reconcile_account",
      "add_transaction", "get_finance_summary",
    ]));
  });

  it("tells the model to call list_accounts first", async () => {
    const tools = (await client.listTools()).tools;
    const desc = (n: string) => tools.find((t) => t.name === n)?.description ?? "";
    expect(desc("add_transaction")).toMatch(/list_accounts/);
    expect(desc("update_transaction")).toMatch(/list_accounts/);
    expect(desc("get_total_balance")).toMatch(/list_accounts/);
  });

  it("walks the whole flow: add, record, transfer, reconcile, list", async () => {
    expect((await call("add_account", { name: "Tunai", type: "cash", opening_balance: 50000 })).json).toMatchObject({ name: "Tunai", is_default: true });
    expect((await call("add_account", { name: "BCA", type: "bank", description: "gaji" })).json).toMatchObject({ is_default: false });

    expect((await call("add_transaction", { type: "income", amount: 500000, category: "Gaji", account: "bca" })).json).toMatchObject({ account: "BCA" });
    expect((await call("add_transaction", { type: "expense", amount: 10000, category: "Makan" })).json).toMatchObject({ account: "Tunai" });
    await call("transfer_between_accounts", { from_account: "BCA", to_account: "tunai", amount: 100000 });
    expect((await call("reconcile_account", { account: "BCA", actual_balance: 399000 })).json).toMatchObject({ difference: -1000 });

    const overview = (await call("list_accounts")).json;
    expect(overview.default_account).toBe("Tunai");
    expect(Object.fromEntries(overview.accounts.map((a: { name: string; balance: number }) => [a.name, a.balance]))).toEqual({ Tunai: 140000, BCA: 399000 });
    expect(overview.unassigned).toEqual({ balance: 0, transaction_count: 0 });
    expect(overview.total_balance).toBe(539000);

    const summary = (await call("get_finance_summary", {})).json;
    expect(summary.totals).toMatchObject({ income: 500000, expense: 10000 });
  });

  it("an unknown account comes back as an error the model can act on", async () => {
    await call("add_account", { name: "Tunai", type: "cash" });
    const res = await call("add_transaction", { type: "expense", amount: 1, category: "Makan", account: "Dana" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Registered accounts: Tunai.*add_account/);
  });

  it("the schema rejects a zero transfer and an unknown account type before the database", async () => {
    await call("add_account", { name: "Tunai", type: "cash" });
    await call("add_account", { name: "BCA", type: "bank" });
    expect((await call("transfer_between_accounts", { from_account: "BCA", to_account: "Tunai", amount: 0 })).isError).toBe(true);
    expect((await call("add_account", { name: "Dana", type: "crypto" })).isError).toBe(true);
  });

  it("update_account can clear a description with null, and remove_account reports archived vs deleted", async () => {
    await call("add_account", { name: "Tunai", type: "cash" });
    await call("add_account", { name: "BCA", type: "bank", description: "gaji" });
    expect((await call("update_account", { account: "BCA", description: null })).json).toMatchObject({ description: null });

    await call("add_transaction", { type: "expense", amount: 1, category: "Makan", account: "BCA" });
    expect((await call("remove_account", { account: "BCA" })).json).toEqual({ account: "BCA", result: "archived" });
    expect((await call("remove_account", { account: "Tunai" })).isError).toBe(true);

    expect((await call("list_accounts")).json.accounts.map((a: { name: string }) => a.name)).toEqual(["Tunai"]);
    const all = (await call("list_accounts", { include_archived: true })).json;
    expect(all.accounts).toHaveLength(2);
    expect(all.total_balance).toBe(-1);
  });

  it("list_transfers and delete_transfer work end to end", async () => {
    await call("add_account", { name: "Tunai", type: "cash" });
    await call("add_account", { name: "BCA", type: "bank" });
    const t = (await call("transfer_between_accounts", { from_account: "BCA", to_account: "Tunai", amount: 25000, notes: "tarik tunai" })).json;
    expect((await call("list_transfers", { account: "tunai" })).json).toHaveLength(1);
    expect((await call("delete_transfer", { id: t.id })).json).toEqual({ deleted: true, id: t.id });
    expect((await call("list_transfers", {})).json).toEqual([]);
  });
});
