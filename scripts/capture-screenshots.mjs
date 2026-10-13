// Runs real CLI invocations against the built dist/ output, captures their actual
// stdout/stderr/exit code, and renders each as a screenshot of a terminal-window HTML
// template. Nothing here hand-edits, reorders, or rewords command output.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCREENSHOTS_DIR = join(ROOT, "docs", "screenshots");
const SPLIT_MARKER = "__LLM_COST_GUARDIAN_SCENE_SPLIT__";

const API_PORT = 4321;
const SLACK_PORT = 4322;
const API_KEY = "demo_platform_f3a1c9"; // from config/api-keys.json (platform team, demo-only key)
const GROWTH_KEY = "demo_growth_7b2e40"; // growth team, demo-only key
const ADMIN_KEY = "demo_admin_8f12a0"; // admin role, demo-only key
const TODAY = new Date().toISOString().slice(0, 10); // so the budget-status scene sees today's spend

rmSync(join(ROOT, "data"), { recursive: true, force: true });
mkdirSync(join(ROOT, "data"), { recursive: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });
// A scratch copy so the `keys create`/`keys revoke` scenes mutate something disposable, not the
// real committed config/api-keys.json the live API server (and every other scene) authenticates
// against.
copyFileSync(join(ROOT, "config", "api-keys.json"), join(ROOT, "data", "api-keys-scratch.json"));

