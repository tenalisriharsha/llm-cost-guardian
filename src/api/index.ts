#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqlBudgetConfigStore, SqlEventStore } from "../core/index.js";
import { ApiKeyRegistry } from "./apiKeys.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DB_PATH ?? "data/guardian.db";
const apiKeysPath = process.env.API_KEYS_FILE ?? "config/api-keys.json";
const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

const app = createServer({
  eventStore: new SqlEventStore(db),
  budgetStore: new SqlBudgetConfigStore(db),
  apiKeys: ApiKeyRegistry.fromFile(apiKeysPath),
  rateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: rateLimitPerMinute }),
});

app.listen(port, () => {
  console.log(`llm-cost-guardian API listening on http://localhost:${port}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  api keys: ${apiKeysPath}`);
});
