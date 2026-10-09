import { describe, expect, it } from "vitest";
import { detectAnomalies } from "../src/core/anomaly.js";
import type { UsageEvent } from "../src/core/types.js";

function dayEvent(day: string, costUsd: number, team = "growth"): UsageEvent {
  return {
    id: `${team}-${day}`,
    timestamp: `${day}T12:00:00.000Z`,
    apiKeyId: "key-1",
    team,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputTokens: 100,
    outputTokens: 50,
    costUsd,
  };
}

describe("detectAnomalies", () => {
  it("does not score days before the minimum baseline is met", () => {
    const events = [dayEvent("2026-10-01", 1), dayEvent("2026-10-02", 1)];
    expect(detectAnomalies(events, { minBaselinePoints: 3 })).toEqual([]);
  });

  it("flags a spend spike far beyond a flat baseline", () => {
    const events = [
      dayEvent("2026-10-01", 1),
      dayEvent("2026-10-02", 1),
      dayEvent("2026-10-03", 1),
      dayEvent("2026-10-04", 1),
      dayEvent("2026-10-05", 10),
    ];
    const results = detectAnomalies(events, { minBaselinePoints: 3 });
    expect(results).toHaveLength(2); // day 4 and day 5

    const [day4, day5] = results;
    expect(day4?.isAnomalous).toBe(false);
    expect(day5?.spendUsd).toBe(10);
    expect(day5?.zScore).toBe(Number.POSITIVE_INFINITY);
    expect(day5?.isAnomalous).toBe(true);
  });

  it("does not flag normal variance within the threshold", () => {
    const events = [
      dayEvent("2026-10-01", 10),
      dayEvent("2026-10-02", 12),
      dayEvent("2026-10-03", 9),
      dayEvent("2026-10-04", 11),
    ];
    const results = detectAnomalies(events, { minBaselinePoints: 3, zScoreThreshold: 2.5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.isAnomalous).toBe(false);
  });

  it("scores each team independently", () => {
    const events = [
      dayEvent("2026-10-01", 1, "platform"),
      dayEvent("2026-10-02", 1, "platform"),
      dayEvent("2026-10-03", 1, "platform"),
      dayEvent("2026-10-04", 100, "platform"),
      dayEvent("2026-10-01", 5, "growth"),
      dayEvent("2026-10-02", 5, "growth"),
      dayEvent("2026-10-03", 5, "growth"),
      dayEvent("2026-10-04", 5, "growth"),
    ];
    const results = detectAnomalies(events, { minBaselinePoints: 3 });
    const platformResult = results.find((r) => r.team === "platform");
    const growthResult = results.find((r) => r.team === "growth");
    expect(platformResult?.isAnomalous).toBe(true);
    expect(growthResult?.isAnomalous).toBe(false);
  });

  it("respects a custom zScoreThreshold", () => {
    const events = [
      dayEvent("2026-10-01", 10),
      dayEvent("2026-10-02", 12),
      dayEvent("2026-10-03", 8),
      dayEvent("2026-10-04", 15),
    ];
    const lenient = detectAnomalies(events, { minBaselinePoints: 3, zScoreThreshold: 100 });
    const strict = detectAnomalies(events, { minBaselinePoints: 3, zScoreThreshold: 0.01 });
    expect(lenient[0]?.isAnomalous).toBe(false);
    expect(strict[0]?.isAnomalous).toBe(true);
  });
});
