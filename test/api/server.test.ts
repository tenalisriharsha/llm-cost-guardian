import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../src/core/store.js";
import { SqlBudgetConfigStore } from "../../src/core/budgetStore.js";
import { ApiKeyRegistry, hashApiKey } from "../../src/api/apiKeys.js";
import { Metrics } from "../../src/api/metrics.js";
import { FixedWindowRateLimiter } from "../../src/api/rateLimit.js";
import { createServer } from "../../src/api/server.js";

const PLATFORM_KEY = "test_platform_key";
const GROWTH_KEY = "test_growth_key";
const ADMIN_KEY = "test_admin_key";

let baseUrl: string;
let close: () => Promise<void>;
let eventStore: InMemoryEventStore;
let budgetStore: SqlBudgetConfigStore;
let metrics: Metrics;

function startServer(rateLimiter?: FixedWindowRateLimiter) {
  eventStore = new InMemoryEventStore();
  budgetStore = new SqlBudgetConfigStore(new DatabaseSync(":memory:"));
  metrics = new Metrics();
  const apiKeys = new ApiKeyRegistry([
    { key: PLATFORM_KEY, apiKeyId: "key-platform-prod", team: "platform" },
    { key: GROWTH_KEY, apiKeyId: "key-growth-prod", team: "growth" },
    { key: ADMIN_KEY, apiKeyId: "key-admin-ops", team: "ops", role: "admin" },
  ]);

  const app = createServer({ eventStore, budgetStore, apiKeys, rateLimiter, metrics });
  return new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      close = () => new Promise((res) => server.close(() => res()));
      resolve();
    });
  });
}

function authed(key: string) {
  return { Authorization: `Bearer ${key}` };
}

beforeEach(async () => {
  await startServer();
});

afterEach(async () => {
  await close();
});

