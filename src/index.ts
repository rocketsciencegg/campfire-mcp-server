#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  FinancialStatementsApi,
  CoreAccountingApi,
  AccountsPayableApi,
  AccountsReceivableApi,
  RevenueRecognitionApi,
  CompanyObjectsApi,
  CoaApi,
  Configuration,
} from "campfire-typescript-sdk";
import {
  getMonthRange,
  getCurrentYTDRange,
  getCurrentMonthRange,
  buildFinancialSnapshot,
  computeBurnRate,
  enrichTransactions,
  analyzeAging,
  analyzeContracts,
  shapeCustomers,
  shapeInvoices,
  shapeTrialBalance,
  shapeBudgets,
  shapeBudgetDetail,
  shapeUncategorizedTransactions,
  shapeBills,
  shapeDepartments,
} from "./helpers.js";

// Campfire uses apiKey auth with "Token <key>" format
const config = new Configuration({
  apiKey: `Token ${process.env.CAMPFIRE_API_KEY}`,
  basePath: "https://api.meetcampfire.com",
});

const financialStatementsApi = new FinancialStatementsApi(config);
const coreAccountingApi = new CoreAccountingApi(config);
const apApi = new AccountsPayableApi(config);
const arApi = new AccountsReceivableApi(config);
const revenueApi = new RevenueRecognitionApi(config);
const companyApi = new CompanyObjectsApi(config);
const coaApi = new CoaApi(config);

