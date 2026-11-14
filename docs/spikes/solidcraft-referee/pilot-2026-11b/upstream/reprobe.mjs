// reprobe.mjs: the four engine findings of the second pilot, tried on one SolidCraft release. Raw command lists, no layer: what is printed is the engine's.
//   node reprobe.mjs <label> <dir of solidcraft_referee.js> <dir of solidcraft_referee_p2.js> [out.json]
// The lists are commands-0.30.1.json (capture.mjs wrote them: what the layer sends on the pin). Every engine run is a fresh process, so a run that
// ends the engine (a wasm trap) or never returns (limit 300 s) costs only itself.
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ME = fileURLToPath(import.meta.url);

if (process.argv[2] === '--run') { // child: one list on one package; prints one JSON line
  const [, , , kind, pkg, file, timesArg] = process.argv; const cmds = JSON.parse(fs.readFileSync(file, 'utf8')); const times = Number(timesArg ?? 1);
  const req = createRequire(import.meta.url); const out = [];
  for (let k = 0; k < times; k++) {
    try {
      if (kind === 'measure') { const sc = req(path.join(pkg, 'solidcraft_referee.js')); out.push(JSON.parse(sc.run(JSON.stringify({ commands: cmds })))); }
      else { // topology: every command's output, then the faces of each body in the order the engine lists them
        const sc = req(path.join(pkg, 'solidcraft_referee_p2.js')); const raw = (c) => JSON.parse(sc.run(JSON.stringify({ commands: c })));
        const r = raw(cmds); const bad = r.results.find((x) => !x.ok); if (bad) { out.push({ ok: false, failed: { command: bad.command, error: bad.error } }); continue; }
        const names = r.measure.out.bodies.map((b) => b.name); const r2 = raw([...cmds, ...names.map((n) => ({ command: 'model.faces', params: { body: n } }))]);
        const faces = r2.results.slice(cmds.length).flatMap((x) => (x.ok ? (x.out?.faces ?? x.out ?? []) : [{ error: x.error }]));
        out.push({ ok: true, volume: r.measure.out.bodies.map((b) => b.volume_mm3), faces: faces.map((f) => (f.error ? f : { name: f.name, at: (f.centroid ?? []).map((v) => Math.round(v * 1e6) / 1e6) })) });
      }
    } catch (e) { out.push({ ok: false, trap: String(e && e.message || e).slice(0, 300) }); break; }
  }
  process.stdout.write(JSON.stringify(out)); process.exit(0);
}

const [label, PKG, TOPO, OUT] = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(path.join(HERE, 'commands-0.30.1.json'), 'utf8')); const tmp = fs.mkdtempSync('/tmp/reprobe-');
function run(kind, cmds, times = 1) {
  const f = path.join(tmp, 'c.json'); fs.writeFileSync(f, JSON.stringify(cmds)); const t0 = Date.now();
  const r = spawnSync(process.execPath, [ME, '--run', kind, kind === 'measure' ? PKG : TOPO, f, String(times)], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 28 });
  const ms = Date.now() - t0;
  if (r.error || r.status !== 0) return { ms, died: r.error ? String(r.error.message).slice(0, 120) : `exit ${r.status} ${String(r.stderr).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300)}` };
  try { return { ms, runs: JSON.parse(r.stdout) }; } catch { return { ms, died: 'no JSON: ' + r.stdout.slice(0, 200) }; }
}
const say = (r) => (r.died ? `the process died: ${r.died}` : r.runs.map((x) => (x.trap ? `WASM TRAP: ${x.trap}` : x.ok === false ? `refused: ${JSON.stringify(x.failed ?? x.error).slice(0, 260)}` : 'ok')).join(' ; '));
const body = (r) => (r.runs && r.runs[0] && r.runs[0].ok ? r.runs[0].measure.bodies[0] : null);
const res = { label, pkg: PKG };
console.log(`== ${label}`);

// 1. a pocket into a drafted cylinder: on 0.30.1 the last extrude panics (truck-geotrait curve.rs:78) and the web build never answers again
{ const full = L['panic: a pocket into a drafted cylinder'].failed[0].commands;
  const small = [full[0], full[1], ...full.slice(6)]; // without the first pocket: a cylinder, a draft of its wall, one shallow round pocket through the wall
  res.panic = {}; for (const [nm, c] of [['as the layer sent it (10 commands)', full], ['without the first pocket (6 commands)', small], ['without the draft (the control)', [full[0], ...full.slice(6)]]]) {
    const r = run('measure', c); res.panic[nm] = { ms: r.ms, says: say(r), volume: body(r)?.volume_mm3 ?? null }; console.log(`1 panic | ${nm}: ${say(r)}${body(r) ? ' volume ' + body(r).volume_mm3 : ''} (${r.ms} ms)`); } }

