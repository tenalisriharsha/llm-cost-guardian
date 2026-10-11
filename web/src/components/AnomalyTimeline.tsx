import { useEffect, useState } from "react";
import { ApiError, getAnomalies, type Connection } from "../lib/api.js";
import { formatUsd, shortDateLabel } from "../lib/format.js";
import { linearScale, pointScale } from "../lib/scale.js";
import type { AnomalyResult } from "../lib/types.js";

const WIDTH = 760;
const HEIGHT = 220;
const PAD = { top: 20, right: 20, bottom: 32, left: 56 };

export function AnomalyTimeline({ conn, refreshToken }: { conn: Connection; refreshToken: number }) {
  const [results, setResults] = useState<AnomalyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getAnomalies(conn)
      .then((res) => {
        if (!cancelled) setResults(res.anomalies);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load anomalies");
      });
    return () => {
      cancelled = true;
    };
  }, [conn, refreshToken]);

  return (
    <section className="card">
      <h2>Spend anomalies</h2>
      <p className="card-sub">
        Daily spend vs. this team's own expanding-window baseline. Flagged days sit statistically far above normal.
        {results && results.length > 0 && (
          <button className="btn view-toggle" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </p>
      {error && <p className="error-text">{error}</p>}
      {!error && results && results.length === 0 && (
        <p className="empty-state">Not enough daily history yet to establish a baseline.</p>
      )}
      {!error && results && results.length > 0 && !showTable && <Chart results={results} />}
      {!error && results && results.length > 0 && showTable && <Table results={results} />}
    </section>
  );
}

function Chart({ results }: { results: AnomalyResult[] }) {
  const maxSpend = Math.max(...results.map((r) => Math.max(r.spendUsd, r.baselineMeanUsd + 2 * r.baselineStdDevUsd)), 0.01);
  const x = pointScale(results.length, [PAD.left, WIDTH - PAD.right]);
  const y = linearScale([0, maxSpend], [HEIGHT - PAD.bottom, PAD.top]);

  const linePoints = results.map((r, i) => `${x(i)},${y(r.spendUsd)}`).join(" ");
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => maxSpend * t);
  const labelEvery = Math.max(1, Math.ceil(results.length / 8));

  return (
    <>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Daily spend with anomalous days highlighted">
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10.5} fill="var(--text-muted)">
              {formatUsd(v)}
            </text>
          </g>
        ))}

        <polyline points={linePoints} fill="none" stroke="var(--series-1)" strokeWidth={2} />

        {results.map((r, i) => (
          <g key={r.bucketStart}>
            <circle
              cx={x(i)}
              cy={y(r.spendUsd)}
              r={r.isAnomalous ? 6 : 4}
              fill={r.isAnomalous ? "var(--status-critical)" : "var(--series-1)"}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            {r.isAnomalous && (
              <text x={x(i)} y={y(r.spendUsd) - 12} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--status-critical)">
                ANOMALY
              </text>
            )}
            {i % labelEvery === 0 && (
              <text x={x(i)} y={HEIGHT - PAD.bottom + 18} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">
                {shortDateLabel(r.bucketStart)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="anomaly-legend">
        <span className="marker" aria-hidden="true" /> flagged day (z-score over threshold)
      </div>
    </>
  );
}

function Table({ results }: { results: AnomalyResult[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Spend</th>
          <th>Baseline mean</th>
          <th>Z-score</th>
          <th>Flagged</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.bucketStart}>
            <td>{shortDateLabel(r.bucketStart)}</td>
            <td>{formatUsd(r.spendUsd)}</td>
            <td>{formatUsd(r.baselineMeanUsd)}</td>
            <td>{Number.isFinite(r.zScore) ? r.zScore.toFixed(2) : "∞"}</td>
            <td>{r.isAnomalous ? "yes" : "no"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
