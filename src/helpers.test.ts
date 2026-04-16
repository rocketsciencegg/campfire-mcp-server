import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
const chartTransactionFixture = loadFixture("chart-transaction.json");
const journalEntryFixture = loadFixture("journal-entry.json");
const invoiceFixture = loadFixture("invoice.json");
const billFixture = loadFixture("bill.json");
const creditMemoFixture = loadFixture("credit-memo.json");
const debitMemoFixture = loadFixture("debit-memo.json");
const contractFixture = loadFixture("contract.json");
const customerFixture = loadFixture("customer.json");

// --- Date helpers ---

describe("getMonthRange", () => {
  const ref = new Date(2026, 1, 8); // Feb 8, 2026

  it("returns current month range for monthsAgo=0", () => {
    const r = getMonthRange(0, ref);
    expect(r.dateFrom).toBe("2026-02-01");
    expect(r.dateTo).toBe("2026-02-28");
  });

  it("returns last month range for monthsAgo=1", () => {
    const r = getMonthRange(1, ref);
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.dateTo).toBe("2026-01-31");
  });

  it("returns 3 months ago correctly", () => {
    const r = getMonthRange(3, ref);
    expect(r.dateFrom).toBe("2025-11-01");
    expect(r.dateTo).toBe("2025-11-30");
  });
});

describe("getCurrentYTDRange", () => {
  it("returns Jan 1 through today", () => {
    const ref = new Date(2026, 1, 8);
    const r = getCurrentYTDRange(ref);
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.dateTo).toBe("2026-02-08");
  });
});

describe("getCurrentMonthRange", () => {
  it("returns first of month through today", () => {
    const ref = new Date(2026, 1, 8);
    const r = getCurrentMonthRange(ref);
    expect(r.dateFrom).toBe("2026-02-01");
    expect(r.dateTo).toBe("2026-02-08");
  });
});

// --- Financial Snapshot ---

describe("buildFinancialSnapshot", () => {
  const incomeStatement = [
    { name: "Revenue", total: 500000 },
    { name: "Cost of Goods Sold", total: 200000 },
    { name: "Operating Expenses", total: 350000 },
    { name: "Net Income", total: 150000 },
  ];

  const balanceSheet = {
    "Cash and Cash Equivalents": { total: 800000 },
    "Total Current Assets": { total: 1200000 },
    "Total Current Liabilities": { total: 400000 },
  };

  const cashFlow = {}; // not heavily used yet

  it("extracts key financial metrics", () => {
    const snap = buildFinancialSnapshot(incomeStatement, balanceSheet, cashFlow, "Jan 2026");
    expect(snap.period).toBe("Jan 2026");
    expect(snap.revenue).toBe(500000);
    expect(snap.netIncome).toBe(150000);
    expect(snap.cashPosition).toBe(800000);
  });

  it("computes gross margin correctly", () => {
    const snap = buildFinancialSnapshot(incomeStatement, balanceSheet, cashFlow, "Jan 2026");
    // gross profit = 500000 - 200000 = 300000, margin = 60%
    expect(snap.grossMarginPercent).toBe(60);
  });

  it("computes net margin correctly", () => {
    const snap = buildFinancialSnapshot(incomeStatement, balanceSheet, cashFlow, "Jan 2026");
    // net margin = 150000 / 500000 = 30%
    expect(snap.netMarginPercent).toBe(30);
  });

  it("computes current ratio", () => {
    const snap = buildFinancialSnapshot(incomeStatement, balanceSheet, cashFlow, "Jan 2026");
    // 1200000 / 400000 = 3.0
    expect(snap.currentRatio).toBe(3);
  });

  it("handles empty data gracefully", () => {
    const snap = buildFinancialSnapshot(null, null, null, "Empty");
    expect(snap.revenue).toBe(0);
    expect(snap.netIncome).toBe(0);
    expect(snap.cashPosition).toBeNull();
    expect(snap.grossMarginPercent).toBeNull();
    expect(snap.currentRatio).toBeNull();
  });

  it("handles nested section format", () => {
    const nested = {
      revenue: [{ amount: 100000 }, { amount: 50000 }],
    };
    const snap = buildFinancialSnapshot(nested, {}, {}, "Nested");
    // extractTotal should find "revenue" key and sum rows
    expect(snap.revenue).toBe(150000);
  });
});

  it("handles array with nested children/rows", () => {
    // This tests the recursive branch in extractTotal (lines 320-324)
    const data = [
      {
        name: "Operating",
        children: [
          { name: "Revenue", total: 200000 },
        ],
      },
    ];
    const snap = buildFinancialSnapshot(data, {}, {}, "Nested Array");
    expect(snap.revenue).toBe(200000);
  });

  it("handles label/title/account_name aliases in extractTotal", () => {
    const data = [
      { label: "Sales Revenue", amount: 75000 },
      { title: "Total Expenses", value: 50000 },
    ];
    const snap = buildFinancialSnapshot(data, {}, {}, "Aliases");
    expect(snap.revenue).toBe(75000);
    expect(snap.expenses).toBe(50000);
  });

  it("handles object with number value directly", () => {
    const data = { revenue: 300000, expense: 180000 };
    const snap = buildFinancialSnapshot(data, {}, {}, "Direct");
    expect(snap.revenue).toBe(300000);
    expect(snap.expenses).toBe(180000);
  });

  it("handles object with .amount sub-property", () => {
    const data = { revenue: { amount: 400000 } };
    const snap = buildFinancialSnapshot(data, {}, {}, "Amount");
    expect(snap.revenue).toBe(400000);
  });

  it("recurses into nested objects", () => {
    const bs = {
      assets: {
        current: {
          "Cash and Cash Equivalents": 250000,
        },
      },
    };
    const snap = buildFinancialSnapshot([], bs, {}, "Deep");
    expect(snap.cashPosition).toBe(250000);
  });

// --- Burn Rate ---

describe("computeBurnRate", () => {
  const months = [
    { label: "Nov 2025", data: [{ name: "Revenue", total: 80000 }, { name: "Expenses", total: 100000 }] },
    { label: "Dec 2025", data: [{ name: "Revenue", total: 85000 }, { name: "Expenses", total: 105000 }] },
    { label: "Jan 2026", data: [{ name: "Revenue", total: 90000 }, { name: "Expenses", total: 110000 }] },
  ];

  const balanceSheet = { "Cash": { total: 500000 } };

  it("computes average burn rate", () => {
    const result = computeBurnRate(months, balanceSheet);
    // Burns: 20000, 20000, 20000 → avg 20000
    expect(result.monthlyBurnAvg).toBe(20000);
  });

  it("computes runway from cash and burn", () => {
    const result = computeBurnRate(months, balanceSheet);
    // 500000 / 20000 = 25 months
    expect(result.runwayMonths).toBe(25);
  });

  it("detects stable trend when burns are equal", () => {
    const result = computeBurnRate(months, balanceSheet);
    expect(result.trend).toBe("stable");
  });

  it("detects increasing burn", () => {
    const increasing = [
      { label: "M1", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 60000 }] },
      { label: "M2", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 70000 }] },
      { label: "M3", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 80000 }] },
      { label: "M4", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 90000 }] },
    ];
    const result = computeBurnRate(increasing, balanceSheet);
    expect(result.trend).toBe("increasing");
  });

  it("detects decreasing burn", () => {
    const decreasing = [
      { label: "M1", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 90000 }] },
      { label: "M2", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 80000 }] },
      { label: "M3", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 70000 }] },
      { label: "M4", data: [{ name: "Revenue", total: 50000 }, { name: "Expenses", total: 60000 }] },
    ];
    const result = computeBurnRate(decreasing, balanceSheet);
    expect(result.trend).toBe("decreasing");
  });

  it("handles empty months array", () => {
    const result = computeBurnRate([], balanceSheet);
    expect(result.monthlyBurnAvg).toBe(0);
    expect(result.monthlyBurns).toHaveLength(0);
    expect(result.runwayMonths).toBeNull();
  });
});

// --- Transaction enrichment ---

describe("enrichTransactions", () => {
  const txns = [
    {
      id: 1,
      date: "2026-01-15",
      description: "Office rent",
      account_name: "Rent Expense",
      account_type: "Expense",
      vendor_name: "Landlord Inc",
      debit_amount: 5000,
      credit_amount: 0,
    },
    {
      id: 2,
      date: "2026-01-16",
      description: "Client payment",
      account_name: "Accounts Receivable",
      account_type: "Asset",
      vendor_name: null,
      debit_amount: 0,
      credit_amount: 15000,
    },
    {
      id: 3,
      date: "2026-01-17",
      description: "Software subscription",
      account_name: "Software Expense",
      account_type: "Expense",
      vendor_name: "SaaS Co",
      debit_amount: 200,
      credit_amount: 0,
    },
  ];

  it("computes total debits and credits", () => {
    const result = enrichTransactions(txns);
    expect(result.totalDebits).toBe(5200);
    expect(result.totalCredits).toBe(15000);
  });

  it("counts transactions", () => {
    const result = enrichTransactions(txns);
    expect(result.totalTransactions).toBe(3);
  });

  it("groups by account type", () => {
    const result = enrichTransactions(txns);
    expect(result.byAccountType["Expense"].count).toBe(2);
    expect(result.byAccountType["Expense"].debits).toBe(5200);
    expect(result.byAccountType["Asset"].count).toBe(1);
    expect(result.byAccountType["Asset"].credits).toBe(15000);
  });

  it("shapes individual transactions", () => {
    const result = enrichTransactions(txns);
    expect(result.transactions[0].accountName).toBe("Rent Expense");
    expect(result.transactions[0].vendorName).toBe("Landlord Inc");
    expect(result.transactions[0].debit).toBe(5000);
  });

  it("handles empty array", () => {
    const result = enrichTransactions([]);
    expect(result.totalTransactions).toBe(0);
    expect(result.totalDebits).toBe(0);
    expect(result.totalCredits).toBe(0);
  });

  it("handles alternate field names (camelCase)", () => {
    const result = enrichTransactions([
      {
        id: 10,
        transaction_date: "2026-02-01",
        memo: "Memo text",
        accountName: "Cash",
        accountType: "Asset",
        vendorName: "V1",
        departmentName: "D1",
        debit: 1000,
        credit: 0,
      },
    ]);
    expect(result.transactions[0].date).toBe("2026-02-01");
    expect(result.transactions[0].description).toBe("Memo text");
    expect(result.transactions[0].accountName).toBe("Cash");
    expect(result.transactions[0].vendorName).toBe("V1");
    expect(result.transactions[0].departmentName).toBe("D1");
  });
});

// --- Aging analysis ---

describe("analyzeAging", () => {
  const agingData = [
    { vendor_name: "Vendor A", amount: 10000, days_outstanding: 15, aging_bucket: "0-30" },
    { vendor_name: "Vendor B", amount: 5000, days_outstanding: 45, aging_bucket: "31-60" },
    { vendor_name: "Vendor C", amount: 8000, days_outstanding: 95, aging_bucket: "90+" },
    { vendor_name: "Vendor D", amount: 3000, days_outstanding: 100, aging_bucket: "90+" },
  ];

  it("computes total outstanding", () => {
    const result = analyzeAging(agingData, "ap");
    expect(result.totalOutstanding).toBe(26000);
  });

  it("groups into buckets", () => {
    const result = analyzeAging(agingData, "ap");
    expect(result.buckets["0-30"].count).toBe(1);
    expect(result.buckets["0-30"].total).toBe(10000);
    expect(result.buckets["90+"].count).toBe(2);
    expect(result.buckets["90+"].total).toBe(11000);
  });

  it("identifies 90+ day critical items", () => {
    const result = analyzeAging(agingData, "ap");
    expect(result.criticalItems).toHaveLength(2);
    expect(result.criticalItems[0].name).toBe("Vendor C");
    expect(result.criticalItems[1].name).toBe("Vendor D");
  });

  it("sets aging type correctly", () => {
    expect(analyzeAging(agingData, "ap").type).toBe("ap");
    expect(analyzeAging(agingData, "ar").type).toBe("ar");
    expect(analyzeAging(agingData).type).toBe("combined");
  });

  it("handles empty data", () => {
    const result = analyzeAging([]);
    expect(result.totalOutstanding).toBe(0);
    expect(result.criticalItems).toHaveLength(0);
  });

  it("handles alternate field names (balance, bucket, customer_name)", () => {
    const data = [
      { customer_name: "Cust A", balance: 7000, days: 50, bucket: "31-60", reference: "INV-1", due_date: "2026-01-01" },
    ];
    const result = analyzeAging(data, "ar");
    expect(result.items[0].name).toBe("Cust A");
    expect(result.items[0].amount).toBe(7000);
    expect(result.items[0].invoiceNumber).toBe("INV-1");
    expect(result.items[0].dueDate).toBe("2026-01-01");
  });

  it("auto-categorizes when no bucket field exists", () => {
    const data = [
      { name: "X", amount: 1000, days_outstanding: 5 },
      { name: "Y", amount: 2000, days_outstanding: 35 },
      { name: "Z", amount: 3000, days_outstanding: 95 },
    ];
    const result = analyzeAging(data);
    expect(result.buckets["0-30"].total).toBe(1000);
    expect(result.buckets["31-60"].total).toBe(2000);
    expect(result.buckets["90+"].total).toBe(3000);
  });
});

