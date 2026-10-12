import { describe, expect, it, vi } from "vitest";
import { formatSlackPayload, sendSlackAlerts } from "../src/integrations/slack.js";
import type { AlertEvent } from "../src/core/alerts.js";

const WARNING: AlertEvent = { kind: "budget", team: "platform", severity: "warning", summary: "platform is at 60%" };
const CRITICAL: AlertEvent = { kind: "anomaly", team: "growth", severity: "critical", summary: "growth spiked" };

describe("formatSlackPayload", () => {
  it("counts critical vs warning alerts in the header and includes every summary", () => {
    const { text } = formatSlackPayload([WARNING, CRITICAL]);
    expect(text).toContain("1 critical, 1 warning");
    expect(text).toContain("platform is at 60%");
    expect(text).toContain("growth spiked");
  });

  it("produces an empty-alert header when there are none", () => {
    const { text } = formatSlackPayload([]);
    expect(text).toContain("0 critical, 0 warning");
  });
});

describe("sendSlackAlerts", () => {
  it("skips the network call and reports sent:false when there are no alerts", async () => {
    const fetchImpl = vi.fn();
    const result = await sendSlackAlerts([], "https://hooks.slack.test/x", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ sent: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the formatted payload and reports sent:true on a 2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await sendSlackAlerts([WARNING], "https://hooks.slack.test/x", fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ sent: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/x");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(formatSlackPayload([WARNING]));
  });

  it("reports sent:false with the status on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await sendSlackAlerts([WARNING], "https://hooks.slack.test/x", fetchImpl as unknown as typeof fetch);
    expect(result.sent).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain("404");
  });

  it("reports sent:false with the error message when the request throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await sendSlackAlerts([WARNING], "https://hooks.slack.test/x", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ sent: false, error: "network down" });
  });
});
