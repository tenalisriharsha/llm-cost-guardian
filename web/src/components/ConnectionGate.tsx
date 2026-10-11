import { useState } from "react";
import { ApiError, whoAmI, type Connection } from "../lib/api.js";
import type { WhoAmI } from "../lib/types.js";

const STORAGE_KEY = "llm-cost-guardian:connection";

export function loadStoredConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Connection;
    if (typeof parsed.baseUrl === "string" && typeof parsed.apiKey === "string") return parsed;
  } catch {
    // ignore corrupt/missing storage
  }
  return null;
}

export function ConnectionGate({ onConnected }: { onConnected: (conn: Connection, who: WhoAmI) => void }) {
  const stored = loadStoredConnection();
  const [baseUrl, setBaseUrl] = useState(stored?.baseUrl ?? "http://localhost:4000");
  const [apiKey, setApiKey] = useState(stored?.apiKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    const conn: Connection = { baseUrl: baseUrl.trim().replace(/\/$/, ""), apiKey: apiKey.trim() };
    try {
      const who = await whoAmI(conn);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
      onConnected(conn, who);
    } catch (err) {
      setError(err instanceof ApiError ? `Could not authenticate (${err.status}): ${err.message}` : `Could not reach ${conn.baseUrl}`);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="gate card">
      <h2>Connect to LLM Cost Guardian</h2>
      <p className="card-sub">
        Point this dashboard at a running API server and one of its team API keys (see{" "}
        <code>config/api-keys.json</code>).
      </p>
      <form onSubmit={connect}>
        <div className="field">
          <label htmlFor="baseUrl">API base URL</label>
          <input
            id="baseUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:4000"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="demo_platform_f3a1c9"
            autoComplete="off"
          />
        </div>
        <button className="btn primary" type="submit" disabled={connecting || !apiKey.trim()}>
          {connecting ? "Connecting…" : "Connect"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
