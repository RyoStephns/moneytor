import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addTransaction,
  deleteTransaction,
  deleteRecurring,
  getAverages,
  getFinanceSummary,
  getTotalBalance,
  listRecurring,
  listTransactions,
  processRecurring,
  registerRecurring,
  updateTransaction
} from "./repository.js";
import {
  addTransactionSchema,
  averagesSchema,
  deleteRecurringSchema,
  deleteTransactionSchema,
  listRecurringSchema,
  listTransactionsSchema,
  registerRecurringSchema,
  summarySchema,
  totalBalanceSchema,
  updateTransactionSchema
} from "./schemas.js";

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export function createMoneytorServer(): McpServer {
  const server = new McpServer({
    name: "moneytor",
    version: "0.1.0"
  });

  server.registerTool(
    "add_transaction",
    {
      title: "Add transaction",
      description: "Record one personal finance income or expense transaction.",
      inputSchema: addTransactionSchema
    },
    async (input) => jsonResult(await addTransaction(input))
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Fetch personal finance transactions for review or summary.",
      inputSchema: listTransactionsSchema
    },
    async (input) => jsonResult(await listTransactions(input))
  );

  server.registerTool(
    "get_finance_summary",
    {
      title: "Get finance summary",
      description: "Summarize income, expenses, net cashflow, and breakdowns over a date range.",
      inputSchema: summarySchema
    },
    async (input) => jsonResult(await getFinanceSummary(input))
  );

  server.registerTool(
    "update_transaction",
    {
      title: "Update transaction",
      description: "Correct an existing personal finance transaction.",
      inputSchema: updateTransactionSchema
    },
    async (input) => jsonResult(await updateTransaction(input))
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete transaction",
      description: "Delete a mistaken personal finance transaction by id.",
      inputSchema: deleteTransactionSchema,
      annotations: {
        destructiveHint: true
      }
    },
    async (input) => jsonResult(await deleteTransaction(input.id))
  );

  server.registerTool(
    "get_total_balance",
    {
      title: "Get total balance",
      description: "Calculate net balance (total income minus total expense). Optionally filter by account or date range.",
      inputSchema: totalBalanceSchema
    },
    async (input) => jsonResult(await getTotalBalance(input))
  );

  server.registerTool(
    "get_averages",
    {
      title: "Get averages",
      description: "Calculate average income and average expense per day or month over a date range.",
      inputSchema: averagesSchema
    },
    async (input) => jsonResult(await getAverages(input))
  );

  server.registerTool(
    "register_recurring",
    {
      title: "Register recurring transaction",
      description: "Register a fixed recurring income or expense that repeats every N months on a specific day. Call process_recurring to generate due transactions.",
      inputSchema: registerRecurringSchema
    },
    async (input) => jsonResult(await registerRecurring(input))
  );

  server.registerTool(
    "list_recurring",
    {
      title: "List recurring transactions",
      description: "List all registered recurring transaction templates.",
      inputSchema: listRecurringSchema
    },
    async (input) => jsonResult(await listRecurring(input.include_inactive))
  );

  server.registerTool(
    "delete_recurring",
    {
      title: "Delete recurring transaction",
      description: "Remove a recurring transaction template by id. Does not affect already-created transactions.",
      inputSchema: deleteRecurringSchema,
      annotations: {
        destructiveHint: true
      }
    },
    async (input) => jsonResult(await deleteRecurring(input.id))
  );

  server.registerTool(
    "process_recurring",
    {
      title: "Process recurring transactions",
      description: "Create actual transactions for all recurring templates that are due today or overdue. Returns the list of created transactions.",
      inputSchema: {}
    },
    async () => jsonResult(await processRecurring())
  );

  return server;
}
