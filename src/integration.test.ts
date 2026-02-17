/**
 * Integration tests for Campfire MCP Server.
 *
 * These hit the live Campfire API — they are excluded from the default test suite.
 * Run with:
 *   npm run test:integration          (CAMPFIRE_API_KEY must be set)
 *   just test-integration             (loads .env.op automatically)
 */

import { describe, it, expect } from "vitest";
import {
  FinancialStatementsApi,
  CoreAccountingApi,
  AccountsPayableApi,
  AccountsReceivableApi,
  RevenueRecognitionApi,
  CompanyObjectsApi,
  Configuration,
} from "campfire-typescript-sdk";
import {
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
  getCurrentMonthRange,
  getCurrentYTDRange,
  getMonthRange,
} from "./helpers.js";

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

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractRaw(resp: any): any[] {
  return Array.isArray(resp.data) ? resp.data : resp.data?.results || [];
}

// ─── 1. get_departments ────────────────────────────────────────────────────

describe("get_departments", () => {
  it("lists departments from the API", async () => {
    const resp = await (companyApi as any).coaApiDepartmentList({ limit: 10 });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);
    if (raw.length === 0) return;

    const result = shapeDepartments(raw);
    expect(result.totalDepartments).toBeGreaterThan(0);
    expect(result.departments[0]).toHaveProperty("id");
    expect(result.departments[0]).toHaveProperty("name");
  });

  it("supports search by name (q param)", async () => {
    const resp = await (companyApi as any).coaApiDepartmentList({ limit: 1 });
    const raw = extractRaw(resp);
    if (raw.length === 0) return;

    const name = raw[0].name;
    const searchResp = await (companyApi as any).coaApiDepartmentList({ q: name, limit: 10 });
    const searchRaw = extractRaw(searchResp);
    expect(searchRaw.length).toBeGreaterThan(0);
    expect(searchRaw.some((d: any) => d.name === name)).toBe(true);
  });

  it("supports includeInactive param", async () => {
    const resp = await (companyApi as any).coaApiDepartmentList({
      includeInactive: true,
      limit: 100,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);
  });
});

// ─── 2. income_statement ───────────────────────────────────────────────────

describe("income_statement", () => {
  it("returns data with date range and cadence", async () => {
    const resp = await (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
    });
    expect(resp.data).toBeDefined();
  });

  it("accepts groupBy=department", async () => {
    const resp = await (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
      groupBy: "department",
    });
    expect(resp.data).toBeDefined();
  });

  it("accepts monthly cadence with short range", async () => {
    const resp = await (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
      startDate: "2025-07-01",
      endDate: "2025-09-30",
      cadence: "monthly",
    });
    expect(resp.data).toBeDefined();
  });
});

// ─── 3. balance_sheet ──────────────────────────────────────────────────────

describe("balance_sheet", () => {
  it("returns data with date range", async () => {
    const resp = await (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
    });
    expect(resp.data).toBeDefined();
  });

  it("accepts groupBy=department", async () => {
    const resp = await (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
      groupBy: "department",
    });
    expect(resp.data).toBeDefined();
  });
});

// ─── 4. cash_flow_statement ────────────────────────────────────────────────

describe("cash_flow_statement", () => {
  it("returns data with date range", async () => {
    const resp = await (financialStatementsApi as any).caApiGetCashFlowRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
    });
    expect(resp.data).toBeDefined();
  });

  it("accepts groupBy=department", async () => {
    const resp = await (financialStatementsApi as any).caApiGetCashFlowRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      cadence: "yearly",
      groupBy: "department",
    });
    expect(resp.data).toBeDefined();
  });
});

// ─── 5. trial_balance ──────────────────────────────────────────────────────

