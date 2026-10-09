// Deterministic fixture generator (seeded LCG) so the sample data in fixtures/ is reproducible.
// Run with: node scripts/generate-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES_DIR = join(ROOT, "fixtures");
const ANCHOR_DAY = "2026-10-09"; // "today" for this demo dataset

function makeRng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function isoAt(dayOffset, hour, minute, anchor = ANCHOR_DAY) {
  const base = new Date(`${anchor}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCHours(hour, minute, 0, 0);
  return base.toISOString();
}

function writeJsonl(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

const MODELS = [
  { model: "claude-sonnet-5-5", provider: "anthropic" },
  { model: "claude-haiku-4-5", provider: "anthropic" },
  { model: "claude-opus-5-5", provider: "anthropic" },
  { model: "gpt-4o-mini", provider: "openai" },
];

const TEAMS = [
  { team: "platform", keys: ["key-platform-prod", "key-platform-staging"], dailyCalls: 26 },
  { team: "growth", keys: ["key-growth-prod"], dailyCalls: 14 },
  { team: "research", keys: ["key-research-prod"], dailyCalls: 10 },
];

// --- fixtures/sample-events.jsonl: 3 days of multi-team traffic for ingest + report demos ---
function buildSampleEvents() {
  const rng = makeRng(42);
  const events = [];
  for (const dayOffset of [-2, -1, 0]) {
    for (const { team, keys } of TEAMS) {
      const calls = TEAMS.find((t) => t.team === team).dailyCalls;
      for (let i = 0; i < calls; i++) {
        const { model, provider } = MODELS[Math.floor(rng() * MODELS.length)];
        const key = keys[Math.floor(rng() * keys.length)];
        const hour = Math.floor(rng() * 23);
        const minute = Math.floor(rng() * 59);
        events.push({
          timestamp: isoAt(dayOffset, hour, minute),
          apiKeyId: key,
          team,
          provider,
          model,
          inputTokens: 200 + Math.floor(rng() * 1800),
          outputTokens: 50 + Math.floor(rng() * 900),
        });
      }
    }
  }
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return events;
}

// --- fixtures/events-with-errors.jsonl: a small batch mixing valid rows with bad ones ---
function buildErrorBatch() {
  return [
    {
      timestamp: isoAt(0, 9, 0),
      apiKeyId: "key-growth-prod",
      team: "growth",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      inputTokens: 500,
      outputTokens: 120,
    },
    {
      // missing team
      timestamp: isoAt(0, 9, 5),
      apiKeyId: "key-growth-prod",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      inputTokens: 500,
      outputTokens: 120,
    },
    {
      // invalid timestamp
      timestamp: "not-a-date",
      apiKeyId: "key-research-prod",
      team: "research",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 400,
      outputTokens: 90,
    },
    {
      // negative tokens
      timestamp: isoAt(0, 9, 10),
      apiKeyId: "key-platform-prod",
      team: "platform",
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: -10,
      outputTokens: 90,
    },
    {
      timestamp: isoAt(0, 9, 15),
      apiKeyId: "key-platform-prod",
      team: "platform",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1200,
      outputTokens: 300,
    },
  ];
}

// --- fixtures/anomaly-events.jsonl: 10 quiet days then one spend spike for the growth team ---
function buildAnomalyEvents() {
  const rng = makeRng(7);
  const events = [];
  for (let dayOffset = -10; dayOffset <= 0; dayOffset++) {
    const isSpikeDay = dayOffset === 0;
    const calls = isSpikeDay ? 40 : 6 + Math.floor(rng() * 4);
    for (let i = 0; i < calls; i++) {
      const hour = Math.floor(rng() * 23);
      const minute = Math.floor(rng() * 59);
      events.push({
        timestamp: isoAt(dayOffset, hour, minute),
        apiKeyId: "key-growth-prod",
        team: "growth",
        provider: "anthropic",
        model: isSpikeDay ? "claude-opus-5-5" : "claude-haiku-4-5",
        inputTokens: isSpikeDay ? 3000 + Math.floor(rng() * 2000) : 300 + Math.floor(rng() * 400),
        outputTokens: isSpikeDay ? 800 + Math.floor(rng() * 600) : 80 + Math.floor(rng() * 150),
      });
    }
  }
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return events;
}

// Tuned against sample-events.jsonl's day-0 (2026-10-09) spend so `budget check` demos
// one of each outcome: research breaches hard, platform trips the soft warning, growth stays ok.
const budgets = [
  { team: "platform", period: "daily", softLimitUsd: 0.3, hardLimitUsd: 0.5 },
  { team: "growth", period: "daily", softLimitUsd: 0.5, hardLimitUsd: 1.0 },
  { team: "research", period: "daily", softLimitUsd: 0.2, hardLimitUsd: 0.35 },
];

writeJsonl(join(FIXTURES_DIR, "sample-events.jsonl"), buildSampleEvents());
writeJsonl(join(FIXTURES_DIR, "events-with-errors.jsonl"), buildErrorBatch());
writeJsonl(join(FIXTURES_DIR, "anomaly-events.jsonl"), buildAnomalyEvents());
writeFileSync(join(FIXTURES_DIR, "budgets.json"), JSON.stringify(budgets, null, 2) + "\n", "utf8");

console.log("Fixtures written to", FIXTURES_DIR);
