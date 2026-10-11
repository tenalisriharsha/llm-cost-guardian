// Seeds a live API server with realistic data (anchored to the real current date, since budgets
// and anomaly detection are evaluated against wall-clock "now"), then drives the real built
// dashboard (web/dist, served by `vite preview`) in a headless browser to capture screenshots of
// every distinct view. Nothing here fabricates UI state outside of what the running app renders.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = join(ROOT, "web");
const SCREENSHOTS_DIR = join(ROOT, "docs", "screenshots");

const API_PORT = 4322;
const DASHBOARD_PORT = 5190;
const PLATFORM_KEY = "demo_platform_f3a1c9";
const GROWTH_KEY = "demo_growth_7b2e40";

function isoAt(dayOffset, hour, minute) {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCHours(hour, minute, 0, 0);
  return base.toISOString();
}

function makeRng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const PLATFORM_MODELS = [
  { model: "claude-opus-5-5", provider: "anthropic" },
  { model: "claude-sonnet-5-5", provider: "anthropic" },
  { model: "claude-haiku-4-5", provider: "anthropic" },
  { model: "gpt-4o", provider: "openai" },
  { model: "gpt-4o-mini", provider: "openai" },
];

function buildPlatformEvents() {
  const rng = makeRng(99);
  const events = [];
  for (const dayOffset of [-2, -1, 0]) {
    for (let i = 0; i < 24; i++) {
      const { model, provider } = PLATFORM_MODELS[Math.floor(rng() * PLATFORM_MODELS.length)];
      events.push({
        timestamp: isoAt(dayOffset, Math.floor(rng() * 23), Math.floor(rng() * 59)),
        provider,
        model,
        inputTokens: 300 + Math.floor(rng() * 2200),
        outputTokens: 80 + Math.floor(rng() * 900),
      });
    }
  }
  return events;
}

function buildGrowthEvents() {
  const rng = makeRng(7);
  const events = [];
  for (let dayOffset = -10; dayOffset <= 0; dayOffset++) {
    const isSpikeDay = dayOffset === 0;
    const calls = isSpikeDay ? 40 : 6 + Math.floor(rng() * 4);
    for (let i = 0; i < calls; i++) {
      events.push({
        timestamp: isoAt(dayOffset, Math.floor(rng() * 23), Math.floor(rng() * 59)),
        provider: "anthropic",
        model: isSpikeDay ? "claude-opus-5-5" : "claude-haiku-4-5",
        inputTokens: isSpikeDay ? 3000 + Math.floor(rng() * 2000) : 300 + Math.floor(rng() * 400),
        outputTokens: isSpikeDay ? 800 + Math.floor(rng() * 600) : 80 + Math.floor(rng() * 150),
      });
    }
  }
  return events;
}

async function postEvents(apiKey, events) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(events),
  });
  if (!res.ok) throw new Error(`seeding events failed: ${res.status}`);
  return res.json();
}

async function putBudget(apiKey, period, limits) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/budgets/${period}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(limits),
  });
  if (!res.ok) throw new Error(`setting budget failed: ${res.status}`);
  return res.json();
}

async function getBudgetStatus(apiKey) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/budgets/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.json();
}

async function waitForOk(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  throw new Error(`${url} never became healthy`);
}

async function main() {
  rmSync(join(ROOT, "data"), { recursive: true, force: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const apiServer = spawn("node", ["dist/api/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DB_PATH: "data/dashboard-demo.db",
      API_KEYS_FILE: "config/api-keys.json",
    },
    stdio: "ignore",
  });
  let dashboard;
  let browser;
  try {
    await waitForOk(`http://127.0.0.1:${API_PORT}/health`);

    await postEvents(PLATFORM_KEY, buildPlatformEvents());
    await postEvents(GROWTH_KEY, buildGrowthEvents());

    // Placeholder budgets just to read back real computed spend for the period, then re-set
    // thresholds relative to that real number so the demo lands on a hard breach (daily) and a
    // soft warning (monthly) without guessing at dollar amounts up front.
    await putBudget(PLATFORM_KEY, "daily", { softLimitUsd: 999, hardLimitUsd: 999 });
    await putBudget(PLATFORM_KEY, "monthly", { softLimitUsd: 999, hardLimitUsd: 999 });
    const { statuses } = await getBudgetStatus(PLATFORM_KEY);
    const dailySpend = statuses.find((s) => s.period === "daily").spendUsd;
    const monthlySpend = statuses.find((s) => s.period === "monthly").spendUsd;
    await putBudget(PLATFORM_KEY, "daily", {
      softLimitUsd: Math.max(0.01, Math.round(dailySpend * 0.5 * 100) / 100),
      hardLimitUsd: Math.max(0.02, Math.round(dailySpend * 0.8 * 100) / 100),
    });
    await putBudget(PLATFORM_KEY, "monthly", {
      softLimitUsd: Math.max(0.01, Math.round(monthlySpend * 0.9 * 100) / 100),
      hardLimitUsd: Math.max(0.02, Math.round(monthlySpend * 1.5 * 100) / 100),
    });

    dashboard = spawn(
      "npx",
      ["vite", "preview", "--host", "127.0.0.1", "--port", String(DASHBOARD_PORT), "--strictPort"],
      { cwd: WEB_ROOT, stdio: "ignore" },
    );
    await waitForOk(`http://127.0.0.1:${DASHBOARD_PORT}/`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: "light" });

    await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}/`);
    await page.getByLabel("API base URL").fill(`http://127.0.0.1:${API_PORT}`);

    // Scene 1: the connection gate, before any API key has been entered.
    await page.screenshot({ path: join(SCREENSHOTS_DIR, "10-dashboard-connect.png"), fullPage: true });

    await page.getByLabel("API key").fill(PLATFORM_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByText("platform", { exact: true }).waitFor();
    await page.getByText("Hard breach").waitFor();

    // Scene 2: full dashboard for the platform team — budgets (one hard breach, one soft
    // warning), cost attribution by model, and the anomaly section's genuine "not enough
    // history" empty state (platform only has 3 days of seeded data).
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, "11-dashboard-overview.png"), fullPage: true });

    // Scene 3: switch the attribution dimension and toggle to the table view.
    await page.getByRole("button", { name: "Provider" }).click();
    await page.getByRole("button", { name: "Show table" }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, "12-dashboard-attribution-table.png"), fullPage: true });

    // Scene 4: reconnect as the growth team to see a real flagged spend spike on the anomaly timeline.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByLabel("API base URL").fill(`http://127.0.0.1:${API_PORT}`);
    await page.getByLabel("API key").fill(GROWTH_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByText("ANOMALY").first().waitFor();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, "13-dashboard-anomaly.png"), fullPage: true });

    console.log("captured dashboard screenshots 10-13");
  } finally {
    if (browser) await browser.close();
    if (dashboard) dashboard.kill();
    apiServer.kill();
    rmSync(join(ROOT, "data"), { recursive: true, force: true });
  }
}

main();
