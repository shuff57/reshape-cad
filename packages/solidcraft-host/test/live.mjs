// Live check against the real SolidCraft web build, in real Chrome (headless). Not part of `npm test`: needs the build.
//   1. build it:  cd <solidcraft v0.21.0>/apps/solidcraft-web && trunk build --release   (about 20 min, ~8 GB)
//   2. make a folder with host.html, src/ and a symlink `solidcraft` -> that dist/web
//   3. node test/live.mjs <folder> <screenshot.png>      (needs /usr/bin/google-chrome and the repo's playwright-core)
// Measured 2026-10-25 on v0.21.0: window.solidcraft comes up; file.export and a raw request are refused by the allowlist; solid.box builds (area 2200, bbox 30x20x10); inspect measures it; the lock overlay shows.
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
  const call = (msg) => page.evaluate((m) => new Promise((res) => { const h = (ev) => { if (ev.data && ev.data.id === m.id && ev.data.ok !== undefined) { removeEventListener('message', h); res(ev.data); } }; addEventListener('message', h); postMessage(m, location.origin); }), msg);
  out.disallowed = await call({ id: 'a', op: 'execute', command: 'file.export' });
  out.rawRequest = await call({ id: 'b', op: 'request', method: 'ui.set' });
  out.box = await call({ id: 'c', op: 'execute', command: 'solid.box', params: { length: 30, width: 20, height: 10, body_name: 'host test box' } });
  out.inspect = await call({ id: 'd', op: 'inspect', measure: true });
  out.undo = await call({ id: 'e', op: 'execute', command: 'edit.undo' });
}
out.lockHiddenAfterOn = await page.evaluate(() => { postMessage({ type: 'lock', on: true }, location.origin); return new Promise((r) => setTimeout(() => r(document.getElementById('lock').hidden), 300)); });
out.logs = logs.slice(0, 8);
console.log(JSON.stringify(out, (k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v), 1).slice(0, 4000));
await page.screenshot({ path: process.argv[3] });
await browser.close(); srv.close();
