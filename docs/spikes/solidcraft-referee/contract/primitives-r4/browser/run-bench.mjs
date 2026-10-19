// SPIKE, referee only (round 4). Drives bench.html in headless Chromium through playwright-cli (session primwk, closed at the end), collects one JSON line per case.
//   PKG_WEB=<wasm-bindgen --target web dir> CMDS=<capture-cmds output> bun run-bench.mjs <out.json> [workdir]
// The playwright-cli snapshot files go to <workdir> (default: a temp dir), never into the repo.
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const out = path.resolve(process.argv[2]); const work = process.argv[3] ?? mkdtempSync(path.join(os.tmpdir(), 'pwbench-')); mkdirSync(work, { recursive: true });
const port = 8793;
const srv = Bun.spawn(['bun', path.join(import.meta.dir, 'serve.mjs'), String(port)], { env: process.env, stdout: 'inherit', stderr: 'inherit' });
await Bun.sleep(1500);
const pw = async (...a) => { const p = Bun.spawn(['playwright-cli', '-s=primwk', ...a], { cwd: work, stdout: 'pipe', stderr: 'pipe' }); const t = await new Response(p.stdout).text(); await p.exited; return t; };
const evalJson = async (js) => { const t = await pw('eval', js); const m = /### Result\n([^\n]*)/.exec(t); if (!m) return { error: t.slice(0, 400) }; try { return JSON.parse(JSON.parse(m[1])); } catch { return { error: m[1].slice(0, 400) }; } };
const rows = [];
const push = (r) => { rows.push({ ...r, load: os.loadavg()[0] }); console.log(JSON.stringify(rows[rows.length - 1])); writeFileSync(out, JSON.stringify(rows, null, 1)); };
try {
  await pw('open', `http://127.0.0.1:${port}/`);
  const env = await evalJson('async () => { await new Promise(r=>setTimeout(r,300)); return JSON.stringify({ ua: navigator.userAgent, cores: navigator.hardwareConcurrency, names: window.names }); }');
  push({ env }); const names = env.names ?? [];
  // worker, no budget: all cases, twice (the first call also compiles the 23 MB wasm in the worker)
  for (const n of names) push(await evalJson(`async () => JSON.stringify(await window.benchWorker(${JSON.stringify(n)}, 0))`));
  // budget: the slowest cases with a budget that is too short -> terminate, then the page must still work and a fresh worker must serve the next call
  for (const n of ['ring', 'cylinder-corner']) {
    if (!names.includes(n)) continue;
    push(await evalJson(`async () => JSON.stringify(await window.benchWorker(${JSON.stringify(n)}, 2000))`));
    push(await evalJson(`async () => JSON.stringify(await window.benchWorker('box', 0))`));
  }
  push({ sentence: await evalJson(`async () => JSON.stringify(window.sentenceFor('ring(40, 10)', 2))`).catch(() => null) });
  // main thread LAST (it freezes the page): a cheap one, a medium one, then the ring
  for (const n of ['box', 'cylinder', 'sphere', 'cylinder-corner', 'ring']) if (names.includes(n)) push(await evalJson(`async () => JSON.stringify(await window.benchMain(${JSON.stringify(n)}))`));
} finally {
  await pw('close'); srv.kill();
}
console.log('wrote', out);
