// Raw-kernel probe (no layer, no guard): the documented truck wrong-solid repros and the shell critic cases, run as their own command
// lists on the rc.2 kernel, each in a child process with a wall limit, and scored against TWO independent references:
//   P     the plane-offset closed form recorded with the case (fuzz/oracle.mjs value for the repros; hand closed forms from
//         fixes/shell-stub/NOTES.md and phase7/probe-shell-rim.mjs for the critic cases);
//   OCCT  the same command list built directly in OCCT (lib.mjs occtFromCommands), shell by MakeThickSolidByJoin, Intersection join
//         (the P convention) and Arc join (occt-build.ts's) both recorded.
// Class: REFUSED (kernel error), HANG (wall limit), CRASH, MATCH (|V-P|/P <= 1e-3, or vs OCCT-int where P is absent),
//        WRONG (built, off P by > 1e-3 AND off every OCCT number that built by > 1e-3), SPLIT (off one reference only).
//        A row scored on one reference only says so: MATCH(P only), WRONG?(one oracle). OCCT's thick solid is used only where lib.mjs accepts it.
//   flock ~/.cache/solidcraft-0.40.0-rc.2-rig/rig.lock node raw-probe.mjs [--limit=300] [--only=a,b] > raw-probe.log
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, PKG, kernelRun, volOf, rel, occtSafe, resetOcct } from './lib.mjs';
import { oracle } from '../fuzz/oracle.mjs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const LIMIT = Number(arg('limit', 300)); const only = arg('only', '').split(',').filter(Boolean);
const OUT = arg('out', path.join(path.dirname(new URL(import.meta.url).pathname), 'raw-probe.json'));
const TOL = 1e-3;
const cases = [];
// 1. fuzz/repros: the truck WRONG rows (p7/p8 CLI and the 474-sweep), with the oracle's P recorded beside them
const RD = path.join(REPO, 'docs/spikes/solidcraft-referee/fuzz/repros');
for (const f of readdirSync(RD).sort()) {
  const j = JSON.parse(readFileSync(path.join(RD, f), 'utf8'));
  const P = j.p8?.expectedP ?? j.p7?.expectedP;
  cases.push({ id: `repro-${f.replace('.json', '')}`, family: f.startsWith('p8') ? 'repro p8 (A/B/C)' : 'repro p7/sweep (A)', desc: j.desc, cmds: j.commands, P,
    truck: { p8: j.p8 ?? null, p7: j.p7 ?? null, base: j.base ?? null } });
}
// 2. phase7/probe-shell-rim.mjs cases (same command lists; P as recorded there) + n17b from fixes/shell-stub/shell-stub.patch
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const comb = (t, tool, op) => ({ command: 'solid.combine', params: { target: t, tools: [tool], operation: op } });
const shell = (pt, t = 1) => ({ command: 'solid.shell', params: { faces: [pt], thickness: t, body: 'b1' } });
const plate = box('b1', 40, 30, 10, [0, 0, 0]);
const rim = (w) => [plate, box('b2', 10, 10, 6, [15, 10, 8]), box('h', 10 - 2 * w, 10 - 2 * w, 8, [15, 10, 8]), comb('b2', 'h', 'cut'), comb('b1', 'b2', 'join'), shell([-17, -12, 5])];
const fil = (pts, r) => ({ command: 'solid.fillet', params: { edges: pts, radius: r, body: 'b1' } });
const corners = [[20, 15, 0], [-20, 15, 0], [20, -15, 0], [-20, -15, 0]];
// P from fuzz/oracle.mjs on the rim model fuzz/selfcheck.mjs validates (2872 - 48 (w - 2) for w >= 2t, exact); for w < 2t the closed form does
// not apply and only the oracle's value is used (an earlier draft of this probe extrapolated the line, which is wrong there).
const rimModel = (w) => ({ t: 1, mode: 'rect', boxes: [[-20, 20, -15, 15, -5, 5], [10, 20, 5, 15, 5, 11]], cuts: [[10 + w, 20 - w, 5 + w, 15 - w, 5, 11]], opens: [{ axis: 'z', dir: 1, coord: 5, rect: [-20, 20, -15, 15], minus: [[10, 20, 5, 15]] }], holes: [], rbosses: [] });
for (const w of [3, 2.5, 2.05, 2.006, 2.002, 2.0, 1.95, 1.5]) cases.push({ id: `rim-w${w}`, family: 'A rim on the open face', cmds: rim(w), P: oracle(rimModel(w), { h: 0.05 }).P, note: w > 2 ? 'oracle P (= closed form 2872 - 48 (w - 2))' : 'oracle P only (w <= 2t; truck p8 refused these)' });
const hole = (n, cx, cy) => [{ command: 'solid.cylinder', params: { radius: 2, height: 20, base: [cx, cy, -10], body_name: n } }, comb('b1', n, 'cut')];
const holes = (list) => [plate, ...list.flatMap(([cx, cy], i) => hole('h' + (i + 1), cx, cy)), shell([-10, -8, 5])];
const one = 2424 + 41 * Math.PI, two = 2424 + 82 * Math.PI;
for (const [id, list, P] of [
  ['lig-web1.0-east', [[17, 0]], 2524.93], ['lig-web1.0-north', [[0, 12]], 2524.87], ['lig-web1.5-east', [[16.5, 0]], null], ['lig-web1.9-east', [[16.1, 0]], 2551.88],
  ['lig-web2.0-east', [[16, 0]], one], ['lig-web2.1-east', [[15.9, 0]], one], ['lig-web3.0-east', [[15, 0]], one],
  ['lig-two-gap1.0', [[-2.5, 0], [2.5, 0]], 2661.10], ['lig-two-gap1.9', [[-2.95, 0], [2.95, 0]], null], ['lig-two-gap2.1', [[-3.05, 0], [3.05, 0]], two], ['lig-centre', [[0, 0]], one],
]) cases.push({ id, family: 'A hole ligament', cmds: holes(list), P });
cases.push(
  { id: 'counterbore-open-top', family: 'critic', cmds: [plate, ...hole('h1', -8, -6), { command: 'solid.cylinder', params: { radius: 4, height: 3, base: [-8, -6, 3], body_name: 'h2' } }, comb('b1', 'h2', 'cut'), shell([0, 8, 5])], P: 2424 + 65 * Math.PI },
  { id: 'n7-vertex-boss', family: 'n7', cmds: [plate, box('b2', 8, 8, 8, [24, 19, 9]), comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2720, note: 'P = the notes\' "separate piece hollowed closed" reading; a policy choice, not a measured error' },
  { id: 'n17b-box-on-cylinder-wall', family: 'n17b', cmds: [{ command: 'solid.cylinder', params: { radius: 15, height: 30, base: [0, 0, 0], body_name: 'b1' } }, box('b2', 14, 10, 10, [19, 0, 15]), comb('b1', 'b2', 'join'), shell([0, 0, 30])], P: 3760.8537 },
  { id: 'n6-rounded-plate-boss', family: 'critic', cmds: [plate, fil(corners, 3), box('b2', 10, 10, 8, [15, 0, 9]), comb('b1', 'b2', 'join'), shell([-5, 8, 5])], P: 2729.646 },
  { id: 'n9-corner-boss-hole', family: 'critic', cmds: [plate, box('b2', 10, 10, 8, [15, 10, 9]), comb('b1', 'b2', 'join'), { command: 'solid.cylinder', params: { radius: 2, height: 30, base: [15, 10, -10], body_name: 'h1' } }, comb('b1', 'h1', 'cut'), shell([0, 0, 5])], P: 3002.195 },
  { id: 'n10-round-boss', family: 'critic', cmds: [plate, { command: 'solid.cylinder', params: { radius: 4, height: 6, base: [16, 11, 5], body_name: 'b2' } }, comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2584.221 },
  { id: 'n11-round-pocket-floor-open', family: 'critic', cmds: [plate, { command: 'solid.cylinder', params: { radius: 8, height: 4, base: [0, 0, 2], body_name: 'p1' } }, comb('b1', 'p1', 'cut'), shell([0, 0, 2])], P: 3393.752 },
  { id: 'n8b-pad-0.5', family: 'critic', cmds: [plate, box('b2', 10, 10, 0.5, [15, 10, 5.25]), comb('b1', 'b2', 'join'), shell([0, 0, 5])], P: 2474 },
  { id: 'control-plain-open-top', family: 'control', cmds: [plate, shell([0, 0, 5])], P: 40 * 30 * 10 - 38 * 28 * 9 },
);
const rows = [];
for (const c of cases) {
  if (only.length && !only.some((o) => c.id.startsWith(o))) continue;
  const k = kernelRun(c.cmds, { limitS: LIMIT });
  const V = volOf(k);
  const pre = c.cmds.some((x) => x.command === 'solid.shell') ? volOf(kernelRun(c.cmds.filter((x) => x.command !== 'solid.shell'), { limitS: LIMIT })) : null;
  let oi = occtSafe(c.cmds, 'intersection'); if (oi.error && /memory|bounds/i.test(oi.error)) await resetOcct();
  let oa = occtSafe(c.cmds, 'arc'); if (oa.error && /memory|bounds/i.test(oa.error)) await resetOcct();
  const row = { id: c.id, family: c.family, desc: c.desc, note: c.note, P: c.P ?? null, kernel: { ok: !!k.ok, volume: V, bodies: k.ok ? k.measure.bodies.length : null, pre, ms: k.ms ?? null, wall: k.wall, hang: !!k.hang, crash: !!k.crash, error: k.ok ? null : (k.failed ? `${k.failed.command}: ${k.failed.error}` : k.error ?? k.stderr ?? null) },
    occtInt: oi, occtArc: oa, truck: c.truck };
  row.rel = { P: rel(V, c.P), occtInt: rel(V, oi.volume), occtArc: rel(V, oa.volume), occtIntVsP: rel(oi.volume, c.P), occtArcVsP: rel(oa.volume, c.P) };
  const refs = [['P', row.rel.P], ['occtInt', row.rel.occtInt], ['occtArc', row.rel.occtArc]].filter(([, r]) => r != null);
  if (k.hang) row.cls = 'HANG'; else if (k.crash) row.cls = 'CRASH'; else if (!k.ok) row.cls = 'REFUSED';
  else if (!refs.length) row.cls = 'NO-ORACLE';
  else if (refs.every(([, r]) => r > TOL)) row.cls = refs.length >= 2 ? 'WRONG' : 'WRONG?(one oracle)';
  else if (refs.every(([, r]) => r <= TOL)) row.cls = refs.length >= 2 ? 'MATCH' : `MATCH(${refs[0][0]} only)`;
  else row.cls = (row.rel.P != null && row.rel.P <= TOL) ? 'MATCH(P)' : 'SPLIT';
  rows.push(row);
  const e = (v) => (v == null ? '-' : v.toExponential(1));
  console.log(`${c.id.padEnd(30)} ${row.cls.padEnd(9)} V=${V?.toFixed(4) ?? '-'} P=${c.P?.toFixed?.(4) ?? '-'} occtInt=${oi.volume?.toFixed(4) ?? oi.error} occtArc=${oa.volume?.toFixed(4) ?? oa.error} | rel P ${e(row.rel.P)} int ${e(row.rel.occtInt)} arc ${e(row.rel.occtArc)} | ${k.ms != null ? (k.ms / 1000).toFixed(2) + ' s' : (k.hang ? 'HANG>' + LIMIT + 's' : '')} ${row.kernel.error ? '| ' + String(row.kernel.error).slice(0, 160) : ''}`);
  writeFileSync(OUT, JSON.stringify({ pkg: PKG, limitS: LIMIT, tolerance: TOL, rows }, null, 1));
}
const n = (k) => rows.filter((r) => r.cls.startsWith(k)).length;
console.log(`DONE ${rows.length}: MATCH ${n('MATCH')} REFUSED ${n('REFUSED')} WRONG ${n('WRONG')} SPLIT ${n('SPLIT')} HANG ${n('HANG')} CRASH ${n('CRASH')} -> ${OUT}`);
