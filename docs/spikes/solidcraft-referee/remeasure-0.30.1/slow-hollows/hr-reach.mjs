// hr-reach.mjs <scripts.json> [--stub] [--only=id,id]: each {id, script} through the HOST ROUTE as stageB/hr-one.mjs runs it (host-entry translateDoc with
// planners 'unified' and HOST_EP_JOIN_CHECKS 'full', pane.js ctx, preflightScript, fromUsage, topologyOf with measure). Records whether a solid.shell command
// ever reaches the kernel (runSC or topologyOf), how long each such run took, and every feature's status / guard / sentence.
// --stub: a run that carries solid.shell is NOT executed; it is recorded as reached and answered {ok:false} (classification only, no kernel time spent on it).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const WT = process.env.WT; const imp = (p) => import(pathToFileURL(p).href);
const STUB = process.argv.includes('--stub');
// --budget: a run that carries { budgetS } is done the way the host bridge does it (createUpstreamBridge execute: a fresh probe per run, killed when budgetS runs out,
// reply { ok:false, timedOut:true, cpuMs }); in time, its reply carries cpuMs. The page's second (applying) run is NOT repeated here; its time is the probe's again.
const BUDGET = process.argv.includes('--budget');
const CAP = Number((process.argv.find((a) => a.startsWith('--cap=')) ?? '--cap=0').slice(6)) || null; // optional cap on any budget (seconds), like ?budgetCapS=
import { spawnSync } from 'node:child_process';
const RUN1 = new URL('./run1.mjs', import.meta.url).pathname;
const probe = (cmds, budgetS) => {
  const s = CAP ? Math.min(budgetS, CAP) : budgetS; const t0 = performance.now();
  const p = spawnSync(process.execPath, [RUN1, process.env.SOLIDCRAFT_REFEREE_PKG], { input: JSON.stringify({ commands: cmds }), timeout: Math.ceil(s * 1000), killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  const wall = Math.round(performance.now() - t0);
  if (p.signal === 'SIGKILL' || p.error?.code === 'ETIMEDOUT') return { ok: false, timedOut: true, cpuMs: wall, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${Math.round(s * 1000)} ms` } };
  if (p.status !== 0 || p.error) console.error('PROBE FAIL', p.status, p.signal, p.error?.code, String(p.stderr).slice(0, 300));
  if (p.status !== 0) return { ok: false, probeError: true, failed: { command: '(probe)', error: `probe exit ${p.status} ${p.signal} ${String(p.stderr).slice(0, 200)}` } };
  let o; try { o = JSON.parse(String(p.stdout)); } catch (e) { console.error('PARSE FAIL', String(p.stdout).length, String(p.stdout).slice(0, 200), String(p.stderr).slice(0, 300)); throw e; } if (!o.res.ok) console.error('PROBE NOT OK', s, JSON.stringify(o.res.failed ?? o.res).slice(0, 300)); return { ...o.res, cpuMs: o.ms };
};
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const H = await imp(path.join(WT, 'packages/solidcraft-host/pane/src/host-entry.mjs'));
if (H.HOST_EP_JOIN_CHECKS !== 'full') { console.error('FATAL: HOST_EP_JOIN_CHECKS ' + H.HOST_EP_JOIN_CHECKS); process.exit(2); }
const up = (await imp(path.join(WT, 'packages/layer/test/topology-upstream.mjs'))).loadUpstream(process.env.SOLIDCRAFT_TOPOLOGY_PKG);
const { runScript } = await imp(path.join(WT, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(WT, 'packages/script/dist/model-codegen.js'));
const hasShell = (cmds) => cmds.some((c) => c.command === 'solid.shell');
for (const c of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  if (ONLY.length && !ONLY.includes(c.id)) continue;
  const shellRuns = [];
  const wrap = (name, fn) => async (cmds, opts) => {
    if (!hasShell(cmds)) return fn(cmds, opts);
    if (STUB) { shellRuns.push({ via: name, stub: true, budgetS: opts?.budgetS ?? null, n: cmds.length, cmds }); return { ok: false, failed: { command: 'solid.shell', error: 'STUB: not run' } }; }
    const t0 = performance.now(); let r; try { r = await fn(cmds, opts); } catch (e) { console.error('WRAP THREW', e.stack); throw e; } const ms = Math.round(performance.now() - t0);
    shellRuns.push({ via: name, ms, budgetS: opts?.budgetS ?? null, ok: !!r.ok, timedOut: !!r.timedOut, cpuMs: r.cpuMs ?? null, error: r.ok ? null : (r.failed?.error ?? r.error ?? null), vol: r.ok ? (r.measure?.bodies ?? []).reduce((s, b) => s + b.volume_mm3, 0) : null });
    return r;
  };
  const topologyOf = wrap('topologyOf', async (cmds) => { const t = await up.topologyOf(cmds); if (!t.ok) return t; const m = await up.runSC(cmds); return m.ok ? { ...t, measure: m.measure } : t; });
  const runSC = wrap('runSC', (cmds, opts) => (BUDGET && opts?.budgetS ? probe(cmds, opts.budgetS) : C.runSC(cmds)));
  const pf = H.preflightScript ? H.preflightScript(c.script) : null;
  if (pf) { console.log(JSON.stringify({ id: c.id, preflight: pf.sentence, reached: false })); continue; }
  const r = runScript(c.script); if (r.errors.length) { console.log(JSON.stringify({ id: c.id, scriptError: r.errors[0].message, reached: false })); continue; }
  const doc = solveDoc(r.doc);
  const ctx = { arc: C.arc, mt: C.mt, runSC, soups: {}, followMoves: true, fromUsage: H.draftFromUsage(c.script), topologyOf };
  const t0 = performance.now();
  const tr = await H.translateDoc(structuredClone(doc), ctx);
  const ms = Math.round(performance.now() - t0);
  const sc = STUB ? null : await C.runSC(tr.commands);
  const bodies = sc?.ok ? (sc.measure?.bodies ?? []) : null;
  if (process.env.DUMP) console.error(JSON.stringify(tr.features.find((f) => f.id === process.env.DUMP), (k, v) => (k === 'commands' ? undefined : v)).slice(0, 3000));
  console.log(JSON.stringify({ id: c.id, pkg: path.basename(path.dirname(process.env.SOLIDCRAFT_REFEREE_PKG)) + '/' + path.basename(process.env.SOLIDCRAFT_REFEREE_PKG), reached: shellRuns.length > 0, shellRuns, translateMs: ms,
    feats: tr.features.map((f) => [f.id, f.kind, f.status, f.guard ?? null, f.refusal ?? null, f.raw ?? null, f.cpuMs ?? null]),
    scene: bodies ? { volume: bodies.reduce((s, b) => s + b.volume_mm3, 0), bodies: bodies.length, com: bodies[0]?.center_of_mass ?? null } : null,
    finalHasShell: hasShell(tr.commands) }));
}
