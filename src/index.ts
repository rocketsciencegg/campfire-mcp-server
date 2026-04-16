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
  shapeAccounts,
  shapeCreditMemos,
  shapeVendors,
  shapeChartTransaction,
  shapeJournalEntry,
  shapeInvoiceDetail,
  shapeBillDetail,
  shapeCreditMemoDetail,
  shapeDebitMemoDetail,
  shapeContractDetail,
  shapeCustomerDetail,
} from "./helpers.js";
import type { DetailLevel } from "./helpers.js";

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

const SERVER_INSTRUCTIONS = `Campfire identifier rules (applies to every tool):

- Every entity has ONE canonical numeric \`id\` — the integer in Campfire URLs (e.g. \`/v2/accounting/invoices/{id}\`) and the value stored in foreign-key fields returned by other tools (\`invoiceId\`, \`billId\`, \`journal\`, \`contractId\`, \`clientId\`, \`vendorId\`, \`accountId\`, etc.). Every by-id fetch tool (\`get_invoice\`, \`get_bill\`, \`get_journal_entry\`, …) accepts only this numeric id.
- Some entities ALSO return a printed display string — \`invoiceNumber\` (e.g. \`INV-0042\`), \`billNumber\` (also often \`INV-…\`), \`creditMemoNumber\` (e.g. \`CN-105\`), \`debitMemoNumber\`, a journal entry's \`order\` (shown in the UI as \`Transaction #0099999\`), or a chart transaction's UUID \`transactionId\`. These are NOT API ids. To look up an entity by a printed display string, call the corresponding LIST tool with \`q="…"\`, never a fetch-by-id tool.
- Collision warning: invoices and bills both print numbers like \`INV-…\`. The URL path (\`/invoices/…\` vs \`/bills/…\`) is the only reliable disambiguator.`;