// Each scene is a sequence of real commands run once, in order, in a single bash -c
// invocation (so a `captureExit` command's `echo $?` reflects the true exit status of
// the command immediately before it).
const SCENES = [
  {
    file: "01-cli-help.png",
    commands: [{ cmd: "node dist/cli/index.js --help" }],
  },
  {
    file: "02-ingest-success.png",
    commands: [{ cmd: "node dist/cli/index.js ingest fixtures/sample-events.jsonl --store data/events.jsonl" }],
  },
  {
    file: "03-ingest-validation-errors.png",
    commands: [
      { cmd: "node dist/cli/index.js ingest fixtures/events-with-errors.jsonl --store data/events-errors.jsonl" },
    ],
  },
  {
    file: "04-report-by-team.png",
    commands: [{ cmd: "node dist/cli/index.js report --store data/events.jsonl --by team" }],
  },
  {
    file: "05-budget-check.png",
    commands: [
      {
        cmd: "node dist/cli/index.js budget check --store data/events.jsonl --config fixtures/budgets.json --now 2026-10-09T23:00:00Z",
        captureExit: true,
      },
    ],
  },
  {
    file: "06-anomaly-scan.png",
    commands: [
      { cmd: "node dist/cli/index.js ingest fixtures/anomaly-events.jsonl --store data/events-anomaly.jsonl" },
      { cmd: "node dist/cli/index.js anomaly scan --store data/events-anomaly.jsonl", captureExit: true },
    ],
  },
  {
    file: "07-api-ingest-events.png",
    commands: [
      {
        cmd:
          `curl -s -X POST http://localhost:${API_PORT}/events ` +
          `-H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" ` +
          `-d '[{"timestamp":"${TODAY}T09:00:00.000Z","provider":"anthropic","model":"claude-opus-5-5","inputTokens":4200,"outputTokens":1800},` +
          `{"timestamp":"${TODAY}T10:15:00.000Z","provider":"openai","model":"gpt-4o-mini","inputTokens":900,"outputTokens":400},` +
          `{"timestamp":"${TODAY}T11:00:00.000Z","team":"growth","provider":"openai","model":"gpt-4o-mini","inputTokens":100,"outputTokens":50}]' | jq .`,
      },
    ],
  },
  {
    file: "08-api-report-by-model.png",
    commands: [
      {
        cmd: `curl -s "http://localhost:${API_PORT}/report?by=model" -H "Authorization: Bearer ${API_KEY}" | jq .`,
      },
    ],
  },
  {
    file: "09-api-budget-status.png",
    commands: [
      {
        cmd:
          `curl -s -X PUT http://localhost:${API_PORT}/budgets/daily ` +
          `-H "Authorization: Bearer ${API_KEY}" -H "Content-Type: application/json" ` +
          `-d '{"softLimitUsd":0.01,"hardLimitUsd":0.05}' | jq .`,
      },
      {
        cmd: `curl -s http://localhost:${API_PORT}/budgets/status -H "Authorization: Bearer ${API_KEY}" | jq .`,
      },
    ],
  },
  {
    file: "16-keys-create-and-list.png",
    commands: [
      {
        cmd: "node dist/cli/index.js keys create --id key-staging-01 --team staging --file data/api-keys-scratch.json",
      },
      { cmd: "node dist/cli/index.js keys list --file data/api-keys-scratch.json" },
    ],
  },
  {
    file: "17-keys-revoke.png",
    commands: [
      { cmd: "node dist/cli/index.js keys revoke key-staging-01 --file data/api-keys-scratch.json" },
      { cmd: "node dist/cli/index.js keys list --file data/api-keys-scratch.json" },
    ],
  },
  {
    file: "18-admin-cross-team-report.png",
    commands: [
      {
        cmd:
          `curl -s -X POST http://localhost:${API_PORT}/events ` +
          `-H "Authorization: Bearer ${GROWTH_KEY}" -H "Content-Type: application/json" ` +
          `-d '[{"timestamp":"${TODAY}T09:30:00.000Z","provider":"openai","model":"gpt-4o-mini","inputTokens":600,"outputTokens":250}]' | jq .`,
      },
      {
        cmd: `curl -s "http://localhost:${API_PORT}/report?by=model&team=growth" -H "Authorization: Bearer ${ADMIN_KEY}" | jq .`,
      },
      {
        cmd: `curl -s "http://localhost:${API_PORT}/report?by=model&team=growth" -H "Authorization: Bearer ${API_KEY}" | jq .`,
      },
    ],
  },
  {
    file: "19-api-metrics.png",
    commands: [{ cmd: `curl -s http://localhost:${API_PORT}/metrics` }],
  },
  {
    file: "14-alert-check-clean.png",
    commands: [
      { cmd: "node dist/cli/index.js ingest fixtures/clean-events.jsonl --store data/events-clean.jsonl" },
      {
        cmd:
          "node dist/cli/index.js alert check --store data/events-clean.jsonl --config fixtures/budgets.json " +
          "--now 2026-10-09T12:00:00Z",
        captureExit: true,
      },
    ],
  },
  {
    file: "15-alert-check-slack.png",
    commands: [
      { cmd: "node dist/cli/index.js ingest fixtures/anomaly-events.jsonl --store data/events-alert.jsonl" },
      {
        cmd:
          "node dist/cli/index.js alert check --store data/events-alert.jsonl --config fixtures/budgets.json " +
          `--now 2026-10-01T12:00:00Z --slack-webhook http://localhost:${SLACK_PORT}/webhook`,
        captureExit: true,
      },
    ],
  },
];

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(escaped) {
  return escaped
    .replace(/HARD BREACH/g, '<span class="bad">HARD BREACH</span>')
    .replace(/soft warning/g, '<span class="warn">soft warning</span>')
    .replace(/\bANOMALY\b/g, '<span class="bad">ANOMALY</span>')
    .replace(/\[CRITICAL\]/g, '<span class="bad">[CRITICAL]</span>')
    .replace(/\[WARNING\]/g, '<span class="warn">[WARNING]</span>')
    .replace(/^Rejected .+$/gm, (m) => `<span class="warn">${m}</span>`)
    .replace(/\brevoked\b/g, '<span class="warn">revoked</span>');
}

