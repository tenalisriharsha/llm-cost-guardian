# llm-cost-guardian — Daily Report

A FinOps tool for LLM usage, built over five nights: ingest per-request token/cost events,
enforce budgets, detect spend anomalies, attribute cost, alert on breaches, and run the whole
thing as an authenticated service with observability and a container image.

## Night 1 — Core foundation

Built the storage-agnostic domain core: validated ingestion (`ingestEvent`/`ingestBatch`, with
per-row rejection reasons instead of batch failure), a per-model pricing table that back-fills
`costUsd` when an event omits it, a pluggable `EventStore` interface (in-memory + JSON-file,
idempotent by event id), cost attribution by team/API key/model/provider, a budget evaluator
(daily/monthly, soft/hard), and an anomaly detector (per-team expanding-window z-score over daily
spend). Wrapped it in a CLI (`ingest`, `report`, `budget check`, `anomaly scan`) and a deterministic
fixture generator. 35 tests.

## Night 2 — Ingestion API & durable storage

Added an HTTP ingestion API (Express) with per-team bearer-key auth, a `SqlEventStore` backed by
Node's built-in `node:sqlite` driver (no native module to compile), idempotent dedup enforced in
every store implementation, basic fixed-window rate limiting, and API-managed budgets CRUD via
`SqlBudgetConfigStore`. 25 new tests (60 total).

## Night 3 — Dashboard & live attribution

Added `GET /anomalies` and `GET /whoami` plus permissive CORS so a browser could call the API
cross-origin, then built a standalone Vite + React + TypeScript dashboard: a connection gate,
live budget meters with an inline editor, a cost-attribution chart with a table-view accessibility
toggle, and an SVG anomaly timeline that always labels a flagged day directly (never color alone).
Pure chart/format logic was extracted into `web/src/lib/` and unit-tested independently of React.
19 new tests (79 total across core/API + 17 in the dashboard).

## Night 4 — Alerting & integrations

Added `src/core/alerts.ts` (pure `budgetAlerts`/`anomalyAlerts` mapping, decoupled from any
delivery channel) and `src/integrations/slack.ts` (Slack incoming-webhook delivery that no-ops
on a clean check instead of sending "all clear" noise). New CLI command `alert check` runs budget
+ anomaly evaluation together and posts to a configured webhook — no new scheduler needed, since
it's a single idempotent read-only command a cron entry can call directly. 12 new tests (79
total).

## Night 5 — Hardening & deployment

Closed out the three things an operator would actually get burned by first:

- **Real secrets story.** `config/api-keys.json` now stores a SHA-256 hash per key, never the
  raw value — a leaked config file isn't a usable credential. A CLI key lifecycle
  (`keys create|list|revoke`) generates and shows a raw key exactly once, and revocation marks a
  key dead in place rather than deleting its record.
- **Admin-scoped keys.** A key's `role` (`team`, confined to its own team, or `admin`) is part of
  its auth context. An admin key can read/manage any team's data via `?team=<name>` and ingest on
  behalf of any team; a team-role key's own `?team=` is silently ignored, not an error.
- **Observability.** Structured JSON-line logging for every request and server lifecycle event,
  plus `GET /metrics` in Prometheus text exposition format (request counts by status, rate-limit
  rejections, auth failures, events ingested per team).
- **Deployment.** A multi-stage `Dockerfile` (no native deps — `node:sqlite` is built in) and
  `docker-compose.yml` with a named volume for the SQLite file; verified the production-only
  runtime actually boots and serves real traffic before calling it done.

27 new tests (106 total across core/API) + 4 new preview screenshots.

## Test results

```
Core + API:  106 tests, 16 files, all passing  (npm test)
Dashboard:    17 tests, all passing             (npm run dashboard:test)
Typecheck:   clean                              (npm run typecheck)
```

## What exists end-to-end

- **CLI** — `ingest`, `report`, `budget check`, `anomaly scan`, `alert check`, `keys create|list|revoke`.
- **HTTP API** — bearer-auth'd, per-team-scoped (with admin cross-team override), idempotent
  ingestion, budgets CRUD, anomaly detection, Prometheus metrics, structured logs, backed by
  SQLite via `node:sqlite`.
- **React dashboard** — connection gate, budget meters + editor, attribution chart, anomaly
  timeline, all against the live API.
- **Alerting** — Slack-webhook delivery of budget/anomaly alerts, cron-friendly exit codes
  throughout the CLI.
- **Deployment** — a working container image with a documented volume/secrets/metrics story.
- **19 preview screenshots** in `docs/screenshots/`, every one a real captured invocation (CLI
  output, `curl` against a live server, or a Playwright-driven browser against the live
  dashboard) — nothing hand-typed or mocked.

## Known limitations

- **Key-file hot reload.** The API loads `config/api-keys.json` once at startup
  (`ApiKeyRegistry.fromFile`); a `keys revoke` only takes effect after the API process restarts.
  No file watcher or reload endpoint exists yet.
- **Single-instance metrics.** `Metrics` is an in-memory, process-local counter set. A
  multi-replica deployment would need a shared backend (or per-instance scraping with aggregation
  downstream) instead of treating `/metrics` as global state.
- **No email / generic multi-channel alerting.** Only Slack-shaped webhook delivery exists.
  `src/core/alerts.ts` already separates evaluation from delivery, so adding a channel is a new
  `src/integrations/*.ts` module, not a redesign — just not built, since a second channel hasn't
  been needed yet.
- **Rate limiting is in-memory and per-process.** `FixedWindowRateLimiter` doesn't share state
  across replicas; a multi-instance deployment would under-enforce the configured limit.
- **No admin UI for key management** — `keys create|list|revoke` is CLI-only; there's no HTTP
  route or dashboard screen for it (deliberately: it's an operator action, not an end-user one,
  and the CLI already has filesystem access to the key file that an HTTP route would need its own
  auth story to replicate).

## Future ideas

- A reload mechanism for the key file (watcher, SIGHUP handler, or moving key storage into the
  SQL store so `keys create`/`revoke` are consistent across replicas without a restart).
- An email or generic-webhook alert channel alongside Slack, once a second receiver is actually
  needed.
- A shared-state rate limiter (e.g. token-bucket counters in the same SQLite database) for
  multi-instance deployments.
- Metrics aggregation across replicas (push to a shared Prometheus pushgateway, or move counters
  into the database) if this ever runs as more than one process.
