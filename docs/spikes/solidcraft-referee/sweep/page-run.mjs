// page-run.mjs <site> <out.jsonl> <mode> <cases.json | module>...: cases in the REAL page, one JSON line each. Was pilot-2026-11b/timing/inc.mjs,
// written to measure "run only the new steps"; mode `off` is the page as shipped and is what a sweep uses. <site> is a folder that serves host.html
// with the pinned SolidCraft web build beside it (the rig's student-preview).
//   mode on      ?inc=on. A second SolidCraft (another iframe of the same web build) is the reference: every real engine run of the page is repeated there
//                from an empty design and the two replies are compared field by field, exactly (reply-memory.mjs compareReplies; the page's engineLog).
//                After the run the design the page is left on is read (faces, edges, measure of every body, nothing run) and compared with the accepted
//                commands run from empty on the reference.
//   mode control the same as `on`, but the reference is given every list with one number of its last command changed by 1 part in a million: the
//                comparison must then report differences (it shows that the comparison can fail).
//   mode on3     the same as `on`, and the reference runs every list TWICE from empty. Three replies to one list: the page's (continued where it can), the
//                reference's first and its second. The engine does not repeat itself to the last digit on every list (a round of several edges: other
//                last digits, another order of faces, other names for the blend faces), so each pair is classed (classify): exact; same solid (every
//                number within 1e-9, faces and edges matched by their geometry, names and order ignored), with or without the same names; or NOT the same.
//                page vs reference is the question; reference vs reference is the engine's own noise, the yardstick.
//                Each row of `tri` ends with whether the list holds a round or bevel command.
//   mode off     the page as it is (no continuation, no reference): the results to compare the `on` results with, and the time.
//   mode timing  ?inc=on without the reference: the time.
// BUDGET_ALL=1 (any mode): every run from an empty design that the layer sent without a time budget is given one of 45 s here, so it goes through the worker
// first: what a budget on every step would cost in time (topology readings are not covered).
// A case is { id, script } or { id, doc } (a ModelDoc, through the page's translateRaw). One JSON line per case; a case already in the file is skipped.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../package.json', import.meta.url)); // the repo root's node_modules (playwright-core)
const { chromium } = require('playwright-core');
const [ROOT, OUT, MODE, ...SRC] = process.argv.slice(2);
const CASES = [];
for (const f of SRC) {
  if (f.endsWith('.json')) { for (const t of JSON.parse(fs.readFileSync(f, 'utf8'))) CASES.push(t); continue; }
  const x = await import(pathToFileURL(path.resolve(f)).href); for (const t of (x.TASKS ?? x.CASES)) CASES.push({ id: t.id, script: t.script });
}
const PER_PAGE = Number(process.env.PER_PAGE || 25); // cases per browser page (a fresh page costs about 2 s; a page is also replaced after any error)
const LIMIT_MS = Number(process.env.LIMIT_S || 600) * 1000;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const srv = http.createServer((req, res) => { const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(b); }); }).listen(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/host.html${MODE === 'off' ? '' : '?inc=on'}`;
const launch = () => chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
let browser = await launch();
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); await page.goto(base);
  await page.waitForFunction(() => { const f = document.getElementById('sc'); return f.contentWindow && f.contentWindow.solidcraft && window.__host; }, null, { timeout: 90000 });
  page.setDefaultTimeout(LIMIT_MS + 60000);
  if (process.env.BUDGET_ALL) await page.evaluate(() => { const b = window.__host.bridge; const ex = b.execute.bind(b); b.execute = (cmds, o = {}) => ex(cmds, o.fresh && !o.budgetS ? { ...o, budgetS: 45 } : o); });
  if (MODE === 'on' || MODE === 'control' || MODE === 'on3') {
    await page.evaluate(async ({ control, three }) => {
      const f = document.createElement('iframe'); f.id = 'sc2'; f.src = './solidcraft/index.html';
      f.style.cssText = 'position:absolute;left:0;bottom:0;width:480px;height:320px;border:0;z-index:5';
      document.body.appendChild(f);
      for (let i = 0; i < 600 && !(f.contentWindow && f.contentWindow.solidcraft); i++) await new Promise((r) => setTimeout(r, 100));
      const sc = f.contentWindow.solidcraft; if (!sc) throw new Error('the reference SolidCraft did not start');
      const lazy = { inspect: (...a) => sc.inspect(...a), execute: (...a) => sc.execute(...a), request: (...a) => sc.request(...a) };
      const shadow = window.__host.createUpstreamBridge(lazy);
      for (let i = 0; i < 200; i++) { try { const r = await shadow.inspect(); if (r && r.ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
      if (control) {
        const bump = (cmds) => { const c = structuredClone(cmds); const last = c.at(-1); const k = last && last.params ? Object.keys(last.params).find((x) => typeof last.params[x] === 'number' && last.params[x] !== 0) : null; if (k) last.params[k] *= 1 + 1e-6; return c; };
        const ex = shadow.execute.bind(shadow), tp = shadow.topologyOf.bind(shadow);
        shadow.execute = (cmds, o) => ex(bump(cmds), o); shadow.topologyOf = (cmds, o) => tp(bump(cmds), o);
      }
      if (three) {
        // ---- classify(a, b): two replies to the same list ----
        const TOL = 1e-9;
        // `index` is the place of a face or edge in upstream's list, which is not the same from run to run; `feature` is compared apart
        const nums = (x, out = []) => { if (typeof x === 'number') out.push(x); else if (x && typeof x === 'object') for (const k of Object.keys(x).sort()) { if (k !== 'feature' && k !== 'index') nums(x[k], out); } return out; };
        const strs = (x, out = []) => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') for (const k of Object.keys(x).sort()) strs(x[k], out); return out; };
        const near = (p, q) => p === q || Math.abs(p - q) <= TOL * Math.max(1, Math.abs(p), Math.abs(q));
        const sig = (o) => nums(o).map((v) => (Math.abs(v) < 5e-7 ? 0 : Number(v.toPrecision(6))));
        const cmpSig = (p, q) => { for (let i = 0; i < Math.min(p.length, q.length); i++) if (p[i] !== q[i]) return p[i] - q[i]; return p.length - q.length; };
        // a list of named things (faces, edges, bodies' parts): matched by geometry, not by place or name
        const sameList = (xs, ys) => {
          if (xs.length !== ys.length) return 'count';
          const A = xs.map((o) => ({ o, s: sig(o) })).sort((p, q) => cmpSig(p.s, q.s)), B = ys.map((o) => ({ o, s: sig(o) })).sort((p, q) => cmpSig(p.s, q.s));
          const left = B.map((b) => nums(b.o));
          for (const a of A) { const na = nums(a.o); const k = left.findIndex((nb) => nb && nb.length === na.length && nb.every((v, i) => near(v, na[i]))); if (k < 0) return 'geometry'; left[k] = null; }
          return null;
        };
        const partOf = (r) => ({ ok: r?.ok ?? null, failed: r?.failed ? { index: r.failed.index ?? null, command: r.failed.command ?? null, error: r.failed.error ?? null } : null,
          bodies: r?.measure?.bodies ?? [], sketches: r?.sketches ?? [], topo: r?.topology?.bodies ?? null, results: r?.results ?? null, completed: r?.completed ?? null });
        const classify = (ra, rb) => {
          const a = partOf(ra), b = partOf(rb);
          const strip = (r) => { const { cpuMs: _c, probeLoadMs: _l, probeVolume: _v, ran: _r, ...x } = r ?? {}; return x; };
          if (JSON.stringify(strip(ra)) === JSON.stringify(strip(rb))) return { cls: 'exact' };
          if (a.ok !== b.ok || JSON.stringify(a.failed) !== JSON.stringify(b.failed) || a.completed !== b.completed || (a.results && b.results && JSON.stringify(a.results) !== JSON.stringify(b.results))) return { cls: 'NOT', why: 'outcome' };
          if (a.bodies.length !== b.bodies.length || a.bodies.some((x, i) => x.name !== b.bodies[i].name)) return { cls: 'NOT', why: 'bodies' };
          let maxVol = 0;
          for (let i = 0; i < a.bodies.length; i++) {
            const x = a.bodies[i], y = b.bodies[i]; const nx = nums(x), ny = nums(y);
            if (nx.length !== ny.length || !nx.every((v, k) => near(v, ny[k]))) return { cls: 'NOT', why: 'measure of ' + x.name };
            if (JSON.stringify(strs(x)) !== JSON.stringify(strs(y))) return { cls: 'NOT', why: 'measure words of ' + x.name };
            if (typeof x.volume_mm3 === 'number' && x.volume_mm3 !== y.volume_mm3) maxVol = Math.max(maxVol, Math.abs(x.volume_mm3 - y.volume_mm3) / Math.max(1e-300, Math.abs(x.volume_mm3)));
          }
          { const nx = nums(a.sketches), ny = nums(b.sketches); if (nx.length !== ny.length || !nx.every((v, k) => near(v, ny[k])) || JSON.stringify(strs(a.sketches)) !== JSON.stringify(strs(b.sketches))) return { cls: 'NOT', why: 'sketches' }; }
          let names = true;
          if (a.topo || b.topo) {
            if (!a.topo || !b.topo || a.topo.length !== b.topo.length) return { cls: 'NOT', why: 'topology bodies' };
            for (let i = 0; i < a.topo.length; i++) {
              const x = a.topo[i], y = b.topo[i];
              if (x.name !== y.name || !!x.error !== !!y.error) return { cls: 'NOT', why: 'topology of ' + x.name };
              for (const k of ['faces', 'edges']) { const w = sameList(x[k] ?? [], y[k] ?? []); if (w) return { cls: 'NOT', why: `${k} of ${x.name}: ${w}` }; }
              const nm = (r) => JSON.stringify([...(r.faces ?? []).map((f) => f.name), ...(r.edges ?? []).map((e) => e.name)].sort());
              if (nm(x) !== nm(y)) names = false;
            }
          }
          return { cls: names ? 'same solid' : 'same solid, other names', maxVol };
        };
        // ---- the reference runs each list twice; the page's own reply to it is the last thing its bridge returned ----
        const tri = []; window.__tri = tri; let lastMain = null;
        const B = window.__host.bridge; const mex = B.execute.bind(B), mtp = B.topologyOf.bind(B);
        B.execute = async (cmds, o) => { const r = await mex(cmds, o); lastMain = { key: JSON.stringify(cmds), r }; return r; };
        B.topologyOf = async (cmds, o) => { const r = await mtp(cmds, o); lastMain = { key: JSON.stringify(cmds), r, held: o?.held ?? 0 }; return r; };
        const ex = shadow.execute.bind(shadow), tp = shadow.topologyOf.bind(shadow);
        const both = (kind, run) => async (cmds, o) => {
          const main = lastMain && lastMain.key === JSON.stringify(cmds) ? lastMain.r : null;
          const s1 = await run(cmds, o), s2 = await run(cmds, o);
          tri.push({ kind, n: cmds.length, last: cmds.at(-1)?.command ?? null, round: cmds.some((c) => c.command === 'solid.fillet' || c.command === 'solid.chamfer'), page: main ? classify(main, s1) : { cls: 'no page reply' }, noise: classify(s1, s2) });
          return s1;
        };
        shadow.execute = both('execute', ex); shadow.topologyOf = both('topologyOf', tp);
      }
      window.__host.shadow = shadow;
    }, { control: MODE === 'control', three: MODE === 'on3' });
  }
  return page;
}

const runCase = (page, t) => page.evaluate(async ({ t, mode }) => {
  const H = window.__host; const log0 = H.engineLog.length; const p0 = H.probeLog.length; const tri0 = (window.__tri ?? []).length; const stops0 = (H.engineStops ?? []).length;
  const t0 = performance.now(); let threw = null; let sum = null; let cmds = null;
  try {
    if (typeof t.script === 'string') { H.setScript(t.script); sum = await H.run({ confirmed: true }); cmds = window.__lastRun?.tr?.commands ?? null; }
    else { sum = await H.translateRaw(t.doc); cmds = sum?.commandList ?? null; }
  } catch (e) { threw = String((e && e.message) || e); }
  const wallMs = Math.round(performance.now() - t0);
  const log = H.engineLog.slice(log0);
  const bodies = (sum?.bodies ?? []).map((q) => ({ name: q.name, volume: q.volume, faces: q.faces }));
  const now = await H.bridge.inspect();
  const pageBodies = (now.measure?.bodies ?? []).map((q) => ({ name: q.name, volume: q.volume_mm3, faces: q.faces }));
  const out = { wallMs, threw, error: sum?.error ?? null, status: typeof t.script === 'string' ? document.getElementById('status').innerText : 'doc', volume: sum?.volume ?? bodies.reduce((a, q) => a + q.volume, 0),
    steps: (sum?.features ?? []).map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, note: f.note ?? null })), bodies, pageBodies,
    pageSame: (bodies.length === pageBodies.length && bodies.every((q, i) => q.name === pageBodies[i].name && q.volume === pageBodies[i].volume && q.faces === pageBodies[i].faces)),
    engineUse: sum?.engineUse ?? null, commands: cmds ? cmds.length : null,
    probes: H.probeLog.slice(p0).length, probeMs: H.probeLog.slice(p0).reduce((a, p) => a + (p.wallMs ?? 0), 0),
    noBudgetRuns: log.filter((r) => !r.budget).length, slowestNoBudgetMs: Math.max(0, ...log.filter((r) => !r.budget).map((r) => r.ms)), slowestNoBudget: (log.filter((r) => !r.budget).sort((a, b) => b.ms - a.ms)[0] ?? {}).last ?? null,
    stops: (H.engineStops ?? []).length - stops0,
    runs: log.length, continued: log.filter((r) => r.held > 0).length, heldCommands: log.reduce((a, r) => a + r.held, 0), ranCommands: log.reduce((a, r) => a + r.n - r.held, 0), engineMs: log.reduce((a, r) => a + r.ms, 0) };
  if (mode === 'on3') {
    // one row per real run: [kind, commands, held, last command, page vs reference, reference vs reference]
    const tri = window.__tri.slice(tri0);
    out.tri = tri.map((x, i) => [x.kind, x.n, log[i] ? log[i].held : null, x.last, x.page.cls, x.noise.cls, x.page.why ?? null, x.noise.why ?? null, x.page.maxVol ?? 0, x.noise.maxVol ?? 0, x.round]);
    out.triAligned = tri.length === log.length && tri.every((x, i) => x.n === log[i].n && x.kind === log[i].kind);
  }
  if (mode === 'on' || mode === 'control' || mode === 'on3') {
    const bad = log.filter((r) => r.same === false);
    out.compared = log.filter((r) => r.same !== undefined).length; out.comparedContinued = log.filter((r) => r.same !== undefined && r.held > 0).length;
    out.differ = bad.length; out.differContinued = bad.filter((r) => r.held > 0).length; out.maxRel = bad.reduce((a, r) => Math.max(a, r.maxRel), 0);
    out.firstDiffs = bad.slice(0, 4).map((r) => ({ kind: r.kind, n: r.n, held: r.held, last: r.last, count: r.count, maxRel: r.maxRel, diffs: r.diffs.slice(0, 6) }));
    // the design the page is left on, read without running anything, against the accepted commands from empty on the reference
    if (cmds && sum && !sum.error) {
      const n = cmds.length; const here = await H.bridge.topologyOf(cmds, { held: n, heldResults: Array.from({ length: n }, () => ({ feature: null })) });
      delete here.results; // the reading ran nothing, so it has no feature numbers of its own
      const ref = await H.shadow.topologyOf(cmds); if (mode === 'on3') delete ref.results;
      const strip = (r) => (r && r.ok ? { ok: true, topology: r.topology, measure: r.measure } : { ok: false });
      const a = JSON.stringify(strip(here)), b = JSON.stringify(strip(ref));
      out.finalSame = a === b; out.finalBodies = here.ok ? here.topology.bodies.length : null; out.finalFaces = here.ok ? here.topology.bodies.reduce((s, x) => s + (x.faces?.length ?? 0), 0) : null;
      if (a !== b) out.finalNote = { here: a.length, ref: b.length, hereOk: !!here.ok, refOk: !!ref.ok };
    }
  }
  // on3: the reading of the design the page is left on went through the same three-way comparison (the last row of __tri): faces and edges, names included
  if (mode === 'on3') out.finalTri = window.__tri.slice(tri0 + log.length).map((x) => [x.page.cls, x.noise.cls, x.page.why ?? null, x.noise.why ?? null]);
  return out;
}, { t, mode: MODE });

let page = null; let used = 0;
for (const t of CASES) {
  if (done.has(t.id)) continue;
  if (!page || used >= PER_PAGE) { if (page) await page.close().catch(() => {}); page = await openPage(); used = 0; }
  let r;
  try { r = await Promise.race([runCase(page, t), new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer in ${LIMIT_MS / 1000} s`)), LIMIT_MS))]); }
  catch (e) { r = { harnessError: String((e && e.message) || e) }; await browser.close().catch(() => {}); browser = await launch(); page = null; }
  used++;
  fs.appendFileSync(OUT, JSON.stringify({ id: t.id, mode: MODE, ...r }) + '\n');
  console.log(MODE.padEnd(6), String(t.id).slice(0, 44).padEnd(44), String(r.wallMs ?? '-').padStart(7), 'ms', r.harnessError ? 'HARNESS: ' + r.harnessError : `runs ${r.runs} continued ${r.continued}` + (MODE === 'on' || MODE === 'control' || MODE === 'on3' ? ` differ ${r.differ}${r.differ ? ' (continued ' + r.differContinued + ', maxRel ' + r.maxRel + ')' : ''} final ${r.finalSame === undefined ? '-' : r.finalSame ? 'same' : 'DIFFERS'}` : '') + (r.tri ? ' | ' + Object.entries(r.tri.reduce((a, x) => { const k = (x[2] > 0 ? 'cont ' : 'empty ') + x[4]; a[k] = (a[k] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ') + ' || noise ' + Object.entries(r.tri.reduce((a, x) => { a[x[5]] = (a[x[5]] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ') : '') + (r.pageSame ? '' : ' PAGE!=REPORT'), '|', r.status ?? '');
}
const soon = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 10000))]);
if (page) await soon(page.close().catch(() => {}));
await soon(browser.close().catch(() => {})); srv.close(); process.exit(0);