describe("trial_balance", () => {
  it("returns shaped data with date range", async () => {
    const resp = await (financialStatementsApi as any).caApiGetTrialBalanceRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    const result = shapeTrialBalance(resp.data);
    expect(result.accountCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalDebits).toBe("number");
    expect(typeof result.totalCredits).toBe("number");
  });

  it("accepts departmentId filter", async () => {
    // First get a department
    const deptResp = await (companyApi as any).coaApiDepartmentList({ limit: 1 });
    const depts = extractRaw(deptResp);
    if (depts.length === 0) return;

    const resp = await (financialStatementsApi as any).caApiGetTrialBalanceRetrieve({
      department: depts[0].id,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    const result = shapeTrialBalance(resp.data);
    expect(typeof result.totalDebits).toBe("number");
  });
});

// ─── 6. get_financial_snapshot ─────────────────────────────────────────────

describe("get_financial_snapshot", () => {
  it("returns snapshot for current month and YTD", async () => {
    const now = new Date();
    const monthRange = getCurrentMonthRange(now);
    const ytdRange = getCurrentYTDRange(now);

    const [monthIncome, monthBalance, monthCashFlow] = await Promise.all([
      (financialStatementsApi as any).caApiGetIncomeStatementRetrieve({
        startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly",
      }),
      (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
        startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly",
      }),
      (financialStatementsApi as any).caApiGetCashFlowRetrieve({
        startDate: monthRange.dateFrom, endDate: monthRange.dateTo, cadence: "monthly",
      }),
    ]);

    const snapshot = buildFinancialSnapshot(
      monthIncome.data, monthBalance.data, monthCashFlow.data, "test",
    );
    expect(snapshot).toHaveProperty("revenue");
    expect(snapshot).toHaveProperty("expenses");
    expect(snapshot).toHaveProperty("netIncome");
  });
});

// ─── 7. get_burn_rate ──────────────────────────────────────────────────────

describe("get_burn_rate", () => {
  it("computes burn rate from last 3 months", async () => {
    const now = new Date();
    const monthlyPromises = [];
    for (let i = 3; i >= 1; i--) {
      const range = getMonthRange(i, now);
      monthlyPromises.push(
        (financialStatementsApi as any)
          .caApiGetIncomeStatementRetrieve({
            startDate: range.dateFrom, endDate: range.dateTo, cadence: "monthly",
          })
          .then((resp: any) => ({ label: range.dateFrom, data: resp.data }))
      );
    }
    const currentMonth = getCurrentMonthRange(now);
    const [monthlyStatements, balanceResp] = await Promise.all([
      Promise.all(monthlyPromises),
      (financialStatementsApi as any).caApiGetBalanceSheetRetrieve({
        startDate: currentMonth.dateFrom, endDate: currentMonth.dateTo, cadence: "monthly",
      }),
    ]);

    const result = computeBurnRate(monthlyStatements, balanceResp.data);
    expect(result).toHaveProperty("monthlyBurnAvg");
    expect(result).toHaveProperty("monthlyBurns");
    expect(result).toHaveProperty("trend");
    expect(result.monthlyBurns).toHaveLength(3);
  });
});

// ─── 8. get_transactions ───────────────────────────────────────────────────

describe("get_transactions", () => {
  it("returns transactions with default limit", async () => {
    const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({
      params: { limit: 5 },
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = enrichTransactions(raw);
    expect(typeof result.totalTransactions).toBe("number");
    expect(typeof result.totalDebits).toBe("number");
    expect(typeof result.totalCredits).toBe("number");
  });

  it("filters by date range", async () => {
    const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({
      params: {
        limit: 5,
        posted_at_gte: "2025-01-01",
        posted_at_lte: "2025-06-30",
      },
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);
  });
});

// ─── 9. get_accounts ───────────────────────────────────────────────────────

describe("get_accounts", () => {
  it("returns chart of accounts", async () => {
    const resp = await (companyApi as any).coaApiAccountList({ limit: 10 });
    const data = resp.data;
    // Could be paginated or direct array
    const accounts = Array.isArray(data) ? data : data?.results || [];
    expect(Array.isArray(accounts)).toBe(true);
    if (accounts.length === 0) return;

    expect(accounts[0]).toHaveProperty("id");
    expect(accounts[0]).toHaveProperty("name");
  });

  it("respects limit parameter", async () => {
    const resp = await (companyApi as any).coaApiAccountList({ limit: 3 });
    const accounts = extractRaw(resp);
    expect(accounts.length).toBeLessThanOrEqual(3);
  });
});

// ─── 10. get_vendors ───────────────────────────────────────────────────────

describe("get_vendors", () => {
  it("returns vendor list", async () => {
    const resp = await (companyApi as any).coaApiVendorList({ limit: 10 });
    const vendors = extractRaw(resp);
    expect(Array.isArray(vendors)).toBe(true);
  });

  it("supports search by name (q param)", async () => {
    // Get a vendor name first
    const resp = await (companyApi as any).coaApiVendorList({ limit: 1 });
    const vendors = extractRaw(resp);
    if (vendors.length === 0) return;

    const name = vendors[0].name;
    const searchResp = await (companyApi as any).coaApiVendorList({ q: name, limit: 10 });
    const searchResults = extractRaw(searchResp);
    expect(searchResults.length).toBeGreaterThan(0);
  });
});

// ─── 11. get_aging ─────────────────────────────────────────────────────────

describe("get_aging", () => {
  it("returns AP aging (unpaid bills)", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      limit: 10,
      offset: 0,
      status: "unpaid",
    });
    const bills = extractRaw(resp);
    expect(Array.isArray(bills)).toBe(true);

    const raw = bills.map((b: any) => ({
      vendor_name: b.vendor_name ?? b.vendorName,
      amount: Number(b.amount_due ?? b.amountDue ?? 0),
      days_outstanding: Number(b.past_due_days ?? b.pastDueDays ?? 0),
      invoice_number: b.bill_number ?? b.billNumber,
      due_date: b.due_date ?? b.dueDate,
    }));
    const result = analyzeAging(raw, "ap");
    expect(result.type).toBe("ap");
    expect(typeof result.totalOutstanding).toBe("number");
    expect(result).toHaveProperty("buckets");
  });

  it("returns AR aging (unpaid invoices)", async () => {
    const resp = await (arApi as any).coaApiV1InvoiceList({
      limit: 10,
      offset: 0,
      status: "unpaid",
    });
    const invoices = extractRaw(resp);
    expect(Array.isArray(invoices)).toBe(true);

    const raw = invoices.map((inv: any) => ({
      customer_name: inv.client_name ?? inv.clientName,
      amount: Number(inv.amount_due ?? inv.amountDue ?? 0),
      days_outstanding: Number(inv.past_due_days ?? inv.pastDueDays ?? 0),
      invoice_number: inv.invoice_number ?? inv.invoiceNumber,
      due_date: inv.due_date ?? inv.dueDate,
    }));
    const result = analyzeAging(raw, "ar");
    expect(result.type).toBe("ar");
    expect(typeof result.totalOutstanding).toBe("number");
  });

  it("accepts endDate filter on bills", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      endDate: "2025-12-31",
      limit: 5,
      offset: 0,
      status: "unpaid",
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });
});