// --- Contract analysis ---

describe("analyzeContracts", () => {
  const contracts = [
    {
      id: 1,
      name: "Project Alpha",
      client_name: "Client A",
      status: "active",
      total_revenue: 100000,
      total_billed: 60000,
      total_unbilled: 40000,
      start_date: "2025-06-01",
      end_date: "2026-06-01",
    },
    {
      id: 2,
      name: "Project Beta",
      client_name: "Client B",
      status: "active",
      total_revenue: 50000,
      total_billed: 50000,
      total_unbilled: 0,
      start_date: "2025-01-01",
      end_date: "2025-12-31",
    },
    {
      id: 3,
      name: "Project Gamma",
      client_name: "Client C",
      status: "draft",
      total_revenue: 75000,
      total_billed: 0,
      total_unbilled: 75000,
      start_date: "2026-03-01",
      end_date: "2026-12-31",
    },
  ];

  it("computes totals", () => {
    const result = analyzeContracts(contracts);
    expect(result.totalContracts).toBe(3);
    expect(result.totalRevenue).toBe(225000);
    expect(result.totalRecognized).toBe(110000);
    expect(result.totalRemaining).toBe(115000);
  });

  it("computes overall percent recognized", () => {
    const result = analyzeContracts(contracts);
    // 110000 / 225000 ≈ 48.89%
    expect(result.percentRecognized).toBeCloseTo(48.89, 1);
  });

  it("computes per-contract percent recognized", () => {
    const result = analyzeContracts(contracts);
    expect(result.contracts[0].percentRecognized).toBe(60);
    expect(result.contracts[1].percentRecognized).toBe(100);
    expect(result.contracts[2].percentRecognized).toBe(0);
  });

  it("shapes contract fields", () => {
    const result = analyzeContracts(contracts);
    expect(result.contracts[0].clientName).toBe("Client A");
    expect(result.contracts[0].recognized).toBe(60000);
    expect(result.contracts[0].remaining).toBe(40000);
  });

  it("handles empty contracts", () => {
    const result = analyzeContracts([]);
    expect(result.totalContracts).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.percentRecognized).toBeNull();
  });

  it("handles alternate field names (camelCase)", () => {
    const result = analyzeContracts([
      {
        id: 99,
        contract_name: "Alt Contract",
        clientName: "Alt Client",
        status: "active",
        totalRevenue: 80000,
        totalBilled: 40000,
        totalUnbilled: 40000,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
    ]);
    expect(result.contracts[0].name).toBe("Alt Contract");
    expect(result.contracts[0].clientName).toBe("Alt Client");
    expect(result.contracts[0].recognized).toBe(40000);
    expect(result.contracts[0].startDate).toBe("2026-01-01");
    expect(result.contracts[0].endDate).toBe("2026-12-31");
  });

  it("uses contract_value and recognized_revenue fallbacks", () => {
    const result = analyzeContracts([
      {
        id: 100,
        name: "Fallback",
        client_name: "C",
        status: "active",
        contract_value: 60000,
        recognized_revenue: 30000,
      },
    ]);
    expect(result.totalRevenue).toBe(60000);
    expect(result.totalRecognized).toBe(30000);
    expect(result.totalRemaining).toBe(30000);
  });
});

// --- Customer shaping ---

describe("shapeCustomers", () => {
  const customers = [
    {
      id: 1,
      name: "Acme Corp",
      companyName: "Acme Corporation",
      email: "billing@acme.com",
      phoneNumber: "555-1234",
      currency: "USD",
      activeContracts: 2,
      completedContracts: 1,
      totalContracts: 3,
      totalRevenue: 150000,
      totalMrr: 12500,
      totalBilled: 100000,
      totalUnbilled: 50000,
      totalPaid: 90000,
      totalOutstanding: 10000,
      totalDeferredRevenue: 25000,
      paymentTermNameDisplay: "Net 30",
      status: "active",
    },
    {
      id: 2,
      name: "Beta Inc",
      email: "ar@beta.com",
      currency: "USD",
      activeContracts: 1,
      totalContracts: 1,
      totalRevenue: 50000,
      totalMrr: 4167,
      totalBilled: 30000,
      totalUnbilled: 20000,
      totalPaid: 30000,
      totalOutstanding: 0,
      totalDeferredRevenue: 5000,
      status: "active",
    },
  ];

  it("computes aggregate totals", () => {
    const result = shapeCustomers(customers);
    expect(result.totalCustomers).toBe(2);
    expect(result.totalRevenue).toBe(200000);
    expect(result.totalMrr).toBe(16667);
    expect(result.totalOutstanding).toBe(10000);
  });

  it("shapes individual customer fields", () => {
    const result = shapeCustomers(customers);
    expect(result.customers[0].name).toBe("Acme Corp");
    expect(result.customers[0].companyName).toBe("Acme Corporation");
    expect(result.customers[0].email).toBe("billing@acme.com");
    expect(result.customers[0].phone).toBe("555-1234");
    expect(result.customers[0].activeContracts).toBe(2);
    expect(result.customers[0].totalRevenue).toBe(150000);
    expect(result.customers[0].totalMrr).toBe(12500);
    expect(result.customers[0].totalPaid).toBe(90000);
    expect(result.customers[0].paymentTerms).toBe("Net 30");
  });

  it("handles snake_case field names", () => {
    const result = shapeCustomers([
      {
        id: 10,
        name: "Snake Co",
        company_name: "Snake Corp",
        phone_number: "555-9999",
        total_revenue: 80000,
        total_mrr: 6667,
        total_outstanding: 5000,
        active_contracts: 3,
        completed_contracts: 2,
        total_contracts: 5,
        total_billed: 60000,
        total_unbilled: 20000,
        total_paid: 55000,
        total_deferred_revenue: 10000,
        payment_term_name_display: "Net 45",
      },
    ]);
    expect(result.customers[0].companyName).toBe("Snake Corp");
    expect(result.customers[0].phone).toBe("555-9999");
    expect(result.customers[0].totalRevenue).toBe(80000);
    expect(result.customers[0].activeContracts).toBe(3);
    expect(result.customers[0].paymentTerms).toBe("Net 45");
    expect(result.totalRevenue).toBe(80000);
  });

  it("handles empty customer list", () => {
    const result = shapeCustomers([]);
    expect(result.totalCustomers).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.totalMrr).toBe(0);
    expect(result.totalOutstanding).toBe(0);
    expect(result.customers).toHaveLength(0);
  });

  it("handles missing numeric fields gracefully", () => {
    const result = shapeCustomers([{ id: 99, name: "Sparse" }]);
    expect(result.customers[0].totalRevenue).toBe(0);
    expect(result.customers[0].totalMrr).toBe(0);
    expect(result.customers[0].activeContracts).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });
});

// --- Invoice shaping ---

describe("shapeInvoices", () => {
  const invoices = [
    {
      id: 101,
      invoiceNumber: "INV-001",
      clientName: "Acme Corp",
      contractName: "Project Alpha",
      entityName: "Main Entity",
      status: "unpaid",
      invoiceDate: "2026-01-15",
      dueDate: "2026-02-14",
      totalAmount: 10000,
      amountPaid: 0,
      amountDue: 10000,
      pastDueDays: 0,
      currency: "USD",
      paymentTermName: "Net 30",
      lines: [
        { amount: 8000, tax: 1600, description: "Consulting" },
        { amount: 400, tax: 0, description: "Expenses" },
      ],
    },
    {
      id: 102,
      invoiceNumber: "INV-002",
      clientName: "Beta Inc",
      contractName: "Project Beta",
      entityName: "Main Entity",
      status: "paid",
      invoiceDate: "2025-12-01",
      dueDate: "2025-12-31",
      paidDate: "2025-12-28",
      totalAmount: 5000,
      amountPaid: 5000,
      amountDue: 0,
      pastDueDays: 0,
      currency: "USD",
      paymentTermName: "Net 30",
      lines: [
        { amount: 4166.67, tax: 833.33, description: "Services" },
      ],
    },
    {
      id: 103,
      invoiceNumber: "INV-003",
      clientName: "Acme Corp",
      contractName: "Project Alpha",
      entityName: "Main Entity",
      status: "unpaid",
      invoiceDate: "2025-11-01",
      dueDate: "2025-12-01",
      totalAmount: 8000,
      amountPaid: 0,
      amountDue: 8000,
      pastDueDays: 69,
      currency: "USD",
      paymentTermName: "Net 30",
      lines: [
        { amount: 6666.67, tax: 1333.33, description: "Consulting" },
      ],
    },
  ];

  it("computes aggregate totals", () => {
    const result = shapeInvoices(invoices);
    expect(result.totalInvoices).toBe(3);
    expect(result.totalAmount).toBe(23000);
    expect(result.totalPaid).toBe(5000);
    expect(result.totalDue).toBe(18000);
  });

  it("computes net and tax amounts from line items", () => {
    const result = shapeInvoices(invoices);
    // INV-001: net=8400, tax=1600; INV-002: net=4166.67, tax=833.33; INV-003: net=6666.67, tax=1333.33
    expect(result.totalNetAmount).toBe(19233.34);
    expect(result.totalTaxAmount).toBe(3766.66);

    // Per-invoice
    expect(result.invoices[0].netAmount).toBe(8400);
    expect(result.invoices[0].taxAmount).toBe(1600);
    expect(result.invoices[1].netAmount).toBe(4166.67);
    expect(result.invoices[1].taxAmount).toBe(833.33);
    expect(result.invoices[2].netAmount).toBe(6666.67);
    expect(result.invoices[2].taxAmount).toBe(1333.33);
  });

  it("handles invoices without line items (zero net/tax)", () => {
    const result = shapeInvoices([{ id: 999, totalAmount: 5000, amountDue: 5000, status: "unpaid" }]);
    expect(result.invoices[0].netAmount).toBe(0);
    expect(result.invoices[0].taxAmount).toBe(0);
    expect(result.totalNetAmount).toBe(0);
    expect(result.totalTaxAmount).toBe(0);
  });

  it("groups by status", () => {
    const result = shapeInvoices(invoices);
    expect(result.byStatus["unpaid"].count).toBe(2);
    expect(result.byStatus["unpaid"].totalAmount).toBe(18000);
    expect(result.byStatus["unpaid"].totalDue).toBe(18000);
    expect(result.byStatus["paid"].count).toBe(1);
    expect(result.byStatus["paid"].totalAmount).toBe(5000);
    expect(result.byStatus["paid"].totalDue).toBe(0);
  });

  it("shapes individual invoice fields (normal includes contract/entity/currency)", () => {
    const result = shapeInvoices(invoices);
    expect(result.invoices[0].invoiceNumber).toBe("INV-001");
    expect(result.invoices[0].clientName).toBe("Acme Corp");
    expect(result.invoices[0].status).toBe("unpaid");
    expect(result.invoices[0].totalAmount).toBe(10000);
    expect(result.invoices[0].amountDue).toBe(10000);
    // Normal detail includes these fields
    expect(result.invoices[0].contractName).toBe("Project Alpha");
    expect(result.invoices[0].entityName).toBe("Main Entity");
    expect(result.invoices[0].currency).toBe("USD");
    expect(result.invoices[0].terms).toBe("Net 30");
  });

  it("summary detail omits contract/entity/currency", () => {
    const result = shapeInvoices(invoices, "summary");
    expect(result.invoices[0].invoiceNumber).toBe("INV-001");
    expect(result.invoices[0].contractName).toBeUndefined();
    expect(result.invoices[0].entityName).toBeUndefined();
    expect(result.invoices[0].currency).toBeUndefined();
    expect(result.invoices[0].terms).toBeUndefined();
    // summary should still have core fields
    expect(result.invoices[0].totalAmount).toBe(10000);
    expect(result.invoices[0].netAmount).toBe(8400);
  });

  it("omits amountPaid when zero", () => {
    const result = shapeInvoices(invoices);
    expect(result.invoices[0].amountPaid).toBeUndefined();
    expect(result.invoices[1].amountPaid).toBe(5000);
  });

  it("includes pastDueDays only when positive", () => {
    const result = shapeInvoices(invoices);
    expect(result.invoices[0].pastDueDays).toBeUndefined(); // 0 days
    expect(result.invoices[2].pastDueDays).toBe(69);
  });

  it("handles snake_case field names", () => {
    const result = shapeInvoices([
      {
        id: 200,
        invoice_number: "INV-200",
        client_name: "Snake Client",
        status: "partially_paid",
        invoice_date: "2026-01-01",
        due_date: "2026-01-31",
        total_amount: 6000,
        amount_paid: 2000,
        amount_due: 4000,
        past_due_days: 8,
      },
    ]);
    expect(result.invoices[0].invoiceNumber).toBe("INV-200");
    expect(result.invoices[0].clientName).toBe("Snake Client");
    expect(result.invoices[0].totalAmount).toBe(6000);
    expect(result.invoices[0].amountPaid).toBe(2000);
    expect(result.invoices[0].amountDue).toBe(4000);
    expect(result.invoices[0].pastDueDays).toBe(8);
    expect(result.totalPaid).toBe(2000);
    expect(result.totalDue).toBe(4000);
  });

  it("handles empty invoice list", () => {
    const result = shapeInvoices([]);
    expect(result.totalInvoices).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.totalNetAmount).toBe(0);
    expect(result.totalTaxAmount).toBe(0);
    expect(result.totalPaid).toBe(0);
    expect(result.totalDue).toBe(0);
    expect(result.invoices).toHaveLength(0);
  });

  it("handles missing numeric fields gracefully", () => {
    const result = shapeInvoices([{ id: 999, status: "draft" }]);
    expect(result.invoices[0].totalAmount).toBe(0);
    expect(result.invoices[0].amountDue).toBe(0);
    // amountPaid and pastDueDays omitted when zero
    expect(result.invoices[0].amountPaid).toBeUndefined();
    expect(result.invoices[0].pastDueDays).toBeUndefined();
    expect(result.totalAmount).toBe(0);
    expect(result.byStatus["draft"].count).toBe(1);
  });

  it("defaults status to unknown when missing", () => {
    const result = shapeInvoices([{ id: 888, totalAmount: 1000, amountDue: 1000 }]);
    expect(result.invoices[0].status).toBe("unknown");
    expect(result.byStatus["unknown"].count).toBe(1);
  });
});

