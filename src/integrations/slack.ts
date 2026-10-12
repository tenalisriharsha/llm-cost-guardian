import type { AlertEvent } from "../core/alerts.js";

const SEVERITY_EMOJI: Record<AlertEvent["severity"], string> = {
  warning: "⚠️",
  critical: "🚨",
};

/** Builds a Slack incoming-webhook payload (plain `text`, which Slack also renders from a generic JSON POST). */
export function formatSlackPayload(alerts: AlertEvent[]): { text: string } {
  const hardCount = alerts.filter((a) => a.severity === "critical").length;
  const softCount = alerts.length - hardCount;
  const header = `*llm-cost-guardian*: ${hardCount} critical, ${softCount} warning alert(s)`;
  const lines = alerts.map((alert) => `${SEVERITY_EMOJI[alert.severity]} [${alert.kind}] ${alert.summary}`);
  return { text: [header, ...lines].join("\n") };
}

export interface SendSlackAlertsResult {
  sent: boolean;
  status?: number;
  error?: string;
}

/**
 * Posts alerts to a Slack incoming-webhook URL. Sends nothing (and reports `sent: false`
 * with no error) when there are no alerts, so a clean check never spams the channel.
 */
export async function sendSlackAlerts(
  alerts: AlertEvent[],
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendSlackAlertsResult> {
  if (alerts.length === 0) return { sent: false };

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formatSlackPayload(alerts)),
    });
    if (!response.ok) {
      return { sent: false, status: response.status, error: `webhook responded ${response.status}` };
    }
    return { sent: true, status: response.status };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
