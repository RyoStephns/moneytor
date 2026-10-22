import mysql from "mysql2/promise";
import { config } from "./config.js";
import { nowForMysql, parseEndDate, parseInputDate, parseStartDate } from "./time.js";

export type TransactionType = "income" | "expense";

export type Transaction = {
  id: number;
  type: TransactionType;
  amount: string;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  account: string | null;
  account_id: number | null;
  tags: string[];
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AddTransactionInput = {
  type: TransactionType;
  amount: number;
  category: string;
  description?: string;
  date?: string;
  account?: string;
  tags?: string[];
  source?: string;
  notes?: string;
};

export type TransactionFilters = {
  start_date?: string;
  end_date?: string;
  type?: TransactionType;
  category?: string;
  account?: string;
  tag?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
};

export type UpdateTransactionInput = Partial<Omit<AddTransactionInput, "date" | "description" | "account" | "source" | "notes">> & {
  id: number;
  date?: string;
  description?: string | null;
  account?: string | null;
  source?: string | null;
  notes?: string | null;
};

export type SummaryFilters = Omit<TransactionFilters, "tag" | "limit" | "offset"> & {
  period?: "day" | "month";
};

export type BalanceFilters = Pick<TransactionFilters, "start_date" | "end_date" | "account">;

export type AverageFilters = Pick<TransactionFilters, "start_date" | "end_date" | "category" | "account"> & {
  period?: "day" | "month";
};

type MysqlTransactionRow = mysql.RowDataPacket & Omit<Transaction, "tags"> & {
  tags_json: string | string[];
};

type QueryParts = {
  whereSql: string;
  params: SqlParam[];
};

type SqlParam = string | number | null;

export const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  timezone: "Z"
});

export async function closePool(): Promise<void> {
  await pool.end();
}

export async function listCategories(userId: number): Promise<string[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT name FROM categories WHERE user_id = ? ORDER BY name ASC`,
    [userId]
  );
  return rows.map((r) => String(r.name));
}

export async function addCategory(userId: number, name: string): Promise<{ name: string }> {
  const trimmed = name.trim();
  await pool.execute<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO categories (user_id, name) VALUES (?, ?)`,
    [userId, trimmed]
  );
  return { name: trimmed };
}

export async function addTransaction(userId: number, input: AddTransactionInput): Promise<Transaction> {
  const occurredAt = parseInputDate(input.date);
  const tags = normalizeTags(input.tags);

  const [catRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT name FROM categories WHERE user_id = ? AND name = ? LIMIT 1`,
    [userId, input.category]
  );
  const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM categories WHERE user_id = ?`,
    [userId]
  );
  const total = Number(countRows[0]?.total ?? 0);
  if (total > 0 && catRows.length === 0) {
    throw new Error(
      `Unknown category "${input.category}". Use list_categories to see valid options, or add_category to register a new one.`
    );
  }

  const wanted = input.account?.trim();
  const accountId = wanted ? await accountIdByName(userId, wanted) : await defaultAccountId(userId);

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `
      INSERT INTO transactions
        (user_id, type, amount, currency, category, description, occurred_at, account_id, tags_json, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      input.type,
      input.amount,
      config.defaultCurrency,
      input.category,
      input.description ?? null,
      occurredAt,
      accountId,
      JSON.stringify(tags),
      input.source ?? "claude.ai",
      input.notes ?? null
    ]
  );

  return getTransaction(userId, result.insertId);
}

export async function getTransaction(userId: number, id: number): Promise<Transaction> {
  const [rows] = await pool.execute<MysqlTransactionRow[]>(
    `
      SELECT id, type, amount, currency, category, description, occurred_at,
        ${ACCOUNT_NAME_SQL} AS account, account_id,
        tags_json, source, notes, created_at, updated_at
      FROM transactions
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [id, userId]
  );

  if (!rows[0]) {
    throw new Error(`Transaction not found: ${id}`);
  }

  return mapTransaction(rows[0]);
}

export async function listTransactions(userId: number, filters: TransactionFilters): Promise<Transaction[]> {
  const { whereSql, params } = buildWhere(userId, filters);
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const [rows] = await pool.execute<MysqlTransactionRow[]>(
    `
      SELECT id, type, amount, currency, category, description, occurred_at,
        ${ACCOUNT_NAME_SQL} AS account, account_id,
        tags_json, source, notes, created_at, updated_at
      FROM transactions
      ${whereSql}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    params
  );

  return rows.map(mapTransaction);
}

export async function updateTransaction(userId: number, input: UpdateTransactionInput): Promise<Transaction> {
  const updates: string[] = [];
  const params: SqlParam[] = [];

  addUpdate(updates, params, "type", input.type);
  addUpdate(updates, params, "amount", input.amount);
  addUpdate(updates, params, "category", input.category);
  addUpdate(updates, params, "description", input.description);
  addUpdate(updates, params, "occurred_at", input.date ? parseInputDate(input.date) : undefined);
  if (input.account !== undefined) {
    addUpdate(updates, params, "account_id", input.account === null ? null : await accountIdByName(userId, input.account));
    addUpdate(updates, params, "account", null);
  }
  addUpdate(updates, params, "source", input.source);
  addUpdate(updates, params, "notes", input.notes);

  if (input.tags !== undefined) {
    updates.push("tags_json = ?");
    params.push(JSON.stringify(normalizeTags(input.tags)));
  }

  if (updates.length === 0) {
    return getTransaction(userId, input.id);
  }

  updates.push("updated_at = ?");
  params.push(nowForMysql());
  params.push(input.id);
  params.push(userId);

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE transactions SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    throw new Error(`Transaction not found: ${input.id}`);
  }

  return getTransaction(userId, input.id);
}

export async function deleteTransaction(userId: number, id: number): Promise<{ deleted: boolean; id: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>("DELETE FROM transactions WHERE id = ? AND user_id = ?", [id, userId]);
  return { deleted: result.affectedRows > 0, id };
}

export async function deleteTransactions(userId: number, ids: number[]): Promise<{ deleted: number; ids: number[] }> {
  const placeholders = ids.map(() => "?").join(", ");
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`,
    [...ids, userId]
  );
  return { deleted: result.affectedRows, ids };
}

