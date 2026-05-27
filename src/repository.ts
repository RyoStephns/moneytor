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
