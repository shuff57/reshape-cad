// is there material above the top face (z = 6) of the hollowed prism with a cross bore? Asked of the engine directly, in the page.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json'); const { chromium } = require('playwright-core');
const ROOT = process.argv[2];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${srv.address().port}/host.html`);
await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
const out = await page.evaluate(async () => {
  const doc = { version: 1, features: [{ id: 'p1', kind: 'prism', sides: 5, radius: 12, height: 12, center: [0, 0, 0] }, { id: 's2', kind: 'shell', target: 'p1', thickness: 2, open: { cause: 'primitive', feature: 'p1', kind: 'face', part: '+z' } }, { id: 'h3', kind: 'hole', target: 's2', diameter: 6, depth: 40, center: [4, 0, 5], axis: 'x' }] };
  const base = (await window.__host.translateRaw(doc)).commandList; const B = window.__host.bridge; const res = [];
  const part = await B.execute(base, { fresh: true }); res.push({ what: 'the part', bodies: part.measure.bodies.map((b) => [b.name, b.volume_mm3, b.bbox]) });
  for (const [what, z0, z1] of [['cut away everything above z = 6', 6, 9], ['cut away everything above z = 6.004', 6.004, 9], ['control: cut away above z = 5 (the rim and part of the bore)', 5, 9], ['control: cut away above z = 5.9', 5.9, 9]]) {
    const cmds = [...base, { command: 'solid.box', params: { length: 60, width: 60, height: z1 - z0, center: [0, 0, (z0 + z1) / 2], body_name: 'slab' } }, { command: 'solid.combine', params: { target: part.measure.bodies[0].name, tools: ['slab'], operation: 'cut' } }];
    const r = await B.execute(cmds, { fresh: true });
    res.push({ what, ok: r.ok, failed: r.failed ? String(r.failed.error).slice(0, 140) : null, bodies: (r.measure?.bodies ?? []).map((b) => [b.name, b.volume_mm3, b.bbox && [b.bbox.min[2], b.bbox.max[2]]]) });
  }
  return res;
});
for (const r of out) console.log(JSON.stringify(r).slice(0, 420));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]); process.exit(0);