export async function getFinanceSummary(userId: number, filters: SummaryFilters) {
  const { whereSql, params } = buildWhere(userId, filters);
  const periodFormat = filters.period === "day" ? "%Y-%m-%d" : "%Y-%m";

  const [totals] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COUNT(*) AS transaction_count
      FROM transactions
      ${whereSql}
    `,
    params
  );

  const [byCategory] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT category, type, currency, COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS total
      FROM transactions
      ${whereSql}
      GROUP BY category, type, currency
      ORDER BY total DESC
    `,
    params
  );

  const [byAccount] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT account, type, currency,
        COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS total
      FROM (
        SELECT COALESCE(${ACCOUNT_NAME_SQL}, 'uncategorized') AS account, type, currency, amount
        FROM transactions
        ${whereSql}
      ) labeled
      GROUP BY account, type, currency
      ORDER BY total DESC
    `,
    params
  );

  const periodExpression = `DATE_FORMAT(occurred_at, '${periodFormat}')`;
  const [byPeriod] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT ${periodExpression} AS period, type, currency,
        COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS total
      FROM transactions
      ${whereSql}
      GROUP BY ${periodExpression}, type, currency
      ORDER BY period ASC, type ASC
    `,
    params
  );

  const totalIncome = Number(totals[0]?.total_income ?? 0);
  const totalExpense = Number(totals[0]?.total_expense ?? 0);

  return {
    filters: {
      ...filters,
      period: filters.period ?? "month"
    },
    totals: {
      income: totalIncome,
      expense: totalExpense,
      net: totalIncome - totalExpense,
      transaction_count: Number(totals[0]?.transaction_count ?? 0)
    },
    by_category: byCategory,
    by_account: byAccount,
    by_period: byPeriod
  };
}

export async function getTotalBalance(userId: number, filters: BalanceFilters) {
  const { whereSql, params } = buildWhere(userId, filters as TransactionFilters);

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COUNT(*) AS transaction_count
      FROM transactions
      ${whereSql}
    `,
    params
  );

  const totalIncome = Number(rows[0]?.total_income ?? 0);
  const totalExpense = Number(rows[0]?.total_expense ?? 0);

  return {
    filters,
    total_income: totalIncome,
    total_expense: totalExpense,
    balance: totalIncome - totalExpense,
    transaction_count: Number(rows[0]?.transaction_count ?? 0)
  };
}

export async function getAverages(userId: number, filters: AverageFilters) {
  const { whereSql, params } = buildWhere(userId, filters as TransactionFilters);
  const periodFormat = filters.period === "day" ? "%Y-%m-%d" : "%Y-%m";
  const periodExpr = `DATE_FORMAT(occurred_at, '${periodFormat}')`;

  const [byPeriod] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT ${periodExpr} AS period,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS period_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS period_expense,
        COUNT(*) AS transaction_count
      FROM transactions
      ${whereSql}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `,
    params
  );

  const periodCount = byPeriod.length;
  const totalIncome = byPeriod.reduce((s, r) => s + Number(r.period_income), 0);
  const totalExpense = byPeriod.reduce((s, r) => s + Number(r.period_expense), 0);

  return {
    filters: { ...filters, period: filters.period ?? "month" },
    period_count: periodCount,
    average_income: periodCount > 0 ? totalIncome / periodCount : 0,
    average_expense: periodCount > 0 ? totalExpense / periodCount : 0,
    average_net: periodCount > 0 ? (totalIncome - totalExpense) / periodCount : 0,
    by_period: byPeriod.map((r) => ({
      period: r.period,
      income: Number(r.period_income),
      expense: Number(r.period_expense),
      net: Number(r.period_income) - Number(r.period_expense),
      transaction_count: Number(r.transaction_count)
    }))
  };
}

