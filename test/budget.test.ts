import { describe, expect, it } from "vitest";
import { evaluateBudgets } from "../src/core/budget.js";
import type { BudgetConfig, UsageEvent } from "../src/core/types.js";

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: "evt",
    timestamp: "2026-10-09T12:00:00.000Z",
    apiKeyId: "key-1",
    team: "platform",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 1,
    ...overrides,
  };
}

const NOW = new Date("2026-10-09T18:00:00.000Z");

describe("evaluateBudgets", () => {
  it("reports no alert when spend is under the soft limit", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 1 })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.alert).toBeNull();
    expect(status?.spendUsd).toBe(1);
  });

  it("reports a soft alert at or above the soft limit but below the hard limit", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 3 }), makeEvent({ costUsd: 2.5 })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.alert).toBe("soft");
  });

  it("reports a hard alert at or above the hard limit", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 12 })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.alert).toBe("hard");
  });

  it("excludes events from before the current period", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 100, timestamp: "2026-10-08T23:59:00.000Z" })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.spendUsd).toBe(0);
    expect(status?.alert).toBeNull();
  });

  it("scopes spend to the matching team only", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 100, team: "growth" })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.spendUsd).toBe(0);
  });

  it("evaluates monthly periods across the whole month", () => {
    const configs: BudgetConfig[] = [{ team: "platform", period: "monthly", softLimitUsd: 5, hardLimitUsd: 10 }];
    const events = [makeEvent({ costUsd: 3, timestamp: "2026-10-01T00:00:00.000Z" }), makeEvent({ costUsd: 3, timestamp: "2026-10-09T00:00:00.000Z" })];
    const [status] = evaluateBudgets(events, configs, NOW);
    expect(status?.spendUsd).toBe(6);
    expect(status?.alert).toBe("soft");
  });
});
