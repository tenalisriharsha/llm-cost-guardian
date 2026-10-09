// Runs real CLI invocations against the built dist/ output, captures their actual
// stdout/stderr/exit code, and renders each as a screenshot of a terminal-window HTML
// template. Nothing here hand-edits, reorders, or rewords command output.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCREENSHOTS_DIR = join(ROOT, "docs", "screenshots");
const SPLIT_MARKER = "__LLM_COST_GUARDIAN_SCENE_SPLIT__";

rmSync(join(ROOT, "data"), { recursive: true, force: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

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
];

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(escaped) {
  return escaped
    .replace(/HARD BREACH/g, '<span class="bad">HARD BREACH</span>')
    .replace(/soft warning/g, '<span class="warn">soft warning</span>')
    .replace(/\bANOMALY\b/g, '<span class="bad">ANOMALY</span>')
    .replace(/^Rejected .+$/gm, (m) => `<span class="warn">${m}</span>`);
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

async function main() {
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
  rmSync(join(ROOT, "data"), { recursive: true, force: true });
}

main();
