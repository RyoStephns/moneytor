import { z } from "zod";

export const transactionTypeSchema = z.enum(["income", "expense"]);

export const addTransactionSchema = {
  type: transactionTypeSchema.describe("Transaction type: income or expense."),
  amount: z.number().positive().describe("Transaction amount as a positive number."),
  category: z.string().min(1).max(120).describe("Short category, for example food, transport, salary, rent."),
  description: z.string().max(500).optional().describe("Short human-readable transaction description."),
  date: z.string().optional().describe("ISO date or datetime. Date-only values are treated as local day start."),
  account: z.string().max(120).optional().describe("Name of a registered account exactly as listed by list_accounts, for example Tunai or BCA. Omit to use the default account."),
  tags: z.array(z.string().min(1).max(60)).max(20).optional().describe("Optional tags for later filtering."),
  source: z.string().max(120).optional().describe("Where this entry came from, for example claude.ai."),
  notes: z.string().max(2000).optional().describe("Longer notes.")
};

export const listTransactionsSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date or datetime lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date or datetime upper bound."),
  type: transactionTypeSchema.optional(),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional().describe("Account name. Also matches the free-text label on older transactions."),
  tag: z.string().max(60).optional().describe("Return rows containing this tag."),
  keyword: z.string().max(200).optional().describe("Free-text search across description and notes fields. Use category/account filters for exact-match filtering."),
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().min(0).default(0)
};

export const updateTransactionSchema = {
  id: z.number().int().positive().describe("ID of the transaction to update."),
  type: transactionTypeSchema.optional().describe("Change transaction type to income or expense."),
  amount: z.number().positive().optional().describe("New amount as a positive number."),
  category: z.string().min(1).max(120).optional().describe("New category. Must match an existing category from list_categories."),
  description: z.string().max(500).optional().describe("New short description. Omit to leave unchanged."),
  date: z.string().optional().describe("New ISO date or datetime for when the transaction occurred."),
  account: z.string().max(120).optional().describe("Move the transaction to this registered account (name from list_accounts). Omit to leave unchanged."),
  tags: z.array(z.string().min(1).max(60)).max(20).optional().describe("Replacement tag list. Omit to leave unchanged."),
  source: z.string().max(120).optional().describe("New source label. Omit to leave unchanged."),
  notes: z.string().max(2000).optional().describe("New long-form notes. Omit to leave unchanged.")
};

export const deleteTransactionSchema = {
  id: z.number().int().positive().describe("ID of the transaction to delete.")
};

export const deleteTransactionsSchema = {
  ids: z.array(z.number().int().positive()).min(1).max(100).describe("List of transaction IDs to delete.")
};


export const summarySchema = {
  start_date: z.string().optional().describe("Inclusive ISO date or datetime lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date or datetime upper bound."),
  type: transactionTypeSchema.optional(),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional(),
  period: z.enum(["day", "month"]).default("month").describe("Period granularity for the time breakdown.")
};

export const totalBalanceSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date lower bound. Omit for all-time balance."),
  end_date: z.string().optional().describe("Inclusive ISO date upper bound."),
  account: z.string().max(120).optional().describe("Only this account's transactions. The result is income minus expense, so transfers, opening balance, and adjustments are not included; use list_accounts for an account's real balance.")
};

export const averagesSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date upper bound."),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional(),
  period: z.enum(["day", "month"]).default("month").describe("Granularity: day or month.")
};

export const addCategorySchema = {
  name: z.string().min(1).max(120).describe("Category name to register.")
};

// ─── Budget ───────────────────────────────────────────────────────────────────

const groupInputSchema = z.object({
  name: z.string(),
  amount: z.number().positive(),
  budget_type: z.enum(["spending", "saving"]).optional(),
  categories: z.array(z.string()),
});

const inputTransactionSchema = z.object({
  category: z.string(),
  amount: z.number().nonnegative(),
  type: z.enum(["income", "expense"]),
  occurred_at: z.string(),
});

export const createPayPeriodSchema = {
  period_start: z.string().describe("Date the salary arrived (YYYY-MM-DD)."),
  salary_amount: z.number().positive(),
  salary_txn_id: z.number().int().optional().describe("Moneytor transaction ID of the salary entry."),
  notes: z.string().optional(),
};

