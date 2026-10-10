# llm-cost-guardian — Progress

## Vision

A FinOps tool for LLM usage: ingest per-request token/cost events from multiple API keys and
teams, enforce configurable budgets with hard/soft alerts, detect anomalous spend spikes, and
render a cost-attribution dashboard (by team, API key, model, and provider).

## Architecture

The system is split into a storage-agnostic **core domain** and thin **delivery layers** (CLI and
HTTP API today, web dashboard planned) on top of it, so the budget/anomaly/attribution logic never
depends on how events arrive or where they're persisted.

```
                       ┌──────────────────────┐
  usage events ──────▶ │   ingestion.ts        │  validate + normalize + price
  (JSONL via CLI,      │   (EventValidation-   │  raw events into UsageEvent
   JSON via HTTP API)  │    Error on bad rows) │
                       └──────────┬────────────┘
                                  ▼
                       ┌──────────────────────┐
                       │   EventStore          │  pluggable, idempotent
                       │   (interface)         │  (dedup by id) persistence
                       ├──────────────────────┤
                       │ InMemoryEventStore    │  Phase 1 (tests)
                       │ JsonFileEventStore    │  Phase 1 (CLI/demo)
                       │ SqlEventStore         │  Phase 2 (API server, node:sqlite)
                       └──────────┬────────────┘
                                  ▼
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ attribution.ts   │  │ budget.ts         │  │ anomaly.ts        │
   │ group spend by   │  │ evaluate daily/   │  │ per-team z-score  │
   │ team/key/model/  │  │ monthly budgets,  │  │ spend-spike       │
   │ provider         │  │ soft/hard alerts  │  │ detection         │
   └─────────────────┘  └──────────────────┘  └──────────────────┘
            ▲                     ▲                     ▲
            │          ┌──────────┴────────────┐        │
            │          │ BudgetConfigStore      │        │
            │          │ (interface)            │        │
            │          │ SqlBudgetConfigStore   │        │
            │          └──────────┬────────────┘        │
            └─────────────────────┼─────────────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                  ▼
      ┌────────────────────┐          ┌──────────────────────────┐
      │   CLI (src/cli)     │          │   HTTP API (src/api)      │
      │   commander-based   │          │   Express, Bearer auth,   │
      │   ingest / report /  │         │   per-team scoping, fixed-│
      │   budget check /    │          │   window rate limiting    │
      │   anomaly scan      │          └──────────────────────────┘
      └────────────────────┘
```

