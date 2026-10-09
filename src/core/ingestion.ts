import { randomUUID } from "node:crypto";
import { calculateCostUsd } from "./pricing.js";
import type { RawUsageEvent, UsageEvent } from "./types.js";

export class EventValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "EventValidationError";
  }
}

const REQUIRED_STRING_FIELDS: Array<keyof RawUsageEvent> = [
  "timestamp",
  "apiKeyId",
  "team",
  "provider",
  "model",
];

function assertValidTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new EventValidationError(`timestamp "${value}" is not a valid ISO-8601 date`, "timestamp");
  }
}

/** Validates and normalizes a raw usage event, computing cost from the pricing table when costUsd is omitted. */
export function ingestEvent(raw: RawUsageEvent): UsageEvent {
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EventValidationError(`field "${field}" is required and must be a non-empty string`, field);
    }
  }
  assertValidTimestamp(raw.timestamp);

  if (!Number.isFinite(raw.inputTokens) || raw.inputTokens < 0) {
    throw new EventValidationError("inputTokens must be a non-negative finite number", "inputTokens");
  }
  if (!Number.isFinite(raw.outputTokens) || raw.outputTokens < 0) {
    throw new EventValidationError("outputTokens must be a non-negative finite number", "outputTokens");
  }
  if (raw.costUsd !== undefined && (!Number.isFinite(raw.costUsd) || raw.costUsd < 0)) {
    throw new EventValidationError("costUsd must be a non-negative finite number when provided", "costUsd");
  }

  const costUsd = raw.costUsd ?? calculateCostUsd(raw.model, raw.inputTokens, raw.outputTokens);

  return {
    id: raw.id ?? randomUUID(),
    timestamp: raw.timestamp,
    apiKeyId: raw.apiKeyId,
    team: raw.team,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    costUsd,
  };
}

export interface IngestBatchResult {
  accepted: UsageEvent[];
  rejected: Array<{ raw: RawUsageEvent; error: string }>;
}

export function ingestBatch(rawEvents: RawUsageEvent[]): IngestBatchResult {
  const accepted: UsageEvent[] = [];
  const rejected: Array<{ raw: RawUsageEvent; error: string }> = [];

  for (const raw of rawEvents) {
    try {
      accepted.push(ingestEvent(raw));
    } catch (err) {
      rejected.push({ raw, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { accepted, rejected };
}
