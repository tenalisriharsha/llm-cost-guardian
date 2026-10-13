# llm-cost-guardian

A FinOps tool for LLM usage: ingest per-request token/cost events from multiple API keys and
teams, enforce configurable budgets with hard/soft alerts, detect anomalous spend spikes, and
attribute cost by team, API key, model, and provider — via a CLI, an HTTP API, and a web
dashboard.

## Project Status

This project is built in public, one night at a time. See **[PROGRESS.md](PROGRESS.md)** for
the architecture, the phased build plan, and exactly where work resumes next.

**Current phase:** All five phases are complete — validated ingestion, pluggable storage
(in-memory, JSON-file, and SQLite), cost attribution, budget enforcement (CLI-static and
API-managed CRUD), anomaly detection, a CLI, an authenticated HTTP API with hashed/role-scoped
API keys, a React dashboard, Slack-webhook alerting, structured logging + Prometheus metrics, and
a container image, all with tests. See [DAILY_REPORT.md](DAILY_REPORT.md) for the full build
summary.

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

The four below are the React dashboard (`web/`), driven headlessly against a live API server
seeded with real events — same rule, nothing hand-edited.

**Dashboard — the connection gate: point it at any API base URL and team API key**
![Dashboard connect](docs/screenshots/10-dashboard-connect.png)

**Dashboard — budgets (a real hard breach and a real soft warning), cost attribution by model, and the anomaly section's honest empty state when a team doesn't have enough daily history yet**
![Dashboard overview](docs/screenshots/11-dashboard-overview.png)

**Dashboard — attribution dimension switched to provider, with the accessible table view toggled on**
![Dashboard attribution table](docs/screenshots/12-dashboard-attribution-table.png)

**Dashboard — a different team's anomaly timeline with a real flagged spend spike**
![Dashboard anomaly timeline](docs/screenshots/13-dashboard-anomaly.png)

The two below are the new `alert check` command — a real Slack incoming-webhook receiver was run
locally for the second one; the CLI actually posted to it.

**`alert check` — a clean day: budgets under their soft limits, no anomalies, nothing to report**
![Alert check clean](docs/screenshots/14-alert-check-clean.png)

**`alert check --slack-webhook ...` — a hard budget breach and a flagged anomaly, posted to Slack for real (status 200)**
![Alert check with Slack notification](docs/screenshots/15-alert-check-slack.png)

The four below are Phase 5: key management, role-scoped admin access, and observability.

**`keys create` then `keys list` — a fresh key is generated, hashed, and appended; the raw value is shown exactly once**
![Keys create and list](docs/screenshots/16-keys-create-and-list.png)

**`keys revoke` — the key is marked revoked in place and can no longer authenticate, without deleting its audit trail**
![Keys revoke](docs/screenshots/17-keys-revoke.png)

**An `admin`-role key reads another team's report via `?team=growth`; a `team`-role key passing the same query param is silently ignored and still sees only its own data**
![Admin cross-team report](docs/screenshots/18-admin-cross-team-report.png)

**`GET /metrics` — Prometheus text exposition: request counts by status, rate-limit rejections, auth failures, and events ingested by team**
![API metrics](docs/screenshots/19-api-metrics.png)

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

### Phase 3 — web dashboard

- **`GET /anomalies`** and **`GET /whoami`** — two small additions to the HTTP API: anomaly
  results (previously CLI-only) scoped to the caller's team with optional `minBaselinePoints` /
  `zScoreThreshold` overrides, and a who-am-I lookup the dashboard uses to confirm a connection
  and label it by team.
- **Permissive CORS** — every route is already gated by a bearer API key, so the API answers
  cross-origin requests (and `OPTIONS` preflights) from any browser origin, including the
  dashboard's own dev server port.
- **React dashboard (`web/`)** — a standalone Vite + React + TypeScript app that talks to the API
  directly from the browser: a connection gate (API base URL + API key, persisted to
  `localStorage`), budget cards with live meters and an inline soft/hard-limit editor, a cost
  attribution chart with dimension tabs and a table-view toggle, and an anomaly timeline chart
  that flags real statistical outliers with a direct "ANOMALY" label — never color alone.
- **Pure, unit-tested chart/format logic** — currency/token formatting, budget-meter percentage,
  and the linear/point scale functions behind the bar and line charts are extracted into
  `web/src/lib/` and tested independently of React.

### Phase 4 — alerting & integrations

