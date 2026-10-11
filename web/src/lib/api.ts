import type { AnomalyResult, AttributionDimension, AttributionRow, BudgetConfig, BudgetStatus, WhoAmI } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Connection {
  baseUrl: string;
  apiKey: string;
}

async function request<T>(conn: Connection, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${conn.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.apiKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? `request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function whoAmI(conn: Connection): Promise<WhoAmI> {
  return request(conn, "/whoami");
}

export function getReport(conn: Connection, by: AttributionDimension): Promise<{ by: string; rows: AttributionRow[] }> {
  return request(conn, `/report?by=${by}`);
}

export function listBudgets(conn: Connection): Promise<{ budgets: BudgetConfig[] }> {
  return request(conn, "/budgets");
}

export function getBudgetStatus(conn: Connection): Promise<{ statuses: BudgetStatus[] }> {
  return request(conn, "/budgets/status");
}

export function putBudget(
  conn: Connection,
  period: "daily" | "monthly",
  limits: { softLimitUsd: number; hardLimitUsd: number },
): Promise<{ budget: BudgetConfig }> {
  return request(conn, `/budgets/${period}`, { method: "PUT", body: JSON.stringify(limits) });
}

export function deleteBudget(conn: Connection, period: "daily" | "monthly"): Promise<void> {
  return request(conn, `/budgets/${period}`, { method: "DELETE" });
}

export function getAnomalies(conn: Connection): Promise<{ anomalies: AnomalyResult[] }> {
  return request(conn, "/anomalies");
}
