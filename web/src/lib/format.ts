/** Formats a USD amount the way the CLI/API numbers are meant to be read: always 2+ decimals, no rounding surprises under a cent. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const abs = Math.abs(value);
  const decimals = abs > 0 && abs < 0.01 ? 4 : 2;
  const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** Percent of a budget limit consumed, clamped to [0, 100] so meter widths never overflow their track. */
export function meterPercent(spendUsd: number, limitUsd: number): number {
  if (limitUsd <= 0) return spendUsd > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (spendUsd / limitUsd) * 100));
}

export type StatusRole = "good" | "warning" | "critical";

export function alertToStatusRole(alert: "soft" | "hard" | null): StatusRole {
  if (alert === "hard") return "critical";
  if (alert === "soft") return "warning";
  return "good";
}

/** Short "Oct 5" label for a day/period-start bucket, used on chart axes where full ISO timestamps would collide. */
export function shortDateLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