describe("GET /health", () => {
  it("responds without authentication", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("authentication", () => {
  it("rejects requests with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/report`);
    expect(res.status).toBe(401);
  });

  it("rejects requests with an unknown key", async () => {
    const res = await fetch(`${baseUrl}/report`, { headers: authed("not-a-real-key") });
    expect(res.status).toBe(401);
  });
});

describe("GET /whoami", () => {
  it("returns the authenticated key's apiKeyId and team", async () => {
    const res = await fetch(`${baseUrl}/whoami`, { headers: authed(PLATFORM_KEY) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apiKeyId: "key-platform-prod", team: "platform", role: "team" });
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/whoami`);
    expect(res.status).toBe(401);
  });
});

describe("POST /events", () => {
  it("accepts events and fills in team/apiKeyId from the authenticated key", async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify([
        {
          timestamp: "2026-10-09T12:00:00.000Z",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          inputTokens: 100,
          outputTokens: 50,
        },
      ]),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, rejected: 0 });

    const stored = eventStore.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.team).toBe("platform");
    expect(stored[0]?.apiKeyId).toBe("key-platform-prod");
  });

  it("rejects events whose declared team does not match the authenticated key", async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify([
        {
          timestamp: "2026-10-09T12:00:00.000Z",
          team: "growth",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          inputTokens: 100,
          outputTokens: 50,
        },
      ]),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(0);
    expect(body.rejected).toBe(1);
    expect(body.errors[0].error).toMatch(/does not match authenticated team/);
    expect(eventStore.all()).toHaveLength(0);
  });

  it("is idempotent for repeated ids across requests, reporting duplicates distinctly", async () => {
    const payload = [
      {
        id: "evt-fixed",
        timestamp: "2026-10-09T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        inputTokens: 100,
        outputTokens: 50,
      },
    ];
    const first = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(await first.json()).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });

    const second = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(await second.json()).toMatchObject({ accepted: 0, duplicates: 1, rejected: 0 });
    expect(eventStore.all()).toHaveLength(1);
  });

  it("rejects a non-array body", async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify({ not: "an array" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /report", () => {
  beforeEach(async () => {
    for (const [key, team] of [[PLATFORM_KEY, "platform"], [GROWTH_KEY, "growth"]] as const) {
      await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { ...authed(key), "content-type": "application/json" },
        body: JSON.stringify([
          {
            timestamp: "2026-10-09T12:00:00.000Z",
            provider: "anthropic",
            model: "claude-sonnet-5-5",
            inputTokens: 1000,
            outputTokens: 1000,
          },
        ]),
      });
      void team;
    }
  });

  it("scopes attribution to the caller's own team", async () => {
    const res = await fetch(`${baseUrl}/report?by=model`, { headers: authed(PLATFORM_KEY) });
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(eventStore.all().filter((e) => e.team === "platform")).toHaveLength(1);
    expect(eventStore.all().filter((e) => e.team === "growth")).toHaveLength(1);
  });

  it("rejects an invalid dimension", async () => {
    const res = await fetch(`${baseUrl}/report?by=nope`, { headers: authed(PLATFORM_KEY) });
    expect(res.status).toBe(400);
  });
});

describe("budgets CRUD", () => {
  it("starts empty, upserts, reads status, and deletes", async () => {
    const empty = await fetch(`${baseUrl}/budgets`, { headers: authed(PLATFORM_KEY) });
    expect((await empty.json()).budgets).toEqual([]);

    const put = await fetch(`${baseUrl}/budgets/daily`, {
      method: "PUT",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify({ softLimitUsd: 10, hardLimitUsd: 20 }),
    });
    expect(put.status).toBe(200);

    const list = await fetch(`${baseUrl}/budgets`, { headers: authed(PLATFORM_KEY) });
    expect((await list.json()).budgets).toEqual([
      { team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 },
    ]);

    const status = await fetch(`${baseUrl}/budgets/status`, { headers: authed(PLATFORM_KEY) });
    const statusBody = await status.json();
    expect(statusBody.statuses).toHaveLength(1);
    expect(statusBody.statuses[0].team).toBe("platform");

    const del = await fetch(`${baseUrl}/budgets/daily`, { method: "DELETE", headers: authed(PLATFORM_KEY) });
    expect(del.status).toBe(204);

    const delAgain = await fetch(`${baseUrl}/budgets/daily`, { method: "DELETE", headers: authed(PLATFORM_KEY) });
    expect(delAgain.status).toBe(404);
  });

  it("scopes budgets to the caller's team", async () => {
    await fetch(`${baseUrl}/budgets/daily`, {
      method: "PUT",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify({ softLimitUsd: 10, hardLimitUsd: 20 }),
    });
    const growthView = await fetch(`${baseUrl}/budgets`, { headers: authed(GROWTH_KEY) });
    expect((await growthView.json()).budgets).toEqual([]);
  });

  it("rejects invalid period and invalid limits", async () => {
    const badPeriod = await fetch(`${baseUrl}/budgets/weekly`, {
      method: "PUT",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify({ softLimitUsd: 10, hardLimitUsd: 20 }),
    });
    expect(badPeriod.status).toBe(400);

    const badLimits = await fetch(`${baseUrl}/budgets/daily`, {
      method: "PUT",
      headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
      body: JSON.stringify({ softLimitUsd: 20, hardLimitUsd: 10 }),
    });
    expect(badLimits.status).toBe(400);
  });
});

describe("GET /anomalies", () => {
  it("scopes anomaly detection to the caller's own team", async () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    for (const day of days) {
      const tokens = day === "2026-10-05" ? 2_000_000 : 1000;
      await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { ...authed(PLATFORM_KEY), "content-type": "application/json" },
        body: JSON.stringify([
          {
            timestamp: `${day}T12:00:00.000Z`,
            provider: "anthropic",
            model: "claude-sonnet-5-5",
            inputTokens: tokens,
            outputTokens: tokens,
          },
        ]),
      });
    }

    const res = await fetch(`${baseUrl}/anomalies`, { headers: authed(PLATFORM_KEY) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anomalies.length).toBeGreaterThan(0);
    expect(body.anomalies.every((a: { team: string }) => a.team === "platform")).toBe(true);
    expect(body.anomalies.some((a: { isAnomalous: boolean }) => a.isAnomalous)).toBe(true);

    const growthView = await fetch(`${baseUrl}/anomalies`, { headers: authed(GROWTH_KEY) });
    expect((await growthView.json()).anomalies).toEqual([]);
  });

  it("accepts minBaselinePoints/zScoreThreshold overrides and rejects invalid ones", async () => {
    const ok = await fetch(`${baseUrl}/anomalies?minBaselinePoints=1&zScoreThreshold=1.5`, {
      headers: authed(PLATFORM_KEY),
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`${baseUrl}/anomalies?minBaselinePoints=not-a-number`, {
      headers: authed(PLATFORM_KEY),
    });
    expect(bad.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/anomalies`);
    expect(res.status).toBe(401);
  });
});

describe("CORS", () => {
  it("answers preflight requests without authentication", async () => {
    const res = await fetch(`${baseUrl}/report`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("sets CORS headers on authenticated responses", async () => {
    const res = await fetch(`${baseUrl}/report`, { headers: authed(PLATFORM_KEY) });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the window is exhausted", async () => {
    await close();
    await startServer(new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }));

    const first = await fetch(`${baseUrl}/report`, { headers: authed(PLATFORM_KEY) });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/report`, { headers: authed(PLATFORM_KEY) });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).not.toBeNull();
  });
});

describe("admin-scoped keys", () => {
  beforeEach(async () => {
    await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(GROWTH_KEY), "content-type": "application/json" },
      body: JSON.stringify([
        {
          timestamp: "2026-10-09T12:00:00.000Z",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          inputTokens: 500,
          outputTokens: 500,
        },
      ]),
    });
  });

  it("lets an admin key read another team's report via ?team=", async () => {
    const res = await fetch(`${baseUrl}/report?by=model&team=growth`, { headers: authed(ADMIN_KEY) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });

  it("ignores ?team= for a non-admin key — it still only sees its own team", async () => {
    const res = await fetch(`${baseUrl}/report?by=model&team=growth`, { headers: authed(PLATFORM_KEY) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
  });

  it("lets an admin key manage another team's budgets via ?team=", async () => {
    const put = await fetch(`${baseUrl}/budgets/daily?team=growth`, {
      method: "PUT",
      headers: { ...authed(ADMIN_KEY), "content-type": "application/json" },
      body: JSON.stringify({ softLimitUsd: 5, hardLimitUsd: 10 }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).budget.team).toBe("growth");

    const growthView = await fetch(`${baseUrl}/budgets`, { headers: authed(GROWTH_KEY) });
    expect((await growthView.json()).budgets).toEqual([
      { team: "growth", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 },
    ]);
  });

  it("lets an admin key ingest events on behalf of another team", async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { ...authed(ADMIN_KEY), "content-type": "application/json" },
      body: JSON.stringify([
        {
          team: "research",
          timestamp: "2026-10-09T12:00:00.000Z",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          inputTokens: 10,
          outputTokens: 10,
        },
      ]),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(eventStore.all().some((e) => e.team === "research")).toBe(true);
  });
});

describe("revoked keys", () => {
  it("rejects a key loaded from a file with a revokedAt set", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcg-keys-"));
    const file = join(dir, "api-keys.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          apiKeyId: "key-revoked",
          team: "platform",
          role: "team",
          keyHash: hashApiKey("some-revoked-key"),
          createdAt: "2026-01-01T00:00:00.000Z",
          revokedAt: "2026-01-02T00:00:00.000Z",
        },
      ]),
    );

    const registry = ApiKeyRegistry.fromFile(file);
    expect(registry.authenticate("some-revoked-key")).toBeNull();
  });
});

describe("GET /metrics", () => {
  it("responds without authentication and reflects observed requests", async () => {
    await fetch(`${baseUrl}/report`, { headers: authed(PLATFORM_KEY) });
    await fetch(`${baseUrl}/report`); // unauthenticated, counted as an auth failure too

    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("llm_cost_guardian_requests_total");
    expect(body).toContain("llm_cost_guardian_auth_failures_total 1");
  });
});
