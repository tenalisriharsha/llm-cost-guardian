import { describe, expect, it } from "vitest";
import { dayBucket, periodStart } from "../src/core/time.js";

describe("periodStart", () => {
  it("returns the UTC start of day for 'daily'", () => {
    expect(periodStart("2026-10-09T17:45:00.000Z", "daily")).toBe("2026-10-09T00:00:00.000Z");
  });

  it("returns the UTC start of month for 'monthly'", () => {
    expect(periodStart("2026-10-09T17:45:00.000Z", "monthly")).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("dayBucket", () => {
  it("matches periodStart with 'daily'", () => {
    expect(dayBucket("2026-01-15T23:59:00.000Z")).toBe("2026-01-15T00:00:00.000Z");
  });
});
