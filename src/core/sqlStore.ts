import { DatabaseSync } from "node:sqlite";
import type { EventStore } from "./store.js";
import type { UsageEvent } from "./types.js";

interface EventRow {
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

/**
 * SQLite-backed EventStore using Node's built-in `node:sqlite` driver, so there's no native
 * module to compile. Takes an already-open `DatabaseSync` (`:memory:` for tests, a file path for
 * the API server) so callers can share one connection across stores backed by the same database.
 * Dedup is enforced by the `id` primary key via `INSERT OR IGNORE`.
 */
export class SqlEventStore implements EventStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        apiKeyId TEXT NOT NULL,
        team TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        inputTokens INTEGER NOT NULL,
        outputTokens INTEGER NOT NULL,
        costUsd REAL NOT NULL
      )
    `);
  }

  append(event: UsageEvent): boolean {
    return this.appendMany([event]).length > 0;
  }

  appendMany(events: UsageEvent[]): UsageEvent[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO events
        (id, timestamp, apiKeyId, team, provider, model, inputTokens, outputTokens, costUsd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const inserted: UsageEvent[] = [];
    for (const event of events) {
      const result = insert.run(
        event.id,
        event.timestamp,
        event.apiKeyId,
        event.team,
        event.provider,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.costUsd,
      );
      if (Number(result.changes) > 0) inserted.push(event);
    }
    return inserted;
  }

  all(): UsageEvent[] {
    const rows = this.db.prepare(`SELECT * FROM events ORDER BY rowid ASC`).all() as unknown as EventRow[];
    return rows.map((row) => ({ ...row }));
  }
}
