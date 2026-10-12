import { describe, expect, it } from "vitest";
import { anomalyAlerts, budgetAlerts } from "../src/core/alerts.js";
import type { AnomalyResult, BudgetStatus } from "../src/core/types.js";

function makeStatus(overrides: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    team: "platform",
    period: "daily",
    spendUsd: 1,
    softLimitUsd: 5,
    hardLimitUsd: 10,
    periodStart: "2026-10-09T00:00:00.000Z",
    alert: null,
    ...overrides,
  };
}

function makeAnomaly(overrides: Partial<AnomalyResult> = {}): AnomalyResult {
  return {
    team: "growth",
    bucketStart: "2026-10-09T00:00:00.000Z",
    spendUsd: 50,
    baselineMeanUsd: 5,
    baselineStdDevUsd: 1,
    zScore: 10,
    isAnomalous: false,
    ...overrides,
  };
}

describe("budgetAlerts", () => {
  it("drops statuses with no alert", () => {
    expect(budgetAlerts([makeStatus({ alert: null })])).toEqual([]);
  });

  it("maps a soft alert to a warning alert event", () => {
    const [alert] = budgetAlerts([makeStatus({ alert: "soft", spendUsd: 6 })]);
    expect(alert?.severity).toBe("warning");
    expect(alert?.kind).toBe("budget");
    expect(alert?.team).toBe("platform");
    expect(alert?.summary).toContain("soft limit");
  });

  it("maps a hard alert to a critical alert event", () => {
    const [alert] = budgetAlerts([makeStatus({ alert: "hard", spendUsd: 12 })]);
    expect(alert?.severity).toBe("critical");
    expect(alert?.summary).toContain("hard limit");
  });
});

describe("anomalyAlerts", () => {
  it("drops non-anomalous results", () => {
    expect(anomalyAlerts([makeAnomaly({ isAnomalous: false })])).toEqual([]);
  });

  it("maps a flagged anomaly to a critical alert event", () => {
    const [alert] = anomalyAlerts([makeAnomaly({ isAnomalous: true })]);
    expect(alert?.severity).toBe("critical");
    expect(alert?.kind).toBe("anomaly");
    expect(alert?.team).toBe("growth");
    expect(alert?.summary).toContain("growth");
  });

  it("renders an infinite z-score without crashing the summary", () => {
    const [alert] = anomalyAlerts([makeAnomaly({ isAnomalous: true, zScore: Number.POSITIVE_INFINITY })]);
    expect(alert?.summary).toContain("far above");
  });
});
