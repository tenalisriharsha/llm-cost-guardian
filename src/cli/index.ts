#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  anomalyAlerts,
  attributeBy,
  budgetAlerts,
  detectAnomalies,
  evaluateBudgets,
  ingestBatch,
  JsonFileEventStore,
  totalSpendUsd,
  type AttributionDimension,
  type BudgetConfig,
  type RawUsageEvent,
} from "../core/index.js";
import { createKey, loadKeyFile, revokeKey, saveKeyFile } from "../api/keyManagement.js";
import { sendSlackAlerts } from "../integrations/slack.js";
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
    const stored = store.appendMany(accepted);
    const duplicates = accepted.length - stored.length;

    console.log(`Ingested ${stored.length}/${raw.length} events from ${file}`);
    if (duplicates > 0) console.log(`Skipped ${duplicates} duplicate event(s) already in the store`);
    console.log(`Accepted spend: ${formatUsd(totalSpendUsd(stored))}`);
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

const alert = program.command("alert").description("Combined budget + anomaly check, optionally notifying Slack");

alert
  .command("check")
  .description("Evaluate budgets and scan for anomalies together; posts to a Slack webhook if one is configured")
  .option("-s, --store <path>", "event store file path", "data/events.jsonl")
  .option("-c, --config <path>", "budgets config JSON path", "fixtures/budgets.json")
  .option("-n, --now <iso>", "reference timestamp for the current period (defaults to now)")
  .option("-t, --threshold <number>", "anomaly z-score threshold", "2.5")
  .option("-m, --min-baseline <number>", "minimum baseline days required before scoring", "3")
  .option("--slack-webhook <url>", "Slack incoming-webhook URL to notify (defaults to $SLACK_WEBHOOK_URL)")
  .action(
    async (opts: {
      store: string;
      config: string;
      now?: string;
      threshold: string;
      minBaseline: string;
      slackWebhook?: string;
    }) => {
      const store = new JsonFileEventStore(opts.store);
      const events = store.all();
      const configs = JSON.parse(readFileSync(opts.config, "utf8")) as BudgetConfig[];
      const now = opts.now ? new Date(opts.now) : new Date();

      const statuses = evaluateBudgets(events, configs, now);
      const anomalies = detectAnomalies(events, {
        zScoreThreshold: Number(opts.threshold),
        minBaselinePoints: Number(opts.minBaseline),
      });
      const alerts = [...budgetAlerts(statuses), ...anomalyAlerts(anomalies)];

      console.log(`Alert check as of ${now.toISOString()}\n`);
      if (alerts.length === 0) {
        console.log("No budget breaches or spend anomalies.");
      } else {
        for (const a of alerts) {
          console.log(`[${a.severity.toUpperCase()}] (${a.kind}) ${a.summary}`);
        }
      }

      const webhookUrl = opts.slackWebhook ?? process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) {
        const result = await sendSlackAlerts(alerts, webhookUrl);
        if (alerts.length === 0) {
          console.log("\nSlack webhook configured, nothing to send.");
        } else if (result.sent) {
          console.log(`\nSent ${alerts.length} alert(s) to Slack (status ${result.status}).`);
        } else {
          console.log(`\nFailed to notify Slack: ${result.error ?? `status ${result.status}`}`);
        }
      }

      const hardCount = alerts.filter((a) => a.severity === "critical").length;
      if (hardCount > 0) process.exitCode = 2;
      else if (alerts.length > 0) process.exitCode = 1;
    },
  );

const keys = program.command("keys").description("Manage API keys (config/api-keys.json by default)");

keys
  .command("create")
  .description("Generate a new API key and append its hashed record to the key file; prints the raw key once")
  .requiredOption("-i, --id <apiKeyId>", "unique id for this key, e.g. key-platform-staging")
  .requiredOption("-t, --team <team>", "team this key is scoped to")
  .option("-r, --role <role>", "team | admin", "team")
  .option("-f, --file <path>", "API key file path", "config/api-keys.json")
  .action((opts: { id: string; team: string; role: string; file: string }) => {
    if (opts.role !== "team" && opts.role !== "admin") {
      console.error(`invalid role "${opts.role}", expected "team" or "admin"`);
      process.exitCode = 1;
      return;
    }
    const records = loadKeyFile(opts.file);
    if (records.some((r) => r.apiKeyId === opts.id)) {
      console.error(`a key with id "${opts.id}" already exists in ${opts.file}`);
      process.exitCode = 1;
      return;
    }
    const { record, rawKey } = createKey({ apiKeyId: opts.id, team: opts.team, role: opts.role });
    saveKeyFile(opts.file, [...records, record]);

    console.log(`Created key "${opts.id}" (team=${opts.team}, role=${opts.role})`);
    console.log(`\n  ${rawKey}\n`);
    console.log("This is the only time the raw key is shown — only its hash is stored. Save it now.");
  });

keys
  .command("list")
  .description("List API key records (never the raw key or its hash)")
  .option("-f, --file <path>", "API key file path", "config/api-keys.json")
  .action((opts: { file: string }) => {
    const records = loadKeyFile(opts.file);
    console.log(
      renderTable(
        ["id", "team", "role", "created", "status"],
        records.map((r) => [r.apiKeyId, r.team, r.role, r.createdAt.slice(0, 10), r.revokedAt ? "revoked" : "active"]),
      ),
    );
  });

keys
  .command("revoke <apiKeyId>")
  .description("Revoke an API key so it can no longer authenticate")
  .option("-f, --file <path>", "API key file path", "config/api-keys.json")
  .action((apiKeyId: string, opts: { file: string }) => {
    const records = loadKeyFile(opts.file);
    if (!revokeKey(records, apiKeyId)) {
      console.error(`no active key with id "${apiKeyId}" found in ${opts.file}`);
      process.exitCode = 1;
      return;
    }
    saveKeyFile(opts.file, records);
    console.log(`Revoked "${apiKeyId}" — it will no longer authenticate once the API server re-reads the key file.`);
  });

program.parse();
