import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventStore, JsonFileEventStore } from "../src/core/store.js";
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

describe("InMemoryEventStore", () => {
  it("returns a defensive copy from all()", () => {
    const store = new InMemoryEventStore();
    store.append(makeEvent());
    const snapshot = store.all();
    snapshot.push(makeEvent({ id: "evt-2" }));
    expect(store.all()).toHaveLength(1);
  });

  it("supports appendMany", () => {
    const store = new InMemoryEventStore();
    store.appendMany([makeEvent({ id: "a" }), makeEvent({ id: "b" })]);
    expect(store.all().map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("JsonFileEventStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists events across instances", () => {
    const filePath = join(dir, "nested", "events.jsonl");
    const store = new JsonFileEventStore(filePath);
    store.append(makeEvent({ id: "evt-1" }));
    store.append(makeEvent({ id: "evt-2" }));

    const reloaded = new JsonFileEventStore(filePath);
    expect(reloaded.all().map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
  });

  it("starts empty when the file does not exist yet", () => {
    const store = new JsonFileEventStore(join(dir, "missing.jsonl"));
    expect(store.all()).toEqual([]);
  });
});