function buildWhere(userId: number, filters: TransactionFilters): QueryParts {
  const clauses: string[] = ["user_id = ?"];
  const params: SqlParam[] = [userId];

  addClause(clauses, params, "occurred_at >= ?", parseStartDate(filters.start_date));
  addClause(clauses, params, "occurred_at <= ?", parseEndDate(filters.end_date));
  addClause(clauses, params, "type = ?", filters.type);
  addClause(clauses, params, "category = ?", filters.category);

  if (filters.account) {
    clauses.push("(account_id IN (SELECT id FROM accounts WHERE user_id = ? AND name = ?) OR account = ?)");
    params.push(userId, filters.account, filters.account);
  }

  if (filters.tag) {
    clauses.push("JSON_CONTAINS(tags_json, JSON_QUOTE(?), '$')");
    params.push(filters.tag);
  }

  if (filters.keyword) {
    const like = `%${filters.keyword}%`;
    clauses.push("(description LIKE ? OR notes LIKE ?)");
    params.push(like, like);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function addClause(clauses: string[], params: SqlParam[], sql: string, value: SqlParam | undefined): void {
  if (value === undefined) {
    return;
  }

  clauses.push(sql);
  params.push(value);
}

function addUpdate(updates: string[], params: SqlParam[], column: string, value: SqlParam | undefined): void {
  if (value === undefined) {
    return;
  }

  updates.push(`${column} = ?`);
  params.push(value);
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().substring(0, 10);
  return String(val).substring(0, 10);
}

function mapTransaction(row: MysqlTransactionRow): Transaction {
  const rawTags = row.tags_json;
  const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(rawTags);

  return {
    id: Number(row.id),
    type: row.type,
    amount: String(row.amount),
    currency: row.currency,
    category: row.category,
    description: row.description,
    occurred_at: String(row.occurred_at),
    account: row.account,
    account_id: row.account_id === null ? null : Number(row.account_id),
    tags,
    source: row.source,
    notes: row.notes,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export type BudgetType = "spending" | "saving";
export type PayPeriodStatus = "estimated" | "active" | "closed";

export type PayPeriod = {
  id: number;
  period_start: string;
  period_end: string | null;
  salary_amount: number;
  salary_txn_id: number | null;
  status: PayPeriodStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PayPeriodWithDays = PayPeriod & {
  days_elapsed: number;
  days_total: number | null;
  days_remaining: number | null;
};

export type BudgetGroup = {
  id: number;
  pay_period_id: number;
  name: string;
  amount: number;
  budget_type: BudgetType;
  categories: string[];
};

export type GroupInput = {
  name: string;
  amount: number;
  budget_type?: BudgetType;
  categories: string[];
};

export type BudgetTemplate = {
  id: number;
  name: string;
  groups: GroupInput[];
  created_at: string;
  updated_at: string;
};

export type InputTransaction = {
  category: string;
  amount: number;
  type: "income" | "expense";
  occurred_at: string;
};

function budgetComputeDays(
  period_start: string,
  period_end: string | null
): { days_elapsed: number; days_total: number | null; days_remaining: number | null } {
  const start = new Date(period_start + "T00:00:00");
  const today = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  let days_elapsed = Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);

  if (!period_end) return { days_elapsed, days_total: null, days_remaining: null };

  const end = new Date(period_end + "T00:00:00");
  const days_total = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  const effective = Math.min(days_elapsed, days_total);
  return { days_elapsed: effective, days_total, days_remaining: days_total - effective };
}

function mapPayPeriodRow(row: mysql.RowDataPacket): PayPeriod {
  return {
    id: Number(row.id),
    period_start: toDateString(row.period_start),
    period_end: row.period_end ? toDateString(row.period_end) : null,
    salary_amount: Number(row.salary_amount),
    salary_txn_id: row.salary_txn_id != null ? Number(row.salary_txn_id) : null,
    status: row.status as PayPeriodStatus,
    notes: row.notes as string | null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

async function upsertBudgetGroupInConn(
  conn: mysql.PoolConnection,
  userId: number,
  pay_period_id: number,
  group: GroupInput
): Promise<number> {
  await conn.execute(
    `INSERT INTO budget_groups (user_id, pay_period_id, name, amount, budget_type)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE amount = VALUES(amount), budget_type = VALUES(budget_type), updated_at = NOW()`,
    [userId, pay_period_id, group.name, group.amount, group.budget_type ?? "spending"]
  );

  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM budget_groups WHERE pay_period_id = ? AND name = ? AND user_id = ? LIMIT 1`,
    [pay_period_id, group.name, userId]
  );
  if (rows.length === 0) throw new Error(`Budget group not found after upsert (pay_period_id=${pay_period_id}, name=${group.name})`);
  const groupId = Number(rows[0].id);

  await conn.execute(`DELETE FROM budget_group_categories WHERE budget_group_id = ?`, [groupId]);

  if (group.categories.length > 0) {
    const placeholders = group.categories.map(() => "(?, ?)").join(", ");
    await conn.execute(
      `INSERT INTO budget_group_categories (budget_group_id, category) VALUES ${placeholders}`,
      group.categories.flatMap((cat) => [groupId, cat])
    );
  }

  return groupId;
}

async function fetchBudgetGroupsWithCategories(userId: number, pay_period_id: number): Promise<BudgetGroup[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT bg.id, bg.pay_period_id, bg.name, bg.amount, bg.budget_type, bgc.category
     FROM budget_groups bg
     LEFT JOIN budget_group_categories bgc ON bgc.budget_group_id = bg.id
     WHERE bg.pay_period_id = ? AND bg.user_id = ?
     ORDER BY bg.id, bgc.category`,
    [pay_period_id, userId]
  );

  const map = new Map<number, BudgetGroup>();
  for (const row of rows) {
    const id = Number(row.id);
    if (!map.has(id)) {
      map.set(id, {
        id,
        pay_period_id: Number(row.pay_period_id),
        name: String(row.name),
        amount: Number(row.amount),
        budget_type: row.budget_type as BudgetType,
        categories: [],
      });
    }
    if (row.category) map.get(id)!.categories.push(String(row.category));
  }

  return Array.from(map.values());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupMetrics(
  group: BudgetGroup,
  expenseByCategory: Map<string, number>,
  days_elapsed: number,
  days_total: number | null
) {
  const actual_amount = round2(group.categories.reduce((s, c) => s + (expenseByCategory.get(c) ?? 0), 0));
  const remaining = round2(group.amount - actual_amount);
  const pct_used = round2(group.amount > 0 ? (actual_amount / group.amount) * 100 : 0);
  const status: "ok" | "warning" | "over" = pct_used <= 80 ? "ok" : pct_used <= 100 ? "warning" : "over";
  const burn_rate = round2(days_elapsed > 0 ? actual_amount / days_elapsed : 0);
  const projected_total = days_total != null ? round2(burn_rate * days_total) : null;
  const projected_status: "ok" | "warning" | "over" | null =
    projected_total != null && group.amount > 0
      ? (projected_total / group.amount) * 100 <= 80 ? "ok"
        : (projected_total / group.amount) * 100 <= 100 ? "warning" : "over"
      : null;
  return { actual_amount, remaining, pct_used, status, burn_rate, projected_total, projected_status };
}

// Pay Period

export async function createPayPeriod(userId: number, input: {
  period_start: string;
  salary_amount: number;
  salary_txn_id?: number;
  notes?: string;
}): Promise<PayPeriod> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO pay_periods (user_id, period_start, salary_amount, salary_txn_id, notes) VALUES (?, ?, ?, ?, ?)`,
    [userId, input.period_start, input.salary_amount, input.salary_txn_id ?? null, input.notes ?? null]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? AND user_id = ? LIMIT 1`, [result.insertId, userId]);
  return mapPayPeriodRow(rows[0]);
}

export async function closePayPeriod(userId: number, period_id: number, period_end: string): Promise<PayPeriod> {
  await pool.execute(
    `UPDATE pay_periods SET period_end = ?, status = 'closed', updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [period_end, period_id, userId]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? AND user_id = ? LIMIT 1`, [period_id, userId]);
  if (rows.length === 0) throw new Error(`Pay period ${period_id} not found`);
  return mapPayPeriodRow(rows[0]);
}

export async function getCurrentPeriod(userId: number): Promise<PayPeriodWithDays | null> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM pay_periods WHERE user_id = ? AND status IN ('active','estimated') ORDER BY period_start DESC LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;
  const p = mapPayPeriodRow(rows[0]);
  return { ...p, ...budgetComputeDays(p.period_start, p.period_end) };
}

export async function listPayPeriods(userId: number, limit = 6): Promise<PayPeriodWithDays[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM pay_periods WHERE user_id = ? ORDER BY period_start DESC LIMIT ${Number(limit)}`, [userId]
  );
  return rows.map((row) => {
    const p = mapPayPeriodRow(row);
    return { ...p, ...budgetComputeDays(p.period_start, p.period_end) };
  });
}

// Budget Group

// Throws "not found" (never "forbidden") if the pay period doesn't exist OR
// belongs to another user — never leak existence across tenants.
async function assertPayPeriodOwned(userId: number, pay_period_id: number): Promise<void> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM pay_periods WHERE id = ? AND user_id = ? LIMIT 1`,
    [pay_period_id, userId]
  );
  if (rows.length === 0) throw new Error(`Pay period ${pay_period_id} not found`);
}

export async function setBudgetGroupsBulk(
  userId: number,
  pay_period_id: number,
  groups: GroupInput[],
  replace_all = false
): Promise<{ group_ids: number[] }> {
  await assertPayPeriodOwned(userId, pay_period_id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (replace_all) {
      await conn.execute(`DELETE FROM budget_groups WHERE pay_period_id = ? AND user_id = ?`, [pay_period_id, userId]);
    }
    const group_ids: number[] = [];
    for (const g of groups) group_ids.push(await upsertBudgetGroupInConn(conn, userId, pay_period_id, g));
    await conn.commit();
    return { group_ids };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function setBudgetGroup(userId: number, pay_period_id: number, input: GroupInput): Promise<{ group_id: number }> {
  const { group_ids } = await setBudgetGroupsBulk(userId, pay_period_id, [input]);
  return { group_id: group_ids[0] };
}

export async function getBudgetGroups(userId: number, pay_period_id: number): Promise<BudgetGroup[]> {
  return fetchBudgetGroupsWithCategories(userId, pay_period_id);
}

export async function deleteBudgetGroup(userId: number, group_id: number): Promise<{ deleted: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(`DELETE FROM budget_groups WHERE id = ? AND user_id = ?`, [group_id, userId]);
  return { deleted: result.affectedRows };
}

// Budget Summary

export async function getBudgetSummary(userId: number, pay_period_id: number, transactions: InputTransaction[]) {
  const [pRows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? AND user_id = ? LIMIT 1`, [pay_period_id, userId]);
  if (pRows.length === 0) throw new Error(`Pay period ${pay_period_id} not found`);
  const period = mapPayPeriodRow(pRows[0]);

  const groups = await fetchBudgetGroupsWithCategories(userId, pay_period_id);
  const { days_elapsed, days_total, days_remaining } = budgetComputeDays(period.period_start, period.period_end);

  const allMapped = new Set(groups.flatMap((g) => g.categories));
  const expenseByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type === "expense") expenseByCategory.set(t.category, (expenseByCategory.get(t.category) ?? 0) + t.amount);
  }

  const groupResults = groups.map((g) => ({
    group_id: g.id,
    name: g.name,
    budget_type: g.budget_type,
    categories: g.categories,
    budget_amount: g.amount,
    ...groupMetrics(g, expenseByCategory, days_elapsed, days_total),
  }));

  const unbudgetedMap = new Map<string, number>();
  for (const [cat, amt] of expenseByCategory) {
    if (!allMapped.has(cat)) unbudgetedMap.set(cat, amt);
  }
  const unbudgeted_total = round2(Array.from(unbudgetedMap.values()).reduce((s, v) => s + v, 0));
  const total_actual = round2(Array.from(expenseByCategory.values()).reduce((s, v) => s + v, 0));

  return {
    period_info: {
      period_start: period.period_start,
      period_end: period.period_end,
      days_elapsed,
      days_total,
      days_remaining,
      salary_amount: period.salary_amount,
      total_budget_spending: round2(groups.filter((g) => g.budget_type === "spending").reduce((s, g) => s + g.amount, 0)),
      total_budget_saving: round2(groups.filter((g) => g.budget_type === "saving").reduce((s, g) => s + g.amount, 0)),
      total_actual,
      total_remaining: round2(groups.filter((g) => g.budget_type === "spending").reduce((s, g) => s + g.amount, 0) - total_actual),
    },
    groups: groupResults,
    unbudgeted: {
      categories: Array.from(unbudgetedMap.entries()).map(([category, amount]) => ({ category, amount: round2(amount) })),
      total_amount: unbudgeted_total,
    },
  };
}

export async function getGroupDetail(userId: number, pay_period_id: number, budget_group_id: number, transactions: InputTransaction[]) {
  const groups = await fetchBudgetGroupsWithCategories(userId, pay_period_id);
  const group = groups.find((g) => g.id === budget_group_id);
  if (!group) throw new Error(`Budget group ${budget_group_id} not found in period ${pay_period_id}`);

  const txns = transactions.filter((t) => t.type === "expense" && group.categories.includes(t.category));
  const actual_amount = round2(txns.reduce((s, t) => s + t.amount, 0));
  const remaining = round2(group.amount - actual_amount);
  const pct_used = round2(group.amount > 0 ? (actual_amount / group.amount) * 100 : 0);

  return {
    group: {
      id: group.id,
      name: group.name,
      budget_type: group.budget_type,
      categories: group.categories,
      budget_amount: group.amount,
      actual_amount,
      remaining,
      pct_used,
      status: pct_used <= 80 ? "ok" : pct_used <= 100 ? "warning" : "over",
    },
    transactions: txns,
  };
}

// Template

export async function saveBudgetTemplate(userId: number, name: string, groups: GroupInput[]): Promise<BudgetTemplate> {
  await pool.execute(
    `INSERT INTO budget_templates (user_id, name, groups_json) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE groups_json = VALUES(groups_json), updated_at = NOW()`,
    [userId, name, JSON.stringify(groups)]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates WHERE name = ? AND user_id = ? LIMIT 1`, [name, userId]);
  return mapTemplateRow(rows[0]);
}

export async function listBudgetTemplates(userId: number): Promise<BudgetTemplate[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates WHERE user_id = ? ORDER BY name`, [userId]);
  return rows.map(mapTemplateRow);
}

export async function deleteBudgetTemplate(userId: number, template_id: number): Promise<{ deleted: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(`DELETE FROM budget_templates WHERE id = ? AND user_id = ?`, [template_id, userId]);
  return { deleted: result.affectedRows };
}

export async function applyBudgetTemplate(userId: number, pay_period_id: number, template_id: number): Promise<{ applied: number }> {
  await assertPayPeriodOwned(userId, pay_period_id);
  const [tRows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates WHERE id = ? AND user_id = ? LIMIT 1`, [template_id, userId]);
  if (tRows.length === 0) throw new Error(`Template ${template_id} not found`);

  const groups: GroupInput[] = typeof tRows[0].groups_json === "string"
    ? JSON.parse(tRows[0].groups_json) as GroupInput[]
    : tRows[0].groups_json as GroupInput[];

  if (groups.length === 0) throw new Error(`Template ${template_id} has no groups — refusing to wipe pay period`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM budget_groups WHERE pay_period_id = ? AND user_id = ?`, [pay_period_id, userId]);
    for (const g of groups) await upsertBudgetGroupInConn(conn, userId, pay_period_id, g);
    await conn.commit();
    return { applied: groups.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

function mapTemplateRow(row: mysql.RowDataPacket): BudgetTemplate {
  return {
    id: Number(row.id),
    name: String(row.name),
    groups: typeof row.groups_json === "string" ? JSON.parse(row.groups_json) as GroupInput[] : row.groups_json as GroupInput[],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// Accounts

export type AccountType = "cash" | "bank" | "ewallet" | "other";

export type Account = {
  id: number;
  name: string;
  type: AccountType;
  description: string | null;
  opening_balance: number;
  is_default: boolean;
  archived: boolean;
  created_at: string;
};

export type AddAccountInput = {
  name: string;
  type: AccountType;
  description?: string;
  opening_balance?: number;
};

export type UpdateAccountInput = {
  new_name?: string;
  type?: AccountType;
  description?: string | null;
};

const ACCOUNT_COLS = "id, name, type, description, opening_balance, is_default, archived_at, created_at";

// Balance is never stored: opening balance plus everything that touched the account.
const ACCOUNT_BALANCE_SQL = `(
  accounts.opening_balance
  + COALESCE((SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END)
      FROM transactions WHERE account_id = accounts.id AND user_id = accounts.user_id), 0)
  + COALESCE((SELECT SUM(amount) FROM transfers WHERE to_account_id = accounts.id AND user_id = accounts.user_id), 0)
  - COALESCE((SELECT SUM(amount) FROM transfers WHERE from_account_id = accounts.id AND user_id = accounts.user_id), 0)
  + COALESCE((SELECT SUM(amount) FROM account_adjustments WHERE account_id = accounts.id AND user_id = accounts.user_id), 0)
  - COALESCE((SELECT SUM(amount) FROM receivables WHERE account_id = accounts.id AND user_id = accounts.user_id), 0)
  + COALESCE((SELECT SUM(amount) FROM receivables WHERE settled_account_id = accounts.id AND user_id = accounts.user_id), 0)
)`;

export type AccountWithBalance = Account & { balance: number };

function mapAccount(row: mysql.RowDataPacket): Account {
  return {
    id: Number(row.id),
    name: String(row.name),
    type: row.type,
    description: row.description,
    opening_balance: Number(row.opening_balance),
    is_default: row.is_default === 1,
    archived: row.archived_at !== null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function isNameTaken(e: unknown): boolean {
  const err = e as { errno?: number; message?: string };
  return err.errno === 1062 && String(err.message).includes("uq_accounts_user_name");
}

async function requireAccount(userId: number, name: string): Promise<Account> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${ACCOUNT_COLS} FROM accounts WHERE user_id = ? AND name = ? LIMIT 1`,
    [userId, name.trim()]
  );
  if (rows.length === 0) {
    const names = (await listAccounts(userId)).map((a) => a.name);
    const known = names.length ? `Registered accounts: ${names.join(", ")}.` : "No accounts registered yet.";
    throw new Error(`Account "${name}" not found. ${known} Use add_account to create a new one.`);
  }
  return mapAccount(rows[0]);
}

export async function listAccounts(userId: number, includeArchived = false): Promise<AccountWithBalance[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${ACCOUNT_COLS}, ${ACCOUNT_BALANCE_SQL} AS balance FROM accounts WHERE user_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY is_default DESC, name ASC`,
    [userId]
  );
  return rows.map((r) => ({ ...mapAccount(r), balance: Number(r.balance) }));
}

export async function addAccount(userId: number, input: AddAccountInput): Promise<Account> {
  const name = input.name.trim();
  try {
    await pool.execute(
      `
        INSERT INTO accounts (user_id, name, type, description, opening_balance, is_default)
        SELECT ?, ?, ?, ?, ?, NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND is_default = 1)
      `,
      [userId, name, input.type, input.description ?? null, input.opening_balance ?? 0, userId]
    );
  } catch (e) {
    if (isNameTaken(e)) throw new Error(`Account "${name}" already exists.`);
    throw e;
  }
  return requireAccount(userId, name);
}

export async function updateAccount(userId: number, name: string, input: UpdateAccountInput): Promise<Account> {
  const acc = await requireAccount(userId, name);
  const newName = input.new_name?.trim();
  const updates: string[] = [];
  const params: SqlParam[] = [];

  addUpdate(updates, params, "name", newName);
  addUpdate(updates, params, "type", input.type);
  addUpdate(updates, params, "description", input.description);

  if (updates.length === 0) return acc;

  params.push(acc.id, userId);
  try {
    await pool.execute(`UPDATE accounts SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`, params);
  } catch (e) {
    if (isNameTaken(e)) throw new Error(`Account "${newName}" already exists.`);
    throw e;
  }
  return requireAccount(userId, newName ?? acc.name);
}

export async function setDefaultAccount(userId: number, name: string): Promise<Account> {
  const acc = await requireAccount(userId, name);
  if (acc.archived) throw new Error(`Account "${acc.name}" is archived and cannot be the default.`);
  if (acc.is_default) return acc;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`UPDATE accounts SET is_default = 0 WHERE user_id = ? AND is_default = 1`, [userId]);
    await conn.execute(`UPDATE accounts SET is_default = 1 WHERE id = ? AND user_id = ?`, [acc.id, userId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { ...acc, is_default: true };
}

// Deletes only when the account has no history. The FKs from transfers and
// adjustments cascade, so the check and the delete share one locked transaction.
// Receivables count as history too, so an account with debts attached gets archived.
export async function removeAccount(userId: number, name: string): Promise<{ account: string; result: "deleted" | "archived" }> {
  const acc = await requireAccount(userId, name);
  if (acc.is_default) {
    throw new Error(`Account "${acc.name}" is the default. Use set_default_account to pick another default first.`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`SELECT id FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE`, [acc.id, userId]);
    const [used] = await conn.execute<mysql.RowDataPacket[]>(
      `
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND account_id = ?) +
          (SELECT COUNT(*) FROM transfers WHERE user_id = ? AND (from_account_id = ? OR to_account_id = ?)) +
          (SELECT COUNT(*) FROM account_adjustments WHERE user_id = ? AND account_id = ?) +
          (SELECT COUNT(*) FROM receivables WHERE user_id = ? AND (account_id = ? OR settled_account_id = ?)) AS used
      `,
      [userId, acc.id, userId, acc.id, acc.id, userId, acc.id, userId, acc.id, acc.id]
    );

    const hasHistory = Number(used[0].used) > 0;
    if (!hasHistory) {
      await conn.execute(`DELETE FROM accounts WHERE id = ? AND user_id = ?`, [acc.id, userId]);
    } else if (!acc.archived) {
      await conn.execute(`UPDATE accounts SET archived_at = ? WHERE id = ? AND user_id = ?`, [nowForMysql(), acc.id, userId]);
    }
    await conn.commit();
    return { account: acc.name, result: hasHistory ? "archived" : "deleted" };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// transactions.account holds free text from before accounts existed, so reads
// prefer the linked account's current name and fall back to that text.
const ACCOUNT_NAME_SQL =
  "COALESCE((SELECT a.name FROM accounts a WHERE a.id = transactions.account_id AND a.user_id = transactions.user_id), transactions.account)";

async function accountIdByName(userId: number, name: string): Promise<number> {
  const acc = await requireAccount(userId, name);
  if (acc.archived) throw new Error(`Account "${acc.name}" is archived. Pick an active account or add a new one.`);
  return acc.id;
}

// A user with no accounts yet keeps recording without one.
async function defaultAccountId(userId: number): Promise<number | null> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM accounts WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    [userId]
  );
  return rows.length ? Number(rows[0].id) : null;
}

// Transfers

export type Transfer = {
  id: number;
  from_account: string;
  to_account: string;
  amount: number;
  occurred_at: string;
  notes: string | null;
  created_at: string;
};

export type TransferInput = {
  from: string;
  to: string;
  amount: number;
  date?: string;
  notes?: string;
};

export type TransferFilters = {
  start_date?: string;
  end_date?: string;
  account?: string;
  limit?: number;
  offset?: number;
};

const TRANSFER_COLS = "t.id, fa.name AS from_account, ta.name AS to_account, t.amount, t.occurred_at, t.notes, t.created_at";
const TRANSFER_FROM =
  "FROM transfers t JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = t.user_id JOIN accounts ta ON ta.id = t.to_account_id AND ta.user_id = t.user_id";

function mapTransfer(row: mysql.RowDataPacket): Transfer {
  return {
    id: Number(row.id),
    from_account: String(row.from_account),
    to_account: String(row.to_account),
    amount: Number(row.amount),
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    notes: row.notes,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function transferBetweenAccounts(userId: number, input: TransferInput): Promise<Transfer> {
  if (!(input.amount > 0)) throw new Error("Transfer amount must be greater than zero.");
  const from = await requireAccount(userId, input.from);
  const to = await requireAccount(userId, input.to);
  if (from.id === to.id) throw new Error(`Cannot transfer from "${from.name}" to itself.`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // One lock per statement, lowest id first. A single IN (?, ?) query locks in
    // whatever order the optimizer scans, and two opposite transfers deadlocked on it.
    // Locking first also means the archived check sees rows nobody can change.
    const locked: mysql.RowDataPacket[] = [];
    for (const id of [from.id, to.id].sort((a, b) => a - b)) {
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT name, archived_at FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE`,
        [id, userId]
      );
      locked.push(...rows);
    }
    const archived = locked.find((a) => a.archived_at !== null);
    if (archived) throw new Error(`Account "${archived.name}" is archived. Transfers need two active accounts.`);

    const [res] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, occurred_at, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, from.id, to.id, input.amount, parseInputDate(input.date), input.notes ?? null]
    );
    await conn.commit();
    return getTransfer(userId, res.insertId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function getTransfer(userId: number, id: number): Promise<Transfer> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${TRANSFER_COLS} ${TRANSFER_FROM} WHERE t.id = ? AND t.user_id = ? LIMIT 1`,
    [id, userId]
  );
  if (rows.length === 0) throw new Error(`Transfer not found: ${id}`);
  return mapTransfer(rows[0]);
}

export async function listTransfers(userId: number, filters: TransferFilters): Promise<Transfer[]> {
  const clauses: string[] = ["t.user_id = ?"];
  const params: SqlParam[] = [userId];

  addClause(clauses, params, "t.occurred_at >= ?", parseStartDate(filters.start_date));
  addClause(clauses, params, "t.occurred_at <= ?", parseEndDate(filters.end_date));
  if (filters.account) {
    clauses.push("(fa.name = ? OR ta.name = ?)");
    params.push(filters.account, filters.account);
  }

  const whereSql = `WHERE ${clauses.join(" AND ")}`;
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${TRANSFER_COLS} ${TRANSFER_FROM} ${whereSql} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return rows.map(mapTransfer);
}

export async function deleteTransfer(userId: number, id: number): Promise<{ deleted: boolean; id: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(`DELETE FROM transfers WHERE id = ? AND user_id = ?`, [id, userId]);
  return { deleted: result.affectedRows > 0, id };
}

// Transactions whose account is unknown: everything recorded before accounts existed.
export async function getUnknownAccountBalance(userId: number): Promise<{ balance: number; transaction_count: number }> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS balance, COUNT(*) AS n
      FROM transactions
      WHERE user_id = ? AND account_id IS NULL
    `,
    [userId]
  );
  return { balance: Number(rows[0].balance), transaction_count: Number(rows[0].n) };
}

