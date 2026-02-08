# campfire-mcp-server

MCP server for Campfire — accounting and financial reporting.

## Tools

| Tool | Description |
|------|-------------|
| `income_statement` | Generate an income statement (P&L) for a specified period |
| `balance_sheet` | Generate a balance sheet showing assets, liabilities, and equity |
| `cash_flow_statement` | Generate a cash flow statement for operating, investing, and financing activities |
| `get_transactions` | Retrieve general ledger transactions with filtering by account, vendor, department, and date |
| `get_accounts` | Retrieve chart of accounts with optional filtering by type or search query |
| `get_vendors` | Retrieve vendors with optional filtering by search query and type |
| `get_aging` | Retrieve AP/AR aging reports grouped by age buckets |
| `get_contracts` | Retrieve revenue recognition contracts with status and revenue schedules |

## Installation

```bash
npm install -g github:rocketsciencegg/campfire-mcp-server
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "campfire": {
      "command": "campfire-mcp-server",
      "env": {
        "CAMPFIRE_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "campfire": {
      "command": "campfire-mcp-server",
      "env": {
        "CAMPFIRE_API_KEY": "${CAMPFIRE_API_KEY}"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CAMPFIRE_API_KEY` | Your Campfire API key |

## Development

```bash
git clone https://github.com/rocketsciencegg/campfire-mcp-server.git
cd campfire-mcp-server
npm install
npm run build
```

## License

MIT
