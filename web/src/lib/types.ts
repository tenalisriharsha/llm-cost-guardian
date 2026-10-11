export type BudgetPeriod = "daily" | "monthly";
export type AlertLevel = "soft" | "hard";
export type AttributionDimension = "team" | "apiKeyId" | "model" | "provider";

export interface BudgetConfig {
  team: string;
  period: BudgetPeriod;
  softLimitUsd: number;
  hardLimitUsd: number;
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

export interface AttributionRow {
  key: string;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
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

export interface WhoAmI {
  apiKeyId: string;
  team: string;
}
