import { useEffect, useState } from "react";
import { ApiError, getReport, type Connection } from "../lib/api.js";
import { categoricalSlot } from "../lib/palette.js";
import { barWidthPercent } from "../lib/scale.js";
import type { AttributionDimension, AttributionRow } from "../lib/types.js";
import { formatTokens, formatUsd } from "../lib/format.js";

const DIMENSIONS: Array<{ key: AttributionDimension; label: string }> = [
  { key: "model", label: "Model" },
  { key: "provider", label: "Provider" },
  { key: "apiKeyId", label: "API key" },
  { key: "team", label: "Team" },
];

export function AttributionChart({ conn, refreshToken }: { conn: Connection; refreshToken: number }) {
  const [dimension, setDimension] = useState<AttributionDimension>("model");
  const [rows, setRows] = useState<AttributionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getReport(conn, dimension)
      .then((res) => {
        if (!cancelled) setRows([...res.rows].sort((a, b) => b.spendUsd - a.spendUsd));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load report");
      });
    return () => {
      cancelled = true;
    };
  }, [conn, dimension, refreshToken]);

  const max = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.spendUsd)) : 0;

  return (
    <section className="card">
      <h2>Cost attribution</h2>
      <p className="card-sub">
        Spend across your own team's events, grouped by {dimension === "apiKeyId" ? "API key" : dimension}.
        <button className="btn view-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </p>
      <div className="tabs">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            className={`tab ${dimension === d.key ? "active" : ""}`}
            onClick={() => setDimension(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}
      {!error && rows && rows.length === 0 && <p className="empty-state">No events yet for this team.</p>}

      {!error && rows && rows.length > 0 && !showTable && (
        <div role="img" aria-label={`Spend by ${dimension}, largest first`}>
          {rows.map((row, i) => {
            const color = categoricalSlot(i);
            return (
              <div className="bar-row" key={row.key}>
                <span className="bar-label" title={row.key}>
                  {row.key}
                </span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${barWidthPercent(row.spendUsd, max)}%`,
                      background: `light-dark(${color.light}, ${color.dark})`,
                    }}
                  />
                </div>
                <span className="bar-value">{formatUsd(row.spendUsd)}</span>
              </div>
            );
          })}
        </div>
      )}

      {!error && rows && rows.length > 0 && showTable && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{dimension === "apiKeyId" ? "API key" : dimension}</th>
              <th>Spend</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{formatUsd(row.spendUsd)}</td>
                <td>{formatTokens(row.inputTokens)}</td>
                <td>{formatTokens(row.outputTokens)}</td>
                <td>{row.eventCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
