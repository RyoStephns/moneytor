import { z } from "zod";

export const transactionTypeSchema = z.enum(["income", "expense"]);

export const addTransactionSchema = {
  type: transactionTypeSchema.describe("Transaction type: income or expense."),
  amount: z.number().positive().describe("Transaction amount as a positive number."),
  category: z.string().min(1).max(120).describe("Short category, for example food, transport, salary, rent."),
  description: z.string().max(500).optional().describe("Short human-readable transaction description."),
  date: z.string().optional().describe("ISO date or datetime. Date-only values are treated as local day start."),
  account: z.string().max(120).optional().describe("Wallet, bank account, card, or payment source."),
  tags: z.array(z.string().min(1).max(60)).max(20).optional().describe("Optional tags for later filtering."),
  source: z.string().max(120).optional().describe("Where this entry came from, for example claude.ai."),
  notes: z.string().max(2000).optional().describe("Longer notes.")
};

export const listTransactionsSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date or datetime lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date or datetime upper bound."),
  type: transactionTypeSchema.optional(),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional(),
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
  account: z.string().max(120).optional().describe("New account/wallet/card. Omit to leave unchanged."),
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
  account: z.string().max(120).optional().describe("Filter by account/wallet.")
};

export const averagesSchema = {
  start_date: z.string().optional().describe("Inclusive ISO date lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date upper bound."),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional(),
  period: z.enum(["day", "month"]).default("month").describe("Granularity: day or month.")
};

export const registerRecurringSchema = {
  type: transactionTypeSchema.describe("Transaction type: income or expense."),
  amount: z.number().positive().describe("Fixed amount recorded each occurrence."),
  category: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  account: z.string().max(120).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  source: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  interval_months: z.number().int().min(1).max(12).default(1).describe("Repeat every N months."),
  day_of_month: z.number().int().min(1).max(28).describe("Day of month to record (1–28)."),
  start_date: z.string().optional().describe("First due date as YYYY-MM-DD. Defaults to next occurrence based on day_of_month.")
};

export const listRecurringSchema = {
  include_inactive: z.boolean().default(false).describe("Include deactivated recurring entries.")
};

export const deleteRecurringSchema = {
  id: z.number().int().positive()
};

export const addCategorySchema = {
  name: z.string().min(1).max(120).describe("Category name to register.")
};
