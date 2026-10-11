import { describe, expect, it } from "vitest";
import { alertToStatusRole, formatTokens, formatUsd, meterPercent, shortDateLabel } from "./format.js";

describe("formatUsd", () => {
  it("formats whole and fractional dollars with 2 decimals", () => {
    expect(formatUsd(12.3)).toBe("$12.30");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("widens to 4 decimals for sub-cent amounts so tiny spend isn't rounded to zero", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
  });

  it("preserves a negative sign", () => {
    expect(formatUsd(-5)).toBe("-$5.00");
  });

  it("falls back to $0.00 for non-finite input", () => {
    expect(formatUsd(NaN)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("meterPercent", () => {
  it("scales spend against the limit", () => {
    expect(meterPercent(5, 10)).toBe(50);
    expect(meterPercent(10, 10)).toBe(100);
  });

  it("clamps overspend to 100 so the meter never overflows its track", () => {
    expect(meterPercent(25, 10)).toBe(100);
  });

  it("treats a zero limit as fully consumed once there is any spend", () => {
    expect(meterPercent(1, 0)).toBe(100);
    expect(meterPercent(0, 0)).toBe(0);
  });
});

describe("alertToStatusRole", () => {
  it("maps alert levels to status roles", () => {
    expect(alertToStatusRole(null)).toBe("good");
    expect(alertToStatusRole("soft")).toBe("warning");
    expect(alertToStatusRole("hard")).toBe("critical");
  });
});

describe("shortDateLabel", () => {
  it("renders a short month/day label", () => {
    expect(shortDateLabel("2026-10-05T12:00:00.000Z")).toBe("Oct 5");
  });
});
