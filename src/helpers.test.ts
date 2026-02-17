import { describe, it, expect } from "vitest";
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
    },
  ];

  it("computes aggregate totals", () => {
    const result = shapeInvoices(invoices);
    expect(result.totalInvoices).toBe(3);
    expect(result.totalAmount).toBe(23000);
    expect(result.totalPaid).toBe(5000);
    expect(result.totalDue).toBe(18000);
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

  it("shapes individual invoice fields (compact)", () => {
    const result = shapeInvoices(invoices);
    expect(result.invoices[0].invoiceNumber).toBe("INV-001");
    expect(result.invoices[0].clientName).toBe("Acme Corp");
    expect(result.invoices[0].status).toBe("unpaid");
    expect(result.invoices[0].totalAmount).toBe(10000);
    expect(result.invoices[0].amountDue).toBe(10000);
    // Removed fields for compactness: contractName, entityName, currency, paymentTerms
    expect(result.invoices[0].contractName).toBeUndefined();
    expect(result.invoices[0].entityName).toBeUndefined();
    expect(result.invoices[0].currency).toBeUndefined();
    expect(result.invoices[0].paymentTerms).toBeUndefined();
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