// --- Trial balance shaping ---

describe("shapeTrialBalance", () => {
  const trialBalanceData = {
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    trialBalance: {
      accounts: [
        { id: "1", name: "Cash", number: "1000", accountType: "Asset", balances: { debits: 50000, credits: 10000 } },
        { id: "2", name: "Accounts Receivable", number: "1100", accountType: "Asset", balances: { debits: 30000, credits: 5000 } },
        { id: "3", name: "Revenue", number: "4000", accountType: "Revenue", balances: { debits: 0, credits: 65000 } },
      ],
    },
  };

  it("computes total debits and credits", () => {
    const result = shapeTrialBalance(trialBalanceData);
    expect(result.totalDebits).toBe(80000);
    expect(result.totalCredits).toBe(80000);
  });

  it("includes date range", () => {
    const result = shapeTrialBalance(trialBalanceData);
    expect(result.startDate).toBe("2026-01-01");
    expect(result.endDate).toBe("2026-01-31");
  });

  it("counts accounts", () => {
    const result = shapeTrialBalance(trialBalanceData);
    expect(result.accountCount).toBe(3);
  });

  it("groups by account type", () => {
    const result = shapeTrialBalance(trialBalanceData);
    expect(result.byAccountType["Asset"].count).toBe(2);
    expect(result.byAccountType["Asset"].debits).toBe(80000);
    expect(result.byAccountType["Asset"].credits).toBe(15000);
    expect(result.byAccountType["Revenue"].count).toBe(1);
    expect(result.byAccountType["Revenue"].credits).toBe(65000);
  });

  it("shapes individual accounts with net", () => {
    const result = shapeTrialBalance(trialBalanceData);
    expect(result.accounts[0].name).toBe("Cash");
    expect(result.accounts[0].number).toBe("1000");
    expect(result.accounts[0].debits).toBe(50000);
    expect(result.accounts[0].credits).toBe(10000);
    expect(result.accounts[0].net).toBe(40000);
  });

  it("handles snake_case field names", () => {
    const result = shapeTrialBalance({
      start_date: "2026-02-01",
      end_date: "2026-02-28",
      trial_balance: {
        accounts: [
          { id: "1", name: "Cash", number: "1000", account_type: "Asset", debits: 10000, credits: 2000 },
        ],
      },
    });
    expect(result.startDate).toBe("2026-02-01");
    expect(result.endDate).toBe("2026-02-28");
    expect(result.accounts[0].accountType).toBe("Asset");
    expect(result.accounts[0].debits).toBe(10000);
    expect(result.accounts[0].credits).toBe(2000);
  });

  it("handles empty/null data", () => {
    const result = shapeTrialBalance(null);
    expect(result.totalDebits).toBe(0);
    expect(result.totalCredits).toBe(0);
    expect(result.accountCount).toBe(0);
    expect(result.accounts).toHaveLength(0);
  });

  it("handles data without wrapper (accounts directly)", () => {
    const result = shapeTrialBalance({
      accounts: [
        { id: "1", name: "Cash", number: "1000", accountType: "Asset", balances: { debits: 5000, credits: 1000 } },
      ],
    });
    expect(result.accountCount).toBe(1);
    expect(result.totalDebits).toBe(5000);
  });

  it("handles missing accountType", () => {
    const result = shapeTrialBalance({
      trialBalance: {
        accounts: [
          { id: "1", name: "Misc", number: "9999", balances: { debits: 100, credits: 100 } },
        ],
      },
    });
    expect(result.accounts[0].accountType).toBe("Unknown");
    expect(result.byAccountType["Unknown"].count).toBe(1);
  });
});

// --- Budget shaping ---

describe("shapeBudgets", () => {
  const budgets = [
    {
      id: 1,
      name: "2026 Operating Budget",
      description: "Annual operating budget",
      entity: 10,
      entity_name: "Main Entity",
      department: 5,
      department_name: "Engineering",
      cadence: "monthly",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      periods: 12,
      breakdown_type: "standard",
      currency: "USD",
      tags: [{ name: "Q1" }, { name: "approved" }],
    },
    {
      id: 2,
      name: "Marketing FY26",
      entity: 10,
      entity_name: "Main Entity",
      department: 8,
      department_name: "Marketing",
      cadence: "quarterly",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      periods: 4,
      currency: "USD",
      tags: [],
    },
    {
      id: 3,
      name: "R&D Budget",
      entity_name: "Main Entity",
      cadence: "monthly",
      start_date: "2026-01-01",
    },
  ];

  it("computes summary with cadence breakdown", () => {
    const result = shapeBudgets(budgets);
    expect(result.totalBudgets).toBe(3);
    expect(result.byCadence["monthly"]).toBe(2);
    expect(result.byCadence["quarterly"]).toBe(1);
  });

  it("resolves entity and department names", () => {
    const result = shapeBudgets(budgets);
    expect(result.budgets[0].entityName).toBe("Main Entity");
    expect(result.budgets[0].departmentName).toBe("Engineering");
    expect(result.budgets[0].entityId).toBe(10);
    expect(result.budgets[0].departmentId).toBe(5);
  });

  it("shapes individual budget fields", () => {
    const result = shapeBudgets(budgets);
    expect(result.budgets[0].name).toBe("2026 Operating Budget");
    expect(result.budgets[0].description).toBe("Annual operating budget");
    expect(result.budgets[0].cadence).toBe("monthly");
    expect(result.budgets[0].startDate).toBe("2026-01-01");
    expect(result.budgets[0].endDate).toBe("2026-12-31");
    expect(result.budgets[0].periods).toBe(12);
    expect(result.budgets[0].breakdownType).toBe("standard");
    expect(result.budgets[0].currency).toBe("USD");
    expect(result.budgets[0].tags).toEqual(["Q1", "approved"]);
  });

  it("handles missing optional fields", () => {
    const result = shapeBudgets(budgets);
    const rd = result.budgets[2];
    expect(rd.description).toBeNull();
    expect(rd.departmentId).toBeNull();
    expect(rd.departmentName).toBeNull();
    expect(rd.endDate).toBeNull();
    expect(rd.periods).toBeNull();
    expect(rd.breakdownType).toBeNull();
    expect(rd.cadence).toBe("monthly");
  });

  it("handles empty budget list", () => {
    const result = shapeBudgets([]);
    expect(result.totalBudgets).toBe(0);
    expect(result.byCadence).toEqual({});
    expect(result.budgets).toHaveLength(0);
  });

  it("extracts tag names from tag objects", () => {
    const result = shapeBudgets([
      { id: 99, name: "Tagged", start_date: "2026-01-01", tags: [{ name: "important" }] },
    ]);
    expect(result.budgets[0].tags).toEqual(["important"]);
  });

  it("handles plain string tags", () => {
    const result = shapeBudgets([
      { id: 99, name: "Tagged", start_date: "2026-01-01", tags: ["plain-tag"] },
    ]);
    expect(result.budgets[0].tags).toEqual(["plain-tag"]);
  });

  it("defaults cadence to unspecified when missing", () => {
    const result = shapeBudgets([{ id: 99, name: "No Cadence", start_date: "2026-01-01" }]);
    expect(result.budgets[0].cadence).toBe("unspecified");
    expect(result.byCadence["unspecified"]).toBe(1);
  });
});

