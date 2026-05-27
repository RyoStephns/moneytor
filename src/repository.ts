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

export type RecurringTransaction = {
  id: number;
  type: TransactionType;
  amount: string;
  currency: string;
  category: string;
  description: string | null;
  account: string | null;
  tags: string[];
  source: string | null;
  notes: string | null;
  interval_months: number;
  day_of_month: number;
  next_due_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RegisterRecurringInput = {
  type: TransactionType;
  amount: number;
  category: string;
  description?: string;
  account?: string;
  tags?: string[];
  source?: string;
  notes?: string;
  interval_months?: number;
  day_of_month: number;
  start_date?: string;
};

type MysqlTransactionRow = mysql.RowDataPacket & Omit<Transaction, "tags"> & {
  tags_json: string | string[];
};

type MysqlRecurringRow = mysql.RowDataPacket & Omit<RecurringTransaction, "tags" | "is_active"> & {
  tags_json: string | string[];
  is_active: number;
};

type QueryParts = {
  whereSql: string;
  params: SqlParam[];
};

type SqlParam = string | number | null;

const pool = mysql.createPool({
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

export async function listCategories(): Promise<string[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT name FROM categories ORDER BY name ASC`
  );
  return rows.map((r) => String(r.name));
}

export async function addCategory(name: string): Promise<{ name: string }> {
  const trimmed = name.trim();
  await pool.execute<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO categories (name) VALUES (?)`,
    [trimmed]
  );
  return { name: trimmed };
}

export async function addTransaction(input: AddTransactionInput): Promise<Transaction> {
  const occurredAt = parseInputDate(input.date);
  const tags = normalizeTags(input.tags);

  const [catRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT name FROM categories WHERE name = ? LIMIT 1`,
    [input.category]
  );
  const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM categories`
  );
  const total = Number(countRows[0]?.total ?? 0);
  if (total > 0 && catRows.length === 0) {
    throw new Error(
      `Unknown category "${input.category}". Use list_categories to see valid options, or add_category to register a new one.`
    );
  }

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `
      INSERT INTO transactions
        (type, amount, currency, category, description, occurred_at, account, tags_json, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.type,
      input.amount,
      config.defaultCurrency,
      input.category,
      input.description ?? null,
      occurredAt,
      input.account ?? null,
      JSON.stringify(tags),
      input.source ?? "claude.ai",
      input.notes ?? null
    ]
  );

  return getTransaction(result.insertId);
}

export async function getTransaction(id: number): Promise<Transaction> {
  const [rows] = await pool.execute<MysqlTransactionRow[]>(
    `
      SELECT id, type, amount, currency, category, description, occurred_at, account,
        tags_json, source, notes, created_at, updated_at
      FROM transactions
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  if (!rows[0]) {
    throw new Error(`Transaction not found: ${id}`);
  }

  return mapTransaction(rows[0]);
}

export async function listTransactions(filters: TransactionFilters): Promise<Transaction[]> {
  const { whereSql, params } = buildWhere(filters);
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const [rows] = await pool.execute<MysqlTransactionRow[]>(
    `
      SELECT id, type, amount, currency, category, description, occurred_at, account,
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

export async function updateTransaction(input: UpdateTransactionInput): Promise<Transaction> {
  const updates: string[] = [];
  const params: SqlParam[] = [];

  addUpdate(updates, params, "type", input.type);
  addUpdate(updates, params, "amount", input.amount);
  addUpdate(updates, params, "category", input.category);
  addUpdate(updates, params, "description", input.description);
  addUpdate(updates, params, "occurred_at", input.date ? parseInputDate(input.date) : undefined);
  addUpdate(updates, params, "account", input.account);
  addUpdate(updates, params, "source", input.source);
  addUpdate(updates, params, "notes", input.notes);

  if (input.tags !== undefined) {
    updates.push("tags_json = ?");
    params.push(JSON.stringify(normalizeTags(input.tags)));
  }

  if (updates.length === 0) {
    return getTransaction(input.id);
  }

  updates.push("updated_at = ?");
  params.push(nowForMysql());
  params.push(input.id);

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE transactions SET ${updates.join(", ")} WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    throw new Error(`Transaction not found: ${input.id}`);
  }

  return getTransaction(input.id);
}

export async function deleteTransaction(id: number): Promise<{ deleted: boolean; id: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>("DELETE FROM transactions WHERE id = ?", [id]);
  return { deleted: result.affectedRows > 0, id };
}

export async function deleteTransactions(ids: number[]): Promise<{ deleted: number; ids: number[] }> {
  const placeholders = ids.map(() => "?").join(", ");
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `DELETE FROM transactions WHERE id IN (${placeholders})`,
    ids
  );
  return { deleted: result.affectedRows, ids };
}

export async function getFinanceSummary(filters: SummaryFilters) {
  const { whereSql, params } = buildWhere(filters);
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
      SELECT COALESCE(account, 'uncategorized') AS account, type, currency,
        COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS total
      FROM transactions
      ${whereSql}
      GROUP BY COALESCE(account, 'uncategorized'), type, currency
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

export async function getTotalBalance(filters: BalanceFilters) {
  const { whereSql, params } = buildWhere(filters as TransactionFilters);

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

export async function getAverages(filters: AverageFilters) {
  const { whereSql, params } = buildWhere(filters as TransactionFilters);
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

export async function registerRecurring(input: RegisterRecurringInput): Promise<RecurringTransaction> {
  const tags = normalizeTags(input.tags);
  const intervalMonths = input.interval_months ?? 1;
  const nextDueDate = calcInitialDueDate(input.day_of_month, intervalMonths, input.start_date);

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `
      INSERT INTO recurring_transactions
        (type, amount, currency, category, description, account, tags_json, source, notes, interval_months, day_of_month, next_due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.type,
      input.amount,
      config.defaultCurrency,
      input.category,
      input.description ?? null,
      input.account ?? null,
      JSON.stringify(tags),
      input.source ?? "claude.ai",
      input.notes ?? null,
      intervalMonths,
      input.day_of_month,
      nextDueDate
    ]
  );

  return getRecurring(result.insertId);
}

export async function getRecurring(id: number): Promise<RecurringTransaction> {
  const [rows] = await pool.execute<MysqlRecurringRow[]>(
    `SELECT * FROM recurring_transactions WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!rows[0]) {
    throw new Error(`Recurring transaction not found: ${id}`);
  }

  return mapRecurring(rows[0]);
}

export async function listRecurring(includeInactive = false): Promise<RecurringTransaction[]> {
  const [rows] = await pool.execute<MysqlRecurringRow[]>(
    `SELECT * FROM recurring_transactions ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY next_due_date ASC, id ASC`
  );

  return rows.map(mapRecurring);
}

export async function deleteRecurring(id: number): Promise<{ deleted: boolean; id: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `DELETE FROM recurring_transactions WHERE id = ?`,
    [id]
  );

  return { deleted: result.affectedRows > 0, id };
}

export async function processRecurring(): Promise<{ processed: number; transactions: Transaction[] }> {
  const todayStr = new Date().toISOString().substring(0, 10);

  const [dueRows] = await pool.execute<MysqlRecurringRow[]>(
    `SELECT * FROM recurring_transactions WHERE is_active = 1 AND next_due_date <= ? ORDER BY next_due_date ASC`,
    [todayStr]
  );

  const transactions: Transaction[] = [];
  const MAX_PER_ENTRY = 24;

  for (const row of dueRows) {
    let nextDue = toDateString(row.next_due_date);
    let count = 0;

    while (nextDue <= todayStr && count < MAX_PER_ENTRY) {
      const rawTags = row.tags_json;
      const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(rawTags as string);

      const tx = await addTransaction({
        type: row.type,
        amount: Number(row.amount),
        category: row.category,
        description: row.description ?? undefined,
        date: nextDue,
        account: row.account ?? undefined,
        tags,
        source: row.source ?? "recurring",
        notes: row.notes ?? undefined
      });

      transactions.push(tx);
      nextDue = calcNextDueDate(nextDue, Number(row.day_of_month), Number(row.interval_months));
      count++;
    }

    await pool.execute<mysql.ResultSetHeader>(
      `UPDATE recurring_transactions SET next_due_date = ?, updated_at = ? WHERE id = ?`,
      [nextDue, nowForMysql(), row.id]
    );
  }

  return { processed: transactions.length, transactions };
}

function buildWhere(filters: TransactionFilters): QueryParts {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  addClause(clauses, params, "occurred_at >= ?", parseStartDate(filters.start_date));
  addClause(clauses, params, "occurred_at <= ?", parseEndDate(filters.end_date));
  addClause(clauses, params, "type = ?", filters.type);
  addClause(clauses, params, "category = ?", filters.category);
  addClause(clauses, params, "account = ?", filters.account);

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

function calcInitialDueDate(dayOfMonth: number, intervalMonths: number, startDate?: string): string {
  if (startDate) {
    return startDate.substring(0, 10);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const today = now.getDate();

  if (today < dayOfMonth) {
    return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
  }

  const advanced = month - 1 + intervalMonths;
  const newYear = year + Math.floor(advanced / 12);
  const newMonth = (advanced % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

function calcNextDueDate(fromDue: string, dayOfMonth: number, intervalMonths: number): string {
  const [yearStr, monthStr] = fromDue.split("-");
  const advanced = parseInt(monthStr) - 1 + intervalMonths; // 0-indexed after advance
  const newYear = parseInt(yearStr) + Math.floor(advanced / 12);
  const newMonth = (advanced % 12) + 1; // back to 1-indexed
  return `${newYear}-${String(newMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

function mapRecurring(row: MysqlRecurringRow): RecurringTransaction {
  const rawTags = row.tags_json;
  const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(rawTags as string);

  return {
    id: Number(row.id),
    type: row.type,
    amount: String(row.amount),
    currency: row.currency,
    category: row.category,
    description: row.description,
    account: row.account,
    tags,
    source: row.source,
    notes: row.notes,
    interval_months: Number(row.interval_months),
    day_of_month: Number(row.day_of_month),
    next_due_date: toDateString(row.next_due_date),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
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
  pay_period_id: number,
  group: GroupInput
): Promise<number> {
  await conn.execute(
    `INSERT INTO budget_groups (pay_period_id, name, amount, budget_type)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE amount = VALUES(amount), budget_type = VALUES(budget_type), updated_at = NOW()`,
    [pay_period_id, group.name, group.amount, group.budget_type ?? "spending"]
  );

  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM budget_groups WHERE pay_period_id = ? AND name = ? LIMIT 1`,
    [pay_period_id, group.name]
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

async function fetchBudgetGroupsWithCategories(pay_period_id: number): Promise<BudgetGroup[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT bg.id, bg.pay_period_id, bg.name, bg.amount, bg.budget_type, bgc.category
     FROM budget_groups bg
     LEFT JOIN budget_group_categories bgc ON bgc.budget_group_id = bg.id
     WHERE bg.pay_period_id = ?
     ORDER BY bg.id, bgc.category`,
    [pay_period_id]
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

export async function createPayPeriod(input: {
  period_start: string;
  salary_amount: number;
  salary_txn_id?: number;
  notes?: string;
}): Promise<PayPeriod> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO pay_periods (period_start, salary_amount, salary_txn_id, notes) VALUES (?, ?, ?, ?)`,
    [input.period_start, input.salary_amount, input.salary_txn_id ?? null, input.notes ?? null]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? LIMIT 1`, [result.insertId]);
  return mapPayPeriodRow(rows[0]);
}

export async function closePayPeriod(period_id: number, period_end: string): Promise<PayPeriod> {
  await pool.execute(
    `UPDATE pay_periods SET period_end = ?, status = 'closed', updated_at = NOW() WHERE id = ?`,
    [period_end, period_id]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? LIMIT 1`, [period_id]);
  if (rows.length === 0) throw new Error(`Pay period ${period_id} not found`);
  return mapPayPeriodRow(rows[0]);
}

export async function getCurrentPeriod(): Promise<PayPeriodWithDays | null> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM pay_periods WHERE status IN ('active','estimated') ORDER BY period_start DESC LIMIT 1`
  );
  if (rows.length === 0) return null;
  const p = mapPayPeriodRow(rows[0]);
  return { ...p, ...budgetComputeDays(p.period_start, p.period_end) };
}

export async function listPayPeriods(limit = 6): Promise<PayPeriodWithDays[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM pay_periods ORDER BY period_start DESC LIMIT ?`, [limit]
  );
  return rows.map((row) => {
    const p = mapPayPeriodRow(row);
    return { ...p, ...budgetComputeDays(p.period_start, p.period_end) };
  });
}

// Budget Group

export async function setBudgetGroupsBulk(
  pay_period_id: number,
  groups: GroupInput[]
): Promise<{ group_ids: number[] }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const group_ids: number[] = [];
    for (const g of groups) group_ids.push(await upsertBudgetGroupInConn(conn, pay_period_id, g));
    await conn.commit();
    return { group_ids };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function setBudgetGroup(pay_period_id: number, input: GroupInput): Promise<{ group_id: number }> {
  const { group_ids } = await setBudgetGroupsBulk(pay_period_id, [input]);
  return { group_id: group_ids[0] };
}

export async function getBudgetGroups(pay_period_id: number): Promise<BudgetGroup[]> {
  return fetchBudgetGroupsWithCategories(pay_period_id);
}

export async function deleteBudgetGroup(group_id: number): Promise<{ deleted: number }> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(`DELETE FROM budget_groups WHERE id = ?`, [group_id]);
  return { deleted: result.affectedRows };
}

// Budget Summary

export async function getBudgetSummary(pay_period_id: number, transactions: InputTransaction[]) {
  const [pRows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM pay_periods WHERE id = ? LIMIT 1`, [pay_period_id]);
  if (pRows.length === 0) throw new Error(`Pay period ${pay_period_id} not found`);
  const period = mapPayPeriodRow(pRows[0]);

  const groups = await fetchBudgetGroupsWithCategories(pay_period_id);
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

export async function getGroupDetail(pay_period_id: number, budget_group_id: number, transactions: InputTransaction[]) {
  const groups = await fetchBudgetGroupsWithCategories(pay_period_id);
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

export async function saveBudgetTemplate(name: string, groups: GroupInput[]): Promise<BudgetTemplate> {
  await pool.execute(
    `INSERT INTO budget_templates (name, groups_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE groups_json = VALUES(groups_json), updated_at = NOW()`,
    [name, JSON.stringify(groups)]
  );
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates WHERE name = ? LIMIT 1`, [name]);
  return mapTemplateRow(rows[0]);
}

export async function listBudgetTemplates(): Promise<BudgetTemplate[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates ORDER BY name`);
  return rows.map(mapTemplateRow);
}

export async function applyBudgetTemplate(pay_period_id: number, template_id: number): Promise<{ applied: number }> {
  const [tRows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT * FROM budget_templates WHERE id = ? LIMIT 1`, [template_id]);
  if (tRows.length === 0) throw new Error(`Template ${template_id} not found`);

  const groups: GroupInput[] = typeof tRows[0].groups_json === "string"
    ? JSON.parse(tRows[0].groups_json) as GroupInput[]
    : tRows[0].groups_json as GroupInput[];

  if (groups.length === 0) throw new Error(`Template ${template_id} has no groups — refusing to wipe pay period`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM budget_groups WHERE pay_period_id = ?`, [pay_period_id]);
    for (const g of groups) await upsertBudgetGroupInConn(conn, pay_period_id, g);
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
