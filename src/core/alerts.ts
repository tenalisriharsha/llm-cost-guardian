import type { AnomalyResult, BudgetStatus } from "./types.js";

export type AlertSeverity = "warning" | "critical";

export interface AlertEvent {
  kind: "budget" | "anomaly";
  team: string;
  severity: AlertSeverity;
  summary: string;
}

/** Turns budget statuses carrying a soft/hard alert into warning/critical alert events. Statuses with no alert are dropped. */
export function budgetAlerts(statuses: BudgetStatus[]): AlertEvent[] {
  return statuses
    .filter((status) => status.alert !== null)
    .map((status) => ({
      kind: "budget" as const,
      team: status.team,
      severity: status.alert === "hard" ? ("critical" as const) : ("warning" as const),
      summary:
        status.alert === "hard"
          ? `${status.team} ${status.period} spend $${status.spendUsd.toFixed(2)} breached the hard limit of $${status.hardLimitUsd.toFixed(2)}`
          : `${status.team} ${status.period} spend $${status.spendUsd.toFixed(2)} crossed the soft limit of $${status.softLimitUsd.toFixed(2)}`,
    }));
}

/** Turns flagged anomaly results into critical alert events. Non-anomalous days are dropped. */
export function anomalyAlerts(results: AnomalyResult[]): AlertEvent[] {
  return results
    .filter((result) => result.isAnomalous)
    .map((result) => ({
      kind: "anomaly" as const,
      team: result.team,
      severity: "critical" as const,
      summary: `${result.team} spent $${result.spendUsd.toFixed(2)} on ${result.bucketStart.slice(0, 10)}, ${Number.isFinite(result.zScore) ? `${result.zScore.toFixed(1)}σ` : "far"} above its own baseline of $${result.baselineMeanUsd.toFixed(2)}`,
    }));
}
