// held.mjs <site> <out.json> <mode> <module>...: is what SolidCraft holds after a run what the page reports?
// With the reply memory on, the final replay is skipped when SolidCraft already holds the accepted commands. This runs each script in the real page and
// then reads SolidCraft once more, on its own (bridge.inspect), and compares the bodies with the ones in the run's report: names, face counts, volumes, exactly.
//   mode on      the memory on (the default page)
//   mode off     ?memo=off, every list run every time: the reference for steps, sentences and volumes
//   mode tamper  the memory on, and every reading of SolidCraft DURING the run is given a wrong volume: the skip must not happen, and the result must not change
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT, MODE, ...MODS] = process.argv.slice(2);
const CASES = [];
for (const m of MODS) { const x = await import(pathToFileURL(path.resolve(m)).href); for (const t of (x.TASKS ?? x.CASES)) CASES.push({ id: t.id, script: t.script }); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html${MODE === 'off' ? '?memo=off' : ''}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
for (const t of CASES) { if (out.some((o) => o.id === t.id && o.mode === MODE)) continue;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 }); page.setDefaultTimeout(900000);
  const r = await page.evaluate(async ({ s, tamper }) => {
    const b = window.__host.bridge; const inspect = b.inspect.bind(b); let tampered = 0;
    if (tamper) b.inspect = async () => { const x = await inspect(); tampered++; return { ...x, measure: { bodies: (x.measure?.bodies ?? []).map((q) => ({ ...q, volume_mm3: q.volume_mm3 + 1 })) } }; };
    const t0 = performance.now(); let threw = null; let sum = null;
    window.__host.setScript(s); try { sum = await window.__host.run({ confirmed: true }); } catch (e) { threw = String(e && e.message || e); }
    const wallMs = Math.round(performance.now() - t0);
    b.inspect = inspect;
    const now = await inspect(); // SolidCraft itself, read after the run, not through the memory
    const pageBodies = (now.measure?.bodies ?? []).map((q) => ({ name: q.name, volume: q.volume_mm3, faces: q.faces }));
    const bodies = (sum?.bodies ?? []).map((q) => ({ name: q.name, volume: q.volume, faces: q.faces }));
    return { wallMs, threw, error: sum?.error ?? null, status: document.getElementById('status').innerText, volume: sum?.volume ?? null,
      steps: (sum?.features ?? []).map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal, note: f.note })), bodies, pageBodies,
      pageSame: bodies.length === pageBodies.length && bodies.every((q, i) => q.name === pageBodies[i].name && q.volume === pageBodies[i].volume && q.faces === pageBodies[i].faces),
      engineUse: sum?.engineUse ?? null, tampered };
  }, { s: t.script, tamper: MODE === 'tamper' });
  out.push({ id: t.id, mode: MODE, ...r }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(MODE.padEnd(7), t.id.padEnd(30), String(r.wallMs).padStart(7), 'ms', r.pageSame ? 'page = report' : 'PAGE DIFFERS', JSON.stringify(r.engineUse), r.status);
  await page.close();
}
await browser.close(); srv.close();