export type ReconcileResult = {
  account: string;
  balance_before: number;
  balance_after: number;
  difference: number;
  adjustment_id: number | null;
};

// The actual balance is a reading of right now, so the adjustment is stamped now.
export async function reconcileAccount(userId: number, name: string, actualBalance: number, notes?: string): Promise<ReconcileResult> {
  const acc = await requireAccount(userId, name);
  if (acc.archived) throw new Error(`Account "${acc.name}" is archived. Pick an active account.`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The lock stops a new transaction or transfer landing between reading the balance and writing the adjustment.
    await conn.execute(`SELECT id FROM accounts WHERE id = ? AND user_id = ? FOR UPDATE`, [acc.id, userId]);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT ${ACCOUNT_BALANCE_SQL} AS balance FROM accounts WHERE id = ? AND user_id = ?`,
      [acc.id, userId]
    );
    const before = Number(rows[0].balance);
    const difference = round2(actualBalance - before);

    let adjustmentId: number | null = null;
    if (difference !== 0) {
      const [res] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO account_adjustments (user_id, account_id, amount, occurred_at, notes) VALUES (?, ?, ?, ?, ?)`,
        [userId, acc.id, difference, nowForMysql(), notes ?? null]
      );
      adjustmentId = res.insertId;
    }
    await conn.commit();
    return { account: acc.name, balance_before: before, balance_after: round2(before + difference), difference, adjustment_id: adjustmentId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getAccountOverview(userId: number, includeArchived = false) {
  const all = await listAccounts(userId, true);
  const unknown = await getUnknownAccountBalance(userId);
  // Reconciled account balances already hold the same money the old history adds up to,
  // so the history stays out of the total. With no accounts yet it is all there is.
  const total = all.length ? all.reduce((sum, a) => sum + a.balance, 0) : unknown.balance;
  return {
    default_account: all.find((a) => a.is_default)?.name ?? null,
    accounts: includeArchived ? all : all.filter((a) => !a.archived),
    unknown_account: {
      ...unknown,
      note: "History recorded before accounts were used, source account unknown. Informational only: not part of total_balance."
    },
    total_balance: round2(total),
  };
}

// Receivables: money fronted for someone else. It moves account balances but is
// neither expense nor income, so it lives outside transactions and every report ignores it.

export type ReceivableStatus = "open" | "settled";

export type Receivable = {
  id: number;
  borrower: string;
  amount: number;
  account: string;
  occurred_at: string;
  notes: string | null;
  status: ReceivableStatus;
  settled_at: string | null;
  settled_account: string | null;
  created_at: string;
};

export type ReceivableInput = {
  borrower: string;
  amount: number;
  account?: string;
  date?: string;
  notes?: string;
};

export type UpdateReceivableInput = {
  borrower?: string;
  amount?: number;
  account?: string;
  date?: string;
  notes?: string | null;
};

export type ReceivableFilters = {
  status?: ReceivableStatus | "all";
  borrower?: string;
  account?: string;
  limit?: number;
  offset?: number;
};

const RECEIVABLE_COLS =
  "r.id, r.borrower, r.amount, a.name AS account, r.occurred_at, r.notes, r.status, r.settled_at, sa.name AS settled_account, r.created_at";
const RECEIVABLE_FROM =
  "FROM receivables r JOIN accounts a ON a.id = r.account_id AND a.user_id = r.user_id LEFT JOIN accounts sa ON sa.id = r.settled_account_id AND sa.user_id = r.user_id";

function mapReceivable(row: mysql.RowDataPacket): Receivable {
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
  return {
    id: Number(row.id),
    borrower: String(row.borrower),
    amount: Number(row.amount),
    account: String(row.account),
    occurred_at: iso(row.occurred_at),
    notes: row.notes,
    status: row.status,
    settled_at: row.settled_at === null ? null : iso(row.settled_at),
    settled_account: row.settled_account,
    created_at: iso(row.created_at),
  };
}

async function getReceivable(userId: number, id: number): Promise<Receivable> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${RECEIVABLE_COLS} ${RECEIVABLE_FROM} WHERE r.id = ? AND r.user_id = ? LIMIT 1`,
    [id, userId]
  );
  if (rows.length === 0) throw new Error(`Receivable not found: ${id}`);
  return mapReceivable(rows[0]);
}

export async function createReceivable(userId: number, input: ReceivableInput): Promise<Receivable> {
  if (!(input.amount > 0)) throw new Error("Receivable amount must be greater than zero.");
  const wanted = input.account?.trim();
  const accountId = wanted ? await accountIdByName(userId, wanted) : await defaultAccountId(userId);
  if (!accountId) throw new Error("No account to take the money from. Pass an account, or add one with add_account.");

  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO receivables (user_id, borrower, amount, account_id, occurred_at, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, input.borrower.trim(), input.amount, accountId, parseInputDate(input.date), input.notes ?? null]
  );
  return getReceivable(userId, res.insertId);
}

export async function settleReceivable(userId: number, id: number, input: { account?: string; date?: string }): Promise<Receivable> {
  const wanted = input.account?.trim();
  const accountId = wanted ? await accountIdByName(userId, wanted) : await defaultAccountId(userId);
  if (!accountId) throw new Error("No account to receive the money. Pass an account, or set a default with set_default_account.");

  const [res] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE receivables SET status = 'settled', settled_at = ?, settled_account_id = ? WHERE id = ? AND user_id = ? AND status = 'open'`,
    [parseInputDate(input.date), accountId, id, userId]
  );
  const rec = await getReceivable(userId, id);
  if (res.affectedRows === 0) throw new Error(`Receivable ${id} (${rec.borrower}) is already settled.`);
  return rec;
}