/** Runs every command in the scene exactly once, in one shell, and returns per-command output/exit. */
function runScene(scene) {
  const scriptParts = [];
  scene.commands.forEach((entry, i) => {
    if (i > 0) scriptParts.push(`echo "${SPLIT_MARKER}"`);
    scriptParts.push(entry.cmd);
    if (entry.captureExit) {
      scriptParts.push('echo "$?"');
    }
  });
  const script = scriptParts.join(" ; ");

  const result = spawnSync("bash", ["-c", script], { cwd: ROOT, encoding: "utf8" });
  const segments = result.stdout.split(`${SPLIT_MARKER}\n`);

  return scene.commands.map((entry, i) => {
    let segment = (segments[i] ?? "").replace(/\s+$/, "");
    let exitCode;
    if (entry.captureExit) {
      const lines = segment.split("\n");
      exitCode = lines.pop();
      segment = lines.join("\n").replace(/\s+$/, "");
    }
    return { command: entry.cmd, output: segment, exitCode };
  });
}

function sceneToHtml(scene) {
  const turns = runScene(scene);
  let body = "";

  for (const { command, output, exitCode } of turns) {
    body += `<div class="line"><span class="prompt">$</span> <span class="cmd">${escapeHtml(command)}</span></div>`;
    if (output.length > 0) {
      body += `<div class="output">${highlight(escapeHtml(output))}</div>`;
    }
    if (exitCode !== undefined) {
      body += `<div class="spacer"></div>`;
      body += `<div class="line"><span class="prompt">$</span> <span class="cmd">echo $?</span></div>`;
      body += `<div class="output">${escapeHtml(exitCode)}</div>`;
    }
    body += `<div class="spacer"></div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; }
  .window {
    width: 980px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0,0,0,0.55);
    font-family: "SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace;
    border: 1px solid #30363d;
  }
  .titlebar {
    background: #161b22;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #21262d;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red { background: #ff5f56; }
  .dot.yellow { background: #ffbd2e; }
  .dot.green { background: #27c93f; }
  .titletext { color: #8b949e; font-size: 12px; margin-left: 10px; }
  .body {
    background: #0d1117;
    padding: 22px 26px 26px;
    color: #c9d1d9;
    font-size: 13.5px;
    line-height: 1.65;
  }
  .line { color: #e6edf3; white-space: pre-wrap; word-break: break-word; }
  .prompt { color: #3fb950; font-weight: 600; }
  .cmd { color: #79c0ff; }
  .output { color: #c9d1d9; white-space: pre; margin: 4px 0 0; }
  .spacer { height: 14px; }
  .bad { color: #ff7b72; font-weight: 600; }
  .warn { color: #d29922; font-weight: 600; }
</style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div>
      <div class="titletext">llm-cost-guardian — bash</div>
    </div>
    <div class="body">${body}</div>
  </div>
</body>
</html>`;
}

async function waitForHealth(url, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await sleep(100);
  }
  throw new Error(`API server did not become healthy at ${url}`);
}

async function main() {
  const apiServer = spawn("node", ["dist/api/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DB_PATH: "data/api-demo.db",
      API_KEYS_FILE: "config/api-keys.json",
    },
    stdio: "ignore",
  });
  await waitForHealth(`http://127.0.0.1:${API_PORT}/health`);

  // Runs as its own OS process, not in-process: a scene's synchronous spawnSync call blocks
  // this orchestrator's event loop, so an in-process mock server would never get to answer.
  const slackServer = spawn("node", ["scripts/mock-slack-server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SLACK_PORT) },
    stdio: "ignore",
  });
  await waitForHealth(`http://127.0.0.1:${SLACK_PORT}/health`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  for (const scene of SCENES) {
    const html = sceneToHtml(scene);
    const htmlPath = join(SCREENSHOTS_DIR, `_tmp-${scene.file}.html`);
    writeFileSync(htmlPath, html, "utf8");
    await page.goto(`file://${htmlPath}`);
    await page.locator(".window").screenshot({ path: join(SCREENSHOTS_DIR, scene.file) });
    rmSync(htmlPath);
    console.log(`captured ${scene.file}`);
  }

  await browser.close();
  apiServer.kill();
  slackServer.kill();
  rmSync(join(ROOT, "data"), { recursive: true, force: true });
}

main();
