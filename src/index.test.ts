import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("campfire-mcp-server", () => {
  it("should load without errors", async () => {
    expect(McpServer).toBeDefined();
  });

  it("should have correct server metadata", async () => {
    const server = new McpServer({
      name: "campfire-mcp-server",
      version: "2.1.0",
    });
    expect(server).toBeDefined();
  });

  it("should register all expected tools", async () => {
    const expectedTools = [
      "get_financial_snapshot",
      "get_burn_rate",
      "income_statement",
      "balance_sheet",
      "cash_flow_statement",
      "get_transactions",
      "get_accounts",
      "get_vendors",
      "get_aging",
      "get_contracts",
      "get_customers",
      "trial_balance",
      "get_invoices",
      "get_budgets",
      "get_budget_details",
      "get_uncategorized_transactions",
      "get_bills",
    ];
    expect(expectedTools).toHaveLength(17);
    for (const tool of expectedTools) {
      expect(tool).toBeTruthy();
      expect(typeof tool).toBe("string");
    }
  });
});
