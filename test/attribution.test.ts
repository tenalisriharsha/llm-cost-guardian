import { describe, expect, it } from "vitest";
import { attributeBy, totalSpendUsd } from "../src/core/attribution.js";
import type { UsageEvent } from "../src/core/types.js";

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

describe("attributeBy", () => {
  it("aggregates spend, tokens, and counts per key", () => {
    const events = [
      makeEvent({ team: "platform", costUsd: 1, inputTokens: 100, outputTokens: 10 }),
      makeEvent({ team: "platform", costUsd: 2, inputTokens: 200, outputTokens: 20 }),
      makeEvent({ team: "growth", costUsd: 5, inputTokens: 50, outputTokens: 5 }),
    ];

    const rows = attributeBy(events, "team");
    expect(rows).toEqual([
      { key: "growth", spendUsd: 5, inputTokens: 50, outputTokens: 5, eventCount: 1 },
      { key: "platform", spendUsd: 3, inputTokens: 300, outputTokens: 30, eventCount: 2 },
    ]);
  });

  it("sorts rows by spend descending", () => {
    const events = [makeEvent({ team: "a", costUsd: 1 }), makeEvent({ team: "b", costUsd: 10 })];
    expect(attributeBy(events, "team").map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("returns an empty array for no events", () => {
    expect(attributeBy([], "team")).toEqual([]);
  });
});

describe("totalSpendUsd", () => {
  it("sums cost across events", () => {
    const events = [makeEvent({ costUsd: 1.5 }), makeEvent({ costUsd: 2.25 })];
    expect(totalSpendUsd(events)).toBeCloseTo(3.75, 6);
  });

  it("returns 0 for no events", () => {
    expect(totalSpendUsd([])).toBe(0);
  });
});
