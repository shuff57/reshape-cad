// Sketch contact gap + tangency residual (HANDOFF.md; phase7/README.md "Sketch limit"), re-measured on the rc.2 engine through the topology
// wrapper's @sketch dump (SolidCraft's own solved points and SolveReport). Same probes and the same 8 starts as phase7/probe-sketch-limit.mjs
// (same LCG seed and jitter), mapped by phase2/sketch-map.mjs (the spike mapper) instead of the browser pane.
// Reference: the true tangent point (foot of the circle centre on the solved line), computed here from the solved points: an exact closed
// form, independent of either solver. "contact error" = distance from the line end (the contact) to that foot.
//   flock ~/.cache/solidcraft-0.40.0-rc.2-rig/rig.lock node sketch-contact-probe.mjs [--out=sketch-contact.json] [--dump]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, TOPO } from './lib.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const OUT = arg('out', path.join(path.dirname(new URL(import.meta.url).pathname), 'sketch-contact.json'));
const mapper = await import(pathToFileURL(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/sketch-map.mjs')).href);
const sc = createRequire(import.meta.url)(path.join(TOPO, 'solidcraft_referee_p2.js'));
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
const j = (v, amp) => +(v + rnd() * 2 * amp).toFixed(4);
const R = 5;
const probeA = (amp, exact = false, arc = false) => ({
  geoms: [arc ? { k: 'arc', id: 1, c: [0, 0], r: exact ? R : j(R, amp / 2), a: [4.6985, 1.7101], b: [-4.6985, 1.7101], sense: 'ccw' } : { k: 'circle', id: 1, c: [0, 0], r: exact ? R : j(R, amp / 2) },
    { k: 'line', id: 2, a: [exact ? 0 : j(0, amp), exact ? 5 : j(5, amp)], b: [exact ? 12 : j(12, amp), exact ? 5 : j(5.5, amp)] }],
  rules: [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'radius', a: 1, value: R }, { k: 'tangent', a: 2, b: 1 }, { k: 'distance', a: 2, aEnd: 'a', b: 1, bEnd: 'c', value: R }] });
const probeB = (amp, exact = false) => { const th = 0.9 + amp * 2 * (rnd() + 0.5); const ax = +(-R * Math.cos(th)).toFixed(6), ay = +(R * Math.sin(th)).toFixed(6); return {
  geoms: [{ k: 'circle', id: 1, c: [0, 0], r: R }, { k: 'line', id: 2, a: [ax, ay], b: [exact ? +(ax + 8 * ay / R).toFixed(6) : j(ax + 8, amp * 4), exact ? +(ay + 8 * Math.cos(th)).toFixed(6) : j(ay + 6, amp * 4)] },
    { k: 'point', id: 3, p: [-ax, ay] }, { k: 'line', id: 4, a: [0, -9], b: [0, 9] }],
  rules: [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'radius', a: 1, value: R }, { k: 'lock', a: 4, aEnd: 'a' }, { k: 'lock', a: 4, aEnd: 'b' }, { k: 'pointOnObject', a: 3, b: 1 }, { k: 'symmetric', a: 2, aEnd: 'a', b: 3, c: 4 }, { k: 'tangent', a: 2, b: 1 }] }; };
const probeD = (amp, exact = false) => probeA(amp, exact, true);
function run({ geoms, rules }) {
  const m = mapper.mapSketch({ id: 'p', plane: 'xy', geoms, rules }, { name: 'sk' });
  if (!m.ok) return { mapperRefused: m.refusals.map((r) => r.sentence) };
  const cmds = mapper.extrudeCommands(m, { height: 10 });
  const t0 = performance.now(); const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); const ms = performance.now() - t0;
  const bad = r.results.find((x) => !x.ok);
  const dump = r.results.find((x) => x.command === '@sketch')?.out;
  return { ms, refused: bad ? `${bad.command}: ${bad.error}` : null, dump, cmds };
}
function analyse(res) {
  if (res.mapperRefused) return { refused: true, sentence: res.mapperRefused.join(' | ') };
  const d = res.dump; if (!d || d.error || !d.sketch) return { refused: true, sentence: res.refused, dumpError: d?.error ?? null };
  const pts = Object.fromEntries((d.sketch.points ?? []).map((p) => [p.id, p.pos ?? p.position ?? p.p]));
  const C = (d.sketch.curves ?? []).find((c) => c.type === 'circle' || c.type === 'arc' || c.kind === 'circle' || c.kind === 'arc');
  const cen = pts['g1.center'] ?? [0, 0]; const a = pts['g2.start'], b = pts['g2.end'];
  if (!a || !b) return { refused: !!res.refused, sentence: res.refused, note: 'line points not found in dump', keys: Object.keys(pts) };
  const dv = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...dv);
  const t = ((cen[0] - a[0]) * dv[0] + (cen[1] - a[1]) * dv[1]) / L;
  const perp = Math.abs(dv[0] * (cen[1] - a[1]) - dv[1] * (cen[0] - a[0])) / L;
  const rep = d.report ?? {};
  return { sentence: res.refused, status: rep.status, dof: rep.dof, redundant: rep.redundant, failing: rep.failing, solverMaxResidual: rep.max_residual ?? null,
    contactErrMm: Math.abs(t), perpMinusR: C ? perp - (C.r ?? C.radius ?? R) : perp - R, ms: res.ms };
}
if (process.argv.includes('--dump')) { const r = run(probeA(0)); console.log(JSON.stringify({ refused: r.refused, dump: r.dump }, null, 1).slice(0, 4000)); process.exit(0); }
const results = { pkg: TOPO, probes: {} };
const AMPS = [0, 0.05, 0.1, 0.25, 0.5, 0.05, 0.1, 0.25];
for (const [name, mk] of [['A distance-pinned contact', probeA], ['B Symmetric-tied contact', probeB], ['D distance-pinned contact, ARC', probeD]]) {
  seed = 12345; results.probes[name] = [];
  for (const amp of AMPS) { const r = analyse(run(mk(amp))); results.probes[name].push({ amp, ...r }); console.log(name, amp, JSON.stringify(r)); }
}
for (const [n, mk] of [['A0 exact-tangent start', probeA], ['B0 exact-tangent start', probeB], ['D0 exact-tangent start, ARC', probeD]]) { const r = analyse(run(mk(0, true))); results.probes[n] = r; console.log(n, JSON.stringify(r)); }
writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log('wrote', OUT);