describe("shapeBudgetDetail", () => {
  const budget = {
    id: 1,
    name: "2026 Operating Budget",
    description: "Annual ops",
    entity: 10,
    entity_name: "Main Entity",
    department: null,
    department_name: "",
    cadence: "monthly",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    periods: 12,
    breakdown_type: "standard",
    currency: "USD",
  };

  const allocations = [
    {
      id: 101,
      account: 1000,
      account_name: "Salaries",
      account_lineage: "Expenses > Payroll > Salaries",
      department: 5,
      department_name: "Engineering",
      period: 1,
      amount: 50000,
    },
    {
      id: 102,
      account: 1001,
      account_name: "Benefits",
      account_lineage: "Expenses > Payroll > Benefits",
      department: 5,
      department_name: "Engineering",
      period: 1,
      amount: 15000,
    },
    {
      id: 103,
      account: 2000,
      account_name: "Cloud Hosting",
      account_lineage: "Expenses > Infrastructure > Cloud Hosting",
      department: 5,
      department_name: "Engineering",
      period: 1,
      amount: 8000,
    },
    {
      id: 104,
      account: 3000,
      account_name: "Ad Spend",
      account_lineage: "Expenses > Marketing > Ad Spend",
      department: 8,
      department_name: "Marketing",
      period: 1,
      amount: 20000,
    },
  ];

  it("computes total budgeted amount", () => {
    const result = shapeBudgetDetail(budget, allocations);
    expect(result.totalBudgeted).toBe(93000);
    expect(result.allocationCount).toBe(4);
  });

  it("includes budget metadata", () => {
    const result = shapeBudgetDetail(budget, allocations);
    expect(result.id).toBe(1);
    expect(result.name).toBe("2026 Operating Budget");
    expect(result.entityName).toBe("Main Entity");
    expect(result.cadence).toBe("monthly");
    expect(result.startDate).toBe("2026-01-01");
    expect(result.endDate).toBe("2026-12-31");
    expect(result.currency).toBe("USD");
  });

  it("groups allocations by top-level account type from lineage", () => {
    const result = shapeBudgetDetail(budget, allocations);
    expect(result.byAccountType["Expenses"].count).toBe(4);
    expect(result.byAccountType["Expenses"].total).toBe(93000);
  });

  it("groups allocations by department", () => {
    const result = shapeBudgetDetail(budget, allocations);
    expect(result.byDepartment["Engineering"].count).toBe(3);
    expect(result.byDepartment["Engineering"].total).toBe(73000);
    expect(result.byDepartment["Marketing"].count).toBe(1);
    expect(result.byDepartment["Marketing"].total).toBe(20000);
  });

  it("shapes individual allocations with resolved names and IDs", () => {
    const result = shapeBudgetDetail(budget, allocations);
    const first = result.allocations[0];
    expect(first.id).toBe(101);
    expect(first.accountId).toBe(1000);
    expect(first.accountName).toBe("Salaries");
    expect(first.accountLineage).toBe("Expenses > Payroll > Salaries");
    expect(first.departmentId).toBe(5);
    expect(first.departmentName).toBe("Engineering");
    expect(first.period).toBe(1);
    expect(first.amount).toBe(50000);
  });

  it("handles empty allocations", () => {
    const result = shapeBudgetDetail(budget, []);
    expect(result.totalBudgeted).toBe(0);
    expect(result.allocationCount).toBe(0);
    expect(result.byAccountType).toEqual({});
    expect(result.byDepartment).toEqual({});
    expect(result.allocations).toHaveLength(0);
  });

  it("handles allocations without lineage", () => {
    const result = shapeBudgetDetail(budget, [
      { id: 200, account: 5000, account_name: "Misc", account_lineage: "", amount: 1000 },
    ]);
    expect(result.allocations[0].accountLineage).toBe("");
    expect(result.byAccountType["Misc"]).toBeDefined();
    expect(result.byAccountType["Misc"].total).toBe(1000);
  });

  it("handles allocations without department", () => {
    const result = shapeBudgetDetail(budget, [
      { id: 201, account: 5000, account_name: "Misc", account_lineage: "Expenses > Misc", amount: 500 },
    ]);
    expect(result.allocations[0].departmentId).toBeNull();
    expect(result.allocations[0].departmentName).toBeNull();
    expect(result.byDepartment["Unassigned"].count).toBe(1);
    expect(result.byDepartment["Unassigned"].total).toBe(500);
  });

  it("handles missing amount (defaults to 0)", () => {
    const result = shapeBudgetDetail(budget, [
      { id: 202, account: 5000, account_name: "Empty", account_lineage: "Expenses > Empty" },
    ]);
    expect(result.allocations[0].amount).toBe(0);
    expect(result.totalBudgeted).toBe(0);
  });
});

// --- Uncategorized transaction shaping ---

describe("shapeUncategorizedTransactions", () => {
  const txns = [
    {
      id: 1,
      date: "2026-01-15",
      description: "Office supplies",
      debit_amount: 250,
      credit_amount: 0,
      vendor_name: "Staples",
      department_name: "Operations",
      merchant_name: "Staples Store #42",
      bank_description: "POS STAPLES #42",
      suggested_account_name: "Office Supplies",
      suggested_account_number: "6100",
      needs_review: true,
      has_matches: false,
    },
    {
      id: 2,
      date: "2026-01-16",
      description: "Software license",
      debit_amount: 500,
      credit_amount: 0,
      vendor_name: "Staples",
      suggested_account_name: "Software Expense",
      suggested_account_number: "6200",
    },
    {
      id: 3,
      date: "2026-01-17",
      description: "Client refund",
      debit_amount: 0,
      credit_amount: 1000,
      vendor_name: "Acme Corp",
      bill_id: 99,
      bill_number: "BILL-099",
      has_matches: true,
    },
  ];

  it("computes total count and amount", () => {
    const result = shapeUncategorizedTransactions(txns);
    expect(result.totalCount).toBe(3);
    // |250-0| + |500-0| + |0-1000| = 250 + 500 + 1000 = 1750
    expect(result.totalAmount).toBe(1750);
  });

  it("groups by vendor name", () => {
    const result = shapeUncategorizedTransactions(txns);
    expect(result.byVendor["Staples"].count).toBe(2);
    expect(result.byVendor["Staples"].total).toBe(750);
    expect(result.byVendor["Acme Corp"].count).toBe(1);
    expect(result.byVendor["Acme Corp"].total).toBe(1000);
  });

  it("counts transactions with suggestions", () => {
    const result = shapeUncategorizedTransactions(txns);
    expect(result.withSuggestions).toBe(2);
  });

  it("shapes individual transaction fields", () => {
    const result = shapeUncategorizedTransactions(txns);
    const t0 = result.transactions[0];
    expect(t0.id).toBe(1);
    expect(t0.date).toBe("2026-01-15");
    expect(t0.description).toBe("Office supplies");
    expect(t0.amount).toBe(250);
    expect(t0.debit).toBe(250);
    expect(t0.credit).toBe(0);
    expect(t0.vendorName).toBe("Staples");
    expect(t0.departmentName).toBe("Operations");
    expect(t0.merchantName).toBe("Staples Store #42");
    expect(t0.bankDescription).toBe("POS STAPLES #42");
    expect(t0.suggestedAccountName).toBe("Office Supplies");
    expect(t0.suggestedAccountNumber).toBe("6100");
    expect(t0.needsReview).toBe(true);
    expect(t0.hasMatches).toBe(false);
  });

  it("includes bill linkage fields", () => {
    const result = shapeUncategorizedTransactions(txns);
    const t2 = result.transactions[2];
    expect(t2.billId).toBe(99);
    expect(t2.billNumber).toBe("BILL-099");
    expect(t2.hasMatches).toBe(true);
  });

  it("handles empty array", () => {
    const result = shapeUncategorizedTransactions([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.byVendor).toEqual({});
    expect(result.withSuggestions).toBe(0);
    expect(result.transactions).toHaveLength(0);
  });

  it("handles camelCase field names", () => {
    const result = shapeUncategorizedTransactions([
      {
        id: 10,
        transaction_date: "2026-02-01",
        memo: "CamelCase test",
        debit: 300,
        credit: 0,
        vendorName: "CamelVendor",
        departmentName: "Dept1",
        merchantName: "Merchant1",
        bankDescription: "BANK DESC",
        suggestedAccountName: "Suggested",
        suggestedAccountNumber: "9999",
        billId: 42,
        billNumber: "B-42",
        needsReview: false,
        hasMatches: true,
      },
    ]);
    const t = result.transactions[0];
    expect(t.date).toBe("2026-02-01");
    expect(t.description).toBe("CamelCase test");
    expect(t.vendorName).toBe("CamelVendor");
    expect(t.departmentName).toBe("Dept1");
    expect(t.merchantName).toBe("Merchant1");
    expect(t.bankDescription).toBe("BANK DESC");
    expect(t.suggestedAccountName).toBe("Suggested");
    expect(t.billId).toBe(42);
  });

  it("defaults vendorName to Unknown when missing", () => {
    const result = shapeUncategorizedTransactions([
      { id: 20, debit_amount: 100, credit_amount: 0 },
    ]);
    expect(result.transactions[0].vendorName).toBe("Unknown");
    expect(result.byVendor["Unknown"].count).toBe(1);
  });

  it("falls back vendorName to merchant_name when vendor_name is missing", () => {
    const result = shapeUncategorizedTransactions([
      { id: 21, debit_amount: 50, credit_amount: 0, merchant_name: "Rmpr R Hub" },
    ]);
    expect(result.transactions[0].vendorName).toBe("Rmpr R Hub");
    expect(result.byVendor["Rmpr R Hub"].count).toBe(1);
  });

  it("handles live API field names (posted_at, journal_memo)", () => {
    const result = shapeUncategorizedTransactions([
      {
        id: 176037615,
        posted_at: "2026-02-06",
        journal_memo: "RMPR C Popescu; Operating US New",
        bank_description: "RMPR C Popescu; Operating US New",
        debit_amount: null,
        credit_amount: 11.58,
        merchant_name: null,
        needs_review: true,
      },
    ]);
    const t = result.transactions[0];
    expect(t.date).toBe("2026-02-06");
    expect(t.description).toBe("RMPR C Popescu; Operating US New");
    expect(t.credit).toBe(11.58);
    expect(t.debit).toBe(0);
    expect(t.amount).toBe(11.58);
    expect(t.needsReview).toBe(true);
  });

  it("defaults optional fields to null/false when missing", () => {
    const result = shapeUncategorizedTransactions([
      { id: 30, debit_amount: 50, credit_amount: 0 },
    ]);
    const t = result.transactions[0];
    expect(t.departmentName).toBeNull();
    expect(t.merchantName).toBeNull();
    expect(t.bankDescription).toBeNull();
    expect(t.suggestedAccountName).toBeNull();
    expect(t.suggestedAccountNumber).toBeNull();
    expect(t.billId).toBeNull();
    expect(t.billNumber).toBeNull();
    expect(t.needsReview).toBe(false);
    expect(t.hasMatches).toBe(false);
  });
});

// --- Bill shaping ---

describe("shapeBills", () => {
  const bills = [
    {
      id: 1,
      bill_number: "BILL-001",
      bill_date: "2026-01-01",
      due_date: "2026-01-31",
      vendor_name: "Vendor A",
      entity_name: "Main Entity",
      status: "unpaid",
      past_due_days: 8,
      total_amount: 5000,
      amount_due: 5000,
      amount_paid: 0,
      lines: [{ id: 1 }, { id: 2 }],
      ap_account_name: "Accounts Payable",
      message_on_bill: "Please pay promptly",
    },
    {
      id: 2,
      bill_number: "BILL-002",
      bill_date: "2025-12-01",
      due_date: "2025-12-31",
      paid_date: "2025-12-28",
      vendor_name: "Vendor A",
      entity_name: "Main Entity",
      status: "paid",
      total_amount: 3000,
      amount_due: 0,
      amount_paid: 3000,
      lines: [{ id: 3 }],
      ap_account_name: "Accounts Payable",
    },
    {
      id: 3,
      bill_number: "BILL-003",
      bill_date: "2026-01-10",
      due_date: "2026-02-09",
      vendor_name: "Vendor B",
      entity_name: "Main Entity",
      status: "unpaid",
      past_due_days: 0,
      total_amount: 8000,
      amount_due: 8000,
      amount_paid: 0,
      lines: [{ id: 4 }, { id: 5 }, { id: 6 }],
    },
  ];

  it("computes aggregate totals", () => {
    const result = shapeBills(bills);
    expect(result.totalBills).toBe(3);
    expect(result.totalAmount).toBe(16000);
    expect(result.totalAmountDue).toBe(13000);
    expect(result.totalAmountPaid).toBe(3000);
  });

  it("groups by status", () => {
    const result = shapeBills(bills);
    expect(result.byStatus["unpaid"].count).toBe(2);
    expect(result.byStatus["unpaid"].total).toBe(13000);
    expect(result.byStatus["paid"].count).toBe(1);
    expect(result.byStatus["paid"].total).toBe(3000);
  });

  it("groups by vendor", () => {
    const result = shapeBills(bills);
    expect(result.byVendor["Vendor A"].count).toBe(2);
    expect(result.byVendor["Vendor A"].totalDue).toBe(5000);
    expect(result.byVendor["Vendor B"].count).toBe(1);
    expect(result.byVendor["Vendor B"].totalDue).toBe(8000);
  });

  it("shapes individual bill fields", () => {
    const result = shapeBills(bills);
    const b0 = result.bills[0];
    expect(b0.id).toBe(1);
    expect(b0.billNumber).toBe("BILL-001");
    expect(b0.billDate).toBe("2026-01-01");
    expect(b0.dueDate).toBe("2026-01-31");
    expect(b0.vendorName).toBe("Vendor A");
    expect(b0.entityName).toBe("Main Entity");
    expect(b0.status).toBe("unpaid");
    expect(b0.pastDueDays).toBe(8);
    expect(b0.totalAmount).toBe(5000);
    expect(b0.amountDue).toBe(5000);
    expect(b0.amountPaid).toBe(0);
    expect(b0.lineCount).toBe(2);
    expect(b0.apAccountName).toBe("Accounts Payable");
    expect(b0.messageOnBill).toBe("Please pay promptly");
  });

  it("includes paid date when present", () => {
    const result = shapeBills(bills);
    expect(result.bills[1].paidDate).toBe("2025-12-28");
  });

  it("counts line items", () => {
    const result = shapeBills(bills);
    expect(result.bills[0].lineCount).toBe(2);
    expect(result.bills[1].lineCount).toBe(1);
    expect(result.bills[2].lineCount).toBe(3);
  });

  it("handles empty bill list", () => {
    const result = shapeBills([]);
    expect(result.totalBills).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.totalAmountDue).toBe(0);
    expect(result.totalAmountPaid).toBe(0);
    expect(result.byStatus).toEqual({});
    expect(result.byVendor).toEqual({});
    expect(result.bills).toHaveLength(0);
  });

  it("handles camelCase field names", () => {
    const result = shapeBills([
      {
        id: 10,
        billNumber: "B-10",
        billDate: "2026-02-01",
        dueDate: "2026-02-28",
        paidDate: "2026-02-15",
        vendorName: "CamelVendor",
        entityName: "CamelEntity",
        status: "paid",
        pastDueDays: 0,
        totalAmount: 2000,
        amountDue: 0,
        amountPaid: 2000,
        lineItems: [{ id: 1 }],
        apAccountName: "AP Account",
        messageOnBill: "Thank you",
      },
    ]);
    const b = result.bills[0];
    expect(b.billNumber).toBe("B-10");
    expect(b.billDate).toBe("2026-02-01");
    expect(b.dueDate).toBe("2026-02-28");
    expect(b.paidDate).toBe("2026-02-15");
    expect(b.vendorName).toBe("CamelVendor");
    expect(b.entityName).toBe("CamelEntity");
    expect(b.totalAmount).toBe(2000);
    expect(b.amountPaid).toBe(2000);
    expect(b.lineCount).toBe(1);
    expect(b.apAccountName).toBe("AP Account");
    expect(b.messageOnBill).toBe("Thank you");
  });

  it("defaults status to unknown when missing", () => {
    const result = shapeBills([{ id: 99, total_amount: 1000, amount_due: 1000 }]);
    expect(result.bills[0].status).toBe("unknown");
    expect(result.byStatus["unknown"].count).toBe(1);
  });

  it("defaults vendorName to Unknown when missing", () => {
    const result = shapeBills([{ id: 100, total_amount: 500, amount_due: 500, status: "unpaid" }]);
    expect(result.bills[0].vendorName).toBe("Unknown");
    expect(result.byVendor["Unknown"].count).toBe(1);
  });

  it("handles missing numeric fields gracefully", () => {
    const result = shapeBills([{ id: 101, status: "draft" }]);
    expect(result.bills[0].totalAmount).toBe(0);
    expect(result.bills[0].amountDue).toBe(0);
    expect(result.bills[0].amountPaid).toBe(0);
    expect(result.bills[0].pastDueDays).toBe(0);
    expect(result.bills[0].lineCount).toBe(0);
    expect(result.totalAmount).toBe(0);
  });

  it("handles missing optional fields as null", () => {
    const result = shapeBills([{ id: 102, status: "open" }]);
    const b = result.bills[0];
    expect(b.billNumber).toBeNull();
    expect(b.billDate).toBeNull();
    expect(b.dueDate).toBeNull();
    expect(b.paidDate).toBeNull();
    expect(b.entityName).toBeNull();
    expect(b.apAccountName).toBeNull();
    expect(b.messageOnBill).toBeNull();
  });

  it("uses amount fallback when total_amount and totalAmount are missing", () => {
    const result = shapeBills([{ id: 103, amount: 7500, amount_due: 7500, status: "unpaid" }]);
    expect(result.bills[0].totalAmount).toBe(7500);
    expect(result.totalAmount).toBe(7500);
  });
});

