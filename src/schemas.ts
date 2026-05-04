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
  limit: z.number().int().positive().max(500).default(100),
  offset: z.number().int().min(0).default(0)
};

export const updateTransactionSchema = {
  id: z.number().int().positive(),
  type: transactionTypeSchema.optional(),
  amount: z.number().positive().optional(),
  category: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  date: z.string().optional(),
  account: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  source: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional()
};

export const deleteTransactionSchema = {
  id: z.number().int().positive()
};

export const summarySchema = {
  start_date: z.string().optional().describe("Inclusive ISO date or datetime lower bound."),
  end_date: z.string().optional().describe("Inclusive ISO date or datetime upper bound."),
  type: transactionTypeSchema.optional(),
  category: z.string().max(120).optional(),
  account: z.string().max(120).optional(),
  period: z.enum(["day", "month"]).default("month").describe("Period granularity for the time breakdown.")
};