// 2. a box with all twelve edges rounded, read four times in one engine, and once more in another process
{ const c = L['round: a box with all twelve edges rounded'].accepted; const r = run('topology', c, 4); const r2 = run('topology', c, 1);
  const all = [...(r.runs ?? []), ...(r2.runs ?? [])];
  if (r.died || all.some((x) => !x.ok)) { res.round = { says: say(r) }; console.log('2 round |', say(r)); }
  else { const vols = all.map((x) => x.volume[0]); const orders = all.map((x) => x.faces.map((f) => f.at.join(',')).join(' / ')); const sets = all.map((x) => x.faces.map((f) => f.at.join(',')).sort().join(' / '));
    res.round = { volumes: vols, faces: all[0].faces.length, distinctVolumes: new Set(vols).size, distinctOrders: new Set(orders).size, sameFaces: new Set(sets).size === 1, spread: (Math.max(...vols) - Math.min(...vols)) / vols[0] };
    console.log(`2 round | ${all.length} readings (4 in one engine, 1 in another process): ${res.round.distinctVolumes} different volumes (spread ${res.round.spread.toExponential(2)} of the volume), ${res.round.distinctOrders} different orders of the ${res.round.faces} faces, the same set of faces: ${res.round.sameFaces}`); console.log('          volumes', vols.join(' ')); } }

// 3. a cylinder's wall: radius 8, height 30, base (8, -5, -12). Exact volume pi 64 30; exact box 0..16, -13..3, -12..18.
{ const exact = Math.PI * 64 * 30; const xb = [0, -13, -12, 16, 3, 18]; res.cylinder = {};
  const off = (b) => Math.max(...[...b.bbox.min, ...b.bbox.max].map((v, i) => Math.abs(v - xb[i])));
  const r = run('measure', L['cylinder: plain'].accepted); const b = body(r);
  if (!b) { res.cylinder.plain = { says: say(r) }; console.log('3 cylinder | plain:', say(r)); }
  else { res.cylinder.plain = { volume: b.volume_mm3, rel: (b.volume_mm3 - exact) / exact, boxOffMm: off(b), bbox: b.bbox }; console.log(`3 cylinder | plain: volume ${b.volume_mm3} (exact ${exact}, ${res.cylinder.plain.rel.toExponential(2)}), box off by ${off(b).toExponential(2)} mm`); }
  // with a 6 x 4 pocket 2 deep from z = 0 at (0..6, 0..4): what it removes is the part of the rectangle inside the circle (midpoint rule, 4000 x 4000), times 2
  let a = 0; const n = 4000; for (let i = 0; i < n; i++) { const x = (i + 0.5) * 6 / n; for (let j = 0; j < n; j++) { const y = (j + 0.5) * 4 / n; if ((x - 8) ** 2 + (y + 5) ** 2 <= 64) a++; } } a *= 24 / (n * n);
  const exactP = exact - 2 * a; const rp = run('measure', L['cylinder: with a pocket'].accepted); const bp = body(rp);
  if (!bp) { res.cylinder.pocket = { says: say(rp) }; console.log('3 cylinder | with a pocket:', say(rp)); }
  else { res.cylinder.pocket = { volume: bp.volume_mm3, byHand: exactP, rel: (bp.volume_mm3 - exactP) / exactP, boxOffMm: off(bp), bbox: bp.bbox }; console.log(`3 cylinder | with a pocket: volume ${bp.volume_mm3} (by hand ${exactP.toFixed(6)}, ${res.cylinder.pocket.rel.toExponential(2)}), box off by ${off(bp).toExponential(2)} mm`); } }

// 4. a five-sided prism, z -6 to 6, hollowed 2 with the top open, a bore of radius 3 along x at z = 5 through the rim: the part ends at z = 6
{ const r = run('measure', L['box: a prism hollowed, a cross bore through the rim'].accepted); const b = body(r);
  if (!b) { res.box = { says: say(r) }; console.log('4 box |', say(r)); }
  else { res.box = { zMax: b.bbox.max[2], zMin: b.bbox.min[2], above: b.bbox.max[2] - 6, volume: b.volume_mm3, ms: r.ms }; console.log(`4 box | the measured box ends at z = ${b.bbox.max[2]} (the part ends at 6: ${(b.bbox.max[2] - 6).toExponential(2)} mm above), volume ${b.volume_mm3} (${r.ms} ms)`); } }
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
