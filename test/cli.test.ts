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
