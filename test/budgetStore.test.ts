import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SqlBudgetConfigStore } from "../src/core/budgetStore.js";

function makeStore(): SqlBudgetConfigStore {
  return new SqlBudgetConfigStore(new DatabaseSync(":memory:"));
}

describe("SqlBudgetConfigStore", () => {
  it("starts empty", () => {
    expect(makeStore().list()).toEqual([]);
  });

  it("upserts and lists budgets", () => {
    const store = makeStore();
    store.upsert({ team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 });
    store.upsert({ team: "growth", period: "monthly", softLimitUsd: 100, hardLimitUsd: 200 });

    expect(store.list()).toEqual([
      { team: "growth", period: "monthly", softLimitUsd: 100, hardLimitUsd: 200 },
      { team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 },
    ]);
  });

  it("filters by team", () => {
    const store = makeStore();
    store.upsert({ team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 });
    store.upsert({ team: "platform", period: "monthly", softLimitUsd: 100, hardLimitUsd: 200 });
    store.upsert({ team: "growth", period: "daily", softLimitUsd: 5, hardLimitUsd: 10 });

    expect(store.listForTeam("platform")).toEqual([
      { team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 },
      { team: "platform", period: "monthly", softLimitUsd: 100, hardLimitUsd: 200 },
    ]);
  });

  it("updates limits in place when upserting the same team/period", () => {
    const store = makeStore();
    store.upsert({ team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 });
    store.upsert({ team: "platform", period: "daily", softLimitUsd: 15, hardLimitUsd: 30 });

    expect(store.listForTeam("platform")).toEqual([
      { team: "platform", period: "daily", softLimitUsd: 15, hardLimitUsd: 30 },
    ]);
  });

  it("removes a budget and reports whether anything was deleted", () => {
    const store = makeStore();
    store.upsert({ team: "platform", period: "daily", softLimitUsd: 10, hardLimitUsd: 20 });

    expect(store.remove("platform", "daily")).toBe(true);
    expect(store.remove("platform", "daily")).toBe(false);
    expect(store.listForTeam("platform")).toEqual([]);
  });
});
