// Live check of the SCRIPT PANE against the real SolidCraft web build, in headless Chrome (see test/live.mjs for how to set up the folder; it also needs pane/ and `sh pane/build.sh`).
// Measured 2026-10-25 on v0.21.0: cuboid(40,30,10) + hole(across 6) typed in the pane builds 11717.30 mm3 (closed form 11717.26). A second run onto a changed design asks before replacing it.
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
  const run = async (script) => { await page.evaluate((c) => { const t = document.getElementById('src'); t.value = c; t.dispatchEvent(new Event('input')); document.getElementById('run').click(); }, script);
    await page.waitForFunction(() => /^(built|built with|cancelled|error|refused)/i.test(document.getElementById('status').textContent) , null, { timeout: 90000 }).catch(() => {});
    return page.evaluate(() => ({ status: document.getElementById('status').textContent, verdict: document.getElementById('verdict').textContent.slice(0, 300), features: document.getElementById('features').innerText.slice(0, 500), confirm: !document.getElementById('confirm').hidden })); };
  out.panePresent = await page.evaluate(() => !!document.getElementById('scp'));
  out.hole = await run("const b = cuboid(40, 30, 10)\nhole(b, { across: 6 })");
  out.volHole = await page.evaluate(async () => (await document.getElementById('sc').contentWindow.solidcraft.inspect({ measure: true })).bodies.map((b) => [b.name, b.volume_mm3]));
  out.union = await run("const base = cuboid(40, 40, 10, { at: [0, 0, 5] })\nconst post = cylinder(6, 20, { at: [0, 0, 10] })\nunion(base, post)");
  out.vol = await page.evaluate(async () => (await document.getElementById('sc').contentWindow.solidcraft.inspect({ measure: true })).bodies.map((b) => [b.name, b.volume_mm3]));
}
out.logs = logs.slice(0, 8);
console.log(JSON.stringify(out, (k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v), 1).slice(0, 4000));
await page.screenshot({ path: process.argv[3] });
await browser.close(); srv.close();
