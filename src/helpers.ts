// Pure data transformation helpers for Campfire MCP server.
// No API calls — all functions take pre-fetched data and return shaped results.

export interface DateRange {
  dateFrom: string;
  dateTo: string;
}

/** Get YYYY-MM-DD range for N months ago (full month). */
export function getMonthRange(monthsAgo: number, now = new Date()): DateRange {
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const dateFrom = fmt(d);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { dateFrom, dateTo: fmt(last) };
}

/** Get YYYY-MM-DD range from Jan 1 of current year through today. */
export function getCurrentYTDRange(now = new Date()): DateRange {
  return {
    dateFrom: `${now.getFullYear()}-01-01`,
    dateTo: fmt(now),
  };
}

/** Get YYYY-MM-DD range for the current month through today. */
export function getCurrentMonthRange(now = new Date()): DateRange {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { dateFrom: fmt(first), dateTo: fmt(now) };
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// --- Financial Snapshot ---

export interface FinancialSnapshot {
  period: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  grossMarginPercent: number | null;
  netMarginPercent: number | null;
  cashPosition: number | null;
  currentRatio: number | null;
}

/**
 * Build a financial snapshot from raw Campfire statement data.
 * Income statement data typically has sections with rows containing amounts.
 * Balance sheet has assets/liabilities/equity sections.
 */
export function buildFinancialSnapshot(
  incomeStatement: any,
  balanceSheet: any,
  cashFlow: any,
  periodLabel: string,
): FinancialSnapshot {
  const revenue = extractTotal(incomeStatement, ["revenue", "income", "sales"]);
  const cogs = extractTotal(incomeStatement, ["cost of goods", "cost of sales", "cogs", "cost of revenue"]);
  const expenses = extractTotal(incomeStatement, ["expense", "operating expense", "total expense"]);
  const netIncome = extractTotal(incomeStatement, ["net income", "net profit", "net earnings"]);

  // Fallback: if netIncome isn't found as a line item, compute it
  const computedNet = netIncome !== 0 ? netIncome : revenue - expenses;

  const grossProfit = revenue - Math.abs(cogs);
  const grossMarginPercent = revenue !== 0 ? round((grossProfit / revenue) * 100) : null;
  const netMarginPercent = revenue !== 0 ? round((computedNet / revenue) * 100) : null;

  // Balance sheet: cash and current ratio
  const cash = extractTotal(balanceSheet, ["cash", "cash and cash equivalents", "bank"]);
  const currentAssets = extractTotal(balanceSheet, ["current assets", "total current assets"]);
  const currentLiabilities = extractTotal(balanceSheet, ["current liabilities", "total current liabilities"]);
  const currentRatio = currentLiabilities !== 0 ? round(currentAssets / currentLiabilities) : null;

  return {
    period: periodLabel,
    revenue,
    expenses: Math.abs(expenses),
    netIncome: computedNet,
    grossMarginPercent,
    netMarginPercent,
    cashPosition: cash || null,
    currentRatio,
  };
}

// --- Burn Rate ---

export interface BurnRateResult {
  monthlyBurnAvg: number;
  monthlyBurns: { month: string; burn: number }[];
  trend: "increasing" | "decreasing" | "stable";
  cashPosition: number | null;
  runwayMonths: number | null;
}

/**
 * Compute burn rate from an array of monthly income statements.
 * Each entry: { label, data } where data is raw income statement response.
 * Burn = revenue - expenses (negative = burning cash).
 */
export function computeBurnRate(
  monthlyStatements: { label: string; data: any }[],
  balanceSheet: any,
): BurnRateResult {
  const burns = monthlyStatements.map((m) => {
    const rev = extractTotal(m.data, ["revenue", "income", "sales"]);
    const exp = Math.abs(extractTotal(m.data, ["expense", "operating expense", "total expense"]));
    return { month: m.label, burn: exp - rev };
  });

  const avgBurn = burns.length > 0
    ? round(burns.reduce((s, b) => s + b.burn, 0) / burns.length)
    : 0;

  // Trend: compare first half average to second half average
  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (burns.length >= 3) {
    const mid = Math.floor(burns.length / 2);
    const firstHalf = burns.slice(0, mid).reduce((s, b) => s + b.burn, 0) / mid;
    const secondHalf = burns.slice(mid).reduce((s, b) => s + b.burn, 0) / (burns.length - mid);
    const diff = secondHalf - firstHalf;
    if (diff > avgBurn * 0.1) trend = "increasing";
    else if (diff < -avgBurn * 0.1) trend = "decreasing";
  }

  const cash = extractTotal(balanceSheet, ["cash", "cash and cash equivalents", "bank"]);
  const runwayMonths = avgBurn > 0 && cash > 0 ? round(cash / avgBurn) : null;

  return {
    monthlyBurnAvg: avgBurn,
    monthlyBurns: burns,
    trend,
    cashPosition: cash || null,
    runwayMonths,
  };
}

// --- Transaction enrichment ---

export interface TransactionSummary {
  totalTransactions: number;
  totalDebits: number;
  totalCredits: number;
  byAccountType: Record<string, { count: number; debits: number; credits: number }>;
  transactions: any[];
}

export function enrichTransactions(transactions: any[]): TransactionSummary {
  let totalDebits = 0;
  let totalCredits = 0;
  const byAccountType: Record<string, { count: number; debits: number; credits: number }> = {};

  const shaped = transactions.map((t: any) => {
    const debit = Number(t.debit_amount || t.debit || 0);
    const credit = Number(t.credit_amount || t.credit || 0);
    totalDebits += debit;
    totalCredits += credit;

    const acctType = t.account_type || t.accountType || "Unknown";
    if (!byAccountType[acctType]) {
      byAccountType[acctType] = { count: 0, debits: 0, credits: 0 };
    }
    byAccountType[acctType].count++;
    byAccountType[acctType].debits += debit;
    byAccountType[acctType].credits += credit;

    return {
      id: t.id,
      date: t.date || t.transaction_date,
      description: t.description || t.memo,
      accountName: t.account_name || t.accountName,
      accountType: acctType,
      vendorName: t.vendor_name || t.vendorName,
      departmentName: t.department_name || t.departmentName,
      debit,
      credit,
    };
  });

  return {
    totalTransactions: transactions.length,
    totalDebits: round(totalDebits),
    totalCredits: round(totalCredits),
    byAccountType,
    transactions: shaped,
  };
}

// --- Aging analysis ---

export interface AgingSummary {
  type: "ap" | "ar" | "combined";
  totalOutstanding: number;
  buckets: Record<string, { count: number; total: number }>;
  criticalItems: any[];
  items: any[];
}

export function analyzeAging(agingData: any[], agingType?: "ap" | "ar"): AgingSummary {
  const buckets: Record<string, { count: number; total: number }> = {};
  const criticalItems: any[] = [];
  let totalOutstanding = 0;

  const items = agingData.map((item: any) => {
    const amount = Number(item.amount || item.balance || item.outstanding || 0);
    const bucket = item.aging_bucket || item.bucket || item.age_bucket || categorizeDays(item.days_outstanding || item.days || 0);
    totalOutstanding += amount;

    if (!buckets[bucket]) buckets[bucket] = { count: 0, total: 0 };
    buckets[bucket].count++;
    buckets[bucket].total += amount;

    const days = Number(item.days_outstanding || item.days || 0);
    if (days >= 90 || bucket.includes("90")) {
      criticalItems.push({
        name: item.vendor_name || item.customer_name || item.name,
        amount,
        days,
        bucket,
      });
    }

    return {
      name: item.vendor_name || item.customer_name || item.name,
      amount,
      bucket,
      days,
      invoiceNumber: item.invoice_number || item.reference,
      dueDate: item.due_date,
    };
  });

  // Round bucket totals
  for (const b of Object.values(buckets)) {
    b.total = round(b.total);
  }

  return {
    type: agingType || "combined",
    totalOutstanding: round(totalOutstanding),
    buckets,
    criticalItems,
    items,
  };
}

function categorizeDays(days: number): string {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

// --- Contract analysis ---

export interface ContractSummary {
  totalContracts: number;
  totalRevenue: number;
  totalRecognized: number;
  totalRemaining: number;
  percentRecognized: number | null;
  contracts: any[];
}

export function analyzeContracts(contracts: any[]): ContractSummary {
  let totalRevenue = 0;
  let totalBilled = 0;
  let totalUnbilled = 0;

  const shaped = contracts.map((c: any) => {
    const rev = Number(c.total_revenue || c.totalRevenue || c.contract_value || 0);
    const billed = Number(c.total_billed || c.totalBilled || c.recognized_revenue || 0);
    const unbilled = Number(c.total_unbilled || c.totalUnbilled || rev - billed);
    totalRevenue += rev;
    totalBilled += billed;
    totalUnbilled += unbilled;

    return {
      id: c.id,
      name: c.name || c.contract_name,
      clientName: c.client_name || c.clientName,
      status: c.status,
      totalRevenue: rev,
      recognized: billed,
      remaining: unbilled,
      percentRecognized: rev > 0 ? round((billed / rev) * 100) : 0,
      startDate: c.start_date || c.startDate,
      endDate: c.end_date || c.endDate,
    };
  });

  return {
    totalContracts: contracts.length,
    totalRevenue: round(totalRevenue),
    totalRecognized: round(totalBilled),
    totalRemaining: round(totalUnbilled),
    percentRecognized: totalRevenue > 0 ? round((totalBilled / totalRevenue) * 100) : null,
    contracts: shaped,
  };
}

// --- Customer shaping ---

export interface CustomerSummary {
  totalCustomers: number;
  totalRevenue: number;
  totalMrr: number;
  totalOutstanding: number;
  customers: any[];
}

export function shapeCustomers(customers: any[]): CustomerSummary {
  let totalRevenue = 0;
  let totalMrr = 0;
  let totalOutstanding = 0;

  const shaped = customers.map((c: any) => {
    const rev = Number(c.total_revenue ?? c.totalRevenue ?? 0);
    const mrr = Number(c.total_mrr ?? c.totalMrr ?? 0);
    const outstanding = Number(c.total_outstanding ?? c.totalOutstanding ?? 0);
    totalRevenue += rev;
    totalMrr += mrr;
    totalOutstanding += outstanding;

    return {
      id: c.id,
      name: c.name,
      companyName: c.company_name ?? c.companyName,
      email: c.email,
      phone: c.phone_number ?? c.phoneNumber,
      currency: c.currency,
      activeContracts: Number(c.active_contracts ?? c.activeContracts ?? 0),
      completedContracts: Number(c.completed_contracts ?? c.completedContracts ?? 0),
      totalContracts: Number(c.total_contracts ?? c.totalContracts ?? 0),
      totalRevenue: rev,
      totalMrr: mrr,
      totalBilled: Number(c.total_billed ?? c.totalBilled ?? 0),
      totalUnbilled: Number(c.total_unbilled ?? c.totalUnbilled ?? 0),
      totalPaid: Number(c.total_paid ?? c.totalPaid ?? 0),
      totalOutstanding: outstanding,
      totalDeferredRevenue: Number(c.total_deferred_revenue ?? c.totalDeferredRevenue ?? 0),
      paymentTerms: c.payment_term_name_display ?? c.paymentTermNameDisplay,
      status: c.status,
    };
  });

  return {
    totalCustomers: customers.length,
    totalRevenue: round(totalRevenue),
    totalMrr: round(totalMrr),
    totalOutstanding: round(totalOutstanding),
    customers: shaped,
  };
}

// --- Invoice shaping ---

export interface InvoiceSummary {
  totalInvoices: number;
  totalAmount: number;
  totalPaid: number;
  totalDue: number;
  byStatus: Record<string, { count: number; totalAmount: number; totalDue: number }>;
  invoices: any[];
}

export function shapeInvoices(invoices: any[]): InvoiceSummary {
  let totalAmount = 0;
  let totalPaid = 0;
  let totalDue = 0;
  const byStatus: Record<string, { count: number; totalAmount: number; totalDue: number }> = {};

  const shaped = invoices.map((inv: any) => {
    const amount = Number(inv.totalAmount ?? inv.total_amount ?? 0);
    const paid = Number(inv.amountPaid ?? inv.amount_paid ?? 0);
    const due = Number(inv.amountDue ?? inv.amount_due ?? 0);
    totalAmount += amount;
    totalPaid += paid;
    totalDue += due;

    const status = inv.status ?? "unknown";
    if (!byStatus[status]) {
      byStatus[status] = { count: 0, totalAmount: 0, totalDue: 0 };
    }
    byStatus[status].count++;
    byStatus[status].totalAmount += amount;
    byStatus[status].totalDue += due;

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber ?? inv.invoice_number,
      clientName: inv.clientName ?? inv.client_name,
      contractName: inv.contractName ?? inv.contract_name,
      entityName: inv.entityName ?? inv.entity_name,
      status,
      invoiceDate: inv.invoiceDate ?? inv.invoice_date,
      dueDate: inv.dueDate ?? inv.due_date,
      paidDate: inv.paidDate ?? inv.paid_date,
      totalAmount: amount,
      amountPaid: paid,
      amountDue: due,
      pastDueDays: Number(inv.pastDueDays ?? inv.past_due_days ?? 0),
      currency: inv.currency ?? inv.entityCurrency ?? inv.entity_currency,
      paymentTerms: inv.paymentTermName ?? inv.payment_term_name,
    };
  });

  // Round status bucket totals
  for (const b of Object.values(byStatus)) {
    b.totalAmount = round(b.totalAmount);
    b.totalDue = round(b.totalDue);
  }

  return {
    totalInvoices: invoices.length,
    totalAmount: round(totalAmount),
    totalPaid: round(totalPaid),
    totalDue: round(totalDue),
    byStatus,
    invoices: shaped,
  };
}

// --- Trial balance shaping ---

export interface TrialBalanceSummary {
  startDate: string | null;
  endDate: string | null;
  totalDebits: number;
  totalCredits: number;
  accountCount: number;
  byAccountType: Record<string, { count: number; debits: number; credits: number }>;
  accounts: any[];
}

export function shapeTrialBalance(data: any): TrialBalanceSummary {
  const startDate = data?.startDate ?? data?.start_date ?? null;
  const endDate = data?.endDate ?? data?.end_date ?? null;
  const tb = data?.trialBalance ?? data?.trial_balance ?? data;
  const accounts = tb?.accounts ?? [];

  let totalDebits = 0;
  let totalCredits = 0;
  const byAccountType: Record<string, { count: number; debits: number; credits: number }> = {};

  const shaped = (Array.isArray(accounts) ? accounts : []).map((a: any) => {
    const debits = Number(a.balances?.debits ?? a.debits ?? 0);
    const credits = Number(a.balances?.credits ?? a.credits ?? 0);
    totalDebits += debits;
    totalCredits += credits;

    const acctType = a.accountType ?? a.account_type ?? "Unknown";
    if (!byAccountType[acctType]) {
      byAccountType[acctType] = { count: 0, debits: 0, credits: 0 };
    }
    byAccountType[acctType].count++;
    byAccountType[acctType].debits += debits;
    byAccountType[acctType].credits += credits;

    return {
      id: a.id,
      name: a.name,
      number: a.number,
      accountType: acctType,
      debits,
      credits,
      net: round(debits - credits),
      department: a.department,
    };
  });

  // Round bucket totals
  for (const b of Object.values(byAccountType)) {
    b.debits = round(b.debits);
    b.credits = round(b.credits);
  }

  return {
    startDate,
    endDate,
    totalDebits: round(totalDebits),
    totalCredits: round(totalCredits),
    accountCount: shaped.length,
    byAccountType,
    accounts: shaped,
  };
}

// --- Utility ---

/** Walk nested data looking for a matching section/row by name keywords. */
function extractTotal(data: any, keywords: string[]): number {
  if (!data) return 0;

  // If data is an array of sections/rows
  if (Array.isArray(data)) {
    for (const item of data) {
      const name = (item.name || item.label || item.title || item.account_name || "").toLowerCase();
      if (keywords.some((k) => name.includes(k))) {
        const val = item.total || item.amount || item.value || item.balance || 0;
        return Number(val);
      }
      // Recurse into children/rows
      const nested = item.children || item.rows || item.items || item.line_items;
      if (nested) {
        const found = extractTotal(nested, keywords);
        if (found !== 0) return found;
      }
    }
    return 0;
  }

  // If data is an object with sections
  if (typeof data === "object") {
    for (const key of Object.keys(data)) {
      const keyLower = key.toLowerCase();
      if (keywords.some((k) => keyLower.includes(k))) {
        const val = data[key];
        if (typeof val === "number") return val;
        if (val?.total !== undefined) return Number(val.total);
        if (val?.amount !== undefined) return Number(val.amount);
        if (Array.isArray(val)) {
          // Sum up the section
          return val.reduce((s: number, r: any) => s + Number(r.amount || r.total || r.value || 0), 0);
        }
      }
      // Recurse
      if (typeof data[key] === "object" && data[key] !== null) {
        const found = extractTotal(data[key], keywords);
        if (found !== 0) return found;
      }
    }
  }

  return 0;
}

// --- Budget shaping ---

export interface BudgetListSummary {
  totalBudgets: number;
  byCadence: Record<string, number>;
  budgets: any[];
}

export function shapeBudgets(budgets: any[]): BudgetListSummary {
  const byCadence: Record<string, number> = {};

  const shaped = budgets.map((b: any) => {
    const cadence = b.cadence || "unspecified";
    byCadence[cadence] = (byCadence[cadence] || 0) + 1;

    return {
      id: b.id,
      name: b.name,
      description: b.description || null,
      entityId: b.entity ?? null,
      entityName: b.entity_name || null,
      departmentId: b.department ?? null,
      departmentName: b.department_name || null,
      cadence,
      startDate: b.start_date,
      endDate: b.end_date || null,
      periods: b.periods ?? null,
      breakdownType: b.breakdown_type || null,
      currency: b.currency || null,
      tags: Array.isArray(b.tags) ? b.tags.map((t: any) => t.name || t) : [],
    };
  });

  return {
    totalBudgets: budgets.length,
    byCadence,
    budgets: shaped,
  };
}

export interface BudgetDetailSummary {
  id: number;
  name: string;
  description: string | null;
  entityId: number | null;
  entityName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  cadence: string;
  startDate: string;
  endDate: string | null;
  periods: number | null;
  breakdownType: string | null;
  currency: string | null;
  totalBudgeted: number;
  allocationCount: number;
  byAccountType: Record<string, { count: number; total: number }>;
  byDepartment: Record<string, { count: number; total: number }>;
  allocations: any[];
}

export function shapeBudgetDetail(budget: any, allocations: any[]): BudgetDetailSummary {
  let totalBudgeted = 0;
  const byAccountType: Record<string, { count: number; total: number }> = {};
  const byDepartment: Record<string, { count: number; total: number }> = {};

  const shaped = allocations.map((a: any) => {
    const amount = Number(a.amount ?? 0);
    totalBudgeted += amount;

    // Group by top-level account type from lineage (e.g. "Assets > Current Assets > Cash")
    const lineage = a.account_lineage || "";
    const accountType = lineage.split(">")[0]?.trim() || a.account_name || "Unknown";
    if (!byAccountType[accountType]) byAccountType[accountType] = { count: 0, total: 0 };
    byAccountType[accountType].count++;
    byAccountType[accountType].total += amount;

    const dept = a.department_name || "Unassigned";
    if (!byDepartment[dept]) byDepartment[dept] = { count: 0, total: 0 };
    byDepartment[dept].count++;
    byDepartment[dept].total += amount;

    return {
      id: a.id,
      accountId: a.account,
      accountName: a.account_name,
      accountLineage: lineage,
      departmentId: a.department ?? null,
      departmentName: a.department_name || null,
      period: a.period ?? null,
      amount,
    };
  });

  // Round group totals
  for (const g of Object.values(byAccountType)) g.total = round(g.total);
  for (const g of Object.values(byDepartment)) g.total = round(g.total);

  return {
    id: budget.id,
    name: budget.name,
    description: budget.description || null,
    entityId: budget.entity ?? null,
    entityName: budget.entity_name || null,
    departmentId: budget.department ?? null,
    departmentName: budget.department_name || null,
    cadence: budget.cadence || "unspecified",
    startDate: budget.start_date,
    endDate: budget.end_date || null,
    periods: budget.periods ?? null,
    breakdownType: budget.breakdown_type || null,
    currency: budget.currency || null,
    totalBudgeted: round(totalBudgeted),
    allocationCount: allocations.length,
    byAccountType,
    byDepartment,
    allocations: shaped,
  };
}

// --- Utility ---

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