export async function listReceivables(userId: number, filters: ReceivableFilters) {
  const clauses: string[] = ["r.user_id = ?"];
  const params: SqlParam[] = [userId];

  addClause(clauses, params, "r.borrower = ?", filters.borrower?.trim());
  // either side counts: where the money left or where it came back to
  if (filters.account) {
    clauses.push("(a.name = ? OR sa.name = ?)");
    params.push(filters.account, filters.account);
  }
  const baseWhere = clauses.join(" AND ");

  const status = filters.status ?? "open";
  const listWhere = status === "all" ? baseWhere : `${baseWhere} AND r.status = '${status}'`;
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT ${RECEIVABLE_COLS} ${RECEIVABLE_FROM} WHERE ${listWhere} ORDER BY r.occurred_at DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  // outstanding ignores the status/limit filters: it is always what is still owed
  const [owed] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT r.borrower, COUNT(*) AS n, SUM(r.amount) AS total ${RECEIVABLE_FROM} WHERE ${baseWhere} AND r.status = 'open' GROUP BY r.borrower ORDER BY total DESC`,
    params
  );
  const byBorrower = owed.map((o) => ({ borrower: String(o.borrower), count: Number(o.n), total: Number(o.total) }));

  return {
    receivables: rows.map(mapReceivable),
    outstanding_total: round2(byBorrower.reduce((s, b) => s + b.total, 0)),
    outstanding_by_borrower: byBorrower,
  };
}

export async function updateReceivable(userId: number, id: number, input: UpdateReceivableInput): Promise<Receivable> {
  const rec = await getReceivable(userId, id);
  const moneyChange = input.amount !== undefined || input.account !== undefined;
  if (moneyChange && rec.status === "settled") {
    throw new Error(`Receivable ${id} is already settled. Only borrower, date and notes can change now.`);
  }
  if (input.amount !== undefined && !(input.amount > 0)) throw new Error("Receivable amount must be greater than zero.");

  const updates: string[] = [];
  const params: SqlParam[] = [];
  addUpdate(updates, params, "borrower", input.borrower?.trim());
  addUpdate(updates, params, "amount", input.amount);
  addUpdate(updates, params, "account_id", input.account ? await accountIdByName(userId, input.account) : undefined);
  addUpdate(updates, params, "occurred_at", input.date ? parseInputDate(input.date) : undefined);
  addUpdate(updates, params, "notes", input.notes);

  if (updates.length === 0) return rec;

  params.push(id, userId);
  await pool.execute(`UPDATE receivables SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`, params);
  return getReceivable(userId, id);
}

export async function deleteReceivable(userId: number, id: number): Promise<{ deleted: boolean; id: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(`DELETE FROM receivables WHERE id = ? AND user_id = ?`, [id, userId]);
  return { deleted: result.affectedRows > 0, id };
}
