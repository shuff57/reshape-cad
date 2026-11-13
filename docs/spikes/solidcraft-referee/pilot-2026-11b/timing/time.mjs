// time.mjs <site> <out.json> <cases module>: each script in the real page with every bridge call timed (execute and topologyOf), and the probe log
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT, MOD] = process.argv.slice(2);
const { CASES } = await import(pathToFileURL(path.resolve(MOD)).href);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html${process.env.MEMO === "off" ? "?memo=off" : ""}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = [];
for (const t of CASES) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 }); page.setDefaultTimeout(900000);
  const r = await page.evaluate(async (s) => {
    const calls = []; const b = window.__host.bridge;
    for (const name of ['execute', 'topologyOf']) { const inner = b[name].bind(b); b[name] = async (cmds, opts) => { const t0 = performance.now(); const res = await inner(cmds, opts); calls.push({ name, n: cmds.length, last: cmds.at(-1)?.command, params: JSON.stringify(cmds.at(-1)?.params ?? {}).slice(0, 160), hash: cmds.map((c) => c.command + JSON.stringify(c.params ?? {})).join('|').length + ':' + cmds.map((c) => c.command).join(','), budgetS: opts?.budgetS ?? null, ms: Math.round(performance.now() - t0), ok: !!res?.ok, timedOut: !!res?.timedOut, cpuMs: res?.cpuMs ?? null }); return res; }; }
    const p0 = window.__host.probeLog.length; const t0 = performance.now(); window.__host.setScript(s); const sum = await window.__host.run({ confirmed: true });
    return { wallMs: Math.round(performance.now() - t0), status: document.getElementById('status').innerText, volume: sum?.volume, steps: (sum?.features ?? []).map((f) => [f.id, f.kind, f.status, f.guard ?? null]), calls,
      probes: window.__host.probeLog.slice(p0).map((p) => ({ cmds: p.cmds, last: p.last, budgetS: p.budgetS, status: p.status, wallMs: p.wallMs, cpuMs: p.cpuMs, loadMs: p.loadMs })) };
  }, t.script);
  out.push({ id: t.id, script: t.script, ...r }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const ex = r.calls.filter((c) => c.name === 'execute'), tp = r.calls.filter((c) => c.name === 'topologyOf');
  console.log(t.id.padEnd(30), 'wall', String(r.wallMs).padStart(6), 'ms | execute', ex.length, 'calls', ex.reduce((a, c) => a + c.ms, 0), 'ms | topologyOf', tp.length, 'calls', tp.reduce((a, c) => a + c.ms, 0), 'ms | probes', r.probes.length, 'wall', r.probes.reduce((a, p) => a + (p.wallMs ?? 0), 0), 'cpu', r.probes.reduce((a, p) => a + (p.cpuMs ?? 0), 0), 'load', r.probes.reduce((a, p) => a + (p.loadMs ?? 0), 0), '|', r.status);
  await page.close();
}
await browser.close(); srv.close();
