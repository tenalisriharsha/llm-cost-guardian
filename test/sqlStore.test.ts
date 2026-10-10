import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlEventStore } from "../src/core/sqlStore.js";
import type { UsageEvent } from "../src/core/types.js";

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: "evt-1",
    timestamp: "2026-10-09T12:00:00.000Z",
    apiKeyId: "key-1",
    team: "platform",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    ...overrides,
  };
}

describe("SqlEventStore", () => {
  it("round-trips events through an in-memory database", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqlEventStore(db);
    store.append(makeEvent({ id: "evt-1" }));
    store.appendMany([makeEvent({ id: "evt-2" }), makeEvent({ id: "evt-3" })]);

    expect(store.all().map((e) => e.id)).toEqual(["evt-1", "evt-2", "evt-3"]);
    expect(store.all()[0]).toEqual(makeEvent({ id: "evt-1" }));
  });

  it("preserves insertion order", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqlEventStore(db);
    store.append(makeEvent({ id: "c", timestamp: "2026-10-09T03:00:00.000Z" }));
    store.append(makeEvent({ id: "a", timestamp: "2026-10-09T01:00:00.000Z" }));
    store.append(makeEvent({ id: "b", timestamp: "2026-10-09T02:00:00.000Z" }));

    expect(store.all().map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("dedupes by id via INSERT OR IGNORE, keeping the first write", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqlEventStore(db);
    store.append(makeEvent({ id: "evt-1", costUsd: 0.001 }));
    store.append(makeEvent({ id: "evt-1", costUsd: 999 }));
    store.appendMany([makeEvent({ id: "evt-1", costUsd: 42 }), makeEvent({ id: "evt-2" })]);

    expect(store.all().map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
    expect(store.all()[0]?.costUsd).toBe(0.001);
  });

  it("persists events to a file database across connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-sql-"));
    const dbPath = join(dir, "events.db");
    try {
      const db1 = new DatabaseSync(dbPath);
      new SqlEventStore(db1).append(makeEvent({ id: "evt-1" }));
      db1.close();

      const db2 = new DatabaseSync(dbPath);
      const reopened = new SqlEventStore(db2);
      expect(reopened.all().map((e) => e.id)).toEqual(["evt-1"]);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