// --- Department shaping ---

describe("shapeDepartments", () => {
  const departments = [
    {
      id: 1,
      name: "Engineering",
      description: "Product development",
      is_active: true,
      parent: null,
      parent_name: null,
      entity: 10,
      entity_name: "US Entity",
    },
    {
      id: 2,
      name: "Marketing",
      description: "Growth team",
      is_active: true,
      parent: null,
      entity: 10,
      entity_name: "US Entity",
    },
    {
      id: 3,
      name: "Atomic Theory",
      description: null,
      is_active: false,
      parent: 1,
      parent_name: "Engineering",
      entity: 20,
      entity_name: "UK Entity",
    },
  ];

  it("computes total count", () => {
    const result = shapeDepartments(departments);
    expect(result.totalDepartments).toBe(3);
  });

  it("shapes individual department fields", () => {
    const result = shapeDepartments(departments);
    const eng = result.departments[0];
    expect(eng.id).toBe(1);
    expect(eng.name).toBe("Engineering");
    expect(eng.description).toBe("Product development");
    expect(eng.isActive).toBe(true);
    expect(eng.parentId).toBeNull();
    expect(eng.parentName).toBeNull();
    expect(eng.entityId).toBe(10);
    expect(eng.entityName).toBe("US Entity");
  });

  it("resolves parent department info", () => {
    const result = shapeDepartments(departments);
    const at = result.departments[2];
    expect(at.parentId).toBe(1);
    expect(at.parentName).toBe("Engineering");
    expect(at.isActive).toBe(false);
  });

  it("handles empty list", () => {
    const result = shapeDepartments([]);
    expect(result.totalDepartments).toBe(0);
    expect(result.departments).toHaveLength(0);
  });

  it("handles camelCase field names", () => {
    const result = shapeDepartments([
      {
        id: 5,
        name: "Sales",
        isActive: true,
        parentId: 2,
        parentName: "Marketing",
        entityId: 10,
        entityName: "US Entity",
      },
    ]);
    const d = result.departments[0];
    expect(d.isActive).toBe(true);
    expect(d.parentId).toBe(2);
    expect(d.parentName).toBe("Marketing");
    expect(d.entityId).toBe(10);
    expect(d.entityName).toBe("US Entity");
  });

  it("defaults missing optional fields", () => {
    const result = shapeDepartments([{ id: 6, name: "Minimal" }]);
    const d = result.departments[0];
    expect(d.description).toBeNull();
    expect(d.isActive).toBe(true);
    expect(d.parentId).toBeNull();
    expect(d.parentName).toBeNull();
    expect(d.entityId).toBeNull();
    expect(d.entityName).toBeNull();
  });
});

// --- Account shaping ---

describe("shapeAccounts", () => {
  const accounts = [
    {
      id: 1,
      name: "Cash",
      number: "1000",
      account_type: "ASSET",
      account_sub_type: "Current Asset",
      is_active: true,
      parent: null,
      balance: 50000,
      description: "Operating cash account",
    },
    {
      id: 2,
      name: "Accounts Receivable",
      number: "1100",
      account_type: "ASSET",
      account_sub_type: "Current Asset",
      is_active: true,
      balance: 25000,
    },
    {
      id: 3,
      name: "Rent Expense",
      number: "6000",
      account_type: "EXPENSE",
      account_sub_type: "Operating Expense",
      is_active: true,
      balance: 12000,
    },
    {
      id: 4,
      name: "Old Account",
      number: "9999",
      account_type: "ASSET",
      is_active: false,
      balance: 0,
    },
  ];

  it("computes total count and groups by type", () => {
    const result = shapeAccounts(accounts);
    expect(result.totalAccounts).toBe(4);
    expect(result.byType["ASSET"]).toBe(3);
    expect(result.byType["EXPENSE"]).toBe(1);
  });

  it("shapes individual account fields", () => {
    const result = shapeAccounts(accounts);
    const cash = result.accounts[0];
    expect(cash.id).toBe(1);
    expect(cash.name).toBe("Cash");
    expect(cash.number).toBe("1000");
    expect(cash.accountType).toBe("ASSET");
    expect(cash.accountSubType).toBe("Current Asset");
    expect(cash.isActive).toBe(true);
    expect(cash.balance).toBe(50000);
    expect(cash.description).toBe("Operating cash account");
  });

  it("handles empty list", () => {
    const result = shapeAccounts([]);
    expect(result.totalAccounts).toBe(0);
    expect(result.byType).toEqual({});
    expect(result.accounts).toHaveLength(0);
  });

  it("handles camelCase field names", () => {
    const result = shapeAccounts([
      {
        id: 10,
        account_name: "Revenue",
        account_number: "4000",
        accountType: "REVENUE",
        accountSubType: "Sales",
        isActive: true,
        parentId: 5,
      },
    ]);
    const a = result.accounts[0];
    expect(a.name).toBe("Revenue");
    expect(a.number).toBe("4000");
    expect(a.accountType).toBe("REVENUE");
    expect(a.accountSubType).toBe("Sales");
    expect(a.isActive).toBe(true);
    expect(a.parentId).toBe(5);
  });

  it("defaults missing optional fields", () => {
    const result = shapeAccounts([{ id: 20, name: "Minimal" }]);
    const a = result.accounts[0];
    expect(a.accountType).toBe("Unknown");
    expect(a.accountSubType).toBeNull();
    expect(a.isActive).toBe(true);
    expect(a.parentId).toBeNull();
    expect(a.balance).toBeNull();
    expect(a.description).toBeNull();
  });
});

// --- Credit memo shaping ---

