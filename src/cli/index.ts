#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  attributeBy,
  detectAnomalies,
  evaluateBudgets,
  ingestBatch,
  JsonFileEventStore,
  totalSpendUsd,
  type AttributionDimension,
  type BudgetConfig,
  type RawUsageEvent,
} from "../core/index.js";
import { formatUsd, renderTable } from "./format.js";

function readJsonl<T>(path: string): T[] {
  const contents = readFileSync(path, "utf8").trim();
  if (contents.length === 0) return [];
  return contents.split("\n").map((line) => JSON.parse(line) as T);
}

const program = new Command();

program
  .name("llm-cost-guardian")
  .description("FinOps for LLM usage: ingest cost events, enforce budgets, detect spend anomalies.")
  .version("0.1.0");

program
  .command("ingest <file>")
  .description("Validate and ingest usage events from a JSONL file into the event store")
  .option("-s, --store <path>", "event store file path", "data/events.jsonl")
  .action((file: string, opts: { store: string }) => {
    const raw = readJsonl<RawUsageEvent>(file);
    const { accepted, rejected } = ingestBatch(raw);

    const store = new JsonFileEventStore(opts.store);
    store.appendMany(accepted);

    console.log(`Ingested ${accepted.length}/${raw.length} events from ${file}`);
    console.log(`Accepted spend: ${formatUsd(totalSpendUsd(accepted))}`);
    console.log(`Store: ${opts.store} (${store.all().length} events total)`);

    if (rejected.length > 0) {
      console.log(`\nRejected ${rejected.length} event(s):`);
      for (const { raw: badRaw, error } of rejected) {
        console.log(`  - ${badRaw.apiKeyId ?? "(unknown key)"} @ ${badRaw.timestamp ?? "(unknown time)"}: ${error}`);
      }
    }
  });

program
  .command("report")
  .description("Print a cost attribution report broken down by a dimension")
  .option("-s, --store <path>", "event store file path", "data/events.jsonl")
  .option("-b, --by <dimension>", "team | apiKeyId | model | provider", "team")
  .action((opts: { store: string; by: AttributionDimension }) => {
    const store = new JsonFileEventStore(opts.store);
    const events = store.all();
    const rows = attributeBy(events, opts.by);

    console.log(`Cost attribution by ${opts.by} (${events.length} events, ${formatUsd(totalSpendUsd(events))} total)\n`);
    console.log(
      renderTable(
        [opts.by, "spend", "input tokens", "output tokens", "events"],
        rows.map((row) => [
          row.key,
          formatUsd(row.spendUsd),
          row.inputTokens.toLocaleString(),
          row.outputTokens.toLocaleString(),
          String(row.eventCount),
        ]),
      ),
    );
  });

const budget = program.command("budget").description("Budget enforcement");

budget
  .command("check")
  .description("Evaluate configured budgets against current spend and report alerts")
  .option("-s, --store <path>", "event store file path", "data/events.jsonl")
  .option("-c, --config <path>", "budgets config JSON path", "fixtures/budgets.json")
  .option("-n, --now <iso>", "reference timestamp for the current period (defaults to now)")
  .action((opts: { store: string; config: string; now?: string }) => {
    const store = new JsonFileEventStore(opts.store);
    const configs = JSON.parse(readFileSync(opts.config, "utf8")) as BudgetConfig[];
    const now = opts.now ? new Date(opts.now) : new Date();

    const statuses = evaluateBudgets(store.all(), configs, now);

    console.log(`Budget check as of ${now.toISOString()}\n`);
    console.log(
      renderTable(
        ["team", "period", "spend", "soft limit", "hard limit", "alert"],
        statuses.map((s) => [
          s.team,
          s.period,
          formatUsd(s.spendUsd),
          formatUsd(s.softLimitUsd),
          formatUsd(s.hardLimitUsd),
          s.alert === "hard" ? "HARD BREACH" : s.alert === "soft" ? "soft warning" : "ok",
        ]),
      ),
    );

    const hardCount = statuses.filter((s) => s.alert === "hard").length;
    const softCount = statuses.filter((s) => s.alert === "soft").length;
    console.log(`\n${hardCount} hard breach(es), ${softCount} soft warning(s)`);

    if (hardCount > 0) process.exitCode = 2;
    else if (softCount > 0) process.exitCode = 1;
  });

const anomaly = program.command("anomaly").description("Anomaly detection over historical spend");

anomaly
  .command("scan")
  .description("Flag days where a team's spend is a statistical outlier vs. its own history")
  .option("-s, --store <path>", "event store file path", "data/events.jsonl")
  .option("-t, --threshold <number>", "z-score threshold", "2.5")
  .option("-m, --min-baseline <number>", "minimum baseline days required before scoring", "3")
  .action((opts: { store: string; threshold: string; minBaseline: string }) => {
    const store = new JsonFileEventStore(opts.store);
    const results = detectAnomalies(store.all(), {
      zScoreThreshold: Number(opts.threshold),
      minBaselinePoints: Number(opts.minBaseline),
    });

    console.log(`Anomaly scan (threshold=${opts.threshold}, min baseline=${opts.minBaseline} days)\n`);
    console.log(
      renderTable(
        ["team", "day", "spend", "baseline mean", "baseline stddev", "z-score", "flag"],
        results.map((r) => [
          r.team,
          r.bucketStart.slice(0, 10),
          formatUsd(r.spendUsd),
          formatUsd(r.baselineMeanUsd),
          formatUsd(r.baselineStdDevUsd),
          Number.isFinite(r.zScore) ? r.zScore.toFixed(2) : "inf",
          r.isAnomalous ? "ANOMALY" : "-",
        ]),
      ),
    );

    const anomalyCount = results.filter((r) => r.isAnomalous).length;
    console.log(`\n${anomalyCount} anomalous day(s) out of ${results.length} scored`);
    if (anomalyCount > 0) process.exitCode = 1;
  });

program.parse();
