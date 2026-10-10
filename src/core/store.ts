import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageEvent } from "./types.js";

/**
 * Storage abstraction for usage events. Implementations must be idempotent: appending an event
 * whose `id` already exists in the store is a silent no-op, so retried/duplicate ingestion
 * requests (e.g. from the HTTP API) never double-count spend.
 */
export interface EventStore {
  /** Returns true if the event was newly stored, false if its id already existed (no-op). */
  append(event: UsageEvent): boolean;
  /** Returns the subset of events actually stored, excluding any ids that already existed. */
  appendMany(events: UsageEvent[]): UsageEvent[];
  all(): UsageEvent[];
}

export class InMemoryEventStore implements EventStore {
  private events: UsageEvent[] = [];
  private ids = new Set<string>();

  append(event: UsageEvent): boolean {
    if (this.ids.has(event.id)) return false;
    this.ids.add(event.id);
    this.events.push(event);
    return true;
  }

  appendMany(events: UsageEvent[]): UsageEvent[] {
    return events.filter((event) => this.append(event));
  }

  all(): UsageEvent[] {
    return [...this.events];
  }
}

/** Persists events as newline-delimited JSON on disk, loading any existing file on construction. */
export class JsonFileEventStore implements EventStore {
  private events: UsageEvent[];
  private ids: Set<string>;

  constructor(private readonly filePath: string) {
    this.events = existsSync(filePath) ? loadEvents(filePath) : [];
    this.ids = new Set(this.events.map((event) => event.id));
  }

  append(event: UsageEvent): boolean {
    if (this.ids.has(event.id)) return false;
    this.ids.add(event.id);
    this.events.push(event);
    this.flush();
    return true;
  }

  appendMany(events: UsageEvent[]): UsageEvent[] {
    const inserted: UsageEvent[] = [];
    for (const event of events) {
      if (this.ids.has(event.id)) continue;
      this.ids.add(event.id);
      this.events.push(event);
      inserted.push(event);
    }
    if (inserted.length > 0) this.flush();
    return inserted;
  }

  all(): UsageEvent[] {
    return [...this.events];
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const body = this.events.map((event) => JSON.stringify(event)).join("\n");
    writeFileSync(this.filePath, body.length > 0 ? `${body}\n` : "", "utf8");
  }
}

function loadEvents(filePath: string): UsageEvent[] {
  const contents = readFileSync(filePath, "utf8").trim();
  if (contents.length === 0) return [];
  return contents.split("\n").map((line) => JSON.parse(line) as UsageEvent);
}
