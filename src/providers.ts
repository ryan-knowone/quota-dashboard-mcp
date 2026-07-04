/**
 * Provider adapters for quota-dashboard-mcp.
 *
 * Each adapter normalizes a provider-specific quota response into a common
 * shape. Tokens are read from environment variables at call time and are never
 * persisted to disk or sent anywhere except the provider's own API.
 */

import https from "https";

export interface ProviderQuota {
  ok: true;
  provider: string;
  used: number; // 0-100 percentage
  remaining: number; // 0-100 percentage
  resetTime: string; // ISO 8601
  window: string;
  raw: unknown;
}

export interface ProviderError {
  ok: false;
  provider: string;
  error: string;
  category: "auth" | "network" | "provider" | "config" | "unknown";
  raw?: unknown;
}

export type ProviderResult = ProviderQuota | ProviderError;

export type ProviderKey = "claude" | "kimi" | "zai";

interface ProviderDefinition {
  key: ProviderKey;
  name: string;
  apiUrl: string;
  envToken: string | undefined;
  beta?: string;
}

export const PROVIDERS: Record<ProviderKey, ProviderDefinition> = {
  claude: {
    key: "claude",
    name: "Claude Code Max",
    apiUrl: "https://api.anthropic.com/api/oauth/usage",
    envToken: process.env.CLAUDE_TOKEN,
    beta: "oauth-2025-04-20",
  },
  kimi: {
    key: "kimi",
    name: "Kimi",
    apiUrl: "https://api.kimi.com/coding/v1/usages",
    envToken: process.env.KIMI_TOKEN,
  },
  zai: {
    key: "zai",
    name: "Z.ai",
    apiUrl: "https://api.z.ai/api/monitor/usage/quota/limit",
    envToken: process.env.ZAI_TOKEN,
  },
};

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function inHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function categorizeError(status: number, raw: string): { friendly: string; category: ProviderError["category"] } {
  const text = `${status} ${raw || ""}`;
  if (/\b401\b|403|Unauthorized|Forbidden|Invalid Authentication/i.test(text)) {
    return {
      friendly: "Invalid token. Double-check you are using the right key type (see README).",
      category: "auth",
    };
  }
  if (/\b(404|500|502|503)\b/i.test(text)) {
    return { friendly: "Provider API error. The endpoint may be down or changed.", category: "provider" };
  }
  return { friendly: `Provider returned HTTP ${status}.`, category: "provider" };
}

export async function fetchJson(apiUrl: string, headers: Record<string, string>): Promise<{ status: number; data: unknown; raw: string }> {
  const parsed = new URL(apiUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: "GET",
    headers,
    timeout: 20000,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let data: unknown;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = { __raw: raw };
        }
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => reject(new Error("Request timed out")));
    req.end();
  });
}

export function adaptClaude(provider: ProviderDefinition, data: unknown): ProviderQuota {
  const d = data as { five_hour?: number; seven_day?: number };
  const fiveHour = Number(d.five_hour);
  const sevenDay = Number(d.seven_day);
  const hasFive = !isNaN(fiveHour);
  const hasSeven = !isNaN(sevenDay);

  let used: number;
  let window: string;
  if (hasFive && hasSeven) {
    used = Math.max(fiveHour, sevenDay);
    window = used === fiveHour ? "5-hour" : "7-day";
  } else if (hasSeven) {
    used = sevenDay;
    window = "7-day";
  } else if (hasFive) {
    used = fiveHour;
    window = "5-hour";
  } else {
    throw new Error("Unexpected response shape from Claude.");
  }

  return {
    ok: true,
    provider: provider.name,
    used,
    remaining: 100 - used,
    resetTime: tomorrowAt(0).toISOString(),
    window,
    raw: data,
  };
}

