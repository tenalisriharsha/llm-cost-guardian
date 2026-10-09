import { dayBucket } from "./time.js";
import type { AnomalyResult, UsageEvent } from "./types.js";

export interface AnomalyDetectionOptions {
  /** Minimum number of prior days required before a day can be scored. */
  minBaselinePoints?: number;
  /** Z-score at or above which a day is flagged as anomalous. */
  zScoreThreshold?: number;
}

const DEFAULT_OPTIONS: Required<AnomalyDetectionOptions> = {
  minBaselinePoints: 3,
  zScoreThreshold: 2.5,
};

/**
 * Buckets each team's spend by day and flags days whose spend is a statistical outlier
 * relative to that team's own prior days (expanding-window mean/stddev).
 */
export function detectAnomalies(events: UsageEvent[], options: AnomalyDetectionOptions = {}): AnomalyResult[] {
  const { minBaselinePoints, zScoreThreshold } = { ...DEFAULT_OPTIONS, ...options };

  const byTeam = groupByTeamAndDay(events);
  const results: AnomalyResult[] = [];

  for (const [team, dailySpend] of byTeam) {
    const buckets = [...dailySpend.entries()]
      .map(([bucketStart, spendUsd]) => ({ bucketStart, spendUsd }))
      .sort((a, b) => Date.parse(a.bucketStart) - Date.parse(b.bucketStart));

    for (let i = minBaselinePoints; i < buckets.length; i++) {
      const current = buckets[i]!;
      const baseline = buckets.slice(0, i).map((b) => b.spendUsd);
      const { mean, stdDev } = meanAndStdDev(baseline);

      const zScore = stdDev === 0 ? (current.spendUsd > mean ? Number.POSITIVE_INFINITY : 0) : (current.spendUsd - mean) / stdDev;

      results.push({
        team,
        bucketStart: current.bucketStart,
        spendUsd: current.spendUsd,
        baselineMeanUsd: mean,
        baselineStdDevUsd: stdDev,
        zScore,
        isAnomalous: zScore >= zScoreThreshold,
      });
    }
  }

  return results.sort((a, b) => Date.parse(a.bucketStart) - Date.parse(b.bucketStart));
}

function groupByTeamAndDay(events: UsageEvent[]): Map<string, Map<string, number>> {
  const byTeam = new Map<string, Map<string, number>>();

  for (const event of events) {
    const dailySpend = byTeam.get(event.team) ?? new Map<string, number>();
    const bucket = dayBucket(event.timestamp);
    dailySpend.set(bucket, (dailySpend.get(bucket) ?? 0) + event.costUsd);
    byTeam.set(event.team, dailySpend);
  }

  return byTeam;
}

function meanAndStdDev(values: number[]): { mean: number; stdDev: number } {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}
