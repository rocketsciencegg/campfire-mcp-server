# campfire-mcp-server

[![CI](https://github.com/rocketsciencegg/campfire-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/rocketsciencegg/campfire-mcp-server/actions/workflows/ci.yml)
![Coverage](https://raw.githubusercontent.com/rocketsciencegg/campfire-mcp-server/badges/coverage.svg)

MCP server for Campfire — accounting and financial reporting.

## Tools

| Tool | Description |
|------|-------------|
| `get_financial_snapshot` | Key metrics in one call: revenue, expenses, net income, cash, margins, current ratio (current month + YTD) |
| `get_burn_rate` | Monthly burn trend (3-6 months), current cash position, implied runway in months |
| `income_statement` | P&L for a specified period |
| `balance_sheet` | Assets, liabilities, and equity |
| `cash_flow_statement` | Operating, investing, and financing activities |
| `get_transactions` | Transactions with summary: total debits/credits, breakdown by account type |
| `get_accounts` | Chart of accounts with optional filtering by type or search query |
| `get_vendors` | Vendor list with optional filtering by search query and type |
| `get_aging` | AP/AR aging with bucket totals, 90+ day critical items highlighted |
| `get_contracts` | Contracts with recognized vs remaining revenue, contract-level totals |
| `get_customers` | Contract customers with financial summaries: revenue, MRR, billed/unbilled/outstanding, contract counts |
| `get_invoices` | Invoices filtered by status (unpaid, paid, past_due, etc.), date range, client; summary with totals by status |
| `trial_balance` | Trial balance by account type with debit/credit totals and per-account net amounts |

## Installation

No install needed — runs directly via `npx`:

```bash
npx -y github:rocketsciencegg/campfire-mcp-server
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "campfire": {
      "command": "npx",
      "args": ["-y", "github:rocketsciencegg/campfire-mcp-server"],
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
      "command": "npx",
      "args": ["-y", "github:rocketsciencegg/campfire-mcp-server"],
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
