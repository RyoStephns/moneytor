import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addCategory,
  addTransaction,
  deleteTransaction,
  deleteTransactions,
  deleteRecurring,
  getAverages,
  getFinanceSummary,
  getTotalBalance,
  listCategories,
  listRecurring,
  listTransactions,
  processRecurring,
  registerRecurring,
  updateTransaction,
  createPayPeriod,
  closePayPeriod,
  getCurrentPeriod,
  listPayPeriods,
  setBudgetGroup,
  setBudgetGroupsBulk,
  getBudgetGroups,
  deleteBudgetGroup,
  getBudgetSummary,
  getGroupDetail,
  saveBudgetTemplate,
  listBudgetTemplates,
  applyBudgetTemplate,
  type GroupInput,
  type InputTransaction,
} from "./repository.js";
import {
  addCategorySchema,
  addTransactionSchema,
  averagesSchema,
  deleteRecurringSchema,
  deleteTransactionSchema,
  deleteTransactionsSchema,
  listRecurringSchema,
  listTransactionsSchema,
  registerRecurringSchema,
  summarySchema,
  totalBalanceSchema,
  updateTransactionSchema,
  createPayPeriodSchema,
  closePayPeriodSchema,
  listPayPeriodsSchema,
  setBudgetGroupSchema,
  setBudgetGroupsBulkSchema,
  getBudgetGroupsSchema,
  deleteBudgetGroupSchema,
  getBudgetSummarySchema,
  getGroupDetailSchema,
  saveBudgetTemplateSchema,
  applyBudgetTemplateSchema,
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
    "list_categories",
    {
      title: "List categories",
      description: "List all registered transaction categories. Always call this before add_transaction to pick a valid category.",
      inputSchema: {}
    },
    async () => jsonResult(await listCategories())
  );

  server.registerTool(
    "add_category",
    {
      title: "Add category",
      description: "Register a new transaction category. Required before using a category that doesn't exist yet.",
      inputSchema: addCategorySchema
    },
    async (input) => jsonResult(await addCategory(input.name))
  );

  server.registerTool(
    "add_transaction",
    {
      title: "Add transaction",
      description: "Record one personal finance income or expense transaction. The category field must match an existing category from list_categories. Use add_category first if needed.",
      inputSchema: addTransactionSchema
    },
    async (input) => jsonResult(await addTransaction(input))
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Fetch and filter personal finance transactions. Supports date range, type, category, account, tag filters, and free-text keyword search across description and notes.",
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
      description: "Edit one or more fields of an existing transaction (amount, type, category, description, date, account, tags, notes). Only supply the fields you want to change — omitted fields are left as-is.",
      inputSchema: updateTransactionSchema
    },
    async (input) => jsonResult(await updateTransaction(input))
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete transaction",
      description: "Delete a single transaction by id.",
      inputSchema: deleteTransactionSchema,
      annotations: { destructiveHint: true }
    },
    async (input) => jsonResult(await deleteTransaction(input.id))
  );

  server.registerTool(
    "delete_transactions",
    {
      title: "Delete multiple transactions",
      description: "Delete several transactions at once by passing an array of IDs. Use when cleaning up multiple wrong or duplicate entries.",
      inputSchema: deleteTransactionsSchema,
      annotations: {
        destructiveHint: true
      }
    },
    async (input) => jsonResult(await deleteTransactions(input.ids))
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

  // ── Budget ──────────────────────────────────────────────────────────────────

  server.registerTool(
    "create_pay_period",
    {
      title: "Create pay period",
      description: "Create a new pay period when salary arrives. Close the previous period first with close_pay_period.",
      inputSchema: createPayPeriodSchema,
    },
    async (input) => jsonResult(await createPayPeriod(input))
  );

  server.registerTool(
    "close_pay_period",
    {
      title: "Close pay period",
      description: "Close the current pay period by setting its end date. Typically period_end = new period_start minus 1 day.",
      inputSchema: closePayPeriodSchema,
    },
    async (input) => jsonResult(await closePayPeriod(input.period_id, input.period_end))
  );

  server.registerTool(
    "get_current_period",
    {
      title: "Get current pay period",
      description: "Return the active pay period with elapsed/remaining day counts. Use this to get pay_period_id and period_start for other budget tools.",
      inputSchema: {},
    },
    async () => jsonResult(await getCurrentPeriod())
  );

  server.registerTool(
    "list_pay_periods",
    {
      title: "List pay periods",
      description: "List recent pay periods newest first. Default limit 6.",
      inputSchema: listPayPeriodsSchema,
    },
    async (input) => jsonResult(await listPayPeriods(input.limit))
  );

  server.registerTool(
    "set_budget_group",
    {
      title: "Set budget group",
      description: "Create or update a single budget group and its Moneytor category mappings for a pay period. Same name = update amount and replace categories.",
      inputSchema: setBudgetGroupSchema,
    },
    async (input) => jsonResult(await setBudgetGroup(input.pay_period_id, {
      name: input.name,
      amount: input.amount,
      budget_type: input.budget_type,
      categories: input.categories,
    }))
  );

  server.registerTool(
    "set_budget_groups_bulk",
    {
      title: "Set budget groups (bulk)",
      description: "Set multiple budget groups at once for a pay period in a single atomic operation. Existing groups with the same name are updated; new names are inserted.",
      inputSchema: setBudgetGroupsBulkSchema,
    },
    async (input) => jsonResult(await setBudgetGroupsBulk(input.pay_period_id, input.groups as GroupInput[]))
  );

  server.registerTool(
    "get_budget_groups",
    {
      title: "Get budget groups",
      description: "Return all budget groups and their Moneytor category mappings for a pay period.",
      inputSchema: getBudgetGroupsSchema,
    },
    async (input) => jsonResult(await getBudgetGroups(input.pay_period_id))
  );

  server.registerTool(
    "delete_budget_group",
    {
      title: "Delete budget group",
      description: "Delete a budget group and its category mappings.",
      inputSchema: deleteBudgetGroupSchema,
      annotations: { destructiveHint: true },
    },
    async (input) => jsonResult(await deleteBudgetGroup(input.budget_group_id))
  );

  server.registerTool(
    "get_budget_summary",
    {
      title: "Get budget summary",
      description: `Core budget tool. Receives transactions from Moneytor, joins with budget groups, and returns per-group actual vs budget with burn rate and end-of-period projections.

Workflow:
1. get_current_period → period_start, pay_period_id
2. list_transactions with start_date=period_start
3. get_budget_summary with pay_period_id + transactions from step 2

Status: ok = ≤80% used, warning = 81–100%, over = >100%.`,
      inputSchema: getBudgetSummarySchema,
    },
    async (input) => jsonResult(await getBudgetSummary(input.pay_period_id, input.transactions as InputTransaction[]))
  );

  server.registerTool(
    "get_group_detail",
    {
      title: "Get budget group detail",
      description: "Drill into a single budget group — returns budget vs actual plus the individual transactions that belong to it.",
      inputSchema: getGroupDetailSchema,
    },
    async (input) => jsonResult(await getGroupDetail(input.pay_period_id, input.budget_group_id, input.transactions as InputTransaction[]))
  );

  server.registerTool(
    "save_budget_template",
    {
      title: "Save budget template",
      description: "Save current budget group configuration as a reusable template. Same name overwrites the existing template.",
      inputSchema: saveBudgetTemplateSchema,
    },
    async (input) => jsonResult(await saveBudgetTemplate(input.name, input.groups as GroupInput[]))
  );

  server.registerTool(
    "list_budget_templates",
    {
      title: "List budget templates",
      description: "List all saved budget templates.",
      inputSchema: {},
    },
    async () => jsonResult(await listBudgetTemplates())
  );

  server.registerTool(
    "apply_budget_template",
    {
      title: "Apply budget template",
      description: "Apply a saved template to a pay period. Replaces all existing budget groups for that period with the template's groups.",
      inputSchema: applyBudgetTemplateSchema,
      annotations: { destructiveHint: true },
    },
    async (input) => jsonResult(await applyBudgetTemplate(input.pay_period_id, input.template_id))
  );

  return server;
}
