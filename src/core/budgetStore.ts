import { DatabaseSync } from "node:sqlite";
import type { BudgetConfig, BudgetPeriod } from "./types.js";

/** CRUD storage for budget configs, keyed by (team, period). Backs the Phase 2 budgets API so limits are managed at runtime instead of a static JSON file. */
export interface BudgetConfigStore {
  list(): BudgetConfig[];
  listForTeam(team: string): BudgetConfig[];
  upsert(config: BudgetConfig): void;
  remove(team: string, period: BudgetPeriod): boolean;
}

/** Shares a single `DatabaseSync` connection with `SqlEventStore` when both back the same API server. */
export class SqlBudgetConfigStore implements BudgetConfigStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budgets (
        team TEXT NOT NULL,
        period TEXT NOT NULL,
        softLimitUsd REAL NOT NULL,
        hardLimitUsd REAL NOT NULL,
        PRIMARY KEY (team, period)
      )
    `);
  }

  list(): BudgetConfig[] {
    const rows = this.db.prepare(`SELECT * FROM budgets ORDER BY team ASC, period ASC`).all();
    return rows.map((row) => row as unknown as BudgetConfig);
  }

  listForTeam(team: string): BudgetConfig[] {
    const rows = this.db
      .prepare(`SELECT * FROM budgets WHERE team = ? ORDER BY period ASC`)
      .all(team);
    return rows.map((row) => row as unknown as BudgetConfig);
  }

  upsert(config: BudgetConfig): void {
    this.db
      .prepare(`
        INSERT INTO budgets (team, period, softLimitUsd, hardLimitUsd)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(team, period) DO UPDATE SET
          softLimitUsd = excluded.softLimitUsd,
          hardLimitUsd = excluded.hardLimitUsd
      `)
      .run(config.team, config.period, config.softLimitUsd, config.hardLimitUsd);
  }

  remove(team: string, period: BudgetPeriod): boolean {
    const result = this.db.prepare(`DELETE FROM budgets WHERE team = ? AND period = ?`).run(team, period);
    return result.changes > 0;
  }
}
