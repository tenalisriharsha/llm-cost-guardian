/** In-memory counters exposed at `GET /metrics` in Prometheus text exposition format. Process-
 * local and reset on restart — enough for a single-instance deployment to be scrapeable; a
 * multi-instance deployment would need a shared backend instead, which is out of scope here. */
export class Metrics {
  private requestsTotal = 0;
  private readonly requestsByStatus = new Map<number, number>();
  private rateLimitRejections = 0;
  private authFailures = 0;
  private readonly eventsIngestedByTeam = new Map<string, number>();

  recordRequest(statusCode: number): void {
    this.requestsTotal += 1;
    this.requestsByStatus.set(statusCode, (this.requestsByStatus.get(statusCode) ?? 0) + 1);
  }

  recordRateLimitRejection(): void {
    this.rateLimitRejections += 1;
  }

  recordAuthFailure(): void {
    this.authFailures += 1;
  }

  recordEventsIngested(team: string, count: number): void {
    if (count <= 0) return;
    this.eventsIngestedByTeam.set(team, (this.eventsIngestedByTeam.get(team) ?? 0) + count);
  }

  toPrometheus(): string {
    const lines: string[] = [];

    lines.push("# HELP llm_cost_guardian_requests_total Total HTTP requests handled.");
    lines.push("# TYPE llm_cost_guardian_requests_total counter");
    lines.push(`llm_cost_guardian_requests_total ${this.requestsTotal}`);

    lines.push("# HELP llm_cost_guardian_requests_by_status_total HTTP requests handled, by status code.");
    lines.push("# TYPE llm_cost_guardian_requests_by_status_total counter");
    for (const [status, count] of [...this.requestsByStatus.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`llm_cost_guardian_requests_by_status_total{status="${status}"} ${count}`);
    }

    lines.push("# HELP llm_cost_guardian_rate_limit_rejections_total Requests rejected by the rate limiter.");
    lines.push("# TYPE llm_cost_guardian_rate_limit_rejections_total counter");
    lines.push(`llm_cost_guardian_rate_limit_rejections_total ${this.rateLimitRejections}`);

    lines.push("# HELP llm_cost_guardian_auth_failures_total Requests rejected for a missing or invalid API key.");
    lines.push("# TYPE llm_cost_guardian_auth_failures_total counter");
    lines.push(`llm_cost_guardian_auth_failures_total ${this.authFailures}`);

    lines.push("# HELP llm_cost_guardian_events_ingested_total Usage events accepted via POST /events, by team.");
    lines.push("# TYPE llm_cost_guardian_events_ingested_total counter");
    for (const [team, count] of [...this.eventsIngestedByTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`llm_cost_guardian_events_ingested_total{team="${team}"} ${count}`);
    }

    return `${lines.join("\n")}\n`;
  }
}
