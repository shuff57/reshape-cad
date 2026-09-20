#!/usr/bin/env node
// Playwright scenario recorder for the mouse-interaction-parity pipeline.
// Launches (or reuses an already-running) sandbox dev server, drives a
// named scenario module in a real Chromium session, and prints the
// resulting .webm path to stdout. Feeds scripts/fusion-video-parity.mjs
// for AI review.
//
// Usage: node scripts/parity-record.mjs <scenario-name>
//   Scenario modules live at scripts/parity-scenarios/<scenario-name>.mjs
//   and export `async function run(page)`. The recorder sets a Playwright
//   `baseURL` context option pointing at the dev server, so scenarios
//   navigate with relative paths, e.g. `await page.goto('/')`.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
// Private port convention from .omo/plans/mouse-parity-handover.md, so this
// script transparently reuses a dev server a prior QA session left running.
const DEV_SERVER_PORT = 5199;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const READY_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(url)) return;
    await sleep(300);
  }
  throw new Error(`[parity-record] dev server never became ready at ${url}`);
}

function stopDevServer(ownedProcess) {
  if (!ownedProcess || ownedProcess.pid == null) return;
  try {
    // Negative pid targets the whole detached process group (npm + vite),
    // matching this repo's setsid-detach/kill-by-pid convention.
    process.kill(-ownedProcess.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

async function ensureDevServer() {
  if (await isServerUp(DEV_SERVER_URL)) {
    console.error(`[parity-record] reusing running dev server at ${DEV_SERVER_URL}`);
    return { url: DEV_SERVER_URL, ownedProcess: null };
  }
  console.error(`[parity-record] starting dev server on port ${DEV_SERVER_PORT}`);
  const child = spawn(
    "npm",
    ["run", "dev", "-w", "@shuff57/reshape-sandbox-dev", "--", "--port", String(DEV_SERVER_PORT), "--strictPort"],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore" },
  );
  child.unref();
  try {
    await waitForServer(DEV_SERVER_URL, READY_TIMEOUT_MS);
  } catch (err) {
    stopDevServer(child);
    throw err;
  }
  return { url: DEV_SERVER_URL, ownedProcess: child };
}

async function loadScenario(name) {
  const scenarioPath = path.join(REPO_ROOT, "scripts", "parity-scenarios", `${name}.mjs`);
  if (!existsSync(scenarioPath)) {
    throw new Error(`[parity-record] scenario not found: ${scenarioPath}`);
  }
  const mod = await import(pathToFileURL(scenarioPath).href);
  if (typeof mod.run !== "function") {
    throw new Error(`[parity-record] ${scenarioPath} must export an async function run(page)`);
  }
  return mod.run;
}

async function main() {
  const [scenarioName] = process.argv.slice(2);
  if (!scenarioName) {
    console.error("Usage: node scripts/parity-record.mjs <scenario-name>");
    process.exit(1);
  }

  const run = await loadScenario(scenarioName);
  const devServer = await ensureDevServer();

  const recordDir = path.join(REPO_ROOT, ".omo/evidence/parity-recordings", scenarioName);
  mkdirSync(recordDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: devServer.url,
      recordVideo: { dir: recordDir, size: { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    const video = page.video();
    try {
      await run(page);
    } finally {
      await context.close();
    }
    console.log(await video.path());
  } finally {
    await browser.close();
    stopDevServer(devServer.ownedProcess);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
