# llm-cost-guardian — Progress

## Vision

A FinOps tool for LLM usage: ingest per-request token/cost events from multiple API keys and
teams, enforce configurable budgets with hard/soft alerts, detect anomalous spend spikes, and
render a cost-attribution dashboard (by team, API key, model, and provider).

## Architecture

The system is split into a storage-agnostic **core domain** and thin **delivery layers** (CLI
today, HTTP API + web dashboard planned) on top of it, so the budget/anomaly/attribution logic
never depends on how events arrive or where they're persisted.

```
                       ┌──────────────────────┐
  usage events ──────▶ │   ingestion.ts        │  validate + normalize + price
  (JSONL today,        │   (EventValidation-   │  raw events into UsageEvent
   HTTP API later)     │    Error on bad rows) │
                       └──────────┬────────────┘
                                  ▼
                       ┌──────────────────────┐
                       │   EventStore          │  pluggable persistence
                       │   (interface)         │  interface
                       ├──────────────────────┤
                       │ InMemoryEventStore    │  Phase 1 (tests)
                       │ JsonFileEventStore    │  Phase 1 (CLI/demo)
                       │ SqlEventStore         │  Phase 2 (planned)
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
            └─────────────────────┴─────────────────────┘
                                  │
                       ┌──────────┴────────────┐
                       │   CLI (src/cli)        │  ingest / report / budget
                       │   commander-based      │  check / anomaly scan
                       └────────────────────────┘
```

- `src/core/types.ts` — domain types: `UsageEvent`, `BudgetConfig`, `BudgetStatus`, `AnomalyResult`, `AttributionRow`.
- `src/core/pricing.ts` — per-model USD/1K-token rates; back-fills `costUsd` when an event omits it.
- `src/core/ingestion.ts` — validates raw events, assigns ids, computes cost; `ingestBatch` partitions accepted/rejected rows.
- `src/core/store.ts` — `EventStore` interface with `InMemoryEventStore` and `JsonFileEventStore` implementations.
- `src/core/attribution.ts` — aggregates spend/tokens/event-count by team, API key, model, or provider.
- `src/core/budget.ts` — evaluates `BudgetConfig`s against current-period spend; returns soft/hard alert state.
- `src/core/anomaly.ts` — buckets spend by team/day and flags days whose z-score (vs. that team's own expanding-window history) crosses a threshold.
- `src/cli/` — `llm-cost-guardian ingest|report|budget check|anomaly scan`, with non-zero exit codes on alerts so it's cron/CI friendly.
- `fixtures/` + `scripts/generate-fixtures.mjs` — deterministic (seeded) sample datasets used by tests, manual runs, and the preview screenshots.

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

### Phase 2 — Ingestion API & durable storage
- [ ] HTTP ingestion endpoint (Express/Fastify) with per-team API-key auth, wrapping the existing `ingestBatch`
- [ ] `SqlEventStore` (SQLite to start) implementing `EventStore`, swapped in behind the same interface
- [ ] Idempotent ingestion (dedupe by event id) and basic rate limiting on the endpoint
- [ ] Budgets become API-managed config (CRUD) instead of a static JSON file

### Phase 3 — Dashboard & live attribution
- [ ] Web dashboard (React) for cost attribution by team/key/model/provider
- [ ] Budget status widgets reflecting live alert state
- [ ] Anomaly timeline visualization per team

### Phase 4 — Alerting & integrations
- [ ] Slack/email/webhook delivery for budget and anomaly alerts
- [ ] Scheduled anomaly scans (cron) instead of on-demand CLI runs
- [ ] Multi-tenant auth and per-team scoped API keys

### Phase 5 — Hardening & deployment
- [ ] Input hardening and rate limiting on the ingestion API
- [ ] Structured logging / metrics for observability
- [ ] Deployment docs and a container image

## Where to resume (next session)

Start **Phase 2**: scaffold the HTTP ingestion API (Express) as a thin wrapper around the
existing `ingestBatch` + `EventStore` — the core domain should need zero changes. Add an
API-key auth middleware, then implement `SqlEventStore` (SQLite via a pure-JS driver to avoid
native-module build issues) against the same `EventStore` interface so `attribution.ts`,
`budget.ts`, and `anomaly.ts` keep working unmodified. Carry over the existing fixtures to seed
the new store for integration tests.

STATUS: IN_PROGRESS
