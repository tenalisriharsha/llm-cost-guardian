import type { AttributionRow, UsageEvent } from "./types.js";

export type AttributionDimension = "team" | "apiKeyId" | "model" | "provider";

/** Aggregates spend, tokens, and event count by the given dimension, sorted by spend descending. */
export function attributeBy(events: UsageEvent[], dimension: AttributionDimension): AttributionRow[] {
  const rows = new Map<string, AttributionRow>();

  for (const event of events) {
    const key = event[dimension];
    const row = rows.get(key) ?? { key, spendUsd: 0, inputTokens: 0, outputTokens: 0, eventCount: 0 };
    row.spendUsd += event.costUsd;
    row.inputTokens += event.inputTokens;
    row.outputTokens += event.outputTokens;
    row.eventCount += 1;
    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => b.spendUsd - a.spendUsd);
}

export function totalSpendUsd(events: UsageEvent[]): number {
  return events.reduce((sum, event) => sum + event.costUsd, 0);
}
