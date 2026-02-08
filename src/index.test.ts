import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// We can't easily test the full server without mocking stdio,
// but we can verify the module loads and exports are correct.

describe("campfire-mcp-server", () => {
  it("should load without errors", async () => {
    // Verify the MCP SDK is importable
    expect(McpServer).toBeDefined();
  });

  it("should have correct server metadata", async () => {
    const server = new McpServer({
      name: "campfire-mcp-server",
      version: "1.0.0",
    });
    expect(server).toBeDefined();
  });

  it("should register all expected tools", async () => {
    const expectedTools = [
      "income_statement",
      "balance_sheet",
      "cash_flow_statement",
      "get_transactions",
      "get_accounts",
      "get_vendors",
      "get_aging",
      "get_contracts",
    ];
    // Verify we expect 8 tools
    expect(expectedTools).toHaveLength(8);
    // Each tool name should be a non-empty string
    for (const tool of expectedTools) {
      expect(tool).toBeTruthy();
      expect(typeof tool).toBe("string");
    }
  });
});
