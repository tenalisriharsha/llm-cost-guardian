# llm-cost-guardian — Progress

## Vision

A FinOps tool for LLM usage: ingest per-request token/cost events from multiple API keys and
teams, enforce configurable budgets with hard/soft alerts, detect anomalous spend spikes, and
render a cost-attribution dashboard (by team, API key, model, and provider).

## Architecture

The system is split into a storage-agnostic **core domain** and thin **delivery layers** (CLI,
HTTP API, and a React dashboard) on top of it, so the budget/anomaly/attribution logic never
depends on how events arrive, where they're persisted, or how they're viewed.

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
                                  ▼
                       ┌──────────────────────┐
                       │   alerts.ts           │  BudgetStatus/AnomalyResult
                       │   budgetAlerts /      │  -> severity-ranked AlertEvent[]
                       │   anomalyAlerts       │
                       └──────────┬────────────┘
                                  ▼
                       ┌──────────────────────┐
                       │ integrations/slack.ts │  formats + posts AlertEvent[]
                       │ sendSlackAlerts       │  to an incoming-webhook URL
                       └──────────┬────────────┘
                 ┌────────────────┴────────────────┐
                 ▼                                  ▼
      ┌────────────────────┐          ┌──────────────────────────┐
      │   CLI (src/cli)     │          │   HTTP API (src/api)      │
      │   commander-based   │          │   Express, Bearer auth,   │
      │   ingest / report /  │         │   per-team scoping, CORS, │
      │   budget check /    │          │   fixed-window rate limit │
      │   anomaly scan /    │          └─────────────┬────────────┘
      │   alert check       │                        │ fetch, Bearer auth
      └────────────────────┘                         ▼
                                         ┌──────────────────────────┐
                                         │   Dashboard (web/)        │
                                         │   Vite + React + TS,      │
                                         │   budgets/attribution/    │
                                         │   anomaly views           │
                                         └──────────────────────────┘
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
- `src/api/` — Express HTTP API (`createServer` factory in `server.ts`, bootstrapped in `index.ts`): `apiKeys.ts` loads a `Bearer`-token registry mapping each key to one `(apiKeyId, team)`; `rateLimit.ts` is a fixed-window limiter per key. Routes: `GET /health` (unauth'd), `GET /whoami`, `POST /events`, `GET /report`, `GET /anomalies`, and `GET/PUT/DELETE /budgets[/:period]` + `GET /budgets/status` — every authenticated route is scoped to the caller's own team. A permissive CORS middleware (any origin, since every route is already bearer-gated) answers `OPTIONS` preflights for the dashboard.
- `config/api-keys.json` — demo API-key registry (3 keys, one per fixture team) consumed by the API server, the dashboard, and the preview screenshots.
- `fixtures/` + `scripts/generate-fixtures.mjs` — deterministic (seeded) sample datasets used by tests, manual runs, and the CLI/API preview screenshots.
- `scripts/capture-screenshots.mjs` — runs real CLI commands and real `curl` calls against a live `dist/api` server, renders the captured output into terminal-window screenshots.
- `scripts/capture-dashboard-screenshots.mjs` — seeds a live API server with realistic, wall-clock-anchored data (budgets and anomalies are evaluated against real "now", so fixture files with fixed anchor dates don't work here), serves the built dashboard via `vite preview`, and drives it with Playwright to screenshot every distinct view.
- `web/` — standalone Vite + React + TypeScript dashboard, its own `package.json`/tests, talking to the API directly over `fetch` from the browser (no backend changes needed beyond the two new routes above). `web/src/lib/` holds the pure, unit-tested logic (`api.ts` client, `format.ts`, `scale.ts`, `palette.ts`); `web/src/components/` holds `ConnectionGate`, `BudgetsPanel`, `AttributionChart`, `AnomalyTimeline`.
- `src/core/alerts.ts` — pure mapping functions: `budgetAlerts`/`anomalyAlerts` turn `BudgetStatus[]`/`AnomalyResult[]` into a flat `AlertEvent[]` (dropping anything with no alert), classifying a soft budget breach as `warning` and a hard breach or a flagged anomaly as `critical`. Delivery-channel-agnostic on purpose — nothing here knows about Slack.
- `src/integrations/slack.ts` — `formatSlackPayload` (pure) renders `AlertEvent[]` into a Slack incoming-webhook `{text}` payload; `sendSlackAlerts` POSTs it via an injectable `fetch`, returns `{sent, status?, error?}`, and is a no-op (no network call) when there are nothing to send so a clean check never spams the channel.
- `src/cli/index.ts` — new `alert check` command: runs `evaluateBudgets` + `detectAnomalies` together, prints the combined severity-ranked list, and posts to `--slack-webhook <url>` (or `$SLACK_WEBHOOK_URL`) if one is configured. Exit code `2` on any critical alert, `1` on warning-only, `0` clean — same cron-friendly convention as `budget check`/`anomaly scan`. No new scheduler: cron calling this command on an interval is the scheduled-checks story (documented in the README).

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

### Phase 3 — Dashboard & live attribution (Night 3) ✅ done
- [x] `GET /anomalies` (scoped to caller's team, optional `minBaselinePoints`/`zScoreThreshold` query overrides) and `GET /whoami`, plus permissive CORS so a browser dashboard can call the API cross-origin
- [x] Standalone Vite + React + TypeScript dashboard (`web/`) with its own build/test pipeline
- [x] Connection gate (API base URL + API key, validated via `/whoami`, persisted to `localStorage`)
- [x] Cost attribution chart (dimension tabs: model/provider/apiKeyId/team) with a table-view accessibility toggle
- [x] Budget status widgets: live meters, soft/warning/hard-critical status pills, and an inline editor (PUT) + delete, reflecting real alert state
- [x] Anomaly timeline (SVG line chart) per team, flagged days marked with a direct "ANOMALY" label (never color alone), with a table-view toggle
- [x] Pure chart/format logic (`web/src/lib/format.ts`, `scale.ts`) extracted and unit-tested independently of React — 17 tests
- [x] Backend: 7 new tests for `/anomalies`, `/whoami`, and CORS — 67 total, all passing
- [x] `scripts/capture-dashboard-screenshots.mjs` — seeds a live API server with wall-clock-anchored data and drives the real built dashboard with Playwright; 4 new preview screenshots (connect gate, budgets+attribution overview, attribution table view, anomaly spike)

### Phase 4 — Alerting & integrations (Night 4) ✅ done
- [x] `src/core/alerts.ts` — pure `budgetAlerts`/`anomalyAlerts` mapping functions, decoupled from any delivery channel
- [x] `src/integrations/slack.ts` — Slack incoming-webhook delivery (also works as a generic JSON-webhook receiver since the payload is a plain `{text}` POST); no-ops on a clean check instead of sending an empty "all clear" message
- [x] New CLI command `alert check` — runs budget + anomaly evaluation together, prints a combined severity-ranked report, posts to `--slack-webhook`/`$SLACK_WEBHOOK_URL` if configured, same cron-friendly exit-code convention as the existing commands
- [x] Scheduled checks need no new scheduler: `alert check` is a single idempotent read-only command, so a cron entry is the whole story (documented in the README)
- [x] 12 new tests (`alerts.ts` mapping, `slack.ts` payload formatting + a mocked-`fetch` success/failure/no-op matrix) — 79 total, all passing
- [x] 2 new preview screenshots: a clean `alert check` run (no breaches, nothing sent) and a triggered run that really posts to a locally-run mock Slack webhook server (status 200 captured from the real response)
- [ ] Email delivery and a generic multi-channel abstraction — intentionally deferred; Slack-shaped webhook delivery already covers "post this alert somewhere" for any receiver that accepts a JSON POST, and a second channel isn't needed yet to justify an abstraction
- [ ] Multi-tenant auth beyond the current one-key-per-team model (key rotation, revocation, admin-scoped keys that can manage other teams' budgets) — pushed to Phase 5, see below

### Phase 5 — Hardening & deployment
- [ ] Replace the plaintext demo API-key file with hashed/salted keys and a real secrets story
- [ ] Key rotation / revocation / admin-scoped keys beyond the current one-key-per-team model (carried over from Phase 4)
- [ ] Structured logging / metrics for observability
- [ ] Deployment docs and a container image

## Where to resume (next session)

Start **Phase 5**: hardening & deployment. Everything through alerting now works end-to-end and
is tested; what's left is making the deployed story trustworthy rather than adding new features.
Concretely:
- `config/api-keys.json` is a plaintext demo credential file (documented as such in the README),
  with no rotation or revocation story and one key per team. That's the natural starting point —
  it's the thing an operator would actually get burned by first (a leaked key has no way to be
  revoked without editing the file and restarting the process).
- No structured logging/metrics exist yet — the API only has Express's implicit behavior. Worth
  deciding deliberately what "observability" means for a FinOps tool like this (request logs?
  per-team ingestion volume as a metric? alert-delivery success/failure as a metric, since
  `sendSlackAlerts` already returns a structured result that's just printed to stdout today) rather
  than bolting on a generic logging library.
- Deployment docs/container image come last — once the auth and observability stories are settled,
  since both affect what the container needs to expose/mount (secrets file location, log
  destination).
Email/multi-channel alert delivery (deferred from Phase 4) can slot in here too if it comes up, but
isn't blocking — Slack-webhook delivery already covers "notify a channel."

STATUS: IN_PROGRESS