export const closePayPeriodSchema = {
  period_id: z.number().int(),
  period_end: z.string().describe("Last day of the period (YYYY-MM-DD), typically the day before the new period_start."),
};

export const listPayPeriodsSchema = {
  limit: z.number().int().min(1).max(24).default(6),
};

export const setBudgetGroupSchema = {
  pay_period_id: z.number().int(),
  name: z.string(),
  amount: z.number().positive(),
  budget_type: z.enum(["spending", "saving"]).optional(),
  categories: z.array(z.string()).describe("Moneytor category names mapped to this group. Pass [] for saving groups."),
};

export const setBudgetGroupsBulkSchema = {
  pay_period_id: z.number().int(),
  groups: z.array(groupInputSchema),
  replace_all: z.boolean().default(false).describe("If true, delete all existing groups for this pay period before inserting. Use this to fully replace the budget layout."),
};

export const getBudgetGroupsSchema = {
  pay_period_id: z.number().int(),
};

export const deleteBudgetGroupSchema = {
  budget_group_id: z.number().int(),
};

export const getBudgetSummarySchema = {
  pay_period_id: z.number().int(),
  transactions: z.array(inputTransactionSchema).describe(
    "Transactions from list_transactions for this pay period. Fetch with start_date=period_start."
  ),
};

export const getGroupDetailSchema = {
  pay_period_id: z.number().int(),
  budget_group_id: z.number().int(),
  transactions: z.array(inputTransactionSchema).describe(
    "Full period transactions — same array as get_budget_summary. The tool filters internally."
  ),
};

export const saveBudgetTemplateSchema = {
  name: z.string().describe("Template name. Calling with the same name overwrites the existing template."),
  groups: z.array(groupInputSchema),
};

export const applyBudgetTemplateSchema = {
  pay_period_id: z.number().int(),
  template_id: z.number().int(),
};

export const deleteBudgetTemplateSchema = {
  template_id: z.number().int(),
};

// ─── Accounts ─────────────────────────────────────────────────────────────────

const accountName = (what: string) => z.string().min(1).max(120).describe(what);

export const accountTypeSchema = z.enum(["cash", "bank", "ewallet", "other"]);

export const addAccountSchema = {
  name: accountName("Account name, for example Tunai, BCA, Blu. Must be unique (case-insensitive)."),
  type: accountTypeSchema.describe("cash = physical cash, bank = bank account, ewallet = e-wallet or digital wallet, other = anything else."),
  description: z.string().max(500).optional().describe("Short note about what this account is for."),
  opening_balance: z.number().optional().describe("Money already in the account when you start tracking it. Defaults to 0.")
};

export const updateAccountSchema = {
  account: accountName("Current name of the account to change."),
  new_name: z.string().min(1).max(120).optional().describe("Rename the account. Existing transactions follow the new name."),
  type: accountTypeSchema.optional(),
  description: z.string().max(500).nullable().optional().describe("New description, or null to clear it. Omit to leave unchanged.")
};

export const listAccountsSchema = {
  include_archived: z.boolean().default(false).describe("Also list archived accounts.")
};

export const removeAccountSchema = {
  account: accountName("Name of the account to remove.")
};

export const setDefaultAccountSchema = {
  account: accountName("Name of the account to make the default.")
};

export const transferSchema = {
  from_account: accountName("Account the money leaves, as listed by list_accounts."),
  to_account: accountName("Account the money goes to, as listed by list_accounts."),
  amount: z.number().positive().describe("Amount moved, as a positive number."),
  date: z.string().optional().describe("ISO date or datetime. Date-only values are treated as local day start. Omit for now."),
  notes: z.string().max(1000).optional().describe("Optional note.")
};

export const listTransfersSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date or datetime lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date or datetime upper bound."),
  account: z.string().max(120).optional().describe("Only transfers into or out of this account."),
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().min(0).default(0)
};

export const deleteTransferSchema = {
  id: z.number().int().positive().describe("ID of the transfer to delete.")
};

export const reconcileAccountSchema = {
  account: accountName("Account to match against the real balance."),
  actual_balance: z.number().describe("The balance the user actually sees right now, for example in the bank app."),
  notes: z.string().max(1000).optional().describe("Optional note about the difference.")
};
