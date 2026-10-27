// Runs every example of pane/examples.json through the pane in headless Chrome against the real SolidCraft web build (setup as in test/live.mjs).
//   node test/live-examples.mjs <site folder> <screenshot.png> <out.json>
// Result of 2026-10-25 on SolidCraft v0.21.0 is in test/examples-0.21.0.json: 38 of 56 passed (before the topology adapter; now 46, see README) against the independent references (closed form / brep-rs / OCCT); the 18 that do not are all refusals, see README.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const ROOT = process.argv[2];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200))); page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 200)));
await page.goto(url);
const out = { url };
try {
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft; }, null, { timeout: 90000 });
  out.apiUp = true;
} catch (e) { out.apiUp = false; out.err = String(e).slice(0, 200); }
if (out.apiUp) {
  const ids = await page.evaluate(() => window.__host.EXAMPLES.map((e) => [e.id, e.group]));
  out.rows = [];
  for (const [id, group] of ids) {
    const r = await Promise.race([
      page.evaluate((i) => window.__host.runExample(i).then((s) => ({ pass: s && s.pass, verdict: s && s.verdict, refusals: s && s.refusals, volume: s && s.volume, cancelled: s && s.cancelled })), id),
      new Promise((res) => setTimeout(() => res({ timeout: true }), 60000)),
    ]).catch((e) => ({ error: String(e).slice(0, 150) }));
    out.rows.push({ id, group, ...r });
    fs.writeFileSync(process.argv[4], JSON.stringify(out.rows, null, 1));
    if (r.timeout) break;
  }
}
out.logs = logs.slice(0, 8);
console.log(JSON.stringify(out, (k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v), 1).slice(0, 4000));
await page.screenshot({ path: process.argv[3] });
await browser.close(); srv.close();
