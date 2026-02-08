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

// --- TOOLS ---

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

server.registerTool(
  "get_transactions",
  {
    description:
      "Retrieve general ledger transactions with filtering by account, vendor, department, and date range.",
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
        undefined, // q
        accountId,
        accountType,
        undefined, // accountSubtype
        undefined, // entityId
        vendorId,
        departmentId,
        undefined, // tagId
        dateFrom,
        dateTo,
        limit ?? 100
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
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
      "Retrieve AP/AR aging reports grouped by age buckets. Shows outstanding receivables or payables.",
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
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
      "Retrieve revenue recognition contracts. Shows contract status, values, and revenue schedules.",
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_contracts", err);
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
