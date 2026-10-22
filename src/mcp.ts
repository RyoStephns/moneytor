import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addCategory,
  addTransaction,
  deleteTransaction,
  deleteTransactions,
  getAverages,
  getFinanceSummary,
  getTotalBalance,
  listCategories,
  listTransactions,
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
  deleteBudgetTemplate,
  addAccount,
  updateAccount,
  removeAccount,
  setDefaultAccount,
  getAccountOverview,
  transferBetweenAccounts,
  listTransfers,
  deleteTransfer,
  reconcileAccount,
  createReceivable,
  listReceivables,
  settleReceivable,
  updateReceivable,
  deleteReceivable,
  type GroupInput,
  type InputTransaction,
} from "./repository.js";
import {
  addCategorySchema,
  addTransactionSchema,
  averagesSchema,
  deleteTransactionSchema,
  deleteTransactionsSchema,
  listTransactionsSchema,
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
  deleteBudgetTemplateSchema,
  addAccountSchema,
  updateAccountSchema,
  listAccountsSchema,
  removeAccountSchema,
  setDefaultAccountSchema,
  transferSchema,
  listTransfersSchema,
  deleteTransferSchema,
  reconcileAccountSchema,
  addReceivableSchema,
  listReceivablesSchema,
  markReceivableReimbursedSchema,
  updateReceivableSchema,
  deleteReceivableSchema,
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

export function createMoneytorServer(userId: number): McpServer {
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
    async () => jsonResult(await listCategories(userId))
  );

  server.registerTool(
    "add_category",
    {
      title: "Add category",
      description: "Register a new transaction category. Required before using a category that doesn't exist yet.",
      inputSchema: addCategorySchema
    },
    async (input) => jsonResult(await addCategory(userId, input.name))
  );

  server.registerTool(
    "add_transaction",
    {
      title: "Add transaction",
      description: "Record one personal finance income or expense transaction. The category field must match an existing category from list_categories. Use add_category first if needed. When the user says where the money came from or went (for example \"10k from cash\"), pass that account; its name must match one from list_accounts, so call list_accounts first. If the account is not registered yet, call add_account first instead of guessing. Omit account to use the default account. Do not use this for money the user fronts for someone else and expects back, nor for that money being paid back: use add_receivable and mark_receivable_reimbursed so it never counts as expense or income.",
      inputSchema: addTransactionSchema
    },
    async (input) => jsonResult(await addTransaction(userId, input))
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Fetch and filter personal finance transactions. Supports date range, type, category, account, tag filters, and free-text keyword search across description and notes.",
      inputSchema: listTransactionsSchema
    },
    async (input) => jsonResult(await listTransactions(userId, input))
  );

  server.registerTool(
    "get_finance_summary",
    {
      title: "Get finance summary",
      description: "Summarize income, expenses, net cashflow, and breakdowns over a date range.",
      inputSchema: summarySchema
    },
    async (input) => jsonResult(await getFinanceSummary(userId, input))
  );

  server.registerTool(
    "update_transaction",
    {
      title: "Update transaction",
      description: "Edit one or more fields of an existing transaction (amount, type, category, description, date, account, tags, notes). Only supply the fields you want to change — omitted fields are left as-is. To move a transaction to another account, pass that account's name from list_accounts.",
      inputSchema: updateTransactionSchema
    },
    async (input) => jsonResult(await updateTransaction(userId, input))
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete transaction",
      description: "Delete a single transaction by id.",
      inputSchema: deleteTransactionSchema,
      annotations: { destructiveHint: true }
    },
    async (input) => jsonResult(await deleteTransaction(userId, input.id))
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
    async (input) => jsonResult(await deleteTransactions(userId, input.ids))
  );

  server.registerTool(
    "get_total_balance",
    {
      title: "Get total balance",
      description: "Calculate net balance (total income minus total expense). Optionally filter by account or date range. This is cash flow only: transfers, opening balances, and adjustments are not included. For what an account actually holds right now, use list_accounts.",
      inputSchema: totalBalanceSchema
    },
    async (input) => jsonResult(await getTotalBalance(userId, input))
  );

  server.registerTool(
    "get_averages",
    {
      title: "Get averages",
      description: "Calculate average income and average expense per day or month over a date range.",
      inputSchema: averagesSchema
    },
    async (input) => jsonResult(await getAverages(userId, input))
  );

  // ── Budget ──────────────────────────────────────────────────────────────────

  server.registerTool(
    "create_pay_period",
    {
      title: "Create pay period",
      description: "Create a new pay period when salary arrives. Close the previous period first with close_pay_period.",
      inputSchema: createPayPeriodSchema,
    },
    async (input) => jsonResult(await createPayPeriod(userId, input))
  );

  server.registerTool(
    "close_pay_period",
    {
      title: "Close pay period",
      description: "Close the current pay period by setting its end date. Typically period_end = new period_start minus 1 day.",
      inputSchema: closePayPeriodSchema,
    },
    async (input) => jsonResult(await closePayPeriod(userId, input.period_id, input.period_end))
  );

  server.registerTool(
    "get_current_period",
    {
      title: "Get current pay period",
      description: "Return the active pay period with elapsed/remaining day counts. Use this to get pay_period_id and period_start for other budget tools.",
      inputSchema: {},
    },
    async () => jsonResult(await getCurrentPeriod(userId))
  );

  server.registerTool(
    "list_pay_periods",
    {
      title: "List pay periods",
      description: "List recent pay periods newest first. Default limit 6.",
      inputSchema: listPayPeriodsSchema,
    },
    async (input) => jsonResult(await listPayPeriods(userId, input.limit))
  );

  server.registerTool(
    "set_budget_group",
    {
      title: "Set budget group",
      description: "Create or update a single budget group and its Moneytor category mappings for a pay period. Same name = update amount and replace categories.",
      inputSchema: setBudgetGroupSchema,
    },
    async (input) => jsonResult(await setBudgetGroup(userId, input.pay_period_id, {
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
    async (input) => jsonResult(await setBudgetGroupsBulk(userId, input.pay_period_id, input.groups as GroupInput[], input.replace_all))
  );

  server.registerTool(
    "get_budget_groups",
    {
      title: "Get budget groups",
      description: "Return all budget groups and their Moneytor category mappings for a pay period.",
      inputSchema: getBudgetGroupsSchema,
    },
    async (input) => jsonResult(await getBudgetGroups(userId, input.pay_period_id))
  );

  server.registerTool(
    "delete_budget_group",
    {
      title: "Delete budget group",
      description: "Delete a budget group and its category mappings.",
      inputSchema: deleteBudgetGroupSchema,
      annotations: { destructiveHint: true },
    },
    async (input) => jsonResult(await deleteBudgetGroup(userId, input.budget_group_id))
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
    async (input) => jsonResult(await getBudgetSummary(userId, input.pay_period_id, input.transactions as InputTransaction[]))
  );

  server.registerTool(
    "get_group_detail",
    {
      title: "Get budget group detail",
      description: "Drill into a single budget group — returns budget vs actual plus the individual transactions that belong to it.",
      inputSchema: getGroupDetailSchema,
    },
    async (input) => jsonResult(await getGroupDetail(userId, input.pay_period_id, input.budget_group_id, input.transactions as InputTransaction[]))
  );

  server.registerTool(
    "save_budget_template",
    {
      title: "Save budget template",
      description: "Save current budget group configuration as a reusable template. Same name overwrites the existing template.",
      inputSchema: saveBudgetTemplateSchema,
    },
    async (input) => jsonResult(await saveBudgetTemplate(userId, input.name, input.groups as GroupInput[]))
  );

  server.registerTool(
    "list_budget_templates",
    {
      title: "List budget templates",
      description: "List all saved budget templates.",
      inputSchema: {},
    },
    async () => jsonResult(await listBudgetTemplates(userId))
  );

  server.registerTool(
    "apply_budget_template",
    {
      title: "Apply budget template",
      description: "Apply a saved template to a pay period. Replaces all existing budget groups for that period with the template's groups.",
      inputSchema: applyBudgetTemplateSchema,
      annotations: { destructiveHint: true },
    },
    async (input) => jsonResult(await applyBudgetTemplate(userId, input.pay_period_id, input.template_id))
  );

  server.registerTool(
    "delete_budget_template",
    {
      title: "Delete budget template",
      description: "Delete a saved budget template by id. Does not affect pay periods the template was already applied to.",
      inputSchema: deleteBudgetTemplateSchema,
      annotations: { destructiveHint: true },
    },
    async (input) => jsonResult(await deleteBudgetTemplate(userId, input.template_id))
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description: "List the user's accounts (cash, banks, e-wallets) with each current balance and which one is the default. total_balance is the sum of the account balances. Also returns unknown_account: older history whose source account is unknown, shown for information only and not part of total_balance. Call this before add_transaction, update_transaction, transfer_between_accounts, or reconcile_account so the account name you pass matches a registered one. If the user names an account that is not listed, call add_account first; never guess a name.",
      inputSchema: listAccountsSchema
    },
    async (input) => jsonResult(await getAccountOverview(userId, input.include_archived))
  );

  server.registerTool(
    "add_account",
    {
      title: "Add account",
      description: "Register an account where the user keeps money, for example cash, a bank account, or an e-wallet. Needed before using a name that list_accounts does not show. The first account created becomes the default.",
      inputSchema: addAccountSchema
    },
    async (input) => jsonResult(await addAccount(userId, input))
  );

  server.registerTool(
    "update_account",
    {
      title: "Update account",
      description: "Rename an account or change its type or description. Only supply what should change. Opening balance cannot be edited; use reconcile_account to fix a balance that drifted.",
      inputSchema: updateAccountSchema
    },
    async (input) => jsonResult(await updateAccount(userId, input.account, {
      new_name: input.new_name,
      type: input.type,
      description: input.description
    }))
  );

  server.registerTool(
    "set_default_account",
    {
      title: "Set default account",
      description: "Choose which account new transactions use when no account is given. Exactly one account is the default; this moves the flag.",
      inputSchema: setDefaultAccountSchema
    },
    async (input) => jsonResult(await setDefaultAccount(userId, input.account))
  );

  server.registerTool(
    "remove_account",
    {
      title: "Remove account",
      description: "Remove an account. If it has any transactions, transfers, or adjustments it is archived instead of deleted so history stays intact; the result says which happened. The default account cannot be removed: use set_default_account first.",
      inputSchema: removeAccountSchema,
      annotations: { destructiveHint: true }
    },
    async (input) => jsonResult(await removeAccount(userId, input.account))
  );

  server.registerTool(
    "transfer_between_accounts",
    {
      title: "Transfer between accounts",
      description: "Move money from one of the user's accounts to another, for example \"move 100k from BCA to cash\". A transfer is not income or expense: it only shifts balances and never appears in summaries or budgets. If the transfer cost a fee, record the fee separately as an expense on the source account. Both names must come from list_accounts.",
      inputSchema: transferSchema
    },
    async (input) => jsonResult(await transferBetweenAccounts(userId, {
      from: input.from_account,
      to: input.to_account,
      amount: input.amount,
      date: input.date,
      notes: input.notes
    }))
  );

  server.registerTool(
    "list_transfers",
    {
      title: "List transfers",
      description: "List transfers between accounts, newest first. Filter by date range or by an account (transfers into or out of it).",
      inputSchema: listTransfersSchema
    },
    async (input) => jsonResult(await listTransfers(userId, input))
  );

  server.registerTool(
    "delete_transfer",
    {
      title: "Delete transfer",
      description: "Delete one transfer by id. Both accounts' balances go back to what they were before it.",
      inputSchema: deleteTransferSchema,
      annotations: { destructiveHint: true }
    },
    async (input) => jsonResult(await deleteTransfer(userId, input.id))
  );

  server.registerTool(
    "reconcile_account",
    {
      title: "Reconcile account",
      description: "Match an account to the real balance the user reads in their bank or wallet app. Pass that actual balance; the difference is stored as an adjustment, which is not income or expense, and the result shows balance before, after, and the difference. Does nothing when it already matches. Use it for small drift such as rounding, not for money that was really spent: record that as an expense instead.",
      inputSchema: reconcileAccountSchema
    },
    async (input) => jsonResult(await reconcileAccount(userId, input.account, input.actual_balance, input.notes))
  );

  server.registerTool(
    "add_receivable",
    {
      title: "Add receivable",
      description: "Record money the user fronted or lent to someone and expects back, for example \"I paid 150k for Budi's lunch\". It lowers the balance of the account it left from but is not an expense, so it never appears in summaries, averages, or budgets. Pass the account it left from (a name from list_accounts) or omit it for the default account. When the person pays back, call mark_receivable_reimbursed, not add_transaction with type income.",
      inputSchema: addReceivableSchema
    },
    async (input) => jsonResult(await createReceivable(userId, input))
  );

  server.registerTool(
    "list_receivables",
    {
      title: "List receivables",
      description: "List money people still owe the user (status open, the default), already paid back (settled), or both (all). Always returns outstanding_total and outstanding_by_borrower, which is who still owes how much. Use it to find the id before mark_receivable_reimbursed. Outstanding receivables are not part of any account balance.",
      inputSchema: listReceivablesSchema
    },
    async (input) => jsonResult(await listReceivables(userId, input))
  );

  server.registerTool(
    "mark_receivable_reimbursed",
    {
      title: "Mark receivable reimbursed",
      description: "Mark one receivable as paid back in full. The money returns to the account you pass (a name from list_accounts) or the default account. This is not income: it only raises that account's balance and never changes income, summaries, or averages. Fails if it is already settled. Partial repayment is not supported.",
      inputSchema: markReceivableReimbursedSchema
    },
    async (input) => jsonResult(await settleReceivable(userId, input.id, { account: input.account, date: input.date }))
  );

  server.registerTool(
    "update_receivable",
    {
      title: "Update receivable",
      description: "Correct a receivable. Only supply what should change. Amount and account can only change while it is still open; borrower, date, and notes can change anytime.",
      inputSchema: updateReceivableSchema
    },
    async (input) => jsonResult(await updateReceivable(userId, input.id, {
      borrower: input.borrower,
      amount: input.amount,
      account: input.account,
      date: input.date,
      notes: input.notes
    }))
  );

  server.registerTool(
    "delete_receivable",
    {
      title: "Delete receivable",
      description: "Delete one receivable by id, open or settled. The balances it moved go back to what they were before it was recorded.",
      inputSchema: deleteReceivableSchema,
      annotations: { destructiveHint: true }
    },
    async (input) => jsonResult(await deleteReceivable(userId, input.id))
  );

  return server;
}
