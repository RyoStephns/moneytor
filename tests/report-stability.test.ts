import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// FR-009: accounts, transfers, and adjustments must not move any income/expense
// figure. Reports are taken on old-style data, then again after all three exist.
// Needs MySQL, skips without it.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("reports ignore accounts, transfers, and adjustments (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let pool: import("mysql2/promise").Pool;
  let U = 0;
  let periodId = 0;

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
    await pool.execute(`DELETE FROM users WHERE email = 'report-stability@moneytor.test'`);
    await pool.execute(`INSERT INTO users (email, status) VALUES ('report-stability@moneytor.test', 'active')`);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = 'report-stability@moneytor.test'`);
    U = Number(rows[0].id);

    const accounts = ["BCA", "Tunai", "bca ", null, "Blu"];
    const cats = ["Makan", "Transport", "Hiburan"];
    const values: unknown[][] = [];
    for (let i = 0; i < 40; i++) {
      const income = i % 13 === 0;
      const day = new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString().slice(0, 10);
      values.push([
        U, income ? "income" : "expense", income ? 5000000 + i : 9000.25 + i * 411.5, income ? "Gaji" : cats[i % 3],
        `${day} 09:00:00.000`, accounts[i % 5], JSON.stringify(i % 4 === 0 ? ["rutin"] : []),
      ]);
    }
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, occurred_at, account, tags_json) VALUES ?`,
      [values]
    );
    periodId = (await repo.createPayPeriod(U, { period_start: "2026-08-15", salary_amount: 5000000 })).id;
    await repo.setBudgetGroupsBulk(U, periodId, [
      { name: "Makan", amount: 400000, categories: ["Makan"] },
      { name: "Lainnya", amount: 300000, categories: ["Transport", "Hiburan"] },
    ]);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE id = ?`, [U]);
    await pool.end();
    await repo.closePool();
  });

  async function reports() {
    const list = await repo.listTransactions(U, { limit: 500 });
    const forBudget = list.map((t) => ({ category: t.category, amount: Number(t.amount), type: t.type, occurred_at: t.occurred_at }));
    const groups = await repo.getBudgetGroups(U, periodId);
    return JSON.parse(JSON.stringify({
      summary: await repo.getFinanceSummary(U, {}),
      summaryDay: await repo.getFinanceSummary(U, { period: "day", start_date: "2026-08-10", end_date: "2026-09-10" }),
      summaryBca: await repo.getFinanceSummary(U, { account: "BCA" }),
      balance: await repo.getTotalBalance(U, {}),
      balanceBca: await repo.getTotalBalance(U, { account: "BCA" }),
      averages: await repo.getAverages(U, {}),
      list,
      budget: await repo.getBudgetSummary(U, periodId, forBudget),
      groupDetail: await Promise.all(groups.map((g) => repo.getGroupDetail(U, periodId, g.id, forBudget))),
    }));
  }

  it("is identical before and after adding accounts, transfers, and reconciliations", async () => {
    const before = await reports();
    expect(before.summary.totals.income).toBeGreaterThan(0);
    expect(before.groupDetail).toHaveLength(2);

    await repo.addAccount(U, { name: "Tunai", type: "cash", opening_balance: 123456 });
    await repo.addAccount(U, { name: "BCA", type: "bank", opening_balance: 987654 });
    await repo.addAccount(U, { name: "Blu", type: "ewallet" });
    await repo.transferBetweenAccounts(U, { from: "BCA", to: "Tunai", amount: 250000, date: "2026-09-02" });
    await repo.transferBetweenAccounts(U, { from: "Tunai", to: "Blu", amount: 33333.33, date: "2026-08-20" });
    await repo.reconcileAccount(U, "BCA", 1000000);
    await repo.reconcileAccount(U, "Blu", 5);

    expect(await reports()).toEqual(before);
  });
});
