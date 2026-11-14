import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface NpmAuditReport {
  vulnerabilities: Record<string, { severity: string; range: string }>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      total: number;
    };
  };
}

function runNpmAudit(): NpmAuditReport {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  // `npm audit` exits non-zero when it finds vulnerabilities, but it still
  // prints a valid JSON report on stdout in that case.
  expect(result.stdout, result.stderr).not.toEqual("");
  return JSON.parse(result.stdout) as NpmAuditReport;
}

describe("dependency audit", () => {
  it("reports no known vulnerabilities for the installed lockfile", () => {
    const report = runNpmAudit();

    expect(report.vulnerabilities).toEqual({});
    expect(report.metadata.vulnerabilities.total).toBe(0);
  }, 30_000);

  it("does not pin body-parser or qs inside their advised vulnerable ranges", () => {
    const report = runNpmAudit();

    expect(report.vulnerabilities["body-parser"]).toBeUndefined();
    expect(report.vulnerabilities.qs).toBeUndefined();
  }, 30_000);
});
