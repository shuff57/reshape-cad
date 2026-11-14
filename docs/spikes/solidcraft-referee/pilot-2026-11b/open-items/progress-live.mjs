// the progress line in the real page: every text the status line shows during a run, as shipped (on) and with ?progress=off
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../../package.json', import.meta.url)); const { chromium } = require('playwright-core');
const [ROOT, OUT] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const KNOB = `const sk = sketch('front', 0)\nsk.polygon([[0, 0], [12, 0], [12, 6], [6, 14], [0, 14]])\nconst knob = revolve(sk, 360)\nconst base = box(30, 30, 4, { at: [0, 0, -2] })\nconst part = union(knob, base)\nhole(part, { across: 3 })\n`;
const PLATE = `const b = box(40, 30, 10)\nround(b, 2)\nhole(b, { across: 6, at: [-10, 0] })\nhole(b, { across: 6, at: [10, 0] })\nhollow(b, { wall: 12, open: 'top' })\n`;
const out = [];
for (const [mode, q] of [['on (as shipped)', ''], ['off', '?progress=off']]) for (const [id, script] of [['knob', KNOB], ['plate', PLATE]]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(`http://127.0.0.1:${srv.address().port}/host.html${q}`);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 }); page.setDefaultTimeout(600000);
  const r = await page.evaluate(async (s) => {
    const el = document.getElementById('status'); const seen = []; const t0 = performance.now();
    const note = () => { const t = el.textContent; if (!seen.length || seen.at(-1)[1] !== t) seen.push([Math.round(performance.now() - t0), t]); };
    const mo = new MutationObserver(note); mo.observe(el, { childList: true, characterData: true, subtree: true });
    // what was on screen: sample each frame too (a text written and overwritten within one task is never drawn)
    const drawn = []; let go = true; const frame = () => { const t = el.textContent; if (!drawn.length || drawn.at(-1)[1] !== t) drawn.push([Math.round(performance.now() - t0), t]); if (go) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    window.__host.setScript(s); const sum = await window.__host.run({ confirmed: true }); go = false; mo.disconnect(); note();
    return { wallMs: Math.round(performance.now() - t0), written: seen, drawn, steps: (sum?.features ?? []).map((f) => `${f.id}:${f.status}`), volume: sum?.volume ?? null };
  }, script);
  out.push({ mode, id, ...r }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`== ${mode} ${id}: ${r.wallMs} ms, ${r.steps.join(' ')}, volume ${r.volume}`); console.log('   written: ' + r.written.map((x) => `[${x[0]}] ${x[1]}`).join(' | ')); console.log('   drawn:   ' + r.drawn.map((x) => `[${x[0]}] ${x[1]}`).join(' | '));
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]); srv.close(); process.exit(0);
