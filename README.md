# quota-dashboard-mcp

A local-run, privacy-first MCP server that exposes real-time AI subscription quota for **Claude Code Max**, **Kimi**, and **Z.ai**. It uses stdio transport, so it works with Claude Code, Cursor, VS Code, and any other MCP stdio client.

Tokens stay on your machine: they are read from environment variables at call time, never persisted to disk, and never sent anywhere except the provider's own API.

> Looking for a GUI? See the sibling project [`quota-dashboard`](https://github.com/ryan-knowone/quota-dashboard).

## Tools

| Tool | Description |
|------|-------------|
| `get_quota_summary` | Unified quota summary across all configured providers. |
| `get_provider_quota` | Detailed quota for one provider (`claude`, `kimi`, or `zai`). Supports an optional `mock` flag for testing. |
| `check_quota_health` | Flags providers over a usage threshold (default 80%) or missing/invalid tokens. |

## Install

### Requirements

- Node.js ≥ 18
- A bearer token for each provider you want to query (see **Token setup** below)

### One-line install

The package is installable directly from GitHub today (no npm account required):

```bash
npx -y ryan-knowone/quota-dashboard-mcp
```

Once the package is published to npm, the canonical command will be:

```bash
npx -y quota-dashboard-mcp@latest
```

### Claude Code

Add the server to your Claude Code config (`~/.claude/CONFIG.json` or via `/mcp`):

```json
{
  "mcpServers": {
    "quota-dashboard": {
      "command": "npx",
      "args": ["-y", "ryan-knowone/quota-dashboard-mcp"],
      "env": {
        "CLAUDE_TOKEN": "your_claude_oauth_token",
        "KIMI_TOKEN": "your_kimi_platform_api_key",
        "ZAI_TOKEN": "your_zai_bearer_token"
      }
    }
  }
}
```

### Cursor

Open **Cursor Settings → MCP → Add new MCP server**, then paste:

- **Name:** `quota-dashboard`
- **Type:** `command`
- **Command:**

```bash
env CLAUDE_TOKEN=your_claude_oauth_token KIMI_TOKEN=your_kimi_platform_api_key ZAI_TOKEN=your_zai_bearer_token npx -y ryan-knowone/quota-dashboard-mcp
```

### VS Code

Add to your VS Code `settings.json` (requires the [Claude AI extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-ai) or any MCP-compatible extension):

```json
{
  "mcp": {
    "servers": {
      "quota-dashboard": {
        "command": "npx",
        "args": ["-y", "ryan-knowone/quota-dashboard-mcp"],
        "env": {
          "CLAUDE_TOKEN": "your_claude_oauth_token",
          "KIMI_TOKEN": "your_kimi_platform_api_key",
          "ZAI_TOKEN": "your_zai_bearer_token"
        }
      }
    }
  }
}
```

## Token setup

### Claude Code Max

The quota endpoint requires an OAuth token from an authenticated Claude Code browser session. The easiest source is `~/.claude/credentials.json`.

The server currently reads `CLAUDE_TOKEN` from the environment. To extract it:

```bash
# macOS
jq -r '.accessToken' ~/Library/Application\ Support/Claude/credentials.json

# Linux
jq -r '.accessToken' ~/.claude/credentials.json
```

Then set `CLAUDE_TOKEN` to that value.

### Kimi

Use a platform API key from [platform.moonshot.cn](https://platform.moonshot.cn). Set it as `KIMI_TOKEN`.

In practice, the same `sk-kimi-...` key used by Claude Code's Anthropic-compatible proxy also works for the Kimi usage endpoint. If your proxy key returns `Invalid Authentication`, create a dedicated platform API key from `platform.moonshot.cn`.

### Z.ai

Use a Bearer token from your Z.ai account/dashboard. Set it as `ZAI_TOKEN`.

## Local development

```bash
git clone https://github.com/ryan-knowone/quota-dashboard-mcp.git
cd quota-dashboard-mcp
npm install

# Run directly with tsx
CLAUDE_TOKEN=... KIMI_TOKEN=... ZAI_TOKEN=... npm run dev

# Or build and run
npm run build
CLAUDE_TOKEN=... KIMI_TOKEN=... ZAI_TOKEN=... npm start
```

## Testing a tool call

With the server running over stdio, send a JSON-RPC `tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_provider_quota",
    "arguments": { "provider": "kimi", "mock": true }
  }
}
```

## Privacy

- Tokens are read from environment variables at call time.
- Tokens are **never written to disk** (other than the env vars you already manage).
- Tokens and usage data are **never sent to telemetry** or any third party except the provider's own API.

## Support

This is an independent open-source project. If it saves you from an unexpected quota outage, you can tip ETH/USDC on Base:

`0x1e2D7F8715E8180816c0236A5c4F21596C5b9c9e`

Issues and PRs are welcome — provider endpoints change often and community maintenance keeps the tool accurate.

## License

MIT
