import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliEntry = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function runIngest(file: string, store: string) {
  return spawnSync("npx", ["tsx", cliEntry, "ingest", file, "--store", store], {
    encoding: "utf8",
  });
}

function runCli(args: string[]) {
  return spawnSync("npx", ["tsx", cliEntry, ...args], {
    encoding: "utf8",
  });
}

describe("cli ingest", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a malformed JSON line as a per-row error instead of crashing", () => {
    const validLine = JSON.stringify({
      timestamp: "2026-10-09T12:00:00.000Z",
      apiKeyId: "key-1",
      team: "platform",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    const inputFile = join(dir, "bad.jsonl");
    const storeFile = join(dir, "out.jsonl");
    writeFileSync(inputFile, `${validLine}\n{"bad json\n`);

    const result = runIngest(inputFile, storeFile);

    expect(result.stderr).not.toMatch(/SyntaxError/);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Rejected 1 event\(s\):/);
    expect(result.stdout).toMatch(/Ingested 1\/2 events/);
  });
});

describe("cli anomaly scan / alert check with non-numeric options", () => {
  let dir: string;
  let storeFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-cli-anomaly-"));
    storeFile = join(dir, "events.jsonl");
    const ingestResult = runIngest("fixtures/anomaly-events.jsonl", storeFile);
    expect(ingestResult.status).toBe(0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("anomaly scan rejects a non-numeric --threshold instead of silently reporting zero anomalies", () => {
    const result = runCli(["anomaly", "scan", "--store", storeFile, "--threshold", "abc"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/threshold/i);
    // The known growth spend spike must not be silently swallowed as "0 anomalous day(s)".
    expect(result.stdout).not.toMatch(/0 anomalous day\(s\)/);
  });

  it("anomaly scan rejects a non-numeric --min-baseline instead of silently scoring zero days", () => {
    const result = runCli(["anomaly", "scan", "--store", storeFile, "--min-baseline", "xyz"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/min-?baseline/i);
    // A NaN min-baseline must not make the scoring loop silently run over zero days.
    expect(result.stdout).not.toMatch(/out of 0 scored/);
  });

  it("anomaly scan still works with a valid numeric --threshold and --min-baseline", () => {
    const result = runCli([
      "anomaly",
      "scan",
      "--store",
      storeFile,
      "--threshold",
      "2.5",
      "--min-baseline",
      "3",
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/1 anomalous day\(s\) out of 8 scored/);
  });

  it("alert check rejects a non-numeric --threshold instead of silently dropping the anomaly alert", () => {
    const result = runCli([
      "alert",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "2026-10-09T12:00:00Z",
      "--threshold",
      "abc",
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/threshold/i);
  });

  it("alert check rejects a non-numeric --min-baseline instead of silently dropping the anomaly alert", () => {
    const result = runCli([
      "alert",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "2026-10-09T12:00:00Z",
      "--min-baseline",
      "xyz",
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/min-?baseline/i);
  });

  it("alert check still works with a valid numeric --threshold and --min-baseline", () => {
    const result = runCli([
      "alert",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "2026-10-09T12:00:00Z",
      "--threshold",
      "2.5",
      "--min-baseline",
      "3",
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/\[CRITICAL\] \(budget\)/);
    expect(result.stdout).toMatch(/\[CRITICAL\] \(anomaly\)/);
  });
});

describe("cli budget check / alert check with an invalid --now", () => {
  let dir: string;
  let storeFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-cli-now-"));
    storeFile = join(dir, "events.jsonl");
    const ingestResult = runIngest("fixtures/sample-events.jsonl", storeFile);
    expect(ingestResult.status).toBe(0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("budget check rejects an unparseable --now instead of crashing with a raw stack trace", () => {
    const result = runCli([
      "budget",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "not-a-date",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(/RangeError/);
    expect(result.stderr).not.toMatch(/at evaluateBudget/);
    expect(`${result.stdout}${result.stderr}`).toMatch(/invalid.*--now/i);
  });

  it("alert check rejects an unparseable --now instead of crashing with a raw stack trace", () => {
    const result = runCli([
      "alert",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "not-a-date",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(/RangeError/);
    expect(result.stderr).not.toMatch(/at evaluateBudget/);
    expect(`${result.stdout}${result.stderr}`).toMatch(/invalid.*--now/i);
  });

  it("budget check still works with a valid --now", () => {
    const result = runCli([
      "budget",
      "check",
      "--store",
      storeFile,
      "--config",
      "fixtures/budgets.json",
      "--now",
      "2026-10-09T12:00:00Z",
    ]);

    expect(result.status).not.toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/Budget check as of 2026-10-09T12:00:00\.000Z/);
  });
});

describe("cli keys create / list / revoke against a key file that does not exist yet", () => {
  let dir: string;
  let keyFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-cost-guardian-cli-keys-"));
    keyFile = join(dir, "api-keys.prod.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keys create bootstraps a fresh key file instead of crashing with ENOENT", () => {
    const result = runCli(["keys", "create", "--id", "key-fresh", "--team", "newteam", "--file", keyFile]);

    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Created key "key-fresh"/);

    const list = runCli(["keys", "list", "--file", keyFile]);
    expect(list.stdout).toMatch(/key-fresh/);
    expect(list.stdout).toMatch(/newteam/);
  });

  it("keys list prints an empty table instead of crashing with ENOENT", () => {
    const result = runCli(["keys", "list", "--file", keyFile]);

    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.status).toBe(0);
  });

  it("keys revoke reports no matching key instead of crashing with ENOENT", () => {
    const result = runCli(["keys", "revoke", "key-fresh", "--file", keyFile]);

    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no active key with id "key-fresh"/);
  });
});
