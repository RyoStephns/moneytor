import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Same in-memory MCP client as account-tools.test.ts, aimed at the receivable
// tools: what the model sees is the tool name, the zod schema and the error text.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("receivable tools over MCP (requires MySQL)", () => {
  let pool: import("mysql2/promise").Pool;
  let repo: typeof import("../src/repository.js");
  let client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  let userId = 0;

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0].text;
    return { isError: Boolean(res.isError), text, json: res.isError ? null : JSON.parse(text) };
  }

  const balance = async (name: string) => {
    const { json } = await call("list_accounts");
    return json.accounts.find((a: { name: string }) => a.name === name).balance;
  };

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
    await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES ('receivable-tools@moneytor.test', 'active')`);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = 'receivable-tools@moneytor.test'`);
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
    await pool.execute(`DELETE FROM receivables WHERE user_id = ?`, [userId]);
    await pool.execute(`DELETE FROM transactions WHERE user_id = ?`, [userId]);
    await pool.execute(`DELETE FROM accounts WHERE user_id = ?`, [userId]);
  });

  afterAll(async () => {
    await client.close();
    await pool.execute(`DELETE FROM users WHERE id = ?`, [userId]);
    await pool.end();
    await repo.closePool();
  });

  it("lend, list, get paid back: income stays put", async () => {
    await call("add_account", { name: "BCA", type: "bank", opening_balance: 1000000 });
    await call("add_account", { name: "Tunai", type: "cash" });
    await call("add_transaction", { type: "income", amount: 500000, category: "Gaji", account: "BCA" });
    const incomeBefore = (await call("get_finance_summary")).json.totals.income;

    const added = await call("add_receivable", { borrower: "Budi", amount: 150000, account: "BCA", notes: "makan siang" });
    expect(added.json).toMatchObject({ borrower: "Budi", amount: 150000, account: "BCA", status: "open" });
    expect(await balance("BCA")).toBe(1350000);

    const open = await call("list_receivables");
    expect(open.json.outstanding_total).toBe(150000);
    expect(open.json.outstanding_by_borrower).toEqual([{ borrower: "Budi", count: 1, total: 150000 }]);

    const paid = await call("mark_receivable_reimbursed", { id: added.json.id, account: "Tunai" });
    expect(paid.json).toMatchObject({ status: "settled", settled_account: "Tunai" });
    expect(await balance("BCA")).toBe(1350000);
    expect(await balance("Tunai")).toBe(150000);

    expect((await call("get_finance_summary")).json.totals.income).toBe(incomeBefore);
    expect((await call("list_receivables")).json.outstanding_total).toBe(0);
    expect((await call("list_receivables", { status: "settled" })).json.receivables).toHaveLength(1);
  });

  it("paying back twice is an error the model can read", async () => {
    await call("add_account", { name: "BCA", type: "bank" });
    const { json } = await call("add_receivable", { borrower: "Budi", amount: 1000 });
    await call("mark_receivable_reimbursed", { id: json.id });
    const again = await call("mark_receivable_reimbursed", { id: json.id });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already settled/);
  });

  it("rejects bad input and unknown accounts through the tool layer", async () => {
    await call("add_account", { name: "BCA", type: "bank" });
    expect((await call("add_receivable", { borrower: "Budi", amount: -5 })).isError).toBe(true);
    const unknown = await call("add_receivable", { borrower: "Budi", amount: 1000, account: "Nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/not found/);
  });

  it("update and delete tools work, and delete hands the money back", async () => {
    await call("add_account", { name: "BCA", type: "bank", opening_balance: 100000 });
    const { json } = await call("add_receivable", { borrower: "Budi", amount: 10000 });
    const edited = await call("update_receivable", { id: json.id, amount: 20000, notes: "naik" });
    expect(edited.json).toMatchObject({ amount: 20000, notes: "naik" });
    expect(await balance("BCA")).toBe(80000);

    expect((await call("delete_receivable", { id: json.id })).json).toEqual({ deleted: true, id: json.id });
    expect(await balance("BCA")).toBe(100000);
  });

  it("steers the model away from logging a loan as an expense", async () => {
    const tools = (await client.listTools()).tools;
    const desc = (n: string) => tools.find((t) => t.name === n)?.description ?? "";
    expect(desc("add_transaction")).toMatch(/add_receivable/);
    expect(desc("add_receivable")).toMatch(/not an expense/);
    expect(desc("mark_receivable_reimbursed")).toMatch(/not income/);
  });
});