describe("shapeCreditMemos", () => {
  const creditMemos = [
    {
      id: 1,
      credit_memo_number: "CM-001",
      credit_memo_date: "2026-01-15",
      client_name: "Acme Corp",
      entity_name: "US Entity",
      contract_name: "Contract A",
      application_status: "open",
      total_amount: 5000,
      amount_used: 0,
      amount_remaining: 5000,
      currency: "USD",
      message_on_credit_memo: "Refund for Q4",
      lines: [{ id: 1 }, { id: 2 }],
    },
    {
      id: 2,
      credit_memo_number: "CM-002",
      credit_memo_date: "2026-02-01",
      client_name: "Acme Corp",
      entity_name: "US Entity",
      application_status: "used",
      total_amount: 3000,
      amount_used: 3000,
      amount_remaining: 0,
      currency: "USD",
      lines: [{ id: 3 }],
    },
    {
      id: 3,
      credit_memo_number: "CM-003",
      credit_memo_date: "2026-02-10",
      client_name: "Beta Inc",
      entity_name: "UK Entity",
      application_status: "partially_used",
      total_amount: 8000,
      amount_used: 2000,
      amount_remaining: 6000,
      currency: "GBP",
      lines: [{ id: 4 }, { id: 5 }, { id: 6 }],
    },
  ];

  it("computes aggregate totals", () => {
    const result = shapeCreditMemos(creditMemos);
    expect(result.totalCreditMemos).toBe(3);
    expect(result.totalAmount).toBe(16000);
    expect(result.totalUsed).toBe(5000);
    expect(result.totalRemaining).toBe(11000);
  });

  it("groups by status", () => {
    const result = shapeCreditMemos(creditMemos);
    expect(result.byStatus["open"].count).toBe(1);
    expect(result.byStatus["open"].total).toBe(5000);
    expect(result.byStatus["used"].count).toBe(1);
    expect(result.byStatus["used"].total).toBe(3000);
    expect(result.byStatus["partially_used"].count).toBe(1);
    expect(result.byStatus["partially_used"].total).toBe(8000);
  });

  it("shapes individual credit memo fields", () => {
    const result = shapeCreditMemos(creditMemos);
    const cm = result.creditMemos[0];
    expect(cm.id).toBe(1);
    expect(cm.creditMemoNumber).toBe("CM-001");
    expect(cm.creditMemoDate).toBe("2026-01-15");
    expect(cm.clientName).toBe("Acme Corp");
    expect(cm.entityName).toBe("US Entity");
    expect(cm.contractName).toBe("Contract A");
    expect(cm.status).toBe("open");
    expect(cm.totalAmount).toBe(5000);
    expect(cm.amountUsed).toBe(0);
    expect(cm.amountRemaining).toBe(5000);
    expect(cm.currency).toBe("USD");
    expect(cm.message).toBe("Refund for Q4");
    expect(cm.lineCount).toBe(2);
  });

  it("handles empty list", () => {
    const result = shapeCreditMemos([]);
    expect(result.totalCreditMemos).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.totalUsed).toBe(0);
    expect(result.totalRemaining).toBe(0);
    expect(result.byStatus).toEqual({});
    expect(result.creditMemos).toHaveLength(0);
  });

  it("handles camelCase field names", () => {
    const result = shapeCreditMemos([
      {
        id: 10,
        creditMemoNumber: "CM-010",
        creditMemoDate: "2026-03-01",
        clientName: "Gamma LLC",
        entityName: "US Entity",
        applicationStatus: "voided",
        totalAmount: 1000,
        amountUsed: 0,
        amountRemaining: 0,
        messageOnCreditMemo: "Voided",
      },
    ]);
    const cm = result.creditMemos[0];
    expect(cm.creditMemoNumber).toBe("CM-010");
    expect(cm.clientName).toBe("Gamma LLC");
    expect(cm.status).toBe("voided");
    expect(cm.message).toBe("Voided");
  });

  it("defaults missing optional fields", () => {
    const result = shapeCreditMemos([{ id: 20 }]);
    const cm = result.creditMemos[0];
    expect(cm.creditMemoNumber).toBeNull();
    expect(cm.creditMemoDate).toBeNull();
    expect(cm.clientName).toBeNull();
    expect(cm.entityName).toBeNull();
    expect(cm.contractName).toBeNull();
    expect(cm.status).toBe("unknown");
    expect(cm.totalAmount).toBe(0);
    expect(cm.amountUsed).toBe(0);
    expect(cm.amountRemaining).toBe(0);
    expect(cm.currency).toBeNull();
    expect(cm.message).toBeNull();
    expect(cm.lineCount).toBe(0);
  });
});

// --- Vendor shaping ---

describe("shapeVendors", () => {
  const vendors = [
    {
      id: 1,
      name: "Acme Supplies",
      company_name: "Acme Supplies LLC",
      email: "ap@acme.com",
      phone_number: "555-1000",
      status: "active",
      vendor_type: "supplier",
      first_name: "John",
      last_name: "Doe",
      dba: "Acme",
      website: "https://acme.example.com",
      mobile_number: "555-1001",
      notes: "Preferred vendor",
      payment_term_name_display: "Net 30",
      currency: "USD",
      address_street_1: "123 Main St",
      address_street_2: "Suite 100",
      city: "Springfield",
      state: "IL",
      zip_code: "62701",
      country: "US",
      contacts: [
        { id: 10, name: "Jane Doe", first_name: "Jane", last_name: "Doe", email: "jane@acme.com", phone_number: "555-1002" },
      ],
      abbreviation: "ACME",
      is_1099: true,
      vat_number: "VAT123",
      business_id_ssn: "12-3456789",
      external_id: "EXT-001",
      source: "import",
      searchVector: "acme supplies ...",
      searchText: "acme supplies llc",
    },
    {
      id: 2,
      name: "Beta Services",
      email: "billing@beta.com",
      status: "active",
    },
  ];

  it("computes total count", () => {
    const result = shapeVendors(vendors);
    expect(result.totalVendors).toBe(2);
  });

  it("summary returns only core fields", () => {
    const result = shapeVendors(vendors, "summary");
    const v = result.vendors[0];
    expect(v.id).toBe(1);
    expect(v.name).toBe("Acme Supplies");
    expect(v.companyName).toBe("Acme Supplies LLC");
    expect(v.email).toBe("ap@acme.com");
    expect(v.phone).toBe("555-1000");
    expect(v.status).toBe("active");
    expect(v.vendorType).toBe("supplier");
    // Should NOT have normal/full fields
    expect(v.firstName).toBeUndefined();
    expect(v.addressStreet1).toBeUndefined();
    expect(v.contacts).toBeUndefined();
    expect(v.is1099).toBeUndefined();
    // Internal fields should never be present
    expect(v.searchVector).toBeUndefined();
    expect(v.searchText).toBeUndefined();
  });

  it("normal (default) adds identity, address, contacts, notes", () => {
    const result = shapeVendors(vendors);
    const v = result.vendors[0];
    // Core fields still present
    expect(v.id).toBe(1);
    expect(v.name).toBe("Acme Supplies");
    // Normal-level fields
    expect(v.firstName).toBe("John");
    expect(v.lastName).toBe("Doe");
    expect(v.dba).toBe("Acme");
    expect(v.website).toBe("https://acme.example.com");
    expect(v.mobileNumber).toBe("555-1001");
    expect(v.notes).toBe("Preferred vendor");
    expect(v.paymentTerms).toBe("Net 30");
    expect(v.currency).toBe("USD");
    expect(v.addressStreet1).toBe("123 Main St");
    expect(v.addressStreet2).toBe("Suite 100");
    expect(v.city).toBe("Springfield");
    expect(v.state).toBe("IL");
    expect(v.zipCode).toBe("62701");
    expect(v.country).toBe("US");
    expect(v.contacts).toHaveLength(1);
    expect(v.contacts[0].name).toBe("Jane Doe");
    expect(v.contacts[0].email).toBe("jane@acme.com");
    // Should NOT have full-level fields
    expect(v.is1099).toBeUndefined();
    expect(v.vatNumber).toBeUndefined();
    expect(v.externalId).toBeUndefined();
  });

  it("full adds tax/compliance and external IDs", () => {
    const result = shapeVendors(vendors, "full");
    const v = result.vendors[0];
    // Normal fields present
    expect(v.firstName).toBe("John");
    expect(v.addressStreet1).toBe("123 Main St");
    expect(v.contacts).toHaveLength(1);
    // Full-level fields
    expect(v.abbreviation).toBe("ACME");
    expect(v.is1099).toBe(true);
    expect(v.vatNumber).toBe("VAT123");
    expect(v.businessIdSsn).toBe("12-3456789");
    expect(v.externalId).toBe("EXT-001");
    expect(v.source).toBe("import");
  });

  it("handles empty list", () => {
    const result = shapeVendors([]);
    expect(result.totalVendors).toBe(0);
    expect(result.vendors).toHaveLength(0);
  });

  it("handles missing optional fields gracefully", () => {
    const result = shapeVendors([{ id: 99, name: "Sparse" }]);
    const v = result.vendors[0];
    expect(v.email).toBeNull();
    expect(v.phone).toBeNull();
    expect(v.status).toBeNull();
    expect(v.firstName).toBeNull();
    expect(v.contacts).toHaveLength(0);
    expect(v.addressStreet1).toBeNull();
  });

  it("handles camelCase field names", () => {
    const result = shapeVendors([
      {
        id: 50,
        name: "CamelVendor",
        companyName: "CamelCo",
        phoneNumber: "555-5555",
        vendorType: "contractor",
        firstName: "Alex",
        lastName: "Smith",
        mobileNumber: "555-5556",
        paymentTermNameDisplay: "Net 45",
        addressStreet1: "789 Oak Ave",
        zipCode: "90210",
        vatNumber: "VAT-CAMEL",
        is1099: false,
        externalId: "EXT-CAMEL",
      },
    ], "full");
    const v = result.vendors[0];
    expect(v.companyName).toBe("CamelCo");
    expect(v.phone).toBe("555-5555");
    expect(v.vendorType).toBe("contractor");
    expect(v.firstName).toBe("Alex");
    expect(v.mobileNumber).toBe("555-5556");
    expect(v.paymentTerms).toBe("Net 45");
    expect(v.addressStreet1).toBe("789 Oak Ave");
    expect(v.zipCode).toBe("90210");
    expect(v.vatNumber).toBe("VAT-CAMEL");
    expect(v.is1099).toBe(false);
    expect(v.externalId).toBe("EXT-CAMEL");
  });
});

// --- Detail level tests ---

describe("shapeCustomers detail levels", () => {
  const customer = {
    id: 1,
    name: "Detail Corp",
    company_name: "Detail Corporation",
    email: "info@detail.com",
    phone_number: "555-0001",
    currency: "USD",
    active_contracts: 2,
    completed_contracts: 1,
    total_contracts: 3,
    total_revenue: 100000,
    total_mrr: 8333,
    total_billed: 80000,
    total_unbilled: 20000,
    total_paid: 75000,
    total_outstanding: 5000,
    total_deferred_revenue: 15000,
    payment_term_name_display: "Net 30",
    status: "active",
    // Normal-level fields
    first_name: "Alice",
    last_name: "Wonder",
    dba: "DetailCo",
    website: "https://detail.example.com",
    mobile_number: "555-0002",
    notes: "VIP customer",
    invoice_message: "Thank you for your business",
    address_street_1: "100 First Ave",
    address_street_2: "Floor 5",
    city: "Metropolis",
    state: "NY",
    zip_code: "10001",
    country: "US",
    billing_address_street_1: "200 Billing Blvd",
    billing_city: "Metropolis",
    billing_state: "NY",
    billing_zip_code: "10002",
    billing_country: "US",
    billing_addressee: "Accounts Payable",
    shipping_addressee: "Warehouse",
    contacts: [
      { id: 10, name: "Bob Smith", first_name: "Bob", last_name: "Smith", email: "bob@detail.com", phone_number: "555-0003" },
    ],
    total_credit_memos: 2,
    credit_memo_applied: 1000,
    credit_memo_available: 500,
    pending_contracts: 1,
    // Full-level fields
    abbreviation: "DET",
    business_id_ssn: "98-7654321",
    is_1099: false,
    vat_number: "VAT-DET",
    entity_use_code: "G",
    external_id: "EXT-DET",
    source: "api",
  };

  it("summary returns only core fields", () => {
    const result = shapeCustomers([customer], "summary");
    const c = result.customers[0];
    expect(c.id).toBe(1);
    expect(c.name).toBe("Detail Corp");
    expect(c.totalRevenue).toBe(100000);
    expect(c.status).toBe("active");
    // Should NOT have normal-level fields
    expect(c.firstName).toBeUndefined();
    expect(c.addressStreet1).toBeUndefined();
    expect(c.contacts).toBeUndefined();
    expect(c.notes).toBeUndefined();
    // Should NOT have full-level fields
    expect(c.vatNumber).toBeUndefined();
    expect(c.externalId).toBeUndefined();
  });

  it("normal (default) adds addresses, contacts, identity, notes, credit memo totals", () => {
    const result = shapeCustomers([customer]);
    const c = result.customers[0];
    // Core still present
    expect(c.totalRevenue).toBe(100000);
    // Normal fields
    expect(c.firstName).toBe("Alice");
    expect(c.lastName).toBe("Wonder");
    expect(c.dba).toBe("DetailCo");
    expect(c.website).toBe("https://detail.example.com");
    expect(c.notes).toBe("VIP customer");
    expect(c.invoiceMessage).toBe("Thank you for your business");
    expect(c.addressStreet1).toBe("100 First Ave");
    expect(c.addressStreet2).toBe("Floor 5");
    expect(c.city).toBe("Metropolis");
    expect(c.state).toBe("NY");
    expect(c.zipCode).toBe("10001");
    expect(c.country).toBe("US");
    expect(c.billingAddressStreet1).toBe("200 Billing Blvd");
    expect(c.billingCity).toBe("Metropolis");
    expect(c.billingAddressee).toBe("Accounts Payable");
    expect(c.shippingAddressee).toBe("Warehouse");
    expect(c.contacts).toHaveLength(1);
    expect(c.contacts[0].name).toBe("Bob Smith");
    expect(c.contacts[0].email).toBe("bob@detail.com");
    expect(c.totalCreditMemos).toBe(2);
    expect(c.creditMemoApplied).toBe(1000);
    expect(c.creditMemoAvailable).toBe(500);
    expect(c.pendingContracts).toBe(1);
    // Should NOT have full-level fields
    expect(c.vatNumber).toBeUndefined();
    expect(c.externalId).toBeUndefined();
    expect(c.businessIdSsn).toBeUndefined();
  });

  it("full adds tax/compliance and external IDs", () => {
    const result = shapeCustomers([customer], "full");
    const c = result.customers[0];
    // Normal fields present
    expect(c.firstName).toBe("Alice");
    expect(c.contacts).toHaveLength(1);
    // Full fields
    expect(c.abbreviation).toBe("DET");
    expect(c.businessIdSsn).toBe("98-7654321");
    expect(c.is1099).toBe(false);
    expect(c.vatNumber).toBe("VAT-DET");
    expect(c.entityUseCode).toBe("G");
    expect(c.externalId).toBe("EXT-DET");
    expect(c.source).toBe("api");
  });

  it("aggregates are the same regardless of detail level", () => {
    const summary = shapeCustomers([customer], "summary");
    const normal = shapeCustomers([customer], "normal");
    const full = shapeCustomers([customer], "full");
    expect(summary.totalRevenue).toBe(normal.totalRevenue);
    expect(normal.totalRevenue).toBe(full.totalRevenue);
    expect(summary.totalMrr).toBe(normal.totalMrr);
    expect(summary.totalOutstanding).toBe(normal.totalOutstanding);
  });
});

