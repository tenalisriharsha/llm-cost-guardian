import { describe, expect, it } from "vitest";
import { EventValidationError, ingestBatch, ingestEvent } from "../src/core/ingestion.js";
import type { RawUsageEvent } from "../src/core/types.js";

function validRaw(overrides: Partial<RawUsageEvent> = {}): RawUsageEvent {
  return {
    timestamp: "2026-10-09T12:00:00.000Z",
    apiKeyId: "key-1",
    team: "platform",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputTokens: 1000,
    outputTokens: 1000,
    ...overrides,
  };
}

describe("ingestEvent", () => {
  it("accepts a valid event and assigns an id", () => {
    const event = ingestEvent(validRaw());
    expect(event.id).toBeTruthy();
    expect(event.costUsd).toBeCloseTo(0.018, 6);
  });

  it("preserves a provided id", () => {
    const event = ingestEvent(validRaw({ id: "fixed-id" }));
    expect(event.id).toBe("fixed-id");
  });

  it("uses a provided costUsd instead of computing one", () => {
    const event = ingestEvent(validRaw({ costUsd: 1.23 }));
    expect(event.costUsd).toBe(1.23);
  });

  it("rejects a missing required field", () => {
    const raw = validRaw();
    // @ts-expect-error intentionally omitting a required field
    delete raw.team;
    expect(() => ingestEvent(raw)).toThrow(EventValidationError);
  });

  it("rejects an invalid timestamp", () => {
    expect(() => ingestEvent(validRaw({ timestamp: "not-a-date" }))).toThrow(EventValidationError);
  });

  it("rejects negative token counts", () => {
    expect(() => ingestEvent(validRaw({ inputTokens: -1 }))).toThrow(EventValidationError);
  });

  it("rejects negative costUsd", () => {
    expect(() => ingestEvent(validRaw({ costUsd: -5 }))).toThrow(EventValidationError);
  });

  it("propagates unknown-model pricing errors when costUsd is omitted", () => {
    expect(() => ingestEvent(validRaw({ model: "unknown-model" }))).toThrow();
  });
});

describe("ingestBatch", () => {
  it("partitions a mixed batch into accepted and rejected", () => {
    const batch = [validRaw(), validRaw({ team: undefined as unknown as string })];
    const { accepted, rejected } = ingestBatch(batch);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toContain("team");
  });
});
