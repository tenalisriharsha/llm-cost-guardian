import { useEffect, useState } from "react";
import { ApiError, deleteBudget, getBudgetStatus, putBudget, type Connection } from "../lib/api.js";
import { alertToStatusRole, formatUsd, meterPercent } from "../lib/format.js";
import type { BudgetPeriod, BudgetStatus } from "../lib/types.js";

const PERIODS: BudgetPeriod[] = ["daily", "monthly"];

export function BudgetsPanel({ conn, onChanged }: { conn: Connection; onChanged: () => void }) {
  const [statuses, setStatuses] = useState<BudgetStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getBudgetStatus(conn)
      .then((res) => {
        if (!cancelled) setStatuses(res.statuses);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load budgets");
      });
    return () => {
      cancelled = true;
    };
  }, [conn, version]);

  function refresh() {
    setVersion((v) => v + 1);
    onChanged();
  }

  const byPeriod = new Map(statuses?.map((s) => [s.period, s]));

  return (
    <section className="card">
      <h2>Budgets</h2>
      <p className="card-sub">Soft/hard spend limits, evaluated against the current daily and monthly period.</p>
      {error && <p className="error-text">{error}</p>}
      {!error && (
        <div className="budgets-grid">
          {PERIODS.map((period) => (
            <BudgetCard key={period} conn={conn} period={period} status={byPeriod.get(period) ?? null} onChanged={refresh} />
          ))}
        </div>
      )}
    </section>
  );
}

function BudgetCard({
  conn,
  period,
  status,
  onChanged,
}: {
  conn: Connection;
  period: BudgetPeriod;
  status: BudgetStatus | null;
  onChanged: () => void;
}) {
  const [soft, setSoft] = useState(status ? String(status.softLimitUsd) : "");
  const [hard, setHard] = useState(status ? String(status.hardLimitUsd) : "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setSoft(status ? String(status.softLimitUsd) : "");
    setHard(status ? String(status.hardLimitUsd) : "");
  }, [status?.softLimitUsd, status?.hardLimitUsd]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const softLimitUsd = Number(soft);
    const hardLimitUsd = Number(hard);
    if (!Number.isFinite(softLimitUsd) || !Number.isFinite(hardLimitUsd) || softLimitUsd < 0 || hardLimitUsd < softLimitUsd) {
      setFormError("Hard limit must be >= soft limit >= 0");
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await putBudget(conn, period, { softLimitUsd, hardLimitUsd });
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to save budget");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteBudget(conn, period);
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to delete budget");
    } finally {
      setBusy(false);
    }
  }

  const role = status ? alertToStatusRole(status.alert) : "good";
  const percent = status ? meterPercent(status.spendUsd, status.hardLimitUsd) : 0;

  return (
    <div className="budget-card">
      <div className="budget-card-head">
        <span className="period">{period}</span>
        {status && (
          <span className={`status-pill ${role}`}>
            {role === "good" ? "OK" : role === "warning" ? "Soft limit" : "Hard breach"}
          </span>
        )}
      </div>

      {status ? (
        <>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{
                width: `${percent}%`,
                background: `var(--status-${role})`,
              }}
            />
          </div>
          <div className="meter-caption">
            <span>{formatUsd(status.spendUsd)} spent</span>
            <span>
              soft {formatUsd(status.softLimitUsd)} / hard {formatUsd(status.hardLimitUsd)}
            </span>
          </div>
        </>
      ) : (
        <p className="empty-state" style={{ padding: "4px 0" }}>
          No {period} budget configured.
        </p>
      )}

      <form className="budget-form" onSubmit={save}>
        <div>
          <label htmlFor={`${period}-soft`}>Soft $</label>
          <input id={`${period}-soft`} value={soft} onChange={(e) => setSoft(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label htmlFor={`${period}-hard`}>Hard $</label>
          <input id={`${period}-hard`} value={hard} onChange={(e) => setHard(e.target.value)} inputMode="decimal" />
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Save
        </button>
        {status && (
          <button className="btn" type="button" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </form>
      {formError && <p className="error-text">{formError}</p>}
    </div>
  );
}
