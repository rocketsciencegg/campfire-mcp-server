#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  shapeTrialBalance,
} from "./helpers.js";

const server = new McpServer({
  name: "campfire-mcp-server",
  version: "1.0.0",
});

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
        (financialStatementsApi as any).caApiGetIncomeStatementRetrieve(
          monthRange.dateFrom, monthRange.dateTo, "monthly", entityId
        ),
        (financialStatementsApi as any).caApiGetBalanceSheetRetrieve(
          monthRange.dateFrom, monthRange.dateTo, "monthly", entityId
        ),
        (financialStatementsApi as any).caApiGetCashFlowRetrieve(
          monthRange.dateFrom, monthRange.dateTo, "monthly", entityId
        ),
      ]);

      // Fetch YTD statements
      const [ytdIncome, ytdBalance] = await Promise.all([
        (financialStatementsApi as any).caApiGetIncomeStatementRetrieve(
          ytdRange.dateFrom, ytdRange.dateTo, "monthly", entityId
        ),
        (financialStatementsApi as any).caApiGetBalanceSheetRetrieve(
          ytdRange.dateFrom, ytdRange.dateTo, "monthly", entityId
        ),
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
            .caApiGetIncomeStatementRetrieve(range.dateFrom, range.dateTo, "monthly", entityId)
            .then((resp: any) => ({
              label: new Date(range.dateFrom).toLocaleString("default", { month: "short", year: "numeric" }),
              data: resp.data,
            }))
        );
      }

      // Fetch latest balance sheet for cash position
      const currentMonth = getCurrentMonthRange(now);
      const balancePromise = (financialStatementsApi as any).caApiGetBalanceSheetRetrieve(
        currentMonth.dateFrom, currentMonth.dateTo, "monthly", entityId
      );

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
      "Generate an income statement (P&L) for a specified period. Shows revenue, expenses, and net income.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetIncomeStatementRetrieve(
        dateFrom, dateTo, cadence, entityId
      );
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
      "Generate a balance sheet showing assets, liabilities, and equity for a specified period.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetBalanceSheetRetrieve(
        dateFrom, dateTo, cadence, entityId
      );
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
      "Generate a cash flow statement showing operating, investing, and financing activities.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      cadence: z.enum(["monthly", "quarterly", "yearly"]).optional()
        .describe("Reporting cadence (default: monthly)"),
      entityId: z.number().optional().describe("Filter by entity ID"),
    },
  },
  async ({ dateFrom, dateTo, cadence, entityId }) => {
    try {
      const resp = await (financialStatementsApi as any).caApiGetCashFlowRetrieve(
        dateFrom, dateTo, cadence, entityId
      );
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
      const resp = await (coreAccountingApi as any).caApiGetTransactionsList(
        undefined, accountId, accountType, undefined, undefined,
        vendorId, departmentId, undefined, dateFrom, dateTo, limit ?? 100
      );
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
      const resp = await (coaApi as any).caApiGetAccountsList(
        accountType, accountSubtype, q, limit ?? 100
      );
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
      const resp = await (companyApi as any).caApiGetVendorsList(
        q, vendorType, limit ?? 100
      );
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
      const resp = await (coreAccountingApi as any).caApiGetAgingList(
        agingType, asOfDate, entityId, vendorId
      );
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = analyzeAging(raw, agingType);
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
      const resp = await (revenueApi as any).caApiGetContractsList(
        q, clientId, undefined, status, limit ?? 50
      );
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
      const resp = await (financialStatementsApi as any).caApiGetTrialBalanceRetrieve(
        departmentId, endDate, entityId, undefined, undefined, startDate
      );
      const result = shapeTrialBalance(resp.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("trial_balance", err);
    }
  }
);

// --- START ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Campfire MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
