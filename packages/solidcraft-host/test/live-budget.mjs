// Live check of the time budget (Phase 3a, kernel in a worker) against the real SolidCraft 0.21.0 web build, in ONE headless Chrome.
//   systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 node test/live-budget.mjs <site folder> <out.json> [--skip-examples] [--natural]
// <site folder> is the student-preview layout (host.html, pane/, src/, solidcraft/ = the web build) plus kernel/ = the folder with solidcraft_referee_bg.wasm.
//  1. SLOW: 4 countersunk blind holes (the spike's holes-cs-blind: ~44 s of engine time) with ?budgetCapS=2, probe ON -> must be refused G-BUDGET,
//     the host page's event loop must keep turning (heartbeat gap), the box must be intact. Same script with ?probe=off (the old behaviour) for contrast.
//  2. FAST: every example script that sends a budget, probe ON vs OFF: same volumes, and the overhead per run.
//  3. --natural: the same slow script with the layer's own 45 s base (no cap).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/home/shuff57/Documents/GitHub/reshape-cad/package.json');
const { chromium } = require('playwright-core');
const ROOT = process.argv[2]; const OUT = process.argv[3];
const skipEx = process.argv.includes('--skip-examples'); const natural = process.argv.includes('--natural');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html`;
const SLOW = 'const b = cuboid(40, 40, 20)\nholes(b, { across: 4, apart: [20, 20], deep: 10, countersink: { across: 8, angle: 90 } })';
const report = { slow: {}, fast: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
async function open(qs) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(base + qs);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  return page;
}
async function slowRun(page, label, timeoutMs) {
  const r = await Promise.race([
    page.evaluate(async (s) => {
      let last = performance.now(), maxGap = 0, beats = 0;
      const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; beats++; }, 50);
      const t0 = performance.now(); const n0 = window.__host.probeLog.length;
      window.__host.setScript(s);
      const x = await window.__host.run({ confirmed: true });
      clearInterval(iv);
      return { wallMs: Math.round(performance.now() - t0), maxHeartbeatGapMs: Math.round(maxGap), beats, volume: x.volume, bodies: x.bodies, features: x.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, guard: f.guard ?? null, refusal: f.refusal ?? null })), probes: window.__host.probeLog.slice(n0) };
    }, SLOW),
    new Promise((res) => setTimeout(() => res({ timeout: true }), timeoutMs)),
  ]).catch((e) => ({ error: String(e).slice(0, 300) }));
  console.log(label, JSON.stringify({ ...r, features: r.features?.map((f) => `${f.id}:${f.status}:${f.guard}`) }).slice(0, 600));
  return r;
}
{ // 1. slow, probe ON, cap 2 s
  const page = await open('?budgetCapS=2');
  report.slow.probeOn = await slowRun(page, 'SLOW probe ON cap 2s', 300000); save();
  // the SolidCraft page must be intact afterwards: a plain box still builds
  report.slow.afterwards = await page.evaluate(async () => { window.__host.setScript('const b = cuboid(10, 10, 10)'); const x = await window.__host.run({ confirmed: true }); return { volume: x.volume, bodies: x.bodies }; });
  console.log('after', JSON.stringify(report.slow.afterwards)); save();
  await page.close();
}
{ // 1b. the old behaviour: probe off, same cap (ignored)
  const page = await open('?probe=off');
  report.slow.probeOff = await slowRun(page, 'SLOW probe OFF', 400000); save();
  await page.close();
}
{ // 1c. a run that is far over the budget (150 countersunk holes in a grid, many minutes of engine time): stopped at 5 s, page stays responsive, no CPU left running afterwards
  const chromeTicks = () => { let t = 0; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { if (!/chrome/.test(fs.readFileSync(`/proc/${d}/comm`, 'utf8'))) continue; const f = fs.readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' '); t += Number(f[11]) + Number(f[12]); } catch { /* process gone */ } } return t / 100; };
  // CPU seconds per Chrome worker thread, by thread id
  const workerThreads = () => { const m = {}; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { if (!/chrome/.test(fs.readFileSync(`/proc/${d}/comm`, 'utf8'))) continue; for (const th of fs.readdirSync(`/proc/${d}/task`)) { const nm = fs.readFileSync(`/proc/${d}/task/${th}/comm`, 'utf8'); if (!/Worker/i.test(nm)) continue; const f = fs.readFileSync(`/proc/${d}/task/${th}/stat`, 'utf8').split(') ')[1].split(' '); m[th] = (Number(f[11]) + Number(f[12])) / 100; } } catch { /* gone */ } } return m; };
  const page = await open('');
  const holes = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) holes.push({ command: 'solid.hole', params: { position: [-90 + i * 16, -90 + j * 16, 10], diameter: 4, body: 'big', depth: 10, type: 'countersink', cs_diameter: 8, cs_angle: '90 deg' } });
  const cmds = [{ command: 'solid.box', params: { length: 200, width: 200, height: 20, center: [0, 0, 0], body_name: 'big' } }, ...holes];
  await new Promise((r) => setTimeout(r, 4000)); const b0 = chromeTicks(); await new Promise((r) => setTimeout(r, 3000)); const c0 = chromeTicks(); const idle = +(c0 - b0).toFixed(1);
  const r = await page.evaluate(async (cmds) => {
    let last = performance.now(), maxGap = 0; const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 50);
    const t0 = performance.now(); const x = await window.__host.runSC(cmds, { budgetS: 5 }); clearInterval(iv);
    return { wallMs: Math.round(performance.now() - t0), maxHeartbeatGapMs: Math.round(maxGap), ok: x.ok, timedOut: x.timedOut ?? false, cpuMs: x.cpuMs, failed: x.failed };
  }, cmds);
  const c1 = chromeTicks(); const series = []; for (let i = 0; i < 12; i++) { series.push(workerThreads()); await new Promise((r) => setTimeout(r, 250)); }
  const busy = Object.keys(series[0]).filter((t) => series[0][t] > 1); // the probe worker: > 1 s of CPU already
  const stoppedAfterMs = busy.map((t) => { const i = series.findIndex((s2, k) => k > 0 && (s2[t] === undefined || s2[t] === series[k - 1][t])); return i < 0 ? null : i * 250; });
  const c2 = chromeTicks();
  const after = await page.evaluate(async () => { window.__host.setScript('const b = cuboid(10, 10, 10)'); const x = await window.__host.run({ confirmed: true }); return { volume: x.volume }; });
  report.hang = { ...r, chromeCpuSecondsIdleIn3sBefore: idle, chromeCpuSecondsDuringRun: +(c1 - c0).toFixed(1), busyWorkerThreadsRightAfterTimeout: busy.length, probeWorkerStoppedWithinMs: stoppedAfterMs, chromeCpuSecondsIn3sAfterwards: +(c2 - c1).toFixed(1), afterwards: after };
  console.log('HANG', JSON.stringify(report.hang)); save();
  await page.close();
}
if (!skipEx) {
  const results = {};
  for (const mode of ['on', 'off']) {
    const page = await open(mode === 'off' ? '?probe=off' : '');
    const ids = await page.evaluate(() => window.__host.EXAMPLES.map((e) => e.id));
    for (const id of ids) {
      const r = await Promise.race([
        page.evaluate(async (id) => { const n0 = window.__host.probeLog.length; const r0 = window.__host.runLog.length; const t0 = performance.now(); const x = await window.__host.runExample(id); return { runs: window.__host.runLog.slice(r0), wallMs: Math.round(performance.now() - t0), volume: x.volume, bodies: x.bodies, statuses: x.features.map((f) => f.status).join(','), probes: window.__host.probeLog.slice(n0) }; }, id),
        new Promise((res) => setTimeout(() => res({ timeout: true }), 240000)),
      ]).catch((e) => ({ error: String(e).slice(0, 200) }));
      (results[id] ??= {})[mode] = r;
      if (r.timeout) { console.log('timeout on', id); break; }
    }
    await page.close();
  }
  for (const [id, v] of Object.entries(results)) {
    const on = v.on ?? {}, off = v.off ?? {};
    const probes = on.probes ?? [];
    report.fast.push({ id, volOn: on.volume ?? null, volOff: off.volume ?? null, sameVolume: on.volume === off.volume || (on.volume != null && off.volume != null && Math.abs(on.volume - off.volume) <= 1e-9 * Math.abs(off.volume)), sameStatuses: on.statuses === off.statuses, wallOnMs: on.wallMs ?? null, wallOffMs: off.wallMs ?? null, nProbes: probes.length, probeWallMs: probes.reduce((s, p) => s + p.wallMs, 0), probeCpuMs: probes.reduce((s, p) => s + (p.cpuMs ?? 0), 0), probeStatuses: probes.map((p) => p.status), probeVsPage: (on.runs ?? []).map((r) => (r.page ? Math.abs(r.probe - r.page) / Math.abs(r.page) : null)), lastProbeVol: probes.length ? probes[probes.length - 1].vol : null });
  }
  save();
  const used = report.fast.filter((f) => f.nProbes > 0);
  console.log(`examples: ${report.fast.length}, with a budgeted run: ${used.length}, volume differs: ${report.fast.filter((f) => !f.sameVolume).length}, status differs: ${report.fast.filter((f) => !f.sameStatuses).length}`);
}
if (natural) {
  const page = await open('');
  report.slow.natural = await slowRun(page, 'SLOW natural budget', 600000); save();
  await page.close();
}
await browser.close(); srv.close();
