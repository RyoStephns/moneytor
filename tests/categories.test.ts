import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Needs a real MySQL (same env vars as isolation.test.ts) and skips without one.
// Works on two throwaway users it creates itself, so it never touches user 1.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("rename and delete category (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let pool: import("mysql2/promise").Pool;
  let A = 0;
  let B = 0;

  async function makeUser(email: string): Promise<number> {
    await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES (?, 'active')`, [email]);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = ?`, [email]);
    return Number(rows[0].id);
  }

  async function addTx(userId: number, category: string) {
    await pool.execute(
      `INSERT INTO transactions (user_id, type, amount, category, occurred_at, tags_json)
       VALUES (?, 'expense', 1000, ?, NOW(3), '[]')`,
      [userId, category]
    );
  }

  // one pay period with one group that holds the given categories
  async function addGroup(userId: number, categories: string[]) {
    const pp = await repo.createPayPeriod(userId, { period_start: "2026-11-01", salary_amount: 5000000 });
    await repo.setBudgetGroup(userId, pp.id, { name: "Harian", amount: 1000000, budget_type: "spending", categories });
    return pp.id;
  }

  const txCats = async (userId: number) => {
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT category FROM transactions WHERE user_id = ?`, [userId]);
    return rows.map((r) => String(r.category));
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
    A = await makeUser("categories-a@moneytor.test");
    B = await makeUser("categories-b@moneytor.test");
  });

  beforeEach(async () => {
    for (const t of ["transactions", "pay_periods", "budget_templates", "categories"]) {
      await pool.execute(`DELETE FROM ${t} WHERE user_id IN (?, ?)`, [A, B]);
    }
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [A, B]);
    await pool.end();
    await repo.closePool();
  });

  it("rename reaches categories, transactions, budget groups and templates, and only for that user", async () => {
    await repo.addCategory(A, "Maknan");
    await repo.addCategory(B, "Maknan");
    await addTx(A, "Maknan");
    await addTx(A, "Maknan");
    await addTx(B, "Maknan");
    const ppA = await addGroup(A, ["Maknan", "Transport"]);
    const ppB = await addGroup(B, ["Maknan"]);
    await repo.saveBudgetTemplate(A, "Bulanan", [{ name: "Harian", amount: 1000000, budget_type: "spending", categories: ["Maknan", "Transport"] }]);

    const res = await repo.renameCategory(A, "Maknan", "Makan");

    expect(res.updated).toEqual({ transactions: 2, budget_groups: 1, templates: 1 });
    expect(await repo.listCategories(A)).toEqual(["Makan"]);
    expect(await txCats(A)).toEqual(["Makan", "Makan"]);
    expect((await repo.getBudgetGroups(A, ppA))[0].categories.sort()).toEqual(["Makan", "Transport"]);
    expect((await repo.listBudgetTemplates(A))[0].groups[0].categories).toEqual(["Makan", "Transport"]);

    // B kept its own "Maknan" everywhere
    expect(await repo.listCategories(B)).toEqual(["Maknan"]);
    expect(await txCats(B)).toEqual(["Maknan"]);
    expect((await repo.getBudgetGroups(B, ppB))[0].categories).toEqual(["Maknan"]);
  });

  it("rename into a name that already exists is refused and changes nothing", async () => {
    await repo.addCategory(A, "Makan");
    await repo.addCategory(A, "Jajan");
    await addTx(A, "Jajan");

    await expect(repo.renameCategory(A, "Jajan", "Makan")).rejects.toThrow(/already exists/);
    expect(await repo.listCategories(A)).toEqual(["Jajan", "Makan"]);
    expect(await txCats(A)).toEqual(["Jajan"]);
  });

  it("rename into an unregistered name that old rows still use is refused", async () => {
    await repo.addCategory(A, "Jajan");
    await addTx(A, "Kopi");

    await expect(repo.renameCategory(A, "Jajan", "Kopi")).rejects.toThrow(/would merge/);
    expect(await repo.listCategories(A)).toEqual(["Jajan"]);
  });

  it("a case-only rename goes through", async () => {
    await repo.addCategory(A, "makan");
    await addTx(A, "makan");

    await repo.renameCategory(A, "makan", "Makan");
    expect(await repo.listCategories(A)).toEqual(["Makan"]);
    expect(await txCats(A)).toEqual(["Makan"]);
  });

  it("rename of an unknown category, or one only another user owns, is refused", async () => {
    await repo.addCategory(B, "Rahasia");
    await expect(repo.renameCategory(A, "Rahasia", "X")).rejects.toThrow(/Unknown category/);
    expect(await repo.listCategories(B)).toEqual(["Rahasia"]);
  });

  it("delete is refused while a transaction, a budget group or a template still uses it", async () => {
    await repo.addCategory(A, "Pakai-tx");
    await repo.addCategory(A, "Pakai-grup");
    await repo.addCategory(A, "Pakai-template");
    await addTx(A, "Pakai-tx");
    await addGroup(A, ["Pakai-grup"]);
    await repo.saveBudgetTemplate(A, "T", [{ name: "G", amount: 1000, budget_type: "spending", categories: ["Pakai-template"] }]);

    await expect(repo.deleteCategory(A, "Pakai-tx")).rejects.toThrow(/1 transaction/);
    await expect(repo.deleteCategory(A, "Pakai-grup")).rejects.toThrow(/1 budget group/);
    await expect(repo.deleteCategory(A, "Pakai-template")).rejects.toThrow(/1 template/);
    expect(await repo.listCategories(A)).toHaveLength(3);
  });

  it("delete removes an unused category and leaves other users' same-named one alone", async () => {
    await repo.addCategory(A, "Kosong");
    await repo.addCategory(B, "Kosong");
    await addTx(B, "Kosong");

    expect(await repo.deleteCategory(A, "Kosong")).toEqual({ deleted: true, name: "Kosong" });
    expect(await repo.listCategories(A)).toEqual([]);
    expect(await repo.listCategories(B)).toEqual(["Kosong"]);
    await expect(repo.deleteCategory(A, "Kosong")).rejects.toThrow(/Unknown category/);
  });
});
