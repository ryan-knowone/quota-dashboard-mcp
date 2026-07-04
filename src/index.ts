/**
 * quota-dashboard-mcp
 *
 * A stdio MCP server that exposes live AI subscription quota data for
 * Claude Code Max, Kimi, and Z.ai. Tokens are read from environment variables
 * at call time and are never persisted to disk or sent anywhere except the
 * provider's own API.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  fetchAllProviders,
  fetchProvider,
  mockProvider,
  ProviderKey,
  PROVIDERS,
  ProviderResult,
} from "./providers.js";

const SERVER_NAME = "quota-dashboard-mcp";
const SERVER_VERSION = "1.0.0";

function isProviderKey(value: unknown): value is ProviderKey {
  return typeof value === "string" && value in PROVIDERS;
}

function resultToMarkdown(result: ProviderResult): string {
  if (result.ok) {
    return `- **${result.provider}**: ${result.used}% used, ${result.remaining}% remaining — resets ${new Date(result.resetTime).toLocaleString()} (${result.window})`;
  }
  return `- **${result.provider}**: ❌ ${result.error} (${result.category})`;
}

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_quota_summary",
        description:
          "Returns a unified quota summary across all configured providers (Claude Code Max, Kimi, Z.ai). Providers without a configured token report a config error rather than failing the whole call.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_provider_quota",
        description:
          "Returns detailed quota information for a single provider. Supported providers: claude, kimi, zai.",
        inputSchema: {
          type: "object",
          properties: {
            provider: {
              type: "string",
              enum: ["claude", "kimi", "zai"],
              description: "Provider key to query",
            },
            token: {
              type: "string",
              description: "Optional bearer token override. If omitted, the provider's environment variable is used.",
            },
            mock: {
              type: "boolean",
              description: "If true, return deterministic mock data instead of calling the provider API.",
            },
          },
          required: ["provider"],
          additionalProperties: false,
        },
      },
      {
        name: "check_quota_health",
        description:
          "Flags providers that are over a usage threshold (default 80%) or have missing/invalid tokens. Returns a health report with actionable warnings.",
        inputSchema: {
          type: "object",
          properties: {
            threshold: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Usage percentage that triggers a warning. Defaults to 80.",
            },
          },
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_quota_summary") {
    const results = await fetchAllProviders();
    const lines = results.map(resultToMarkdown);
    const healthy = results.filter((r) => r.ok && r.used < 80).length;
    const total = results.length;

    return {
      content: [
        {
          type: "text",
          text: [`## Quota Summary (${healthy}/${total} providers healthy)`, "", ...lines, "", "_Tokens are read from environment variables and never persisted._"].join("\n"),
        },
      ],
    };
  }

  if (name === "get_provider_quota") {
    const provider = (args as { provider?: unknown }).provider;
    const token = (args as { token?: unknown }).token;
    const mock = (args as { mock?: unknown }).mock === true;

    if (!isProviderKey(provider)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid provider "${provider}". Supported providers: claude, kimi, zai.`,
          },
        ],
        isError: true,
      };
    }

    const result = mock
      ? mockProvider(provider)
      : await fetchProvider(provider, typeof token === "string" ? token : undefined);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "check_quota_health") {
    const threshold = typeof (args as { threshold?: unknown }).threshold === "number"
      ? (args as { threshold: number }).threshold
      : 80;
    const results = await fetchAllProviders();
    const warnings: string[] = [];

    for (const r of results) {
      if (!r.ok) {
        warnings.push(`- **${r.provider}**: ${r.error}`);
      } else if (r.used >= threshold) {
        warnings.push(`- **${r.provider}**: usage at ${r.used}% (threshold ${threshold}%)`);
      }
    }

    const text = warnings.length
      ? [`## Quota Health Warnings (${warnings.length} issue${warnings.length === 1 ? "" : "s"})`, "", ...warnings].join("\n")
      : `## Quota Health\n\nAll configured providers are under the ${threshold}% usage threshold.`;

    return {
      content: [
        {
          type: "text",
          text,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio transport keeps the process alive via stdin.
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