function errorResult(toolName: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error in ${toolName}: ${message}` }],
    isError: true,
  };
}

// --- NEW TOOLS ---

function createServer() {
const server = new McpServer({
  name: "campfire-mcp-server",
  version: "2.2.0",
});

server.registerTool(
  "get_financial_snapshot",
  {
    description:
      "Get a financial snapshot with key metrics: revenue, expenses, net income, margins, cash position, and current ratio. Returns both current month and YTD data.",
    inputSchema: {
      entityId: z.number().optional().describe("Filter by entity ID"),
    },
  },
  async ({ entityId }) => {
    try {
      const now = new Date();
      const monthRange = getCurrentMonthRange(now);
      const ytdRange = getCurrentYTDRange(now);

      // Fetch current month statements
      const [monthIncome, monthBalance, monthCashFlow] = await Promise.all([
        (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
          startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly", entity: entityId,
        }),
        (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
          startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly", entity: entityId,
        }),
        (financialStatementsApi as any).caApiGetCashFlowRetrieve({
          startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly", entity: entityId,
        }),
      ]);

      // Fetch YTD statements
      const [ytdIncome, ytdBalance] = await Promise.all([
        (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
          startDate: ytdRange.dateFrom, endDate: ytdRange.dateTo, cadence: "monthly", entity: entityId,
        }),
        (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
          startDate: ytdRange.dateFrom, endDate: ytdRange.dateTo, cadence: "monthly", entity: entityId,
        }),
      ]);

      const monthLabel = now.toLocaleString("default", { month: "long", year: "numeric" });
      const currentMonth = buildFinancialSnapshot(
        monthIncome.data, monthBalance.data, monthCashFlow.data,
        `Current Month (${monthLabel})`,
      );
      const ytd = buildFinancialSnapshot(
        ytdIncome.data, ytdBalance.data, null,
        `YTD ${now.getFullYear()}`,
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ currentMonth, ytd }, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("get_financial_snapshot", err);
    }
  }
);

server.registerTool(
  "get_burn_rate",
  {
    description:
      "Compute monthly burn rate from the last 3-6 months of income statements. Shows trend (increasing/decreasing/stable), current cash position, and implied runway in months.",
    inputSchema: {
      months: z.number().optional().describe("Number of months to analyze (default: 6, min: 3)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
    },
  },
  async ({ months, entityId }) => {
    try {
      const numMonths = Math.max(months ?? 6, 3);
      const now = new Date();

      // Fetch income statements for each of the last N months
      const monthlyPromises = [];
      for (let i = numMonths; i >= 1; i--) {
        const range = getMonthRange(i, now);
        monthlyPromises.push(
          (financialStatementsApi as any)
            .caApiGetIncomeStatementRetrieve({
              startDate: range.dateFrom, endDate: range.dateTo, cadence: "monthly", entity: entityId,
            })
            .then((resp: any) => ({
              label: new Date(range.dateFrom).toLocaleString("default", { month: "short", year: "numeric" }),
              data: resp.data,
            }))
        );
      }

      // Fetch latest balance sheet for cash position
      const currentMonth = getCurrentMonthRange(now);
      const balancePromise = (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
        startDate: currentMonth.dateFrom, endDate: currentMonth.dateTo, cadence: "monthly", entity: entityId,
      });

      const [monthlyStatements, balanceResp] = await Promise.all([
        Promise.all(monthlyPromises),
        balancePromise,
      ]);

      const result = computeBurnRate(monthlyStatements, balanceResp.data);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return errorResult("get_burn_rate", err);
    }
  }
);

// --- EXISTING TOOLS (kept as-is for raw detail) ---

server.registerTool(
  "income_statement",
  {
    description:
      "Generate an income statement (P&L) for a specified period. Shows revenue, expenses, and net income. Use groupBy to break down by department or other dimensions.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      groupBy: z.string().optional().describe("Group results by dimension (e.g. 'department')"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId, groupBy }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
        startDate: dateFrom,
        endDate: dateTo,
        cadence,
        entity: entityId,
        groupBy,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("income_statement", err);
    }
  }
);

server.registerTool(
  "balance_sheet",
  {
    description:
      "Generate a balance sheet showing assets, liabilities, and equity for a specified period. Use groupBy to break down by department or other dimensions.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      groupBy: z.string().optional().describe("Group results by dimension (e.g. 'department')"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId, groupBy }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
        startDate: dateFrom,
        endDate: dateTo,
        cadence,
        entity: entityId,
        groupBy,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("balance_sheet", err);
    }
  }
);

server.registerTool(
  "cash_flow_statement",
  {
    description:
      "Generate a cash flow statement showing operating, investing, and financing activities. Use groupBy to break down by department or other dimensions.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      groupBy: z.string().optional().describe("Group results by dimension (e.g. 'department')"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId, groupBy }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetCashFlowRetrieve({
        startDate: dateFrom,
        endDate: dateTo,
        cadence,
        entity: entityId,
        groupBy,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("cash_flow_statement", err);
    }
  }
);

// --- ENRICHED EXISTING TOOLS ---

server.registerTool(
  "get_transactions",
  {
    description:
      "Retrieve general ledger transactions with filtering. Returns enriched summary with total debits/credits and breakdown by account type.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      accountId: z.number().optional().describe("Filter by account ID"),
      accountType: z.string().optional().describe("Filter by account type"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
      departmentId: z.number().optional().describe("Filter by department ID"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
  },
  async ({ dateFrom, dateTo, accountId, accountType, vendorId, departmentId, limit }) => {
    try {
      const params: Record<string, any> = { limit: limit ?? 100 };
      if (accountId) params.account = accountId;
      if (accountType) params.account_type = accountType;
      if (vendorId) params.vendor = vendorId;
      if (departmentId) params.department = departmentId;
      if (dateFrom) params.posted_at_gte = dateFrom;
      if (dateTo) params.posted_at_lte = dateTo;

      const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({ params });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = enrichTransactions(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_transactions", err);
    }
  }
);

server.registerTool(
  "get_accounts",
  {
    description:
      "Retrieve chart of accounts with optional filtering by type or search query.",
    inputSchema: {
      accountType: z.string().optional().describe("Filter by account type"),
      accountSubtype: z.string().optional().describe("Filter by account subtype"),
      q: z.string().optional().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
  },
  async ({ accountType, accountSubtype, q, limit }) => {
    try {
      const resp = await (companyApi as any).coaApiAccountList({
        limit: limit ?? 100,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_accounts", err);
    }
  }
);

server.registerTool(
  "get_vendors",
  {
    description:
      "Retrieve vendors with optional filtering by search query and type.",
    inputSchema: {
      q: z.string().optional().describe("Search query"),
      vendorType: z.string().optional().describe("Filter by vendor type"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
  },
  async ({ q, vendorType, limit }) => {
    try {
      const resp = await (companyApi as any).coaApiVendorList({
        q,
        vendorType,
        limit: limit ?? 100,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_vendors", err);
    }
  }
);

server.registerTool(
  "get_aging",
  {
    description:
      "Retrieve AP/AR aging reports with enriched summary: bucket totals, total outstanding, and 90+ day critical items highlighted.",
    inputSchema: {
      agingType: z.enum(["ap", "ar"]).optional().describe("Type: 'ap' for payables, 'ar' for receivables"),
      asOfDate: z.string().optional().describe("Date for aging calculation (YYYY-MM-DD)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
    },
  },
  async ({ agingType, asOfDate, entityId, vendorId }) => {
    try {
      // No dedicated aging endpoint — derive from bills (AP) or invoices (AR)
      // Fetch unpaid items which include past_due_days for aging analysis
      let raw: any[] = [];
      if (agingType === "ar") {
        const resp = await (arApi as any).coaApiV1InvoiceList({
          endDate: asOfDate,
          entity: entityId,
          limit: 200,
          offset: 0,
          status: "unpaid",
        });
        const invoices = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
        raw = invoices.map((inv: any) => ({
          customer_name: inv.client_name ?? inv.clientName,
          amount: Number(inv.amount_due ?? inv.amountDue ?? 0),
          days_outstanding: Number(inv.past_due_days ?? inv.pastDueDays ?? 0),
          invoice_number: inv.invoice_number ?? inv.invoiceNumber,
          due_date: inv.due_date ?? inv.dueDate,
        }));
      } else {
        const resp = await (apApi as any).coaApiV1BillRetrieve({
          endDate: asOfDate,
          entity: entityId,
          limit: 200,
          offset: 0,
          status: "unpaid",
          vendor: vendorId,
        });
        const bills = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
        raw = bills.map((b: any) => ({
          vendor_name: b.vendor_name ?? b.vendorName,
          amount: Number(b.amount_due ?? b.amountDue ?? 0),
          days_outstanding: Number(b.past_due_days ?? b.pastDueDays ?? 0),
          invoice_number: b.bill_number ?? b.billNumber,
          due_date: b.due_date ?? b.dueDate,
        }));
      }
      const result = analyzeAging(raw, agingType ?? "ap");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_aging", err);
    }
  }
);

server.registerTool(
  "get_contracts",
  {
    description:
      "Retrieve revenue recognition contracts with enriched summary: recognized vs remaining revenue, per-contract totals and percentages.",
    inputSchema: {
      q: z.string().optional().describe("Search query"),
      clientId: z.number().optional().describe("Filter by client ID"),
      status: z.string().optional().describe("Filter by contract status"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    },
  },
  async ({ q, clientId, status, limit }) => {
    try {
      const resp = await (revenueApi as any).listContracts({
        limit: limit ?? 50,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = analyzeContracts(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_contracts", err);
    }
  }
);

server.registerTool(
  "get_customers",
  {
    description:
      "Retrieve contract customers with financial summaries: total revenue, MRR, billed/unbilled/outstanding amounts, and contract counts per customer.",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
      includeDeleted: z.boolean().optional().describe("Include deleted customers"),
    },
  },
  async ({ limit, offset, includeDeleted }) => {
    try {
      const resp = await (revenueApi as any).rrApiV1CustomersList({
        includeDeleted,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeCustomers(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_customers", err);
    }
  }
);

server.registerTool(
  "trial_balance",
  {
    description:
      "Generate a trial balance report showing debits and credits per account, grouped by account type. Verifies that total debits equal total credits.",
    inputSchema: {
      startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      departmentId: z.number().optional().describe("Filter by department ID"),
    },
  },
  async ({ startDate, endDate, entityId, departmentId }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetTrialBalanceRetrieve({
        department: departmentId,
        endDate,
        entity: entityId,
        startDate,
      });
      const result = shapeTrialBalance(resp.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("trial_balance", err);
    }
  }
);

server.registerTool(
  "get_invoices",
  {
    description:
      "Retrieve invoices with filtering by status, date range, client, and search query. Returns summary with totals and breakdown by status. Status values: unpaid, paid, partially_paid, past_due, current, voided, uncollectible, sent, or aging buckets (1_30, 31_60, 61_90, 91_120, over_120).",
    inputSchema: {
      status: z.string().optional().describe("Filter by status: unpaid, paid, partially_paid, past_due, current, voided, uncollectible, 1_30, 31_60, 61_90, 91_120, over_120"),
      startDate: z.string().optional().describe("Filter invoices on or after this date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Filter invoices on or before this date (YYYY-MM-DD)"),
      clientId: z.number().optional().describe("Filter by client ID"),
      q: z.string().optional().describe("Search invoice numbers, addresses, client names"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
  },
  async ({ status, startDate, endDate, clientId, q, limit, offset }) => {
    try {
      const resp = await (arApi as any).coaApiV1InvoiceList({
        client: clientId,
        endDate,
        limit: limit ?? 50,
        offset: offset ?? 0,
        q,
        startDate,
        status,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeInvoices(raw);
      // Strip null/undefined values to minimize token usage
      const compact = JSON.stringify(result, (_k, v) => v ?? undefined, 2);
      return {
        content: [{ type: "text" as const, text: compact }],
      };
    } catch (err) {
      return errorResult("get_invoices", err);
    }
  }
);

// --- BUDGET TOOLS ---

server.registerTool(
  "get_budgets",
  {
    description:
      "List budgets with optional filtering by entity or search query. Returns summary with count, cadence breakdown, and each budget's entity/department names resolved.",
    inputSchema: {
      entityId: z.number().optional().describe("Filter by entity ID"),
      q: z.string().optional().describe("Search by budget name"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
  },
  async ({ entityId, q, limit, offset }) => {
    try {
      const resp = await (coreAccountingApi as any).coaApiBudgetsList({
        entity: entityId,
        q,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeBudgets(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_budgets", err);
    }
  }
);

server.registerTool(
  "get_budget_details",
  {
    description:
      "Get a single budget with all its account allocations. Returns budget metadata (entity, department, cadence, dates) plus allocations grouped by top-level account type and department, with totals. Use get_budgets first to find the budget ID.",
    inputSchema: {
      budgetId: z.number().describe("The budget ID (from get_budgets)"),
    },
  },
  async ({ budgetId }) => {
    try {
      const [budgetResp, allocResp] = await Promise.all([
        (coreAccountingApi as any).coaApiBudgetsRetrieve({ id: budgetId }),
        (coreAccountingApi as any).coaApiBudgetsAccountsList({ budgetPk: budgetId }),
      ]);
      const budget = budgetResp.data;
      const allocations = Array.isArray(allocResp.data) ? allocResp.data : allocResp.data?.results || [];
      const result = shapeBudgetDetail(budget, allocations);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_budget_details", err);
    }
  }
);

// --- UNCATEGORIZED TRANSACTIONS & BILLS ---

server.registerTool(
  "get_uncategorized_transactions",
  {
    description:
      "Retrieve uncategorized transactions grouped by vendor, with AI-suggested accounts and matching hints. Useful for finding transactions that need to be categorized or matched to bills.",
    inputSchema: {
      accountId: z.number().optional().describe("Narrow by specific account ID"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
      departmentId: z.number().optional().describe("Filter by department ID"),
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().describe("Max results (default: 100)"),
    },
  },
  async ({ accountId, vendorId, departmentId, dateFrom, dateTo, limit }) => {
    try {
      const params: Record<string, any> = {
        account_type: "UNCATEGORIZED",
        limit: limit ?? 100,
      };
      if (accountId) params.account = accountId;
      if (vendorId) params.vendor = vendorId;
      if (departmentId) params.department = departmentId;
      if (dateFrom) params.posted_at_gte = dateFrom;
      if (dateTo) params.posted_at_lte = dateTo;

      const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({ params });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeUncategorizedTransactions(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_uncategorized_transactions", err);
    }
  }
);

server.registerTool(
  "get_bills",
  {
    description:
      "Retrieve bills filtered by status, vendor, date range, and search query. Returns summary with totals by status and vendor. Status values: unpaid, paid, partially_paid, past_due, current, open, voided, payment_pending, payment_not_found, 1_30, 31_60, 61_90, 91_120, over_120.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status: unpaid, paid, partially_paid, past_due, current, open, voided, payment_pending, payment_not_found, 1_30, 31_60, 61_90, 91_120, over_120"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      startDate: z.string().optional().describe("Filter bills on or after this date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Filter bills on or before this date (YYYY-MM-DD)"),
      q: z.string().optional().describe("Search bill number, vendor name, etc."),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
  },
  async ({ status, vendorId, entityId, startDate, endDate, q, limit, offset }) => {
    try {
      const resp = await (apApi as any).coaApiV1BillRetrieve({
        endDate,
        entity: entityId,
        limit: limit ?? 50,
        offset: offset ?? 0,
        q,
        startDate,
        status,
        vendor: vendorId,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeBills(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_bills", err);
    }
  }
);

// --- DEPARTMENT TOOLS ---

server.registerTool(
  "get_departments",
  {
    description:
      "List departments with optional search and filtering. Use this to discover department IDs for filtering financial statements (via groupBy), transactions, trial balances, and budgets.",
    inputSchema: {
      q: z.string().optional().describe("Search by department name"),
      includeInactive: z.boolean().optional().describe("Include inactive departments (default: false)"),
      limit: z.number().optional().describe("Max results (default: 100)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
  },
  async ({ q, includeInactive, limit, offset }) => {
    try {
      const resp = await (companyApi as any).coaApiDepartmentList({
        q,
        includeInactive,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeDepartments(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_departments", err);
    }
  }
);

return server;
}

// --- START ---

async function main() {
  const port = process.env.PORT;

  if (port) {
    const app = createMcpExpressApp({ host: "0.0.0.0" });
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    app.all("/mcp", async (req: Request, res: Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };
        await createServer().connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    });

    app.listen(parseInt(port), "0.0.0.0", () => {
      console.error(`Campfire MCP Server listening on http://0.0.0.0:${port}/mcp`);
    });

    process.on("SIGINT", async () => {
      for (const sid in transports) {
        try { await transports[sid].close(); } catch {}
      }
      process.exit(0);
    });
  } else {
    const transport = new StdioServerTransport();
    await createServer().connect(transport);
    console.error("Campfire MCP Server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
