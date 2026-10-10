# llm-cost-guardian

A FinOps tool for LLM usage: ingest per-request token/cost events from multiple API keys and
teams, enforce configurable budgets with hard/soft alerts, detect anomalous spend spikes, and
attribute cost by team, API key, model, and provider.

## Project Status

This project is built in public, one night at a time. See **[PROGRESS.md](PROGRESS.md)** for
the architecture, the phased build plan, and exactly where work resumes next.

**Current phase:** Phase 1 (core foundation) and Phase 2 (HTTP ingestion API + durable storage)
are complete — validated ingestion, pluggable storage (in-memory, JSON-file, and SQLite), cost
attribution, budget enforcement (CLI-static and API-managed CRUD), anomaly detection, a CLI, and
an authenticated HTTP API, all with tests. Phase 3 (web dashboard) is next.

## Preview

Every screenshot below is a real, captured invocation — CLI commands run against `dist/cli`, API
calls run against a live `dist/api` server via `curl` — rendered into a terminal window. Nothing
here is hand-typed or mocked.

**`--help`**
![CLI help](docs/screenshots/01-cli-help.png)

**Ingesting a batch of usage events**
![Ingest success](docs/screenshots/02-ingest-success.png)

**Ingesting a batch with bad rows — validation errors are reported per-row, good rows still land**
![Ingest validation errors](docs/screenshots/03-ingest-validation-errors.png)

**Cost attribution report, grouped by team**
![Report by team](docs/screenshots/04-report-by-team.png)

**Budget check — soft warning, hard breach, and ok, side by side (and a non-zero exit code for scripting)**
![Budget check](docs/screenshots/05-budget-check.png)

**Anomaly scan — a real spend spike flagged against a team's own daily baseline**
![Anomaly scan](docs/screenshots/06-anomaly-scan.png)

**HTTP API — `POST /events`, scoped to the caller's own team (a spoofed `team` is rejected, not silently accepted)**
![API ingest events](docs/screenshots/07-api-ingest-events.png)

**HTTP API — `GET /report?by=model`, scoped to the authenticated API key's team only**
![API report by model](docs/screenshots/08-api-report-by-model.png)

**HTTP API — budgets are API-managed: `PUT /budgets/daily` then `GET /budgets/status` showing a hard breach**
![API budget status](docs/screenshots/09-api-budget-status.png)

## Features

### Phase 1 — core domain

- **Validated ingestion** — every event is checked for required fields, a parseable timestamp,
  and non-negative token counts before it's accepted; bad rows are rejected individually with a
  specific reason, not as a batch failure.
- **Automatic cost calculation** — if an event doesn't carry a `costUsd`, it's computed from a
  per-model USD/1K-token pricing table.
- **Pluggable storage** — all logic is written against an `EventStore` interface, and every
  implementation is idempotent: appending a previously-seen event id is a silent no-op, so
  retried ingestion never double-counts spend.
- **Cost attribution** — aggregate spend, tokens, and event counts by team, API key, model, or
  provider.
- **Budget enforcement** — configure daily or monthly soft/hard limits per team; `budget check`
  reports current-period spend and alert level, and exits non-zero on a breach so it's safe to
  wire into cron or CI.
- **Anomaly detection** — flags days where a team's spend is a statistical outlier (z-score)
  against that team's own prior-day history, with a configurable threshold and baseline window.

### Phase 2 — HTTP API & durable storage

- **`SqlEventStore`** — a SQLite-backed `EventStore` using Node's built-in `node:sqlite` driver
  (no native module to compile), implementing the exact same interface as the in-memory and
  JSON-file stores, so attribution/budget/anomaly code is unmodified.
- **`SqlBudgetConfigStore`** — CRUD storage for budget configs, keyed by (team, period), backing
  the budgets API instead of a static JSON file.
- **Per-team API-key auth** — every route except `/health` requires a `Bearer` token that maps to
  exactly one `(apiKeyId, team)`. Ingested events are scoped to that team: a payload that claims a
  different team is rejected per-event, not silently relabeled or accepted.
- **Idempotent ingestion over HTTP** — `POST /events` reports `accepted`, `duplicates`, and
  `rejected` counts separately, so retrying a batch after a timeout is safe and observable.
- **Basic rate limiting** — a fixed-window limiter per authenticated API key, returning `429` with
  `Retry-After` once exceeded.
- **Budgets CRUD** — `GET/PUT/DELETE /budgets/:period` and `GET /budgets/status`, all scoped to
  the caller's own team.

## Quickstart

```bash
npm install
npm run build

# Generate the deterministic sample datasets used throughout this README
node scripts/generate-fixtures.mjs

# Ingest usage events into a local JSON-file-backed store
node dist/cli/index.js ingest fixtures/sample-events.jsonl --store data/events.jsonl

# See cost attribution by team / apiKeyId / model / provider
node dist/cli/index.js report --store data/events.jsonl --by team

# Check budgets (exits 2 on a hard breach, 1 on a soft warning, 0 otherwise)
node dist/cli/index.js budget check --store data/events.jsonl --config fixtures/budgets.json

# Scan for anomalous daily spend
node dist/cli/index.js anomaly scan --store data/events.jsonl
```

During local development you can skip the build step and run the CLI directly via `npm run cli -- <args>`.

### Running the HTTP API

```bash
npm run build

# PORT, DB_PATH, API_KEYS_FILE, RATE_LIMIT_PER_MIN all have sane defaults; see src/api/index.ts
npm run serve

# in another terminal — config/api-keys.json ships 3 demo keys, one per fixture team
curl -s -X POST http://localhost:4000/events \
  -H "Authorization: Bearer demo_platform_f3a1c9" -H "Content-Type: application/json" \
  -d '[{"timestamp":"2026-10-10T09:00:00.000Z","provider":"anthropic","model":"claude-opus-5-5","inputTokens":4200,"outputTokens":1800}]'

curl -s "http://localhost:4000/report?by=model" -H "Authorization: Bearer demo_platform_f3a1c9"

curl -s -X PUT http://localhost:4000/budgets/daily \
  -H "Authorization: Bearer demo_platform_f3a1c9" -H "Content-Type: application/json" \
  -d '{"softLimitUsd":0.01,"hardLimitUsd":0.05}'

curl -s http://localhost:4000/budgets/status -H "Authorization: Bearer demo_platform_f3a1c9"
```

`config/api-keys.json` is a **demo-only** credential file committed for local testing — it maps
plaintext keys to `(apiKeyId, team)`, same spirit as `fixtures/budgets.json`. Point
`API_KEYS_FILE` at a real, git-ignored file for anything beyond local demos.

## Testing

```bash
npm test         # run the full suite once
npm run test:watch
npm run typecheck
```

60 unit/integration tests cover ingestion validation, pricing, storage (in-memory, JSON-file, and
SQLite persistence — including idempotent dedup-by-id across all three), cost attribution, budget
evaluation (daily/monthly, soft/hard, team-scoping) and the budgets CRUD store, anomaly detection,
and the HTTP API (auth, per-team scoping, idempotent ingestion, budgets CRUD, rate limiting) run
end-to-end against a live server via `fetch`.

## Architecture

See [PROGRESS.md](PROGRESS.md) for the full architecture diagram and phased roadmap.