- **`alert check`** — a new CLI command that runs budget evaluation and anomaly detection
  together in one pass and prints a combined, severity-ranked list (`budgetAlerts` /
  `anomalyAlerts` in `src/core/alerts.ts` turn a soft breach into a `warning` and a hard breach or
  a flagged anomaly into a `critical`). Same cron-friendly exit codes as the individual commands
  (`2` on any critical alert, `1` on warning-only, `0` clean).
- **Slack webhook delivery** — pass `--slack-webhook <url>` (or set `$SLACK_WEBHOOK_URL`) and
  `alert check` posts every alert to a Slack incoming webhook in one message
  (`src/integrations/slack.ts`). A clean check with no alerts never posts, so a cron job doesn't
  spam the channel with "all clear" noise. The webhook URL is a plain fetch target — any endpoint
  that accepts a JSON `{"text": "..."}` POST works, not just Slack specifically.
- **Scheduled checks, no new scheduler** — `alert check` is a single, idempotent, read-only
  command, so a cron entry (`* * * * * cd /path/to/repo && node dist/cli/index.js alert check
  --slack-webhook "$SLACK_WEBHOOK_URL"`) is all scheduled alerting needs; see Quickstart below.

### Phase 5 — hardening & deployment

- **Hashed API keys, real secrets story** — `config/api-keys.json` now stores a SHA-256 hash per
  key (`src/api/apiKeys.ts`), never the plaintext. A leaked config file can't be used to
  authenticate. `ApiKeyRegistry.fromFile` loads the hashed, at-rest format; the plaintext
  constructor still exists for tests and for freshly-generated keys before they're persisted.
- **Key lifecycle CLI** — `llm-cost-guardian keys create|list|revoke` (`src/api/keyManagement.ts`)
  generates a random `lcg_...` key, shows it exactly once, and appends its hash; `revoke` marks a
  key dead in place (no deletion, so the audit trail survives) without needing to restart anything
  but the API process that re-reads the file.
- **Admin-scoped keys** — a key's `role` is `team` (default, confined to its own team) or `admin`.
  An admin key can read/manage any team's report, anomalies, and budgets via `?team=<name>`, and
  can ingest events on behalf of any team; a `team`-role key passing the same query param is
  silently ignored, not an error, and still only sees its own data.
- **Structured logging** — `src/api/logging.ts` emits one JSON line per HTTP request (method,
  path, status, duration, caller identity) to stdout, plus startup/shutdown events, instead of
  Express's implicit console output — pipeable straight into a log shipper or `jq`.
- **Prometheus metrics** — `GET /metrics` (unauthenticated, like `/health` — meant to sit behind
  network policy, not public) exposes request counts by status, rate-limit rejections, auth
  failures, and events ingested per team, in Prometheus text exposition format.
- **Container image** — a multi-stage `Dockerfile` (no native deps to compile; `node:sqlite` is
  built in) plus a `docker-compose.yml` with a named volume for the SQLite file; see Deployment
  below.
- **27 new tests** (key hashing/revocation, key-lifecycle CRUD, metrics counters + Prometheus
  format, structured-logger output, admin-scoped-key server behavior) — 106 total in the core/API
  suite, all passing.
- **4 new preview screenshots**: `keys create`/`keys list`, `keys revoke`, an admin key reading
  another team's data (and a team key being correctly denied the same), and a real `/metrics`
  scrape.

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

# Budgets + anomalies together, optionally notifying a Slack incoming webhook
# (exits 2 on any critical alert, 1 on warning-only, 0 clean — cron/CI friendly either way)
node dist/cli/index.js alert check --store data/events.jsonl --config fixtures/budgets.json \
  --slack-webhook "$SLACK_WEBHOOK_URL"
```

During local development you can skip the build step and run the CLI directly via `npm run cli -- <args>`.

To run `alert check` on a schedule instead of on demand, point cron at the built CLI — no
in-process scheduler needed:

```
*/15 * * * * cd /path/to/llm-cost-guardian && node dist/cli/index.js alert check --store data/events.jsonl --config fixtures/budgets.json --slack-webhook "$SLACK_WEBHOOK_URL" >> /var/log/llm-cost-guardian.log 2>&1
```

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

# an admin-role key can act on behalf of any team via ?team=
curl -s "http://localhost:4000/report?by=model&team=growth" -H "Authorization: Bearer demo_admin_8f12a0"

# Prometheus-style scrape target, unauthenticated like /health
curl -s http://localhost:4000/metrics
```

`config/api-keys.json` is a **demo-only** credential file committed for local testing. It maps a
SHA-256 **hash** of each key to `(apiKeyId, team, role)` — the raw keys above are only in this
README and in the screenshot-capture scripts, never in the file itself. Point `API_KEYS_FILE` at
a real, git-ignored file for anything beyond local demos.

