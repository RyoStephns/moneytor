import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// The dashboard must show exactly what the MCP tools report. The tools hand back
// JSON.stringify of the repository result, so that is the yardstick here.

const DB = process.env.MYSQL_DATABASE ?? "";
const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && DB && /dev|test/.test(DB));

const asTool = (v: unknown) => JSON.parse(JSON.stringify(v));

describe.skipIf(!HAS_DB)("dashboard API over HTTP (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let auth: typeof import("../src/auth.js");
  let pool: import("mysql2/promise").Pool;
  let server: Server;
  let base = "";
  let A = 0;
  let B = 0;
  let open = 0;
  const pw = "correct horse battery";

  async function get(path: string, cookie?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: await res.json() };
  }

  async function signIn(email: string) {
    const res = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    expect(res.status).toBe(200);
    const m = res.headers.getSetCookie().join("; ").match(/moneytor_session=([^;]*)/);
    return `moneytor_session=${m![1]}`;
  }

  async function makeUser(email: string) {
    const [r] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
      `INSERT INTO users (email, password_hash, is_owner, status) VALUES (?, ?, 0, 'active')`,
      [email, await auth.hashPassword(pw)]
    );
    return r.insertId;
  }

  beforeAll(async () => {
    const mysql = (await import("mysql2/promise")).default;
    forceStrictMode(mysql);
    repo = await import("../src/repository.js");
    auth = await import("../src/auth.js");
    pool = repo.pool;
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@dash.test'`);
    A = await makeUser("a@dash.test");
    B = await makeUser("b@dash.test");

    await repo.addAccount(A, { name: "Wallet", type: "cash", opening_balance: 100000 });
    await repo.addAccount(A, { name: "Bank", type: "bank", opening_balance: 2500000.5 });
    const august = await repo.createPayPeriod(A, { period_start: "2026-08-29", salary_amount: 9000000 });
    await repo.closePayPeriod(A, august.id, "2026-09-28");
    open = (await repo.createPayPeriod(A, { period_start: "2026-09-29", salary_amount: 9000000 })).id;
    await repo.setBudgetGroupsBulk(A, open, [
      { name: "Eating", amount: 150000, categories: ["Food"] },
      { name: "Getting around", amount: 500000, categories: ["Transport", "Fuel"] },
    ]);
    const seed: [string, "income" | "expense", number, string, string][] = [
      ["2026-08-30", "income", 9000000, "Salary", "Bank"],
      ["2026-09-02", "expense", 45000.25, "Food", "Wallet"],
      ["2026-09-29", "income", 9000000, "Salary", "Bank"],
      ["2026-10-01", "expense", 120000, "Food", "Wallet"],
      ["2026-10-03", "expense", 350000, "Transport", "Bank"],
      ["2026-10-21", "expense", 80000.75, "Food", "Bank"],
    ];
    for (const [date, type, amount, category, account] of seed) {
      await repo.addTransaction(A, { date, type, amount, category, account });
    }
    await repo.addTransaction(B, { date: "2026-10-05", type: "expense", amount: 777, category: "Secret" });

    const appMod = await import("../src/app.js");
    server = appMod.createApp().app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@dash.test'`); // cascades their data
    await repo.closePool();
  });

  it("refuses without a session and rejects malformed filters", async () => {
    expect((await get("/api/dashboard/context")).status).toBe(401);
    expect((await get("/api/dashboard/summary")).status).toBe(401);
    const a = await signIn("a@dash.test");
    const bad = await get("/api/dashboard/summary?start_date=10/01/2026", a);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Dates must look like 2026-10-22.");
    expect((await get("/api/dashboard/summary?period=week", a)).status).toBe(400);
  });

  it("returns the same pay periods and account overview as the tools", async () => {
    const r = await get("/api/dashboard/context", await signIn("a@dash.test"));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      current_period: asTool(await repo.getCurrentPeriod(A)),
      pay_periods: asTool(await repo.listPayPeriods(A, 24)),
      accounts: asTool(await repo.getAccountOverview(A)),
    });
    expect(r.body.current_period.period_start).toBe("2026-09-29");
    expect(r.body.accounts.total_balance).toBe(100000 + 2500000.5 + 18000000 - 45000.25 - 120000 - 350000 - 80000.75);
  });

  it("returns the same summary and all-history averages as the tools, for every filter", async () => {
    const a = await signIn("a@dash.test");
    const cases = [
      {},
      { start_date: "2026-09-29" },
      { start_date: "2026-10-01", end_date: "2026-10-31", period: "day" as const },
      { start_date: "2026-09-29", account: "Bank" },
      { account: "Nowhere" },
    ];
    for (const f of cases) {
      const qs = new URLSearchParams(f as Record<string, string>).toString();
      const r = await get(`/api/dashboard/summary?${qs}`, a);
      expect(r.status).toBe(200);
      expect(r.body.summary).toEqual(asTool(await repo.getFinanceSummary(A, { period: "month", ...f })));
      expect(r.body.averages).toEqual(asTool(await repo.getAverages(A, { account: f.account, period: "month" })));
      expect(r.body.history).toEqual(asTool(await repo.getFinanceSummary(A, { account: f.account, period: "month" })));
      const closed = { start_date: "2026-08-29", end_date: "2026-09-28", account: f.account, period: "month" as const };
      expect(r.body.baseline).toEqual({ period_start: "2026-08-29", period_end: "2026-09-28", pay_periods: 1, summary: asTool(await repo.getFinanceSummary(A, { ...closed, period: "day" })) });
      expect(r.body.budget).toBeNull();
      expect(r.body.trend).toEqual([
        { id: expect.any(Number), period_start: "2026-09-29", period_end: null, totals: (await repo.getFinanceSummary(A, { start_date: "2026-09-29", account: f.account, period: "month" })).totals },
        { id: expect.any(Number), period_start: "2026-08-29", period_end: "2026-09-28", totals: (await repo.getFinanceSummary(A, closed)).totals },
      ]);
    }
    const pp = await get("/api/dashboard/summary?start_date=2026-09-29", a);
    expect(pp.body.summary.totals).toEqual({ income: 9000000, expense: 550000.75, net: 8449999.25, transaction_count: 4 });
    // averages ignore the date range: three months of history, not one period
    expect(pp.body.averages.period_count).toBe(3);
    // the closed August pay period holds the 30 Aug salary and the 2 Sep lunch, nothing from the open one
    expect(pp.body.baseline.summary.totals).toEqual({ income: 9000000, expense: 45000.25, net: 8954999.75, transaction_count: 2 });
  });

  it("returns the budget get_budget_summary gives for the period's own transactions", async () => {
    const a = await signIn("a@dash.test");
    const r = await get(`/api/dashboard/summary?start_date=2026-09-29&period=day&pay_period_id=${open}`, a);
    expect(r.status).toBe(200);
    // what an assistant would do: list the period's transactions and hand them over one by one
    const txns = (await repo.listTransactions(A, { start_date: "2026-09-29", limit: 500 }))
      .map((t) => ({ category: t.category, type: t.type, amount: Number(t.amount), occurred_at: t.occurred_at }));
    expect(r.body.budget).toEqual(asTool(await repo.getBudgetSummary(A, open, txns)));
    const eating = r.body.budget.groups.find((g: { name: string }) => g.name === "Eating");
    expect(eating.actual_amount).toBe(200000.75);
    expect(eating.status).toBe("over");
    expect(r.body.budget.period_info.total_budget_spending).toBe(650000);

    // a filtered view, or a period that isn't a pay period of this user, gets no budget
    expect((await get(`/api/dashboard/summary?start_date=2026-09-29&pay_period_id=${open}&account=Bank`, a)).body.budget).toBeNull();
    const b = await signIn("b@dash.test");
    const probe = await get(`/api/dashboard/summary?pay_period_id=${open}`, b);
    expect(probe.status).toBe(200);
    expect(probe.body.budget).toBeNull();
  });

  it("lists one category's spending for the details view, only from the signed-in user", async () => {
    const a = await signIn("a@dash.test");
    const r = await get("/api/dashboard/transactions?start_date=2026-09-29&category=Food", a);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(asTool(await repo.listTransactions(A, { start_date: "2026-09-29", category: "Food", type: "expense", limit: 200 })));
    expect(r.body.map((t: { amount: string }) => t.amount)).toEqual(["80000.75", "120000.00"]);
    expect((await get("/api/dashboard/transactions?start_date=2026-09-29", a)).status).toBe(400);
    expect((await get("/api/dashboard/transactions?category=Food")).status).toBe(401);
    const b = await signIn("b@dash.test");
    expect((await get("/api/dashboard/transactions?category=Food", b)).body).toEqual([]);
  });

  it("shows each person only their own money", async () => {
    const b = await signIn("b@dash.test");
    const ctx = await get("/api/dashboard/context", b);
    expect(ctx.body.pay_periods).toEqual([]);
    expect(ctx.body.current_period).toBeNull();
    expect(ctx.body.accounts.accounts).toEqual([]);
    const sum = await get("/api/dashboard/summary", b);
    expect(sum.body.summary.totals).toEqual({ income: 0, expense: 777, net: -777, transaction_count: 1 });
    expect(sum.body.summary.by_category.map((c: { category: string }) => c.category)).toEqual(["Secret"]);
    expect(sum.body.baseline).toBeNull();
    expect(sum.body.trend).toEqual([]);

    // naming A's account from B's session finds nothing rather than A's rows
    const probe = await get("/api/dashboard/summary?account=Bank", b);
    expect(probe.body.summary.totals.transaction_count).toBe(0);
  });
});
