import { describe, expect, it } from "vitest";
import { Metrics } from "../../src/api/metrics.js";

describe("Metrics", () => {
  it("counts total requests and by status code", () => {
    const metrics = new Metrics();
    metrics.recordRequest(200);
    metrics.recordRequest(200);
    metrics.recordRequest(404);

    const text = metrics.toPrometheus();
    expect(text).toContain("llm_cost_guardian_requests_total 3");
    expect(text).toContain('llm_cost_guardian_requests_by_status_total{status="200"} 2');
    expect(text).toContain('llm_cost_guardian_requests_by_status_total{status="404"} 1');
  });

  it("counts rate limit rejections and auth failures", () => {
    const metrics = new Metrics();
    metrics.recordRateLimitRejection();
    metrics.recordRateLimitRejection();
    metrics.recordAuthFailure();

    const text = metrics.toPrometheus();
    expect(text).toContain("llm_cost_guardian_rate_limit_rejections_total 2");
    expect(text).toContain("llm_cost_guardian_auth_failures_total 1");
  });

  it("accumulates ingested events per team and ignores non-positive counts", () => {
    const metrics = new Metrics();
    metrics.recordEventsIngested("platform", 3);
    metrics.recordEventsIngested("platform", 2);
    metrics.recordEventsIngested("growth", 1);
    metrics.recordEventsIngested("growth", 0);

    const text = metrics.toPrometheus();
    expect(text).toContain('llm_cost_guardian_events_ingested_total{team="platform"} 5');
    expect(text).toContain('llm_cost_guardian_events_ingested_total{team="growth"} 1');
  });

  it("produces valid Prometheus text exposition format (HELP/TYPE precede each metric)", () => {
    const metrics = new Metrics();
    metrics.recordRequest(200);
    const lines = metrics.toPrometheus().trim().split("\n");
    expect(lines[0]).toMatch(/^# HELP /);
    expect(lines[1]).toMatch(/^# TYPE /);
  });
});
