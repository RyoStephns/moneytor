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
  currency?: string;
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
  currency?: string;
  category?: string;
  account?: string;
  tag?: string;
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

type MysqlTransactionRow = mysql.RowDataPacket & Omit<Transaction, "tags"> & {
  tags_json: string | string[];
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

export async function addTransaction(input: AddTransactionInput): Promise<Transaction> {
  const currency = normalizeCurrency(input.currency) ?? config.defaultCurrency;
  const occurredAt = parseInputDate(input.date);
  const tags = normalizeTags(input.tags);

  const [result] = await pool.execute<mysql.ResultSetHeader>(
    `
      INSERT INTO transactions
        (type, amount, currency, category, description, occurred_at, account, tags_json, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.type,
      input.amount,
      currency,
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
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  return rows.map(mapTransaction);
}

export async function updateTransaction(input: UpdateTransactionInput): Promise<Transaction> {
  const updates: string[] = [];
  const params: SqlParam[] = [];

  addUpdate(updates, params, "type", input.type);
  addUpdate(updates, params, "amount", input.amount);
  addUpdate(updates, params, "currency", normalizeCurrency(input.currency));
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

  const [byPeriod] = await pool.execute<mysql.RowDataPacket[]>(
    `
      SELECT DATE_FORMAT(occurred_at, ?) AS period, type, currency,
        COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS total
      FROM transactions
      ${whereSql}
      GROUP BY DATE_FORMAT(occurred_at, ?), type, currency
      ORDER BY period ASC, type ASC
    `,
    [periodFormat, ...params, periodFormat]
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

function buildWhere(filters: TransactionFilters): QueryParts {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  addClause(clauses, params, "occurred_at >= ?", parseStartDate(filters.start_date));
  addClause(clauses, params, "occurred_at <= ?", parseEndDate(filters.end_date));
  addClause(clauses, params, "type = ?", filters.type);
  addClause(clauses, params, "currency = ?", normalizeCurrency(filters.currency));
  addClause(clauses, params, "category = ?", filters.category);
  addClause(clauses, params, "account = ?", filters.account);

  if (filters.tag) {
    clauses.push("JSON_CONTAINS(tags_json, JSON_QUOTE(?), '$')");
    params.push(filters.tag);
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

function normalizeCurrency(currency: string | undefined): string | undefined {
  if (currency === undefined) {
    return undefined;
  }

  return currency.trim().toUpperCase();
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
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
