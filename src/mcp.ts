import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addTransaction,
  deleteTransaction,
  getFinanceSummary,
  listTransactions,
  updateTransaction
} from "./repository.js";
import {
  addTransactionSchema,
  deleteTransactionSchema,
  listTransactionsSchema,
  summarySchema,
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

  return server;
}
