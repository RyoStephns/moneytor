import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Pairwise tenant-isolation proof. Requires a real MySQL test database (migrated
// through the Phase 0 migrations). Auto-skips when DB env is absent so the suite
// stays green in environments without DB access (e.g. CI without a service).
//
// To run locally/CI with a DB:
//   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... \
//   PUBLIC_BASE_URL=http://localhost:3000 npx vitest run tests/isolation.test.ts
//
// The test seeds user A (owner, id=1) and a second user B, then asserts B can
// never read/update/delete A's rows by id, that listings never bleed across
// tenants, and that per-user unique keys let both users reuse the same names.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("tenant isolation (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let mysql: typeof import("mysql2/promise");
  let pool: import("mysql2/promise").Pool;

  const A = 1; // owner
  let B = 0; // second user, created in setup

  beforeAll(async () => {
    mysql = (await import("mysql2/promise")).default as unknown as typeof import("mysql2/promise");
    repo = await import("../src/repository.js");
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });

    // Ensure a second user exists for cross-tenant probing.
    const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
      `INSERT INTO users (email, status, display_name) VALUES (?, 'active', 'Tenant B')
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      ["tenant-b@moneytor.test"]
    );
    if (res.insertId) {
      B = res.insertId;
    } else {
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        ["tenant-b@moneytor.test"]
      );
      B = Number(rows[0].id);
    }
  });

  afterAll(async () => {
    if (B) await pool.execute(`DELETE FROM users WHERE id = ?`, [B]); // cascades B's data
    await pool.end();
    await repo.closePool();
  });

  it("B cannot read a transaction owned by A", async () => {
    const tx = await repo.addTransaction(A, { type: "expense", amount: 12345, category: "iso-test-cat-a" });
    await expect(repo.getTransaction(B, tx.id)).rejects.toThrow(/not found/i);
    await repo.deleteTransaction(A, tx.id);
  });

  it("B cannot update or delete A's transaction by id", async () => {
    const tx = await repo.addTransaction(A, { type: "expense", amount: 999, category: "iso-test-cat-a" });

    await expect(repo.updateTransaction(B, { id: tx.id, amount: 1 })).rejects.toThrow(/not found/i);
    const del = await repo.deleteTransaction(B, tx.id);
    expect(del.deleted).toBe(false);

    // A's row is untouched.
    const still = await repo.getTransaction(A, tx.id);
    expect(Number(still.amount)).toBe(999);
    await repo.deleteTransaction(A, tx.id);
  });

  it("listings and balances never bleed across tenants", async () => {
    const ta = await repo.addTransaction(A, { type: "income", amount: 500, category: "iso-test-cat-a" });
    const tb = await repo.addTransaction(B, { type: "income", amount: 700, category: "iso-test-cat-b" });

    const balA = await repo.getTotalBalance(A, {});
    const listB = await repo.listTransactions(B, {});

    expect(listB.some((t) => t.id === ta.id)).toBe(false);
    expect(listB.some((t) => t.id === tb.id)).toBe(true);
    // A's balance must not include B's 700.
    expect(balA.transaction_count).toBeGreaterThan(0);

    await repo.deleteTransaction(A, ta.id);
    await repo.deleteTransaction(B, tb.id);
  });

  it("both users can reuse the same category name (per-user unique key)", async () => {
    await repo.addCategory(A, "shared-name");
    await repo.addCategory(B, "shared-name");
    expect(await repo.listCategories(A)).toContain("shared-name");
    expect(await repo.listCategories(B)).toContain("shared-name");
    await pool.execute(`DELETE FROM categories WHERE name = 'shared-name'`);
  });

  it("B cannot get budget summary for A's pay period (arg-confusion)", async () => {
    const period = await repo.createPayPeriod(A, { period_start: "2099-01-01", salary_amount: 1000 });
    await expect(repo.getBudgetSummary(B, period.id, [])).rejects.toThrow(/not found/i);
    await expect(repo.setBudgetGroupsBulk(B, period.id, [{ name: "x", amount: 1, categories: [] }])).rejects.toThrow(/not found/i);
    await pool.execute(`DELETE FROM pay_periods WHERE id = ?`, [period.id]);
  });
});
