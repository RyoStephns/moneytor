import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forceStrictMode } from "./strict-mode.js";

// Needs a real MySQL (same env vars as isolation.test.ts) and skips without one.
// Works on two throwaway users it creates itself, so it never touches user 1.

const HAS_DB = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE);


describe.skipIf(!HAS_DB)("accounts (requires MySQL)", () => {
  let repo: typeof import("../src/repository.js");
  let pool: import("mysql2/promise").Pool;
  let A = 0;
  let B = 0;

  async function makeUser(email: string): Promise<number> {
    await pool.execute(`INSERT IGNORE INTO users (email, status) VALUES (?, 'active')`, [email]);
    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT id FROM users WHERE email = ?`, [email]);
    return Number(rows[0].id);
  }

  async function addTx(userId: number, accountId: number) {
    await pool.execute(
      `INSERT INTO transactions (user_id, type, amount, category, account_id, occurred_at, tags_json)
       VALUES (?, 'expense', 1000, 'Makan', ?, NOW(3), '[]')`,
      [userId, accountId]
    );
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
    A = await makeUser("accounts-a@moneytor.test");
    B = await makeUser("accounts-b@moneytor.test");
  });

  beforeEach(async () => {
    await pool.execute(`DELETE FROM transactions WHERE user_id IN (?, ?)`, [A, B]);
    await pool.execute(`DELETE FROM accounts WHERE user_id IN (?, ?)`, [A, B]);
  });

  afterAll(async () => {
    await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [A, B]);
    await pool.end();
    await repo.closePool();
  });

  it("first account becomes default, later ones do not", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await repo.addAccount(A, { name: "BCA", type: "bank", description: "gaji masuk sini", opening_balance: 250000 });
    const list = await repo.listAccounts(A);
    expect(list.map((a) => [a.name, a.is_default])).toEqual([["Tunai", true], ["BCA", false]]);
    expect(list[1]).toMatchObject({ type: "bank", description: "gaji masuk sini", opening_balance: 250000 });
  });

  it("refuses a name that differs only in case, but another user may reuse it", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await expect(repo.addAccount(A, { name: "tunai", type: "cash" })).rejects.toThrow(/already exists/);
    await expect(repo.addAccount(B, { name: "tunai", type: "cash" })).resolves.toMatchObject({ is_default: true });
  });

  it("finds accounts regardless of case", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const res = await repo.updateAccount(A, "TUNAI", { description: "dompet" });
    expect(res).toMatchObject({ name: "Tunai", description: "dompet" });
  });

  it("renames, and refuses a rename onto an existing name", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await expect(repo.updateAccount(A, "BCA", { new_name: "tunai" })).rejects.toThrow(/already exists/);
    const res = await repo.updateAccount(A, "BCA", { new_name: "BCA Utama", type: "other", description: null });
    expect(res).toMatchObject({ name: "BCA Utama", type: "other", description: null });
  });

  it("setDefaultAccount moves the flag so exactly one default remains", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.setDefaultAccount(A, "BCA");
    const defaults = (await repo.listAccounts(A)).filter((a) => a.is_default);
    expect(defaults.map((a) => a.name)).toEqual(["BCA"]);
  });

  it("removeAccount: refuses the default, deletes a clean account, archives a used one", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const bca = await repo.addAccount(A, { name: "BCA", type: "bank" });
    await repo.addAccount(A, { name: "Blu", type: "ewallet" });

    await expect(repo.removeAccount(A, "Tunai")).rejects.toThrow(/default/);

    expect(await repo.removeAccount(A, "Blu")).toEqual({ account: "Blu", result: "deleted" });
    expect((await repo.listAccounts(A, true)).map((a) => a.name)).toEqual(["Tunai", "BCA"]);

    await addTx(A, bca.id);
    expect(await repo.removeAccount(A, "BCA")).toEqual({ account: "BCA", result: "archived" });
    expect((await repo.listAccounts(A)).map((a) => a.name)).toEqual(["Tunai"]);
    expect((await repo.listAccounts(A, true)).find((a) => a.name === "BCA")?.archived).toBe(true);

    const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(
      `SELECT account_id FROM transactions WHERE user_id = ?`, [A]
    );
    expect(Number(rows[0].account_id)).toBe(bca.id);
  });

  it("an archived account cannot become the default", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    const bca = await repo.addAccount(A, { name: "BCA", type: "bank" });
    await addTx(A, bca.id);
    await repo.removeAccount(A, "BCA");
    await expect(repo.setDefaultAccount(A, "BCA")).rejects.toThrow(/archived/);
  });

  it("another user cannot touch my accounts", async () => {
    await repo.addAccount(A, { name: "Tunai", type: "cash" });
    await expect(repo.updateAccount(B, "Tunai", { description: "x" })).rejects.toThrow(/not found/);
    await expect(repo.setDefaultAccount(B, "Tunai")).rejects.toThrow(/not found/);
    await expect(repo.removeAccount(B, "Tunai")).rejects.toThrow(/not found/);
    expect(await repo.listAccounts(B)).toEqual([]);
    expect((await repo.listAccounts(A))[0]).toMatchObject({ name: "Tunai", description: null });
  });

  describe("transactions and accounts", () => {
    const spend = { type: "expense", amount: 1000, category: "Makan" } as const;

    async function legacyTx(userId: number, account: string | null) {
      const [res] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
        `INSERT INTO transactions (user_id, type, amount, category, account, occurred_at, tags_json)
         VALUES (?, 'expense', 2000, 'Makan', ?, NOW(3), '[]')`,
        [userId, account]
      );
      return res.insertId;
    }

    it("no account given lands in the default account", async () => {
      const tunai = await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      const tx = await repo.addTransaction(A, spend);
      expect(tx).toMatchObject({ account: "Tunai", account_id: tunai.id });
    });

    it("a named account is matched ignoring case", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      const bca = await repo.addAccount(A, { name: "BCA", type: "bank" });
      const tx = await repo.addTransaction(A, { ...spend, account: "bca" });
      expect(tx).toMatchObject({ account: "BCA", account_id: bca.id });
    });

    it("an unknown account is refused and the message lists what exists", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      await expect(repo.addTransaction(A, { ...spend, account: "Blu" }))
        .rejects.toThrow(/Registered accounts: Tunai, BCA.*add_account/);
    });

    it("an archived account is refused for new transactions", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      await repo.addTransaction(A, { ...spend, account: "BCA" });
      await repo.removeAccount(A, "BCA");
      await expect(repo.addTransaction(A, { ...spend, account: "BCA" })).rejects.toThrow(/archived/);
    });

    it("a user with no accounts still records, with no account", async () => {
      const tx = await repo.addTransaction(A, spend);
      expect(tx).toMatchObject({ account: null, account_id: null });
    });

    it("new rows leave the old free-text column empty", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      const tx = await repo.addTransaction(A, spend);
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT account FROM transactions WHERE id = ?`, [tx.id]);
      expect(rows[0].account).toBeNull();
    });

    it("renaming an account shows the new name on old transactions", async () => {
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      const tx = await repo.addTransaction(A, spend);
      await repo.updateAccount(A, "BCA", { new_name: "BCA Utama" });
      expect((await repo.getTransaction(A, tx.id)).account).toBe("BCA Utama");
    });

    it("updateTransaction moves to an account, wipes the old text, and can clear", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      const id = await legacyTx(A, "bca lama");
      expect((await repo.getTransaction(A, id)).account).toBe("bca lama");

      const moved = await repo.updateTransaction(A, { id, account: "tunai" });
      expect(moved.account).toBe("Tunai");
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT account FROM transactions WHERE id = ?`, [id]);
      expect(rows[0].account).toBeNull();

      const cleared = await repo.updateTransaction(A, { id, account: null });
      expect(cleared).toMatchObject({ account: null, account_id: null });
    });

    it("the account filter and by_account cover linked accounts and old text alike", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addTransaction(A, spend);
      await legacyTx(A, "Dompet lama");
      await legacyTx(A, null);

      expect(await repo.listTransactions(A, { account: "tunai" })).toHaveLength(1);
      expect(await repo.listTransactions(A, { account: "Dompet lama" })).toHaveLength(1);

      const summary = await repo.getFinanceSummary(A, {});
      const labels = summary.by_account.map((r) => r.account).sort();
      expect(labels).toEqual(["Dompet lama", "Tunai", "uncategorized"]);
      expect((await repo.getTotalBalance(A, { account: "Tunai" })).balance).toBe(-1000);
    });

    it("an account filter never matches another user's account of the same name", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addAccount(B, { name: "Tunai", type: "cash" });
      await repo.addTransaction(A, spend);
      const mine = await repo.addTransaction(B, { ...spend, amount: 7 });
      const seen = await repo.listTransactions(B, { account: "Tunai" });
      expect(seen.map((t) => t.id)).toEqual([mine.id]);
    });
  });

  describe("transfers", () => {
    async function twoAccounts() {
      await repo.addAccount(A, { name: "Tunai", type: "cash" });
      await repo.addAccount(A, { name: "BCA", type: "bank" });
    }

    async function transferCount(userId: number): Promise<number> {
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT COUNT(*) AS n FROM transfers WHERE user_id = ?`, [userId]);
      return Number(rows[0].n);
    }

    it("records a transfer between two accounts, matching names ignoring case", async () => {
      await twoAccounts();
      const t = await repo.transferBetweenAccounts(A, { from: "bca", to: "TUNAI", amount: 100000, date: "2026-03-10", notes: "tarik tunai" });
      expect(t).toMatchObject({ from_account: "BCA", to_account: "Tunai", amount: 100000, notes: "tarik tunai" });
      expect(t.occurred_at.startsWith("2026-03-10")).toBe(true);
    });

    it("leaves income, expense, and balance untouched", async () => {
      await twoAccounts();
      await repo.addTransaction(A, { type: "income", amount: 500000, category: "Gaji", account: "BCA" });
      const before = await repo.getFinanceSummary(A, {});
      const balanceBefore = await repo.getTotalBalance(A, {});

      await repo.transferBetweenAccounts(A, { from: "BCA", to: "Tunai", amount: 100000 });

      const after = await repo.getFinanceSummary(A, {});
      expect(after.totals).toEqual(before.totals);
      expect(after.totals).toMatchObject({ income: 500000, expense: 0, net: 500000 });
      expect(await repo.getTotalBalance(A, {})).toEqual(balanceBefore);
    });

    it("refuses bad transfers and writes nothing", async () => {
      await twoAccounts();
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.addTransaction(A, { type: "expense", amount: 1, category: "Makan", account: "Blu" });
      await repo.removeAccount(A, "Blu");

      const bad = [
        { from: "BCA", to: "bca", amount: 10 },
        { from: "BCA", to: "Dana", amount: 10 },
        { from: "BCA", to: "Tunai", amount: 0 },
        { from: "BCA", to: "Tunai", amount: -5 },
        { from: "Blu", to: "Tunai", amount: 10 },
        { from: "Tunai", to: "Blu", amount: 10 },
      ];
      for (const input of bad) await expect(repo.transferBetweenAccounts(A, input), JSON.stringify(input)).rejects.toThrow();
      expect(await transferCount(A)).toBe(0);
    });

    it("an account whose only history is a transfer is archived, not deleted", async () => {
      await twoAccounts();
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.transferBetweenAccounts(A, { from: "Tunai", to: "Blu", amount: 5000 });
      expect(await repo.removeAccount(A, "Blu")).toEqual({ account: "Blu", result: "archived" });
      expect(await transferCount(A)).toBe(1);
    });

    it("opposite transfers running at once all succeed without deadlock", async () => {
      await twoAccounts();
      const runs = Array.from({ length: 20 }, (_, i) =>
        repo.transferBetweenAccounts(A, i % 2 ? { from: "Tunai", to: "BCA", amount: 1000 } : { from: "BCA", to: "Tunai", amount: 1000 })
      );
      await expect(Promise.all(runs)).resolves.toHaveLength(20);
      expect(await transferCount(A)).toBe(20);
    });

    it("lists newest first and filters by date range and account", async () => {
      await twoAccounts();
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.transferBetweenAccounts(A, { from: "BCA", to: "Tunai", amount: 1, date: "2026-01-05" });
      await repo.transferBetweenAccounts(A, { from: "BCA", to: "Blu", amount: 2, date: "2026-02-05" });
      await repo.transferBetweenAccounts(A, { from: "Tunai", to: "Blu", amount: 3, date: "2026-03-05" });

      expect((await repo.listTransfers(A, {})).map((t) => t.amount)).toEqual([3, 2, 1]);
      expect((await repo.listTransfers(A, { start_date: "2026-02-01", end_date: "2026-02-28" })).map((t) => t.amount)).toEqual([2]);
      expect((await repo.listTransfers(A, { account: "tunai" })).map((t) => t.amount)).toEqual([3, 1]);
    });

    it("deleteTransfer removes the transfer and only the owner can", async () => {
      await twoAccounts();
      const t = await repo.transferBetweenAccounts(A, { from: "BCA", to: "Tunai", amount: 10 });
      expect(await repo.deleteTransfer(B, t.id)).toEqual({ deleted: false, id: t.id });
      expect(await transferCount(A)).toBe(1);
      expect(await repo.deleteTransfer(A, t.id)).toEqual({ deleted: true, id: t.id });
      expect(await transferCount(A)).toBe(0);
    });

    it("another user cannot use my accounts or see my transfers", async () => {
      await twoAccounts();
      await repo.transferBetweenAccounts(A, { from: "BCA", to: "Tunai", amount: 10 });
      await expect(repo.transferBetweenAccounts(B, { from: "BCA", to: "Tunai", amount: 10 })).rejects.toThrow(/not found/);
      expect(await repo.listTransfers(B, {})).toEqual([]);
    });
  });

  describe("balances and reconcile", () => {
    const balances = async (userId: number, includeArchived = false) =>
      Object.fromEntries((await repo.listAccounts(userId, includeArchived)).map((a) => [a.name, a.balance]));

    async function seed() {
      await repo.addAccount(A, { name: "Tunai", type: "cash", opening_balance: 100000 });
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      await repo.addTransaction(A, { type: "income", amount: 500000, category: "Gaji", account: "BCA" });
      await repo.addTransaction(A, { type: "expense", amount: 20000, category: "Makan", account: "Tunai" });
      await repo.transferBetweenAccounts(A, { from: "BCA", to: "Tunai", amount: 100000 });
    }

    it("balance = opening + income - expense + transfers in - transfers out", async () => {
      await seed();
      expect(await balances(A)).toEqual({ Tunai: 180000, BCA: 400000 });
    });

    it("deleting a transfer gives both balances back", async () => {
      await seed();
      const [t] = await repo.listTransfers(A, {});
      await repo.deleteTransfer(A, t.id);
      expect(await balances(A)).toEqual({ Tunai: 80000, BCA: 500000 });
    });

    it("transactions with an unknown account are summed separately", async () => {
      await pool.execute(
        `INSERT INTO transactions (user_id, type, amount, category, account, occurred_at, tags_json) VALUES
         (?, 'expense', 2000, 'Makan', 'bca lama', NOW(3), '[]'), (?, 'income', 3000, 'Gaji', NULL, NOW(3), '[]')`,
        [A, A]
      );
      expect(await repo.getUnknownAccountBalance(A)).toEqual({ balance: 1000, transaction_count: 2 });
    });

    it("account balances plus unknown-account history match overall flow, openings, and adjustments", async () => {
      await seed();
      await pool.execute(
        `INSERT INTO transactions (user_id, type, amount, category, occurred_at, tags_json) VALUES (?, 'expense', 4000, 'Makan', NOW(3), '[]')`,
        [A]
      );
      await repo.reconcileAccount(A, "BCA", 395000);
      await repo.addAccount(A, { name: "Blu", type: "ewallet", opening_balance: 7000 });
      await repo.transferBetweenAccounts(A, { from: "Tunai", to: "Blu", amount: 500 });
      await repo.removeAccount(A, "Blu");

      const accounts = await repo.listAccounts(A, true);
      expect(accounts.map((a) => a.name).sort()).toEqual(["BCA", "Blu", "Tunai"]);
      const grouped = accounts.reduce((sum, a) => sum + a.balance, 0) + (await repo.getUnknownAccountBalance(A)).balance;

      const openings = accounts.reduce((sum, a) => sum + a.opening_balance, 0);
      const [adj] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM account_adjustments WHERE user_id = ?`, [A]
      );
      const overall = (await repo.getTotalBalance(A, {})).balance;
      expect(grouped).toBe(overall + openings + Number(adj[0].total));
    });

    it("total_balance is the sum of the account balances and leaves old history out", async () => {
      await pool.execute(
        `INSERT INTO transactions (user_id, type, amount, category, account, occurred_at, tags_json) VALUES
         (?, 'income', 5000000, 'Gaji', 'BCA', NOW(3), '[]'), (?, 'expense', 1500000, 'Makan', NULL, NOW(3), '[]')`,
        [A, A]
      );
      await repo.addAccount(A, { name: "BCA", type: "bank" });
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.reconcileAccount(A, "BCA", 2000000);
      await repo.reconcileAccount(A, "Blu", 1400000);

      const o = await repo.getAccountOverview(A);
      expect(o.unknown_account).toMatchObject({ balance: 3500000, transaction_count: 2 });
      expect(o.total_balance).toBe(3400000);
    });

    it("with no accounts yet, total_balance falls back to the history instead of reading 0", async () => {
      await pool.execute(
        `INSERT INTO transactions (user_id, type, amount, category, occurred_at, tags_json) VALUES
         (?, 'income', 3000, 'Gaji', NOW(3), '[]'), (?, 'expense', 1000, 'Makan', NOW(3), '[]')`,
        [A, A]
      );
      const o = await repo.getAccountOverview(A);
      expect(o).toMatchObject({ accounts: [], total_balance: 2000, unknown_account: { balance: 2000, transaction_count: 2 } });
    });

    it("an archived account that still holds money stays in total_balance", async () => {
      await repo.addAccount(A, { name: "Tunai", type: "cash", opening_balance: 10000 });
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.transferBetweenAccounts(A, { from: "Tunai", to: "Blu", amount: 4000 });
      expect((await repo.removeAccount(A, "Blu")).result).toBe("archived");

      const o = await repo.getAccountOverview(A);
      expect(o.accounts.map((a) => a.name)).toEqual(["Tunai"]);
      expect(o.total_balance).toBe(10000);
    });

    it("reconcile writes the difference as an adjustment and leaves income and expense alone", async () => {
      await seed();
      const before = await repo.getFinanceSummary(A, {});

      const down = await repo.reconcileAccount(A, "bca", 395000, "selisih m-banking");
      expect(down).toMatchObject({ account: "BCA", balance_before: 400000, balance_after: 395000, difference: -5000 });
      expect(down.adjustment_id).not.toBeNull();
      expect((await balances(A)).BCA).toBe(395000);

      const up = await repo.reconcileAccount(A, "BCA", 396000.5);
      expect(up).toMatchObject({ balance_before: 395000, balance_after: 396000.5, difference: 1000.5 });

      expect((await repo.getFinanceSummary(A, {})).totals).toEqual(before.totals);
    });

    it("reconcile to the same balance writes no adjustment", async () => {
      await seed();
      const res = await repo.reconcileAccount(A, "BCA", 400000);
      expect(res).toMatchObject({ difference: 0, adjustment_id: null });
      const [rows] = await pool.execute<import("mysql2/promise").RowDataPacket[]>(`SELECT COUNT(*) AS n FROM account_adjustments WHERE user_id = ?`, [A]);
      expect(Number(rows[0].n)).toBe(0);
    });

    it("reconcile refuses unknown and archived accounts, and other users' accounts", async () => {
      await seed();
      await repo.addAccount(A, { name: "Blu", type: "ewallet" });
      await repo.transferBetweenAccounts(A, { from: "Tunai", to: "Blu", amount: 1 });
      await repo.removeAccount(A, "Blu");
      await expect(repo.reconcileAccount(A, "Dana", 1)).rejects.toThrow(/not found/);
      await expect(repo.reconcileAccount(A, "Blu", 1)).rejects.toThrow(/archived/);
      await expect(repo.reconcileAccount(B, "BCA", 1)).rejects.toThrow(/not found/);
    });

    it("parallel reconciles never leave the balance off the last reading", async () => {
      await seed();
      await Promise.all([repo.reconcileAccount(A, "BCA", 300000), repo.reconcileAccount(A, "BCA", 300000), repo.reconcileAccount(A, "BCA", 300000)]);
      expect((await balances(A)).BCA).toBe(300000);
    });
  });
});
