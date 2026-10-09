export interface RawUsageEvent {
  id?: string;
  timestamp: string;
  apiKeyId: string;
  team: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface UsageEvent {
  id: string;
  timestamp: string;
  apiKeyId: string;
  team: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type BudgetPeriod = "daily" | "monthly";

export interface BudgetConfig {
  team: string;
  period: BudgetPeriod;
  softLimitUsd: number;
  hardLimitUsd: number;
}

export type AlertLevel = "soft" | "hard";

export interface BudgetAlert {
  team: string;
  period: BudgetPeriod;
  level: AlertLevel;
  spendUsd: number;
  limitUsd: number;
  periodStart: string;
}

export interface BudgetStatus {
  team: string;
  period: BudgetPeriod;
  spendUsd: number;
  softLimitUsd: number;
  hardLimitUsd: number;
  periodStart: string;
  alert: AlertLevel | null;
}

export interface AnomalyResult {
  team: string;
  bucketStart: string;
  spendUsd: number;
  baselineMeanUsd: number;
  baselineStdDevUsd: number;
  zScore: number;
  isAnomalous: boolean;
}

export interface AttributionRow {
  key: string;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
}
