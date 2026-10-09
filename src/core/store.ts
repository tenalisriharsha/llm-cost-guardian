import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageEvent } from "./types.js";

/** Storage abstraction for usage events. Phase 1 ships in-memory and JSON-file backends; a SQL/Postgres backend is planned for Phase 2. */
export interface EventStore {
  append(event: UsageEvent): void;
  appendMany(events: UsageEvent[]): void;
  all(): UsageEvent[];
}

export class InMemoryEventStore implements EventStore {
  private events: UsageEvent[] = [];

  append(event: UsageEvent): void {
    this.events.push(event);
  }

  appendMany(events: UsageEvent[]): void {
    this.events.push(...events);
  }

  all(): UsageEvent[] {
    return [...this.events];
  }
}

/** Persists events as newline-delimited JSON on disk, loading any existing file on construction. */
export class JsonFileEventStore implements EventStore {
  private events: UsageEvent[];

  constructor(private readonly filePath: string) {
    this.events = existsSync(filePath) ? loadEvents(filePath) : [];
  }

  append(event: UsageEvent): void {
    this.events.push(event);
    this.flush();
  }

  appendMany(events: UsageEvent[]): void {
    this.events.push(...events);
    this.flush();
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
