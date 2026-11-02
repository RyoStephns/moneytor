import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Same setup as accounts.test.ts: needs a real MySQL, skips without one, and
// works on two throwaway users so user 1 is never touched.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);

describe.skipIf(!HAS_DB)("receivables (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let pool: import("mysql2/promise").Pool;
  let A = 0;
  let B = 0;

  async function makeUser(email: string): Promise<number> {
    await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES (?, 'active')`, [email]);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = ?`, [email]);
    return Number(rows[0].id);
  }

  async function count(table: string, userId: number): Promise<number> {
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`,
      [userId]
    );
    return Number(rows[0].n);
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
    A = await makeUser("receivables-a@moneytor.test");
    B = await makeUser("receivables-b@moneytor.test");
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM receivables WHERE user_id IN (?, ?)`, [A, B]);
    await pool.execute(`DELETE FROM transactions WHERE user_id IN (?, ?)`, [A, B]);
    await pool.execute(`DELETE FROM accounts WHERE user_id IN (?, ?)`, [A, B]);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [A, B]);
    await pool.end();
    await repo.closePool();
  });

  it("create falls back to the default account and never writes a transaction", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });

    const viaDefault = await repo.createReceivable(A, { borrower: " Budi ", amount: 150000 });
    expect(viaDefault).toMatchObject({ borrower: "Budi", amount: 150000, account: "BCA", status: "open", settled_at: null, settled_account: null });

    const viaName = await repo.createReceivable(A, { borrower: "Sari", amount: 50000, account: "Tunai", notes: "makan siang" });
    expect(viaName.account).toBe("Tunai");
    expect(viaName.notes).toBe("makan siang");

    expect(await count("receivables", A)).toBe(2);
    expect(await count("transactions", A)).toBe(0);
  });

  it("create refuses bad amount, unknown or archived account, and no account at all", async () => {
    await expect(repo.createReceivable(A, { borrower: "Budi", amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(repo.createReceivable(A, { borrower: "Budi", amount: 1000 })).rejects.toThrow(/No account/);
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await expect(repo.createReceivable(A, { borrower: "Budi", amount: 1000, account: "Nope" })).rejects.toThrow(/not found/);
    expect(await count("receivables", A)).toBe(0);
  });

  it("settle marks it settled once, with the receiving account", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 150000, account: "Tunai" });

    const back = await repo.settleReceivable(A, rec.id, { account: "BCA", date: "2026-10-20" });
    expect(back.status).toBe("settled");
    expect(back.account).toBe("Tunai");
    expect(back.settled_account).toBe("BCA");
    expect(back.settled_at).not.toBeNull();

    await expect(repo.settleReceivable(A, rec.id, { account: "BCA" })).rejects.toThrow(/already settled/);
    expect(await count("transactions", A)).toBe(0);
  });

  it("settle without account uses the default, and refuses when there is none", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 1000 });
    expect((await repo.settleReceivable(A, rec.id, {})).settled_account).toBe("BCA");

    await pool.execute(`UPDATE accounts SET is_default = 0 WHERE user_id = ?`, [A]);
    const other = await repo.createReceivable(A, { borrower: "Sari", amount: 1000, account: "BCA" });
    await expect(repo.settleReceivable(A, other.id, {})).rejects.toThrow(/No account/);
    expect((await repo.listReceivables(A, { status: "all" })).receivables.find((r) => r.id === other.id)?.status).toBe("open");
  });

  it("settle on a missing id says not found", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await expect(repo.settleReceivable(A, 999999, {})).rejects.toThrow(/not found/);
  });

  it("list defaults to open and totals what is still owed per borrower", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const a = await repo.createReceivable(A, { borrower: "Budi", amount: 100000 });
    await repo.createReceivable(A, { borrower: "budi", amount: 50000 });
    await repo.createReceivable(A, { borrower: "Sari", amount: 25000 });
    await repo.settleReceivable(A, a.id, {});

    const open = await repo.listReceivables(A, {});
    expect(open.receivables).toHaveLength(2);
    expect(open.outstanding_total).toBe(75000);
    expect(open.outstanding_by_borrower.map((b) => [b.borrower.toLowerCase(), b.count, b.total])).toEqual([
      ["budi", 1, 50000],
      ["sari", 1, 25000],
    ]);

    const settled = await repo.listReceivables(A, { status: "settled" });
    expect(settled.receivables.map((r) => r.id)).toEqual([a.id]);
    expect(settled.outstanding_total).toBe(75000);

    expect((await repo.listReceivables(A, { status: "all" })).receivables).toHaveLength(3);
    expect((await repo.listReceivables(A, { borrower: "SARI" })).receivables).toHaveLength(1);
  });

  it("update: open can change anything, settled only borrower/date/notes", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 100000 });

    const open = await repo.updateReceivable(A, rec.id, { amount: 120000, account: "Tunai", borrower: "Budi S", notes: "naik" });
    expect(open).toMatchObject({ amount: 120000, account: "Tunai", borrower: "Budi S", notes: "naik" });
    await expect(repo.updateReceivable(A, rec.id, { amount: -1 })).rejects.toThrow(/greater than zero/);

    await repo.settleReceivable(A, rec.id, {});
    await expect(repo.updateReceivable(A, rec.id, { amount: 1 })).rejects.toThrow(/already settled/);
    await expect(repo.updateReceivable(A, rec.id, { account: "BCA" })).rejects.toThrow(/already settled/);
    const edited = await repo.updateReceivable(A, rec.id, { notes: null, borrower: "Budi Santoso" });
    expect(edited).toMatchObject({ notes: null, borrower: "Budi Santoso", amount: 120000, status: "settled" });
  });

  it("delete works for open and settled, and reports a missing id", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const open = await repo.createReceivable(A, { borrower: "Budi", amount: 1000 });
    const paid = await repo.createReceivable(A, { borrower: "Sari", amount: 1000 });
    await repo.settleReceivable(A, paid.id, {});

    expect((await repo.deleteReceivable(A, open.id)).deleted).toBe(true);
    expect((await repo.deleteReceivable(A, paid.id)).deleted).toBe(true);
    expect((await repo.deleteReceivable(A, paid.id)).deleted).toBe(false);
    expect(await count("receivables", A)).toBe(0);
  });

  it("other users cannot see, change, settle or delete them", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(B, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 1000 });

    expect((await repo.listReceivables(B, { status: "all" })).receivables).toHaveLength(0);
    await expect(repo.settleReceivable(B, rec.id, {})).rejects.toThrow(/not found/);
    await expect(repo.updateReceivable(B, rec.id, { notes: "x" })).rejects.toThrow(/not found/);
    expect((await repo.deleteReceivable(B, rec.id)).deleted).toBe(false);
    expect((await repo.listReceivables(A, {})).receivables[0].status).toBe("open");
  });

  it("moves account balances but leaves income, expense and averages untouched", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 1000000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await repo.addTransaction(A, { type: "income", amount: 500000, category: "Gaji", account: "BCA" });
    await repo.addTransaction(A, { type: "expense", amount: 200000, category: "Makan", account: "BCA" });

    const bal = async (name: string) => (await repo.listAccounts(A)).find((a) => a.name === name)?.balance;
    const reports = async () => ({
      summary: await repo.getFinanceSummary(A, {}),
      total: await repo.getTotalBalance(A, {}),
      averages: await repo.getAverages(A, {}),
    });
    const before = await reports();
    expect(await bal("BCA")).toBe(1300000);

    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 100000, account: "BCA" });
    expect(await bal("BCA")).toBe(1200000);
    expect(await bal("Tunai")).toBe(0);
    expect((await repo.getAccountOverview(A)).total_balance).toBe(1200000);
    expect(await reports()).toEqual(before);

    await repo.settleReceivable(A, rec.id, { account: "Tunai" });
    expect(await bal("BCA")).toBe(1200000);
    expect(await bal("Tunai")).toBe(100000);
    expect((await repo.getAccountOverview(A)).total_balance).toBe(1300000);
    expect(await reports()).toEqual(before);

    await repo.deleteReceivable(A, rec.id);
    expect(await bal("BCA")).toBe(1300000);
    expect(await bal("Tunai")).toBe(0);
    expect(await reports()).toEqual(before);
  });

  it("changing an open receivable's amount or account moves the balance with it", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 500000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash", opening_balance: 500000 });
    const bal = async (name: string) => (await repo.listAccounts(A)).find((a) => a.name === name)?.balance;

    const rec = await repo.createReceivable(A, { borrower: "Budi", amount: 100000, account: "BCA" });
    await repo.updateReceivable(A, rec.id, { amount: 150000 });
    expect(await bal("BCA")).toBe(350000);
    await repo.updateReceivable(A, rec.id, { account: "Tunai" });
    expect(await bal("BCA")).toBe(500000);
    expect(await bal("Tunai")).toBe(350000);
  });

  it("an account with receivables is archived, not deleted", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await repo.createReceivable(A, { borrower: "Budi", amount: 1000, account: "Tunai" });

    expect(await repo.removeAccount(A, "Tunai")).toEqual({ account: "Tunai", result: "archived" });

    const paidTo = await repo.createReceivable(A, { borrower: "Sari", amount: 1000, account: "BCA" });
    await repo.addAccount(A, { name: "Dana", type: "ewallet" });
    await repo.settleReceivable(A, paidTo.id, { account: "Dana" });
    expect(await repo.removeAccount(A, "Dana")).toEqual({ account: "Dana", result: "archived" });
  });

  it("partial payments keep the row open, count only what is left, and settle on the last rupiah", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 1000000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const bal = async (name: string) => (await repo.listAccounts(A)).find((a) => a.name === name)?.balance;
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 87300, account: "BCA" });
    await repo.createReceivable(A, { borrower: "Ditha", amount: 54900, account: "BCA" });
    expect(await bal("BCA")).toBe(857800);

    const half = await repo.settleReceivable(A, rec.id, { amount: 40000, account: "Tunai", date: "2026-11-02" });
    expect(half).toMatchObject({ status: "open", amount: 87300, paid: 40000, remaining: 47300, settled_at: null, settled_account: null });
    expect(half.payments).toHaveLength(1);
    expect(half.payments[0]).toMatchObject({ amount: 40000, account: "Tunai" });
    expect(await bal("Tunai")).toBe(40000);
    expect(await bal("BCA")).toBe(857800);

    const open = await repo.listReceivables(A, {});
    expect(open.receivables).toHaveLength(2);
    expect(open.outstanding_total).toBe(102200);
    expect(open.outstanding_by_borrower).toEqual([{ borrower: "Ditha", count: 2, total: 102200 }]);

    const done = await repo.settleReceivable(A, rec.id, { amount: 47300, account: "BCA" });
    expect(done).toMatchObject({ status: "settled", paid: 87300, remaining: 0, settled_account: "BCA" });
    expect(done.payments.map((p) => [p.amount, p.account])).toEqual([[40000, "Tunai"], [47300, "BCA"]]);
    expect(await bal("Tunai")).toBe(40000);
    expect(await bal("BCA")).toBe(905100);
    expect((await repo.listReceivables(A, {})).outstanding_total).toBe(54900);
    await expect(repo.settleReceivable(A, rec.id, { amount: 1 })).rejects.toThrow(/already settled/);
  });

  it("a payment above what is left, or not above zero, is refused and changes nothing", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 100000 });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 50000 });
    await repo.settleReceivable(A, rec.id, { amount: 30000 });

    await expect(repo.settleReceivable(A, rec.id, { amount: 20000.01 })).rejects.toThrow(/only has 20000 left/);
    await expect(repo.settleReceivable(A, rec.id, { amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(repo.settleReceivable(A, rec.id, { amount: -5 })).rejects.toThrow(/greater than zero/);
    const after = (await repo.listReceivables(A, {})).receivables[0];
    expect(after).toMatchObject({ status: "open", paid: 30000, remaining: 20000 });
    expect((await repo.listAccounts(A))[0].balance).toBe(80000);
  });

  it("no amount after a partial payment pays exactly the rest", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 118950 });
    await repo.settleReceivable(A, rec.id, { amount: 18950.5 });
    const done = await repo.settleReceivable(A, rec.id, {});
    expect(done).toMatchObject({ status: "settled", paid: 118950, remaining: 0 });
    expect(done.payments.map((p) => p.amount)).toEqual([18950.5, 100000 - 0.5]);
  });

  it("two payments racing for the same remaining cannot both land", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 100000 });
    const results = await Promise.allSettled([
      repo.settleReceivable(A, rec.id, { amount: 70000 }),
      repo.settleReceivable(A, rec.id, { amount: 70000 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await repo.listReceivables(A, {})).receivables[0]).toMatchObject({ paid: 70000, remaining: 30000 });
  });

  it("update: amount must stay above what is already paid", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 100000 });
    await repo.settleReceivable(A, rec.id, { amount: 60000 });

    await expect(repo.updateReceivable(A, rec.id, { amount: 60000 })).rejects.toThrow(/already has 60000 paid/);
    await expect(repo.updateReceivable(A, rec.id, { amount: 50000 })).rejects.toThrow(/already has 60000 paid/);
    expect(await repo.updateReceivable(A, rec.id, { amount: 80000 })).toMatchObject({ amount: 80000, paid: 60000, remaining: 20000, status: "open" });
  });

  it("deleting a partly paid receivable takes its payments and their balance effect along", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 100000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 40000, account: "BCA" });
    await repo.settleReceivable(A, rec.id, { amount: 10000, account: "Tunai" });
    await repo.deleteReceivable(A, rec.id);
    const accs = await repo.listAccounts(A);
    expect(accs.find((a) => a.name === "BCA")?.balance).toBe(100000);
    expect(accs.find((a) => a.name === "Tunai")?.balance).toBe(0);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT COUNT(*) AS n FROM receivable_payments WHERE user_id = ?`, [A]);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("an account that only received a partial payment is archived, and the account filter finds it", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Dana", type: "ewallet" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 50000, account: "BCA" });
    await repo.settleReceivable(A, rec.id, { amount: 10000, account: "Dana" });

    expect((await repo.listReceivables(A, { account: "Dana" })).receivables.map((r) => r.id)).toEqual([rec.id]);
    expect(await repo.removeAccount(A, "Dana")).toEqual({ account: "Dana", result: "archived" });
  });

  it("other users cannot pay a receivable that is not theirs", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(B, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 1000 });
    await expect(repo.settleReceivable(B, rec.id, { amount: 500 })).rejects.toThrow(/not found/);
    expect((await repo.listReceivables(A, {})).receivables[0].paid).toBe(0);
  });

  it("partial payments keep the row open, count only what is left, and settle on the last rupiah", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 1000000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const bal = async (name: string) => (await repo.listAccounts(A)).find((a) => a.name === name)?.balance;
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 87300, account: "BCA" });
    await repo.createReceivable(A, { borrower: "Ditha", amount: 54900, account: "BCA" });
    expect(await bal("BCA")).toBe(857800);

    const half = await repo.settleReceivable(A, rec.id, { amount: 40000, account: "Tunai", date: "2026-11-02" });
    expect(half).toMatchObject({ status: "open", amount: 87300, paid: 40000, remaining: 47300, settled_at: null, settled_account: null });
    expect(half.payments).toHaveLength(1);
    expect(half.payments[0]).toMatchObject({ amount: 40000, account: "Tunai" });
    expect(await bal("Tunai")).toBe(40000);
    expect(await bal("BCA")).toBe(857800);

    const open = await repo.listReceivables(A, {});
    expect(open.receivables).toHaveLength(2);
    expect(open.outstanding_total).toBe(102200);
    expect(open.outstanding_by_borrower).toEqual([{ borrower: "Ditha", count: 2, total: 102200 }]);

    const done = await repo.settleReceivable(A, rec.id, { amount: 47300, account: "BCA" });
    expect(done).toMatchObject({ status: "settled", paid: 87300, remaining: 0, settled_account: "BCA" });
    expect(done.payments.map((p) => [p.amount, p.account])).toEqual([[40000, "Tunai"], [47300, "BCA"]]);
    expect(await bal("Tunai")).toBe(40000);
    expect(await bal("BCA")).toBe(905100);
    expect((await repo.listReceivables(A, {})).outstanding_total).toBe(54900);
    await expect(repo.settleReceivable(A, rec.id, { amount: 1 })).rejects.toThrow(/already settled/);
  });

  it("a payment above what is left, or not above zero, is refused and changes nothing", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 100000 });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 50000 });
    await repo.settleReceivable(A, rec.id, { amount: 30000 });

    await expect(repo.settleReceivable(A, rec.id, { amount: 20000.01 })).rejects.toThrow(/only has 20000 left/);
    await expect(repo.settleReceivable(A, rec.id, { amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(repo.settleReceivable(A, rec.id, { amount: -5 })).rejects.toThrow(/greater than zero/);
    const after = (await repo.listReceivables(A, {})).receivables[0];
    expect(after).toMatchObject({ status: "open", paid: 30000, remaining: 20000 });
    expect((await repo.listAccounts(A))[0].balance).toBe(80000);
  });

  it("no amount after a partial payment pays exactly the rest", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 118950 });
    await repo.settleReceivable(A, rec.id, { amount: 18950.5 });
    const done = await repo.settleReceivable(A, rec.id, {});
    expect(done).toMatchObject({ status: "settled", paid: 118950, remaining: 0 });
    expect(done.payments.map((p) => p.amount)).toEqual([18950.5, 100000 - 0.5]);
  });

  it("two payments racing for the same remaining cannot both land", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 100000 });
    const results = await Promise.allSettled([
      repo.settleReceivable(A, rec.id, { amount: 70000 }),
      repo.settleReceivable(A, rec.id, { amount: 70000 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await repo.listReceivables(A, {})).receivables[0]).toMatchObject({ paid: 70000, remaining: 30000 });
  });

  it("update: amount must stay above what is already paid", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 100000 });
    await repo.settleReceivable(A, rec.id, { amount: 60000 });

    await expect(repo.updateReceivable(A, rec.id, { amount: 60000 })).rejects.toThrow(/already has 60000 paid/);
    await expect(repo.updateReceivable(A, rec.id, { amount: 50000 })).rejects.toThrow(/already has 60000 paid/);
    expect(await repo.updateReceivable(A, rec.id, { amount: 80000 })).toMatchObject({ amount: 80000, paid: 60000, remaining: 20000, status: "open" });
  });

  it("deleting a partly paid receivable takes its payments and their balance effect along", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank", opening_balance: 100000 });
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 40000, account: "BCA" });
    await repo.settleReceivable(A, rec.id, { amount: 10000, account: "Tunai" });
    await repo.deleteReceivable(A, rec.id);
    const accs = await repo.listAccounts(A);
    expect(accs.find((a) => a.name === "BCA")?.balance).toBe(100000);
    expect(accs.find((a) => a.name === "Tunai")?.balance).toBe(0);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT COUNT(*) AS n FROM receivable_payments WHERE user_id = ?`, [A]);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("an account that only received a partial payment is archived, and the account filter finds it", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Dana", type: "ewallet" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 50000, account: "BCA" });
    await repo.settleReceivable(A, rec.id, { amount: 10000, account: "Dana" });

    expect((await repo.listReceivables(A, { account: "Dana" })).receivables.map((r) => r.id)).toEqual([rec.id]);
    expect(await repo.removeAccount(A, "Dana")).toEqual({ account: "Dana", result: "archived" });
  });

  it("other users cannot pay a receivable that is not theirs", async () => {
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(B, { name: "BCA", type: "bank" });
    const rec = await repo.createReceivable(A, { borrower: "Ditha", amount: 1000 });
    await expect(repo.settleReceivable(B, rec.id, { amount: 500 })).rejects.toThrow(/not found/);
    expect((await repo.listReceivables(A, {})).receivables[0].paid).toBe(0);
  });
});
