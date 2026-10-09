import { describe, expect, it } from "vitest";
import { calculateCostUsd, UnknownModelPricingError } from "../src/core/pricing.js";

describe("calculateCostUsd", () => {
  it("computes cost from input and output token rates", () => {
    const cost = calculateCostUsd("claude-sonnet-5-5", 1000, 1000);
    expect(cost).toBeCloseTo(0.003 + 0.015, 6);
  });

  it("returns 0 for a zero-token event", () => {
    expect(calculateCostUsd("gpt-4o-mini", 0, 0)).toBe(0);
  });

  it("throws UnknownModelPricingError for an unpriced model", () => {
    expect(() => calculateCostUsd("some-future-model", 100, 100)).toThrow(UnknownModelPricingError);
  });
});
