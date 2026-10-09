import type { BudgetPeriod } from "./types.js";

/** Returns the UTC start-of-day or start-of-month boundary (as an ISO string) containing `timestamp`. */
export function periodStart(timestamp: string, period: BudgetPeriod): string {
  const date = new Date(timestamp);
  if (period === "daily") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

/** Returns the UTC start-of-day boundary (as an ISO string) for a timestamp, used to bucket anomaly detection windows. */
export function dayBucket(timestamp: string): string {
  return periodStart(timestamp, "daily");
}