### Managing API keys

```bash
# generates a new key, prints it once (only its hash is ever stored), and appends it
node dist/cli/index.js keys create --id key-platform-staging --team platform --role team

node dist/cli/index.js keys list

# marks a key dead in place; takes effect once the API process re-reads the key file
node dist/cli/index.js keys revoke key-platform-staging
```

All three default to `config/api-keys.json`; pass `--file <path>` to target another key file. The
API server loads the key file once at startup (`ApiKeyRegistry.fromFile` in `src/api/index.ts`) —
there's no file-watching or hot reload, so a revocation only takes effect after the API process is
restarted. Known limitation, not a bug: documented in DAILY_REPORT.md.

### Running the dashboard

```bash
npm run serve             # API server, in one terminal (see above)

cd web
npm install                # first time only
npm run dev                 # Vite dev server at http://localhost:5173
```

Open `http://localhost:5173`, enter the API's base URL (`http://localhost:4000` by default) and
one of the demo keys from `config/api-keys.json`, and connect. `npm run dashboard:build` (from the
repo root) type-checks and builds `web/dist` for a static deploy; `npm run dashboard:dev` is a
root-level shortcut for the dev server above.

## Deployment

The HTTP API builds into a container image. `node:sqlite` (used by `SqlEventStore` and
`SqlBudgetConfigStore`) is a built-in Node driver, not a native module, so there's no compiler
toolchain to bake into the image.

```bash
docker compose up --build
# or, without compose:
docker build -t llm-cost-guardian .
docker run -p 4000:4000 -v guardian-data:/app/data llm-cost-guardian
```

What to know before running this anywhere beyond a laptop:

- **The demo key file ships in the image.** `config/api-keys.json`'s hashes correspond to the
  same demo raw keys used throughout this README — fine for trying the image locally, not for
  anything reachable from outside your machine. Mount a real file over it:
  `-v ./config/api-keys.prod.json:/app/config/api-keys.json:ro` (or the equivalent `volumes:`
  entry already commented out in `docker-compose.yml`), generated via `keys create` above.
- **The SQLite file needs a persistent volume** (`DB_PATH`, default `/app/data/guardian.db`) or
  every event/budget is lost on container restart — `docker-compose.yml` wires up a named volume
  for this; `docker run` needs the `-v` shown above.
- **`GET /health`** backs the image's `HEALTHCHECK` and is also what every orchestrator's liveness
  probe should hit; **`GET /metrics`** is unauthenticated by design (same reasoning as `/health`)
  so a Prometheus scrape config doesn't need a credential — put it behind network policy /
  firewall rules, not behind the application's own auth.
- **Logs are structured JSON lines to stdout** (`src/api/logging.ts`) — redirect/collect them the
  same way you would any container's stdout; no log file path to mount.
- `PORT`, `DB_PATH`, `API_KEYS_FILE`, and `RATE_LIMIT_PER_MIN` are all configurable via environment
  variables (see `docker-compose.yml` and `src/api/index.ts`).

There's no Dockerfile for the React dashboard — `npm run dashboard:build` produces a static
`web/dist` you can serve from anything that serves static files (the API itself doesn't need to
know the dashboard exists; CORS is already permissive for exactly this reason).

## Testing

```bash
npm test         # run the full suite once (core + API)
npm run test:watch
npm run typecheck

npm run dashboard:test   # web/src/lib unit tests (format, scales — pure logic behind the charts)
```

106 unit/integration tests cover ingestion validation, pricing, storage (in-memory, JSON-file, and
SQLite persistence — including idempotent dedup-by-id across all three), cost attribution, budget
evaluation (daily/monthly, soft/hard, team-scoping) and the budgets CRUD store, anomaly detection,
alert-event mapping (`src/core/alerts.ts`) and Slack-webhook delivery (payload formatting plus a
mocked-`fetch` success/failure/no-op matrix for `sendSlackAlerts`), API-key hashing/revocation and
the key-lifecycle CRUD helpers (`src/api/apiKeys.ts`, `keyManagement.ts`), the structured logger
and Prometheus-format metrics counters, and the HTTP API (auth, per-team scoping, admin-scoped
cross-team access, idempotent ingestion, budgets CRUD, anomalies, whoami, CORS, rate limiting,
`/metrics`) run end-to-end against a live server via `fetch`. The dashboard adds 17 more,
unit-testing the formatting and chart-scale logic in `web/src/lib/` independently of React — 123
tests in total.

## Architecture

See [PROGRESS.md](PROGRESS.md) for the full architecture diagram and phased roadmap.
