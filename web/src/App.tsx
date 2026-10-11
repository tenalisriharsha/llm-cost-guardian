import { useState } from "react";
import { ConnectionGate } from "./components/ConnectionGate.js";
import { AttributionChart } from "./components/AttributionChart.js";
import { BudgetsPanel } from "./components/BudgetsPanel.js";
import { AnomalyTimeline } from "./components/AnomalyTimeline.js";
import type { Connection } from "./lib/api.js";
import type { WhoAmI } from "./lib/types.js";

export function App() {
  const [session, setSession] = useState<{ conn: Connection; who: WhoAmI } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  if (!session) {
    return (
      <div className="app">
        <ConnectionGate onConnected={(conn, who) => setSession({ conn, who })} />
      </div>
    );
  }

  const { conn, who } = session;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>LLM Cost Guardian</h1>
          <p>Cost attribution, budgets, and spend anomalies for your team.</p>
        </div>
        <div className="connection-bar">
          <span className="team-badge">{who.team}</span>
          <button className="btn" onClick={() => setRefreshToken((t) => t + 1)}>
            Refresh
          </button>
          <button
            className="btn"
            onClick={() => {
              localStorage.removeItem("llm-cost-guardian:connection");
              setSession(null);
            }}
          >
            Disconnect
          </button>
        </div>
      </header>

      <BudgetsPanel conn={conn} onChanged={() => setRefreshToken((t) => t + 1)} />
      <AttributionChart conn={conn} refreshToken={refreshToken} />
      <AnomalyTimeline conn={conn} refreshToken={refreshToken} />
    </div>
  );
}