function createServer() {
const server = new McpServer({
  name: "campfire-mcp-server",
  version: "2.5.0",
}, {
  instructions: SERVER_INSTRUCTIONS,
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
  "get_transaction",
  {
    description:
      "Fetch a single chart-transaction line (one debit OR one credit leg) by its canonical numeric id. The response includes `journal` (parent journal entry id) and `journalOrder` (the UI's \"Transaction #…\" display string). Do NOT pass a journal entry id from a URL like `/v2/accounting/journal-entry/{id}` — use `get_journal_entry` for those.",
    inputSchema: {
      id: z.number().describe("Numeric chart-transaction id (from get_transactions, or from a journal entry's transactions[].id). NOT the journal entry id from URLs."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve2({ id });
      const shaped = shapeChartTransaction(resp.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shaped, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_transaction", err);
    }
  }
);

server.registerTool(
  "get_journal_entry",
  {
    description:
      "Fetch a full journal entry (all debit/credit legs) by its canonical numeric id (the integer in URLs like `/v2/accounting/journal-entry/{id}`). The response includes `order` — the printed display string shown in the UI as \"Transaction #0099999\". For a single line-item, use `get_transaction` instead.",
    inputSchema: {
      id: z.number().describe("Numeric journal entry id (URL id). NOT the display \"Transaction #…\" number (that's the `order` string)."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (coreAccountingApi as any).coaApiJournalEntryRetrieve({ id });
      const shaped = shapeJournalEntry(resp.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shaped, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_journal_entry", err);
    }
  }
);

// --- Single-record fetch-by-id tools ---
// See SERVER_INSTRUCTIONS for the canonical id vs. printed display-number rules.

server.registerTool(
  "get_invoice",
  {
    description:
      "Fetch a single invoice by its canonical numeric id (the integer in URLs like /v2/accounting/invoices/{id}, or in `invoiceId`/`invoice_id` FKs returned by other tools). Do NOT pass the printed `invoiceNumber` like \"INV-0042\" — use `get_invoices` with q=\"INV-0042\" for that. Returns line items, amounts, client/contract refs.",
    inputSchema: {
      id: z.number().describe("Numeric invoice id (URL id). NOT the printed invoiceNumber like \"INV-0042\"."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (arApi as any).coaApiV1InvoiceRetrieve({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeInvoiceDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_invoice", err);
    }
  }
);

server.registerTool(
  "get_bill",
  {
    description:
      "Fetch a single bill (AP) by its canonical numeric id (the integer in URLs like /v2/accounting/bills/{id}, or in `billId`/`bill_id` FKs returned by other tools). Do NOT pass the printed `billNumber` (which often looks like \"INV-…\" even though it's a bill, not an invoice) — use `get_bills` with q=\"…\" for that. The URL path `/bills/…` vs `/invoices/…` is the only reliable disambiguator between an invoice and a bill with identical-looking numbers.",
    inputSchema: {
      id: z.number().describe("Numeric bill id (URL id). NOT the printed billNumber."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (apApi as any).coaApiV1BillRetrieve2({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeBillDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_bill", err);
    }
  }
);

server.registerTool(
  "get_credit_memo",
  {
    description:
      "Fetch a single credit memo (AR credit) by its canonical numeric id (the integer in URLs like /v2/accounting/credit-memos/{id}). Do NOT pass the printed `creditMemoNumber` like \"CN-105\" — use `get_credit_memos` with q=\"CN-105\" for that.",
    inputSchema: {
      id: z.number().describe("Numeric credit memo id (URL id). NOT the printed creditMemoNumber like \"CN-105\"."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (arApi as any).coaApiV1CreditMemoRetrieve({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeCreditMemoDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_credit_memo", err);
    }
  }
);

server.registerTool(
  "get_debit_memo",
  {
    description:
      "Fetch a single debit memo (AP debit) by its canonical numeric id (the integer in URLs like /v2/accounting/debit-memos/{id}). Do NOT pass the printed `debitMemoNumber` — there is no search-by-number endpoint for debit memos yet.",
    inputSchema: {
      id: z.number().describe("Numeric debit memo id (URL id). NOT the printed debitMemoNumber."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (apApi as any).coaApiV1DebitMemoRetrieve({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeDebitMemoDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_debit_memo", err);
    }
  }
);

server.registerTool(
  "get_contract",
  {
    description:
      "Fetch a single revenue contract by its canonical numeric id (the integer in URLs like /v2/revenue/contracts/{id}, or in `contractId`/`contract` FKs returned by other tools). Contracts have no Campfire-issued printed number; they may have a `dealName`/`dealId` from an external CRM (HubSpot), which is informational only. Use `get_contracts` to list/search.",
    inputSchema: {
      id: z.number().describe("Numeric contract id (URL id). NOT a CRM dealId (that's a separate external string)."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (revenueApi as any).rrApiV1ContractsRetrieve({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeContractDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_contract", err);
    }
  }
);

server.registerTool(
  "get_customer",
  {
    description:
      "Fetch a single customer by its canonical numeric id (the integer in URLs like /v2/revenue/customers/{id}, or in `clientId`/`client`/`customerId` FKs returned by other tools). Customers have no printed number — identity is the `name` field. Use `get_customers` with q=\"…\" to look up by name.",
    inputSchema: {
      id: z.number().describe("Numeric customer id (URL id). NOT the customer's name."),
    },
  },
  async ({ id }) => {
    try {
      const resp = await (revenueApi as any).rrApiV1CustomersRetrieve({ id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shapeCustomerDetail(resp.data), null, 2) }],
      };
    } catch (err) {
      return errorResult("get_customer", err);
    }
  }
);

server.registerTool(
  "get_transactions",
  {
    description:
      "Retrieve general ledger transactions with filtering. Returns enriched summary with total debits/credits and breakdown by account type. Auto-paginates to fetch all matching results.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD) — filters transactions on or after this date"),
      dateTo: z.string().optional().describe("End date (YYYY-MM-DD) — filters transactions on or before this date"),
      accountId: z.number().optional().describe("Filter by account ID"),
      accountType: z.string().optional().describe("Filter by account type"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
      departmentId: z.number().optional().describe("Filter by department ID"),
      limit: z.number().optional().describe("Max results per page (default: 100)"),
    },
  },
  async ({ dateFrom, dateTo, accountId, accountType, vendorId, departmentId, limit }) => {
    try {
      const pageSize = limit ?? 100;
      const params: Record<string, any> = { limit: pageSize };
      if (accountId) params.account = accountId;
      if (accountType) params.account_type = accountType;
      if (vendorId) params.vendor = vendorId;
      if (departmentId) params.department = departmentId;
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;

      // Auto-paginate to collect all results
      let allTransactions: any[] = [];
      let offset = 0;
      const maxPages = 20;
      for (let page = 0; page < maxPages; page++) {
        params.offset = offset;
        const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({ params });
        const items = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
        allTransactions = allTransactions.concat(items);
        // Stop if we got fewer than a full page (no more results)
        if (items.length < pageSize) break;
        offset += pageSize;
      }

      // Client-side date filtering as safety net (in case API ignores date params)
      if (dateFrom || dateTo) {
        allTransactions = allTransactions.filter((t: any) => {
          const d = t.posted_at ?? t.date ?? t.transaction_date;
          if (!d) return true;
          const ds = String(d).slice(0, 10);
          if (dateFrom && ds < dateFrom) return false;
          if (dateTo && ds > dateTo) return false;
          return true;
        });
      }

      const result = enrichTransactions(allTransactions);
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
      "Retrieve chart of accounts with optional filtering by type, subtype, or search query. Auto-paginates to fetch all matching accounts. Supports all account types: ASSET, LIABILITY, EQUITY, REVENUE, COGS, OPERATING_EXPENSES, OTHER_INCOME, OTHER_EXPENSE.",
    inputSchema: {
      accountType: z.string().optional().describe("Filter by account type (e.g. ASSET, LIABILITY, EQUITY, REVENUE, COGS, OPERATING_EXPENSES)"),
      accountSubtype: z.string().optional().describe("Filter by account subtype (e.g. BANK, ACCOUNTS_RECEIVABLE, DEFERRED_REVENUE)"),
      q: z.string().optional().describe("Search by account name or number"),
      includeInactive: z.boolean().optional().describe("Include inactive accounts (default: true)"),
      limit: z.number().optional().describe("Page size for API calls (default: 100)"),
    },
  },
  async ({ accountType, accountSubtype, q, includeInactive, limit }) => {
    try {
      const pageSize = limit ?? 100;
      let allAccounts: any[] = [];
      let offset = 0;
      const maxPages = 20;

      // Use coaApiAccountBalanceSheetList — the unified account list endpoint
      // that supports filtering by type, subtype, and search query
      for (let page = 0; page < maxPages; page++) {
        const resp = await (companyApi as any).coaApiAccountBalanceSheetList({
          accountType,
          accountSubtype,
          q,
          includeInactive,
          limit: pageSize,
          offset,
        });
        const items = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
        allAccounts = allAccounts.concat(items);
        if (items.length < pageSize) break;
        offset += pageSize;
      }

      const result = shapeAccounts(allAccounts);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
      "Retrieve vendors with optional filtering by search query and type. Use detail to control response size: summary (compact), normal (default, includes addresses/contacts), full (adds tax/compliance fields).",
    inputSchema: {
      q: z.string().optional().describe("Search query"),
      vendorType: z.string().optional().describe("Filter by vendor type"),
      limit: z.number().optional().describe("Max results (default: 100)"),
      detail: z.enum(["summary", "normal", "full"]).optional().describe("Response detail level (default: normal)"),
    },
  },
  async ({ q, vendorType, limit, detail }) => {
    try {
      const resp = await (companyApi as any).coaApiVendorList({
        q,
        vendorType,
        limit: limit ?? 100,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeVendors(raw, (detail ?? "normal") as DetailLevel);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
      "List/search revenue recognition contracts with enriched summary: recognized vs remaining revenue, per-contract totals and percentages. Use detail to control response size: summary (compact), normal (default, includes deal/financial/department info), full (adds auto-renew, evergreen, tags). For a single contract by id, use `get_contract`.",
    inputSchema: {
      q: z.string().optional().describe("Search query"),
      clientId: z.number().optional().describe("Filter by client ID"),
      status: z.string().optional().describe("Filter by contract status"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      detail: z.enum(["summary", "normal", "full"]).optional().describe("Response detail level (default: normal)"),
    },
  },
  async ({ q, clientId, status, limit, detail }) => {
    try {
      const resp = await (revenueApi as any).listContracts({
        q,
        client: clientId,
        status,
        limit: limit ?? 50,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = analyzeContracts(raw, (detail ?? "normal") as DetailLevel);
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
      "List/search customers with financial summaries: total revenue, MRR, billed/unbilled/outstanding amounts, and contract counts per customer. Use detail to control response size: summary (compact), normal (default, includes addresses/contacts/notes), full (adds tax/compliance fields). For a single customer by id, use `get_customer`.",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
      includeDeleted: z.boolean().optional().describe("Include deleted customers"),
      detail: z.enum(["summary", "normal", "full"]).optional().describe("Response detail level (default: normal)"),
    },
  },
  async ({ limit, offset, includeDeleted, detail }) => {
    try {
      const resp = await (revenueApi as any).rrApiV1CustomersList({
        includeDeleted,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeCustomers(raw, (detail ?? "normal") as DetailLevel);
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
      "List/search invoices with filtering by status, date range, client, and search query (`q` matches invoiceNumber, e.g. q=\"INV-0042\"). Returns summary with totals and breakdown by status. Use detail to control response size: summary (compact), normal (default, includes contract/dates/addresses), full (adds line items, payments, emails). Status values: unpaid, paid, partially_paid, past_due, current, voided, uncollectible, sent, or aging buckets (1_30, 31_60, 61_90, 91_120, over_120). For a single invoice by id, use `get_invoice`.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status: unpaid, paid, partially_paid, past_due, current, voided, uncollectible, 1_30, 31_60, 61_90, 91_120, over_120"),
      startDate: z.string().optional().describe("Filter invoices on or after this date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Filter invoices on or before this date (YYYY-MM-DD)"),
      clientId: z.number().optional().describe("Filter by client ID"),
      q: z.string().optional().describe("Search invoice numbers, addresses, client names"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
      detail: z.enum(["summary", "normal", "full"]).optional().describe("Response detail level (default: normal)"),
    },
  },
  async ({ status, startDate, endDate, clientId, q, limit, offset, detail }) => {
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
      const result = shapeInvoices(raw, (detail ?? "normal") as DetailLevel);
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
      const pageSize = limit ?? 100;
      const params: Record<string, any> = {
        account_type: "UNCATEGORIZED",
        limit: pageSize,
      };
      if (accountId) params.account = accountId;
      if (vendorId) params.vendor = vendorId;
      if (departmentId) params.department = departmentId;
      if (dateFrom) params.start_date = dateFrom;
      if (dateTo) params.end_date = dateTo;

      // Auto-paginate
      let allTransactions: any[] = [];
      let offset = 0;
      const maxPages = 20;
      for (let page = 0; page < maxPages; page++) {
        params.offset = offset;
        const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({ params });
        const items = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
        allTransactions = allTransactions.concat(items);
        if (items.length < pageSize) break;
        offset += pageSize;
      }

      // Client-side date filtering as safety net
      if (dateFrom || dateTo) {
        allTransactions = allTransactions.filter((t: any) => {
          const d = t.posted_at ?? t.date ?? t.transaction_date;
          if (!d) return true;
          const ds = String(d).slice(0, 10);
          if (dateFrom && ds < dateFrom) return false;
          if (dateTo && ds > dateTo) return false;
          return true;
        });
      }

      const result = shapeUncategorizedTransactions(allTransactions);
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
      "List/search bills filtered by status, vendor, date range, and search query (`q` matches billNumber, e.g. q=\"INV-0171\"). Returns summary with totals by status and vendor. Use detail to control response size: summary (compact), normal (default, includes department/PO/currency/address), full (adds line items, payments, attachments). Status values: unpaid, paid, partially_paid, past_due, current, open, voided, payment_pending, payment_not_found, 1_30, 31_60, 61_90, 91_120, over_120. For a single bill by id, use `get_bill`.",
    inputSchema: {
      status: z.string().optional().describe("Filter by status: unpaid, paid, partially_paid, past_due, current, open, voided, payment_pending, payment_not_found, 1_30, 31_60, 61_90, 91_120, over_120"),
      vendorId: z.number().optional().describe("Filter by vendor ID"),
      entityId: z.number().optional().describe("Filter by entity ID"),
      startDate: z.string().optional().describe("Filter bills on or after this date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Filter bills on or before this date (YYYY-MM-DD)"),
      q: z.string().optional().describe("Search bill number, vendor name, etc."),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
      detail: z.enum(["summary", "normal", "full"]).optional().describe("Response detail level (default: normal)"),
    },
  },
  async ({ status, vendorId, entityId, startDate, endDate, q, limit, offset, detail }) => {
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
      const result = shapeBills(raw, (detail ?? "normal") as DetailLevel);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_bills", err);
    }
  }
);

// --- CREDIT MEMO TOOLS ---

server.registerTool(
  "get_credit_memos",
  {
    description:
      "List/search credit memos with filtering by status, date range, client, and search query (`q` matches creditMemoNumber, e.g. q=\"CN-105\"). Returns summary with totals, amount used/remaining, and breakdown by status. Status values: open, partially_used, used, voided. For a single credit memo by id, use `get_credit_memo`.",
    inputSchema: {
      status: z.enum(["open", "partially_used", "used", "voided"]).optional()
        .describe("Filter by status: open, partially_used, used, voided"),
      startDate: z.string().optional().describe("Filter credit memos on or after this date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("Filter credit memos on or before this date (YYYY-MM-DD)"),
      clientId: z.number().optional().describe("Filter by client ID"),
      q: z.string().optional().describe("Search credit memo numbers, messages, client names"),
      limit: z.number().optional().describe("Max results (default: 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
  },
  async ({ status, startDate, endDate, clientId, q, limit, offset }) => {
    try {
      const resp = await (arApi as any).coaApiV1CreditMemoList({
        client: clientId ? [clientId] : undefined,
        endDate,
        limit: limit ?? 50,
        offset: offset ?? 0,
        q,
        startDate,
        status,
      });
      const raw = Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
      const result = shapeCreditMemos(raw);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return errorResult("get_credit_memos", err);
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