describe("shapeInvoices detail levels", () => {
  const invoice = {
    id: 201,
    invoiceNumber: "INV-201",
    clientName: "Detail Corp",
    status: "unpaid",
    invoiceDate: "2026-03-01",
    dueDate: "2026-03-31",
    totalAmount: 15000,
    amountPaid: 0,
    amountDue: 15000,
    pastDueDays: 14,
    // Normal-level fields
    contractName: "Project Detail",
    contract: 42,
    entityName: "US Entity",
    departmentName: "Engineering",
    tags: [{ name: "priority" }, { name: "q1" }],
    paidDate: null,
    sentDate: "2026-03-02",
    lastSentAt: "2026-03-02T10:00:00Z",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    currency: "USD",
    exchangeRate: 1.0,
    paymentTermName: "Net 30",
    purchaseOrderNumber: "PO-100",
    messageOnInvoice: "Please remit payment",
    billingAddress: "100 First Ave, Metropolis NY 10001",
    billingAddressee: "Accounts Payable",
    shippingAddress: "200 Warehouse Dr",
    shippingAddressee: "Receiving",
    // Full-level fields
    lines: [
      { description: "Consulting", quantity: 10, rate: 1200, amount: 12000, tax: 2400, departmentName: "Eng", tags: [{ name: "billable" }], productName: "Consulting Hours" },
      { description: "Expenses", amount: 600, tax: 0 },
    ],
    payments: [
      { amount: 5000, paymentDate: "2026-03-15", source: "ACH", paymentType: "electronic" },
    ],
    discount: 500,
    refNumber: "REF-201",
    emails: [{ sentAt: "2026-03-02", to: "client@detail.com" }],
  };

  it("summary returns only core fields", () => {
    const result = shapeInvoices([invoice], "summary");
    const inv = result.invoices[0];
    expect(inv.id).toBe(201);
    expect(inv.invoiceNumber).toBe("INV-201");
    expect(inv.totalAmount).toBe(15000);
    expect(inv.pastDueDays).toBe(14);
    // Should NOT have normal/full fields
    expect(inv.contractName).toBeUndefined();
    expect(inv.entityName).toBeUndefined();
    expect(inv.departmentName).toBeUndefined();
    expect(inv.lines).toBeUndefined();
    expect(inv.payments).toBeUndefined();
  });

  it("normal adds contract, dates, department, addresses", () => {
    const result = shapeInvoices([invoice], "normal");
    const inv = result.invoices[0];
    expect(inv.contractName).toBe("Project Detail");
    expect(inv.contractId).toBe(42);
    expect(inv.entityName).toBe("US Entity");
    expect(inv.departmentName).toBe("Engineering");
    expect(inv.tags).toEqual(["priority", "q1"]);
    expect(inv.sentDate).toBe("2026-03-02");
    expect(inv.periodStart).toBe("2026-03-01");
    expect(inv.currency).toBe("USD");
    expect(inv.terms).toBe("Net 30");
    expect(inv.purchaseOrderNumber).toBe("PO-100");
    expect(inv.messageOnInvoice).toBe("Please remit payment");
    expect(inv.billingAddress).toBe("100 First Ave, Metropolis NY 10001");
    expect(inv.shippingAddressee).toBe("Receiving");
    // Should NOT have full-level fields
    expect(inv.lines).toBeUndefined();
    expect(inv.payments).toBeUndefined();
    expect(inv.discount).toBeUndefined();
    expect(inv.emails).toBeUndefined();
  });

  it("full adds line items, payments, emails", () => {
    const result = shapeInvoices([invoice], "full");
    const inv = result.invoices[0];
    // Normal fields present
    expect(inv.contractName).toBe("Project Detail");
    // Full fields
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0].description).toBe("Consulting");
    expect(inv.lines[0].quantity).toBe(10);
    expect(inv.lines[0].rate).toBe(1200);
    expect(inv.lines[0].amount).toBe(12000);
    expect(inv.lines[0].tax).toBe(2400);
    expect(inv.lines[0].departmentName).toBe("Eng");
    expect(inv.lines[0].tags).toEqual(["billable"]);
    expect(inv.lines[0].productName).toBe("Consulting Hours");
    expect(inv.lines[1].quantity).toBeNull();
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0].amount).toBe(5000);
    expect(inv.payments[0].paymentDate).toBe("2026-03-15");
    expect(inv.payments[0].source).toBe("ACH");
    expect(inv.payments[0].paymentType).toBe("electronic");
    expect(inv.discount).toBe(500);
    expect(inv.refNumber).toBe("REF-201");
    expect(inv.emails).toHaveLength(1);
  });

  it("aggregates are the same regardless of detail level", () => {
    const summary = shapeInvoices([invoice], "summary");
    const full = shapeInvoices([invoice], "full");
    expect(summary.totalAmount).toBe(full.totalAmount);
    expect(summary.totalNetAmount).toBe(full.totalNetAmount);
    expect(summary.totalTaxAmount).toBe(full.totalTaxAmount);
  });
});

describe("shapeBills detail levels", () => {
  const bill = {
    id: 301,
    bill_number: "BILL-301",
    bill_date: "2026-03-01",
    due_date: "2026-03-31",
    vendor_name: "Test Vendor",
    entity_name: "US Entity",
    status: "unpaid",
    past_due_days: 5,
    total_amount: 10000,
    amount_due: 10000,
    amount_paid: 0,
    ap_account_name: "Accounts Payable",
    message_on_bill: "Rush order",
    // Normal-level fields
    department_name: "Operations",
    purchase_order_number: "PO-301",
    currency: "USD",
    exchange_rate: 1.0,
    mailing_address: "456 Vendor Way, Anytown CA 90000",
    bill_type: "standard",
    // Full-level fields
    lines: [
      { account_name: "Office Supplies", account_number: "6100", department_name: "Ops", description: "Paper", amount: 5000, tax: 400, tags: [{ name: "office" }] },
      { account_name: "Equipment", account_number: "1500", description: "Printer", amount: 5000, tax: 400 },
    ],
    payments: [
      { amount: 3000, payment_date: "2026-03-15", source: "check" },
    ],
    tax_behavior: "exclusive",
    attachments: [{ url: "https://example.com/receipt.pdf" }],
    external_ramp_id: "RAMP-301",
  };

  it("summary returns only core fields", () => {
    const result = shapeBills([bill], "summary");
    const b = result.bills[0];
    expect(b.id).toBe(301);
    expect(b.billNumber).toBe("BILL-301");
    expect(b.totalAmount).toBe(10000);
    expect(b.lineCount).toBe(2);
    // Should NOT have normal/full fields
    expect(b.departmentName).toBeUndefined();
    expect(b.purchaseOrderNumber).toBeUndefined();
    expect(b.currency).toBeUndefined();
    expect(b.lines).toBeUndefined();
    expect(b.payments).toBeUndefined();
  });

  it("normal adds department, PO, currency, address", () => {
    const result = shapeBills([bill], "normal");
    const b = result.bills[0];
    expect(b.departmentName).toBe("Operations");
    expect(b.purchaseOrderNumber).toBe("PO-301");
    expect(b.currency).toBe("USD");
    expect(b.exchangeRate).toBe(1.0);
    expect(b.mailingAddress).toBe("456 Vendor Way, Anytown CA 90000");
    expect(b.billType).toBe("standard");
    // Should NOT have full-level fields
    expect(b.lines).toBeUndefined();
    expect(b.payments).toBeUndefined();
    expect(b.attachments).toBeUndefined();
  });

  it("full adds line items, payments, attachments", () => {
    const result = shapeBills([bill], "full");
    const b = result.bills[0];
    // Normal fields present
    expect(b.departmentName).toBe("Operations");
    // Full fields
    expect(b.lines).toHaveLength(2);
    expect(b.lines[0].accountName).toBe("Office Supplies");
    expect(b.lines[0].accountNumber).toBe("6100");
    expect(b.lines[0].departmentName).toBe("Ops");
    expect(b.lines[0].description).toBe("Paper");
    expect(b.lines[0].amount).toBe(5000);
    expect(b.lines[0].tax).toBe(400);
    expect(b.lines[0].tags).toEqual(["office"]);
    expect(b.payments).toHaveLength(1);
    expect(b.payments[0].amount).toBe(3000);
    expect(b.payments[0].paymentDate).toBe("2026-03-15");
    expect(b.payments[0].source).toBe("check");
    expect(b.taxBehavior).toBe("exclusive");
    expect(b.attachments).toHaveLength(1);
    expect(b.externalRampId).toBe("RAMP-301");
  });
});

