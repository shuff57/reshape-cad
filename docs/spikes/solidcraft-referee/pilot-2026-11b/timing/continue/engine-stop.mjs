// hang.mjs <site> <cases.json> <id prefix> <limit s>: one doc in the real page, every bridge call announced when it STARTS and when it ends, so the call that
// never comes back is the last line. The probe log (the worker's runs) is printed too.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json'); const { chromium } = require('playwright-core');
const [ROOT, CASES, ID, LIMIT] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(CASES, 'utf8')).find((x) => x.id.startsWith(ID));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage(); const t0 = Date.now();
page.on('console', (m) => { const s = m.text(); const at = ((Date.now() - t0) / 1000).toFixed(1).padStart(7); if (s.startsWith('@@')) console.log(at, s.slice(2)); else if (m.type() === 'error' || /panic|unreachable|RuntimeError|abort/i.test(s)) console.log(at, `[${m.type()}]`, s.slice(0, 600)); });
page.on('pageerror', (e) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(7), '[pageerror]', String(e && e.stack || e).slice(0, 900)));
await page.goto(`http://127.0.0.1:${srv.address().port}/host.html`);
await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
const run = page.evaluate(async (t) => {
  const H = window.__host; const b = H.bridge; let k = 0;
  for (const name of ['execute', 'topologyOf']) { const inner = b[name].bind(b); b[name] = async (cmds, o) => { const i = ++k; console.log(`@@start ${i} ${name} n=${cmds.length} last=${cmds.at(-1)?.command} ${JSON.stringify(cmds.at(-1)?.params ?? {}).slice(0, 200)} budgetS=${o?.budgetS ?? '-'}`); const t1 = performance.now(); const r = await inner(cmds, o); console.log(`@@end   ${i} ${Math.round(performance.now() - t1)} ms ok=${r?.ok} ${r?.timedOut ? 'TIMED OUT' : ''} ${r?.failed ? JSON.stringify(r.failed).slice(0, 160) : ''}`); return r; }; }
  const sc = document.getElementById('sc').contentWindow.solidcraft; const req = sc.request.bind(sc);
  sc.request = async (m, p) => { console.log(`@@  solidcraft.request ${m} ${p?.commands ? p.commands.length + ' commands' : ''} begins`); const r = await req(m, p); console.log(`@@  solidcraft.request ${m} returned`); return r; };
  const r = typeof t.script === 'string' ? (H.setScript(t.script), await H.run({ confirmed: true })) : await H.translateRaw(t.doc);
  return { features: (r.features ?? []).map((f) => `${f.id}:${f.kind}:${f.status}${f.refusal ? ' -- ' + f.refusal : ''}`), bodies: r.bodies, stops: H.engineStops, after: (await H.bridge.inspect()).measure.bodies.map((q) => [q.name, q.volume_mm3, q.faces]), probes: H.probeLog.map((p) => `${p.cmds} ${p.last} ${p.status} wall ${p.wallMs} cpu ${p.cpuMs}`) };
}, t);
const res = await Promise.race([run, new Promise((r) => setTimeout(() => r('NO ANSWER'), Number(LIMIT) * 1000))]);
console.log(typeof res === 'string' ? `${res} in ${LIMIT} s` : JSON.stringify(res, null, 1));
if (typeof res === 'string') {
  const alive = await Promise.race([page.evaluate(async () => { const sc = document.getElementById('sc').contentWindow.solidcraft; const r = await Promise.race([sc.inspect({ measure: true }).then((x) => 'inspect answered: ' + JSON.stringify((x.bodies ?? []).map((b) => [b.name, b.volume_mm3, b.faces]))).catch((e) => 'inspect threw: ' + e.message), new Promise((r) => setTimeout(() => r('inspect: no answer in 5 s'), 5000))]); return r; }), new Promise((r) => setTimeout(() => r('the page itself does not answer'), 12000))]);
  console.log('SolidCraft afterwards:', alive);
}
if (typeof res === 'string') { const probes = await Promise.race([page.evaluate(() => window.__host.probeLog.map((p) => `${p.cmds} ${p.last} ${p.status} wall ${p.wallMs} cpu ${p.cpuMs}`)), new Promise((r) => setTimeout(() => r('(the page does not answer: its main thread is busy)'), 5000))]); console.log('probes:', probes); }
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]); process.exit(0);
