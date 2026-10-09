import { periodStart } from "./time.js";
import type { AlertLevel, BudgetConfig, BudgetStatus, UsageEvent } from "./types.js";

/** Evaluates each budget config against events falling within its current period, as of `now`. */
export function evaluateBudgets(
  events: UsageEvent[],
  configs: BudgetConfig[],
  now: Date = new Date(),
): BudgetStatus[] {
  return configs.map((config) => evaluateBudget(events, config, now));
}

function evaluateBudget(events: UsageEvent[], config: BudgetConfig, now: Date): BudgetStatus {
  const start = periodStart(now.toISOString(), config.period);
  const startMs = Date.parse(start);

  const spendUsd = events
    .filter((event) => event.team === config.team && Date.parse(event.timestamp) >= startMs)
    .reduce((sum, event) => sum + event.costUsd, 0);

  return {
    team: config.team,
    period: config.period,
    spendUsd,
    softLimitUsd: config.softLimitUsd,
    hardLimitUsd: config.hardLimitUsd,
    periodStart: start,
    alert: alertLevel(spendUsd, config),
  };
}

function alertLevel(spendUsd: number, config: BudgetConfig): AlertLevel | null {
  if (spendUsd >= config.hardLimitUsd) return "hard";
  if (spendUsd >= config.softLimitUsd) return "soft";
  return null;
}
