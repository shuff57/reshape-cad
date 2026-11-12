// sketch-check-run.mjs <site folder> <out.json>: every sketch example of the page (groups 2d, friendly, diag) and the probe scripts beside this file, one fresh page each;
// records what the page told the student in the Sketch check card, both counts of free ways, and the refused command of a clash.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { CASES } from './sketch-check-cases.mjs';
import { EXTRA } from './sketch-check-extra.mjs';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const [ROOT, OUT] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out = []; const SHOTS = ['full', 'clash', 'x-exact-no-height', 'two-sketches', 'twice', 'no-height'];
const open = async () => { const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 }); page.setDefaultTimeout(300000); return page; };
const grab = () => { const lr = window.__lastRun; if (!lr) return null; return {
  docSk: lr.doc.features.filter((f) => f.kind === 'sketch').map((f) => ({ id: f.id, geoms: f.geoms ?? null, rules: f.rules ?? null })),
  fin: (lr.fin.sketches ?? []).map((x) => ({ name: x.name, dof: x.dof, status: x.status, failing: x.failing, fully: x.fully_constrained, nprof: (x.profile_list ?? []).length })),
  feats: lr.tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, guard: f.guard ?? null, failed: f.failed ?? null, sketch: f.sketch ?? null, cmds: f.status === 'refused' && f.failed ? (f.commands ?? []).map((c) => [c.command, c.params && c.params.name]) : null })),
  volume: lr.summary.volume, check: lr.summary.sketchCheck, rows: lr.summary.sketches, text: document.getElementById('sketches').innerText, dev: document.getElementById('sketches-dev').innerText, dofMatch: lr.summary.dofMatch, verdictDetail: lr.summary.detail }; };
const p0 = await open();
const ids = (await p0.evaluate(() => window.__host.EXAMPLES.map((e) => [e.id, e.group]))).filter(([, g]) => ['2d', 'friendly', 'diag'].includes(g)).map(([i]) => i);
await p0.close();
for (const id of ids) { const page = await open();
  const r = await page.evaluate(async ([i, g]) => { window.__lastRun = null; let threw = null; try { await window.__host.runExample(i); } catch (e) { threw = String(e && e.message || e); } return { threw, status: document.getElementById('status').innerText, ...(new Function('return (' + g + ')()'))() }; }, [id, grab.toString()]);
  out.push({ id, ...r }); console.log(id, r.status); fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); await page.close(); }
for (const t of [...CASES, ...EXTRA]) { const page = await open();
  const r = await page.evaluate(async ([s, g]) => { window.__lastRun = null; let threw = null; window.__host.setScript(s); try { await window.__host.run({ confirmed: true }); } catch (e) { threw = String(e && e.message || e); } return { threw, status: document.getElementById('status').innerText, ...(new Function('return (' + g + ')()'))() }; }, [t.script, grab.toString()]);
  out.push({ id: t.id, script: t.script, ...r }); console.log(t.id, r.status); if (SHOTS.includes(t.id)) { await page.evaluate(() => document.getElementById('sketches').scrollIntoView({ block: 'center' })); await page.waitForTimeout(800); await page.screenshot({ path: path.join(path.dirname(OUT), 'shot-' + t.id + '.png') }); } fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); await page.close(); }
await browser.close(); srv.close();