export function adaptKimi(provider: ProviderDefinition, data: unknown): ProviderQuota {
  const d = data as {
    usage?: { limit?: string | number; used?: string | number; resetTime?: string };
    limits?: Array<{
      detail?: { limit?: string | number; used?: string | number; resetTime?: string };
      window?: { timeUnit?: string; duration?: number | string };
    }>;
  };

  const windows: Array<{ label: string; used: number; limit: number; resetTime?: string }> = [];
  const weekly = d.usage || {};
  if (weekly.limit != null && weekly.used != null) {
    windows.push({
      label: "Weekly shared pool",
      used: Number(weekly.used),
      limit: Number(weekly.limit),
      resetTime: weekly.resetTime,
    });
  }

  for (const l of d.limits || []) {
    const detail = l.detail || {};
    if (detail.limit != null && detail.used != null) {
      const unit = (l.window?.timeUnit || "").replace("TIME_UNIT_", "").toLowerCase();
      const duration = l.window?.duration || "?";
      windows.push({
        label: `${duration}-${unit} rolling`,
        used: Number(detail.used),
        limit: Number(detail.limit),
        resetTime: detail.resetTime,
      });
    }
  }

  if (!windows.length) {
    throw new Error("Unexpected response shape from Kimi.");
  }

  const top = windows.reduce((a, b) => (b.used / b.limit > a.used / a.limit ? b : a));
  const used = Math.round((top.used / top.limit) * 100);

  return {
    ok: true,
    provider: provider.name,
    used,
    remaining: 100 - used,
    resetTime: top.resetTime ? new Date(top.resetTime).toISOString() : tomorrowAt(9).toISOString(),
    window: top.label,
    raw: data,
  };
}

export function adaptZai(provider: ProviderDefinition, data: unknown): ProviderQuota {
  const d = data as { data?: { limits?: Array<{ percentage?: string | number; nextResetTime?: string; window?: string }> } };
  const limits = d.data?.limits || [];
  if (!limits.length) {
    throw new Error("Unexpected response shape from Z.ai.");
  }

  const top = limits.reduce((a, b) => (Number(b.percentage) > Number(a.percentage) ? b : a));
  const used = Number(top.percentage) || 0;

  return {
    ok: true,
    provider: provider.name,
    used,
    remaining: 100 - used,
    resetTime: top.nextResetTime ? new Date(top.nextResetTime).toISOString() : inHours(24).toISOString(),
    window: top.window || "Window",
    raw: data,
  };
}

export async function fetchProvider(providerKey: ProviderKey, token?: string): Promise<ProviderResult> {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    return {
      ok: false,
      provider: providerKey,
      error: "Unknown provider.",
      category: "config",
    };
  }

  const effectiveToken = token || provider.envToken;
  if (!effectiveToken) {
    return {
      ok: false,
      provider: provider.name,
      error: `No token configured. Set ${providerKey.toUpperCase()}_TOKEN or pass token in the request.`,
      category: "config",
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${effectiveToken}`,
    Accept: "application/json",
  };
  if (provider.beta) {
    headers["anthropic-beta"] = provider.beta;
  }

  let response;
  try {
    response = await fetchJson(provider.apiUrl, headers);
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      error: `Network error reaching provider API: ${err instanceof Error ? err.message : String(err)}`,
      category: "network",
    };
  }

  if (response.status < 200 || response.status >= 300) {
    const { friendly, category } = categorizeError(response.status, response.raw);
    return {
      ok: false,
      provider: provider.name,
      error: friendly,
      category,
      raw: response.data,
    };
  }

  try {
    const adapted =
      providerKey === "claude"
        ? adaptClaude(provider, response.data)
        : providerKey === "kimi"
        ? adaptKimi(provider, response.data)
        : adaptZai(provider, response.data);
    return adapted;
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      error: err instanceof Error ? err.message : String(err),
      category: "provider",
      raw: response.data,
    };
  }
}

export async function fetchAllProviders(): Promise<ProviderResult[]> {
  const keys = Object.keys(PROVIDERS) as ProviderKey[];
  return Promise.all(keys.map((key) => fetchProvider(key)));
}

export function mockProvider(providerKey: ProviderKey): ProviderQuota {
  const provider = PROVIDERS[providerKey];
  const base = {
    claude: { used: 62, remaining: 38, window: "7-day" },
    kimi: { used: 46, remaining: 54, window: "Weekly shared pool" },
    zai: { used: 78, remaining: 22, window: "Daily" },
  }[providerKey];

  return {
    ok: true,
    provider: provider.name,
    used: base.used,
    remaining: base.remaining,
    resetTime: tomorrowAt(providerKey === "kimi" ? 9 : 0).toISOString(),
    window: base.window,
    raw: { __mock: true },
  };
}