// ─── 12. get_contracts ─────────────────────────────────────────────────────

describe("get_contracts", () => {
  it("returns contracts list", async () => {
    const resp = await (revenueApi as any).listContracts({ limit: 10 });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = analyzeContracts(raw);
    expect(typeof result.totalContracts).toBe("number");
    expect(typeof result.totalRevenue).toBe("number");
    expect(typeof result.totalRecognized).toBe("number");
    expect(typeof result.totalRemaining).toBe("number");
  });
});

// ─── 13. get_customers ─────────────────────────────────────────────────────

describe("get_customers", () => {
  it("returns customers list", async () => {
    const resp = await (revenueApi as any).rrApiV1CustomersList({
      limit: 10,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = shapeCustomers(raw);
    expect(typeof result.totalCustomers).toBe("number");
    expect(typeof result.totalRevenue).toBe("number");
  });

  it("respects limit and offset", async () => {
    const resp = await (revenueApi as any).rrApiV1CustomersList({
      limit: 2,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(raw.length).toBeLessThanOrEqual(2);
  });
});

// ─── 14. get_invoices ──────────────────────────────────────────────────────

describe("get_invoices", () => {
  it("returns shaped invoices with compact fields", async () => {
    const resp = await (arApi as any).coaApiV1InvoiceList({
      limit: 5,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = shapeInvoices(raw);
    expect(typeof result.totalInvoices).toBe("number");
    expect(typeof result.totalAmount).toBe("number");
    expect(typeof result.totalDue).toBe("number");

    // Verify compact shape — removed fields should not appear
    if (result.invoices.length > 0) {
      const inv = result.invoices[0];
      expect(inv).toHaveProperty("id");
      expect(inv).toHaveProperty("invoiceNumber");
      expect(inv).toHaveProperty("status");
      expect(inv).toHaveProperty("totalAmount");
      expect(inv).toHaveProperty("amountDue");
      // These were removed for compactness
      expect(inv.contractName).toBeUndefined();
      expect(inv.entityName).toBeUndefined();
      expect(inv.paidDate).toBeUndefined();
      expect(inv.currency).toBeUndefined();
      expect(inv.paymentTerms).toBeUndefined();
    }
  });

  it("filters by status", async () => {
    const resp = await (arApi as any).coaApiV1InvoiceList({
      status: "paid",
      limit: 5,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);
    // If there are paid invoices, verify they're all paid
    for (const inv of raw) {
      expect(inv.status).toBe("paid");
    }
  });

  it("filters by date range", async () => {
    const resp = await (arApi as any).coaApiV1InvoiceList({
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      limit: 5,
      offset: 0,
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });

  it("supports search (q param)", async () => {
    const resp = await (arApi as any).coaApiV1InvoiceList({
      q: "INV",
      limit: 5,
      offset: 0,
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });
});

// ─── 15. get_budgets ───────────────────────────────────────────────────────

describe("get_budgets", () => {
  it("returns budget list", async () => {
    const resp = await (coreAccountingApi as any).coaApiBudgetsList({
      limit: 10,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = shapeBudgets(raw);
    expect(typeof result.totalBudgets).toBe("number");
    expect(result).toHaveProperty("byCadence");
  });
});

// ─── 16. get_budget_details ────────────────────────────────────────────────

describe("get_budget_details", () => {
  it("returns budget with allocations", async () => {
    // First get a budget ID
    const listResp = await (coreAccountingApi as any).coaApiBudgetsList({
      limit: 1,
      offset: 0,
    });
    const budgets = extractRaw(listResp);
    if (budgets.length === 0) return;

    const budgetId = budgets[0].id;
    const [budgetResp, allocResp] = await Promise.all([
      (coreAccountingApi as any).coaApiBudgetsRetrieve({ id: budgetId }),
      (coreAccountingApi as any).coaApiBudgetsAccountsList({ budgetPk: budgetId }),
    ]);

    const allocations = extractRaw(allocResp);
    const result = shapeBudgetDetail(budgetResp.data, allocations);
    expect(result.id).toBe(budgetId);
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("totalBudgeted");
    expect(result).toHaveProperty("byAccountType");
    expect(result).toHaveProperty("byDepartment");
  });
});

// ─── 17. get_uncategorized_transactions ────────────────────────────────────

describe("get_uncategorized_transactions", () => {
  it("returns uncategorized transactions", async () => {
    const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({
      params: {
        account_type: "UNCATEGORIZED",
        limit: 5,
      },
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = shapeUncategorizedTransactions(raw);
    expect(typeof result.totalCount).toBe("number");
    expect(typeof result.totalAmount).toBe("number");
    expect(result).toHaveProperty("byVendor");
  });

  it("filters by date range", async () => {
    const resp = await (coreAccountingApi as any).coaApiTransactionRetrieve({
      params: {
        account_type: "UNCATEGORIZED",
        limit: 5,
        posted_at_gte: "2025-01-01",
        posted_at_lte: "2025-12-31",
      },
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });
});

// ─── 18. get_bills ─────────────────────────────────────────────────────────

describe("get_bills", () => {
  it("returns shaped bills", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      limit: 5,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);

    const result = shapeBills(raw);
    expect(typeof result.totalBills).toBe("number");
    expect(typeof result.totalAmount).toBe("number");
    expect(result).toHaveProperty("byStatus");
    expect(result).toHaveProperty("byVendor");
  });

  it("filters by status", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      status: "paid",
      limit: 5,
      offset: 0,
    });
    const raw = extractRaw(resp);
    expect(Array.isArray(raw)).toBe(true);
    for (const b of raw) {
      expect(b.status).toBe("paid");
    }
  });

  it("filters by date range", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      limit: 5,
      offset: 0,
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });

  it("supports search (q param)", async () => {
    const resp = await (apApi as any).coaApiV1BillRetrieve({
      q: "BILL",
      limit: 5,
      offset: 0,
    });
    expect(Array.isArray(extractRaw(resp))).toBe(true);
  });
});