describe("analyzeContracts detail levels", () => {
  const contract = {
    id: 401,
    name: "Enterprise Deal",
    client_name: "Big Corp",
    status: "active",
    total_revenue: 500000,
    total_billed: 200000,
    total_unbilled: 300000,
    start_date: "2025-01-01",
    end_date: "2026-12-31",
    // Normal-level fields
    deal_name: "Enterprise Q1",
    deal_id: 99,
    crm_link: "https://crm.example.com/deal/99",
    contract_link: "https://app.example.com/contract/401",
    total_mrr: 20000,
    total_paid: 180000,
    total_outstanding: 20000,
    total_deferred_revenue: 100000,
    total_contract_value: 500000,
    currency: "USD",
    billing_frequency: "monthly",
    purchase_order_number: "PO-401",
    department_name: "Sales",
    parent_department_name: "Revenue",
    entity_name: "US Entity",
    // Full-level fields
    auto_renew: true,
    auto_renew_duration: 12,
    auto_renew_invoice: true,
    is_evergreen: false,
    effective_end_date: "2026-12-31",
    working_end_date: "2026-12-31",
    tags: [{ name: "enterprise" }, { name: "strategic" }],
    entity_currency: "USD",
    exchange_rate: 1.0,
    attachments: [{ url: "https://example.com/contract.pdf" }],
  };

  it("summary returns only core fields", () => {
    const result = analyzeContracts([contract], "summary");
    const c = result.contracts[0];
    expect(c.id).toBe(401);
    expect(c.name).toBe("Enterprise Deal");
    expect(c.clientName).toBe("Big Corp");
    expect(c.totalRevenue).toBe(500000);
    expect(c.recognized).toBe(200000);
    expect(c.remaining).toBe(300000);
    expect(c.percentRecognized).toBe(40);
    expect(c.startDate).toBe("2025-01-01");
    // Should NOT have normal/full fields
    expect(c.dealName).toBeUndefined();
    expect(c.totalMrr).toBeUndefined();
    expect(c.autoRenew).toBeUndefined();
    expect(c.tags).toBeUndefined();
  });

  it("normal adds deal info, financial detail, department", () => {
    const result = analyzeContracts([contract], "normal");
    const c = result.contracts[0];
    expect(c.dealName).toBe("Enterprise Q1");
    expect(c.dealId).toBe(99);
    expect(c.crmLink).toBe("https://crm.example.com/deal/99");
    expect(c.contractLink).toBe("https://app.example.com/contract/401");
    expect(c.totalMrr).toBe(20000);
    expect(c.totalPaid).toBe(180000);
    expect(c.totalOutstanding).toBe(20000);
    expect(c.totalDeferredRevenue).toBe(100000);
    expect(c.totalContractValue).toBe(500000);
    expect(c.currency).toBe("USD");
    expect(c.billingFrequency).toBe("monthly");
    expect(c.purchaseOrderNumber).toBe("PO-401");
    expect(c.departmentName).toBe("Sales");
    expect(c.parentDepartmentName).toBe("Revenue");
    expect(c.entityName).toBe("US Entity");
    // Should NOT have full-level fields
    expect(c.autoRenew).toBeUndefined();
    expect(c.tags).toBeUndefined();
    expect(c.isEvergreen).toBeUndefined();
  });

  it("full adds auto-renew, evergreen, tags", () => {
    const result = analyzeContracts([contract], "full");
    const c = result.contracts[0];
    // Normal fields present
    expect(c.dealName).toBe("Enterprise Q1");
    // Full fields
    expect(c.autoRenew).toBe(true);
    expect(c.autoRenewDuration).toBe(12);
    expect(c.autoRenewInvoice).toBe(true);
    expect(c.isEvergreen).toBe(false);
    expect(c.effectiveEndDate).toBe("2026-12-31");
    expect(c.workingEndDate).toBe("2026-12-31");
    expect(c.tags).toEqual(["enterprise", "strategic"]);
    expect(c.entityCurrency).toBe("USD");
    expect(c.exchangeRate).toBe(1.0);
    expect(c.attachments).toHaveLength(1);
  });

  it("aggregates are the same regardless of detail level", () => {
    const summary = analyzeContracts([contract], "summary");
    const full = analyzeContracts([contract], "full");
    expect(summary.totalRevenue).toBe(full.totalRevenue);
    expect(summary.totalRecognized).toBe(full.totalRecognized);
    expect(summary.totalRemaining).toBe(full.totalRemaining);
    expect(summary.percentRecognized).toBe(full.percentRecognized);
  });
});

// --- Chart transaction / journal entry shaping (dual-ID support) ---
//
// Fixtures were captured from the live Campfire API and then scrubbed: all
// identifying values (IDs, names, amounts, UUIDs) are fabricated, but the
// object *shape* (fields, nullability, nested arrays) mirrors what the API
// actually returns. See src/__fixtures__/.

describe("shapeChartTransaction", () => {
  it("exposes both IDs: chart-line id, parent journal id, and journal order", () => {
    const out = shapeChartTransaction(chartTransactionFixture);
    expect(out.id).toBe(1001); // chart-line ID
    expect(out.journal).toBe(9001); // parent journal entry ID (matches URL ID)
    expect(out.journalOrder).toBe("0099999"); // user-visible "Transaction #…" number
    expect(out.transactionId).toBe("00000000-0000-0000-0000-000000001001");
  });

  it("preserves debit/credit asymmetry from a real response", () => {
    const out = shapeChartTransaction(chartTransactionFixture);
    expect(out.debitAmount).toBe(100);
    expect(out.creditAmount).toBeNull();
  });

  it("prefers journal_type_name over journal_type for display", () => {
    const out = shapeChartTransaction(chartTransactionFixture);
    expect(out.journalType).toBe("Deposit");
  });

  it("tolerates missing ID fields without throwing", () => {
    // An older/partial record missing the three dual-ID fields entirely
    const partial = { ...chartTransactionFixture } as any;
    delete partial.journal;
    delete partial.journal_order;
    delete partial.transaction_id;
    const out = shapeChartTransaction(partial);
    expect(out.journal).toBeNull();
    expect(out.journalOrder).toBeNull();
    expect(out.transactionId).toBeNull();
  });

  it("handles empty tags array", () => {
    const out = shapeChartTransaction(chartTransactionFixture);
    expect(out.tags).toEqual([]);
  });
});

describe("shapeJournalEntry", () => {
  it("exposes the journal's URL ID and user-visible order", () => {
    const out = shapeJournalEntry(journalEntryFixture);
    expect(out.id).toBe(9001); // matches the fixture's top-level id (URL ID)
    expect(out.order).toBe("0099999"); // user-visible "Transaction #0099999"
  });

  it("nests shaped chart transactions with consistent parent IDs", () => {
    const out = shapeJournalEntry(journalEntryFixture);
    expect(out.transactions).toHaveLength(2);
    for (const t of out.transactions) {
      expect(t.id).toBeGreaterThan(0);
      expect(typeof t.accountName).toBe("string");
    }
  });

  it("journal legs balance: total debits equal total credits", () => {
    const out = shapeJournalEntry(journalEntryFixture);
    const debits = out.transactions.reduce((s: number, t: any) => s + (t.debitAmount ?? 0), 0);
    const credits = out.transactions.reduce((s: number, t: any) => s + (t.creditAmount ?? 0), 0);
    expect(debits).toBe(credits);
  });

  it("returns empty transactions array when field is missing", () => {
    const { transactions, ...withoutTxns } = journalEntryFixture as any;
    const out = shapeJournalEntry(withoutTxns);
    expect(out.transactions).toEqual([]);
  });
});

describe("ID relationship between the two fixtures", () => {
  // This is the invariant the integration tests also verify end-to-end:
  // a chart transaction's `journal` field should equal its parent journal
  // entry's `id`, and `journal_order` should equal the parent's `order`.
  it("chart transaction's journal id matches journal entry's id", () => {
    expect((chartTransactionFixture as any).journal).toBe(
      (journalEntryFixture as any).id
    );
  });

  it("chart transaction's journal_order matches journal entry's order", () => {
    expect((chartTransactionFixture as any).journal_order).toBe(
      (journalEntryFixture as any).order
    );
  });
});

// --- Single-record fetch-by-id shapers (invoice/bill/credit-memo/debit-memo/contract/customer) ---
//
// These confirm the ID vocabulary is consistently exposed:
//   - canonical numeric `id` (URL id, FK value)
//   - printed display number with the entity-specific field name
//   - foreign-key ids named consistently (camelCase `<entity>Id`)

describe("shapeInvoiceDetail", () => {
  const out = shapeInvoiceDetail(invoiceFixture);
  it("exposes canonical id and invoiceNumber separately", () => {
    expect(out.id).toBe(2001);
    expect(out.invoiceNumber).toBe("INV-TEST-0001");
  });
  it("exposes foreign-key IDs for follow-up fetches", () => {
    expect(out.clientId).toBe(802);
    expect(out.contractId).toBe(1001);
    expect(out.journalEntryId).toBe(9501);
  });
  it("coerces amount fields to numbers", () => {
    expect(typeof out.totalAmount).toBe("number");
    expect(out.totalAmount).toBe(10000);
    expect(out.amountDue).toBe(10000);
  });
  it("shapes line items with their own ids and FKs", () => {
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].id).toBe(3001);
    expect(out.lines[0].productId).toBe(501);
    expect(out.lines[0].departmentId).toBe(4001);
  });
  it("tolerates missing display number", () => {
    const { invoice_number, ...partial } = invoiceFixture as any;
    const shaped = shapeInvoiceDetail(partial);
    expect(shaped.invoiceNumber).toBeNull();
    expect(shaped.id).toBe(2001);
  });
});

describe("shapeBillDetail", () => {
  const out = shapeBillDetail(billFixture);
  it("exposes canonical id and billNumber — bill number often starts with INV-…", () => {
    expect(out.id).toBe(2501);
    expect(out.billNumber).toBe("INV-TEST-0002");
    // Intentionally starts with INV-: this is the collision hazard the server instructions warn about
    expect(out.billNumber.startsWith("INV-")).toBe(true);
  });
  it("exposes vendor/entity/journal/apAccount foreign keys", () => {
    expect(out.vendorId).toBe(770);
    expect(out.entityId).toBe(101);
    expect(out.journalEntryId).toBe(9502);
    expect(out.apAccountId).toBe(602);
  });
  it("shapes line items with account and department FKs", () => {
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].accountId).toBe(550);
    expect(out.lines[0].departmentId).toBe(4002);
  });
});

describe("shapeCreditMemoDetail", () => {
  const out = shapeCreditMemoDetail(creditMemoFixture);
  it("exposes canonical id and creditMemoNumber", () => {
    expect(out.id).toBe(3001);
    expect(out.creditMemoNumber).toBe("CN-TEST-0001");
  });
  it("exposes client/contract/entity foreign keys", () => {
    expect(out.clientId).toBe(802);
    expect(out.contractId).toBe(1002);
    expect(out.entityId).toBe(101);
    expect(out.journalEntryId).toBe(9503);
  });
  it("coerces amount fields to numbers", () => {
    expect(out.totalAmount).toBe(5000);
    expect(out.amountRemaining).toBe(5000);
    expect(out.amountUsed).toBe(0);
  });
});

describe("shapeDebitMemoDetail", () => {
  const out = shapeDebitMemoDetail(debitMemoFixture);
  it("exposes canonical id and debitMemoNumber", () => {
    expect(out.id).toBe(3501);
    expect(out.debitMemoNumber).toBe("DN-TEST-0001");
  });
  it("exposes vendor/debitAccount/journal foreign keys", () => {
    expect(out.vendorId).toBe(770);
    expect(out.debitAccountId).toBe(602);
    expect(out.journalEntryId).toBe(9504);
  });
});

describe("shapeContractDetail", () => {
  const out = shapeContractDetail(contractFixture);
  it("exposes canonical id (contracts have no printed Campfire number)", () => {
    expect(out.id).toBe(1001);
  });
  it("separates Campfire id from external CRM deal id", () => {
    // `dealId` is a string from an external CRM (HubSpot), NOT a Campfire id.
    // Callers should not pass it to get_contract.
    expect(out.dealId).toBe("TESTDEAL0001");
    expect(typeof out.dealId).toBe("string");
    expect(typeof out.id).toBe("number");
  });
  it("exposes client/entity/department foreign keys", () => {
    expect(out.clientId).toBe(802);
    expect(out.entityId).toBe(101);
    expect(out.departmentId).toBe(4001);
  });
  it("shapes tag array to names", () => {
    expect(out.tags).toEqual(["monthly_flat"]);
  });
});

describe("shapeCustomerDetail", () => {
  const out = shapeCustomerDetail(customerFixture);
  it("exposes canonical id and name (customers have no printed number)", () => {
    expect(out.id).toBe(802);
    expect(out.name).toBe("Delta Co");
  });
  it("exposes aggregate totals as numbers", () => {
    expect(typeof out.totalRevenue).toBe("number");
    expect(typeof out.totalOutstanding).toBe("number");
    expect(out.totalContracts).toBe(0);
  });
  it("returns empty contacts array when source is empty", () => {
    expect(out.contacts).toEqual([]);
  });
});

// The FK-follow contract: an invoice's clientId is the same kind of id a customer fixture carries.
// This is the "follow the FK" flow an LLM should be able to do without guessing.
describe("Cross-entity ID follow flow", () => {
  it("invoice's clientId can be fed back into get_customer (same numeric id space)", () => {
    const inv = shapeInvoiceDetail(invoiceFixture);
    const cust = shapeCustomerDetail(customerFixture);
    expect(inv.clientId).toBe(cust.id);
  });

  it("invoice's contractId can be fed back into get_contract", () => {
    const inv = shapeInvoiceDetail(invoiceFixture);
    const ctr = shapeContractDetail(contractFixture);
    expect(inv.contractId).toBe(ctr.id);
  });

  it("contract's clientId can be fed back into get_customer", () => {
    const ctr = shapeContractDetail(contractFixture);
    const cust = shapeCustomerDetail(customerFixture);
    expect(ctr.clientId).toBe(cust.id);
  });
});