- `src/core/types.ts` — domain types: `UsageEvent`, `BudgetConfig`, `BudgetStatus`, `AnomalyResult`, `AttributionRow`.
- `src/core/pricing.ts` — per-model USD/1K-token rates; back-fills `costUsd` when an event omits it.
- `src/core/ingestion.ts` — validates raw events, assigns ids, computes cost; `ingestBatch` partitions accepted/rejected rows.
- `src/core/store.ts` — `EventStore` interface (append/appendMany return what was actually newly stored, for idempotency reporting) with `InMemoryEventStore` and `JsonFileEventStore` implementations.
- `src/core/sqlStore.ts` — `SqlEventStore`, a SQLite-backed `EventStore` using the built-in `node:sqlite` driver (no native module to compile); dedup enforced by an `id` primary key via `INSERT OR IGNORE`.
- `src/core/budgetStore.ts` — `BudgetConfigStore` interface + `SqlBudgetConfigStore`, CRUD storage for budget configs keyed by (team, period), sharing a `DatabaseSync` connection with `SqlEventStore`.
- `src/core/attribution.ts` — aggregates spend/tokens/event-count by team, API key, model, or provider.
- `src/core/budget.ts` — evaluates `BudgetConfig`s against current-period spend; returns soft/hard alert state.
- `src/core/anomaly.ts` — buckets spend by team/day and flags days whose z-score (vs. that team's own expanding-window history) crosses a threshold.
- `src/cli/` — `llm-cost-guardian ingest|report|budget check|anomaly scan`, with non-zero exit codes on alerts so it's cron/CI friendly.
- `src/api/` — Express HTTP API (`createServer` factory in `server.ts`, bootstrapped in `index.ts`): `apiKeys.ts` loads a `Bearer`-token registry mapping each key to one `(apiKeyId, team)`; `rateLimit.ts` is a fixed-window limiter per key. Routes: `GET /health` (unauth'd), `POST /events`, `GET /report`, and `GET/PUT/DELETE /budgets[/:period]` + `GET /budgets/status` — every authenticated route is scoped to the caller's own team.
- `config/api-keys.json` — demo API-key registry (3 keys, one per fixture team) consumed by the API server and the preview screenshots.
- `fixtures/` + `scripts/generate-fixtures.mjs` — deterministic (seeded) sample datasets used by tests, manual runs, and the preview screenshots.
- `scripts/capture-screenshots.mjs` — runs real CLI commands and real `curl` calls against a live `dist/api` server, renders the captured output into terminal-window screenshots.

## Phased Build Plan

### Phase 1 — Core foundation (Night 1) ✅ done
- [x] Project scaffold: TypeScript, Vitest, tsx, commander, strict tsconfig
- [x] Domain types and validated ingestion pipeline (`ingestEvent` / `ingestBatch`)
- [x] Model pricing table + automatic cost back-fill
- [x] Pluggable `EventStore` (in-memory + JSON-file backed)
- [x] Cost attribution aggregation by team / API key / model / provider
- [x] Budget evaluator with daily/monthly periods and soft/hard alert levels
- [x] Anomaly detector (per-team expanding-window z-score over daily spend)
- [x] CLI: `ingest`, `report`, `budget check`, `anomaly scan`
- [x] Deterministic fixture generator + sample/error/anomaly datasets
- [x] Unit tests for every module (35 tests, all passing)
- [x] README with Preview section and PROGRESS.md

### Phase 2 — Ingestion API & durable storage (Night 2) ✅ done
- [x] HTTP ingestion endpoint (Express) with per-team API-key auth, wrapping the existing `ingestBatch`
- [x] `SqlEventStore` (`node:sqlite`, Node's built-in driver — zero native deps) implementing `EventStore`, swapped in behind the same interface
- [x] Idempotent ingestion (dedupe by event id, enforced in every `EventStore` impl, not just SQL) and basic fixed-window rate limiting on the API
- [x] Budgets become API-managed config (CRUD) via `SqlBudgetConfigStore`, instead of only a static JSON file (the CLI's `budget check` still reads the JSON file — that's an intentionally separate, simpler path for offline/cron use)
- [x] `EventStore.append`/`appendMany` now report what was actually newly stored, so callers (API, CLI) can distinguish "accepted" from "duplicate, already present"
- [x] Demo API-key registry (`config/api-keys.json`) + `npm run serve` bootstrap
- [x] 25 new tests (store dedup, SQL event/budget stores, full HTTP API via a live server + `fetch`) — 60 total, all passing
- [x] 3 new preview screenshots of the HTTP API (ingest with per-team scoping, report, budgets CRUD + status)

### Phase 3 — Dashboard & live attribution
- [ ] Web dashboard (React) for cost attribution by team/key/model/provider
- [ ] Budget status widgets reflecting live alert state
- [ ] Anomaly timeline visualization per team

### Phase 4 — Alerting & integrations
- [ ] Slack/email/webhook delivery for budget and anomaly alerts
- [ ] Scheduled anomaly scans (cron) instead of on-demand CLI runs
- [ ] Multi-tenant auth beyond the current one-key-per-team model (key rotation, revocation, admin-scoped keys that can manage other teams' budgets)

### Phase 5 — Hardening & deployment
- [ ] Replace the plaintext demo API-key file with hashed/salted keys and a real secrets story
- [ ] Structured logging / metrics for observability
- [ ] Deployment docs and a container image

## Where to resume (next session)

Start **Phase 3**: build the React web dashboard against the existing `GET /report` and
`GET /budgets/status` endpoints — no backend changes should be needed for the first cut. Serve it
either as a separate Vite dev server proxying to the API, or statically from Express once built.
Reuse `config/api-keys.json` demo keys for local dashboard auth. Anomaly results aren't exposed
over HTTP yet (`detectAnomalies` is CLI-only) — add a `GET /anomalies` route scoped to the
caller's team before wiring up the anomaly timeline view.

STATUS: IN_PROGRESS
