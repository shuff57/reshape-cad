#!/usr/bin/env node
// ROUND 3. Where is solidcraft's native solid.hole(type:countersink) wrong on a BLIND hole, exactly? Source reading (crates/doc/src/eval.rs,
// HoleKind::Countersink) says the cone tool is extruded from the face down to radius 0.9*r, i.e. to depth dcx = (R - 0.9 r)/tan(half),
// regardless of the hole depth. If the bore floor (depth b) is above that, the cone overshoots below the floor. This sweeps b through the
// whole band, scores the removed volume against the closed form, and finds the smallest margin above dcx at which the result is right.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes3-cs-band.mjs --out=<dir>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { runIso } from './holes3-sc.mjs';
const OUT = path.resolve((process.argv.find((a) => a.startsWith('--out=')) ?? '--out=.').slice(6)); mkdirSync(OUT, { recursive: true });
const PI = Math.PI;
function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
const out = [];
function one(d, D, a, b, T = 20) {
  const cmds = [{ command: 'solid.box', params: { length: 40, width: 30, height: T, center: [0, 0, 0], body_name: 'b' } },
    { command: 'solid.hole', params: { position: [0, 0, T / 2], diameter: d, depth: b, type: 'countersink', cs_diameter: D, cs_angle: `${a} deg`, body: 'b' } }];
  const base = 40 * 30 * T;
  const run = runIso(cmds, 120000);
  if (run.timeout) return { d, D, a, b, refused: 'TIMEOUT 120 s (killed)', hang: true };
  const r = run.result;
  const want = csRem(d, D, a, b);
  if (!r.ok) return { d, D, a, b, refused: `${r.failed?.command}: ${r.failed?.error}`.slice(0, 120) };
  const bs = r.measure.bodies; const bd = bs[0];
  const rem = base - bd.volume_mm3;
  return { d, D, a, b, cpuMs: run.cpuMs, removed: rem, want, rel: Math.abs(rem - want) / want, bodies: bs.length, shells: bd.kernel.shells, faces: bd.faces };
}
const tanH = (a) => Math.tan((a * PI) / 360);
const cases = [];
for (const [d, D, a] of [[6, 12, 90], [6, 12, 120], [6, 14, 60], [10, 20, 90], [3, 6, 90], [4, 9, 82]]) {
  const r = d / 2; const R = D / 2; const dc = (R - r) / tanH(a); const dcx = (R - 0.9 * r) / tanH(a);
  const bs = [0.5 * dc, dc - 0.2, dc, dc + 0.01, (dc + dcx) / 2, dcx - 1e-3, dcx, dcx + 1e-6, dcx + 1e-4, dcx + 1e-3, dcx + 1e-2, dcx + 0.05, dcx + 0.1, dcx + 0.3, dcx + 1, dcx + 5].filter((x) => x > 0.05);
  for (const b of bs) { const o = one(d, D, a, +b.toFixed(9)); o.dc = dc; o.dcx = dcx; o.offsetFromDcx = b - dcx; cases.push(o); }
}
for (const o of cases) console.log(`d${o.d} D${o.D} a${o.a} b=${o.b.toFixed(5)} (b-dcx=${o.offsetFromDcx.toFixed(6)}; dc=${o.dc.toFixed(3)}) ${o.refused ? 'REFUSED ' + o.refused : `removed ${o.removed.toFixed(4)} want ${o.want.toFixed(4)} rel ${o.rel.toExponential(2)} bodies ${o.bodies} shells ${o.shells} faces ${o.faces}`}`);
writeFileSync(path.join(OUT, 'holes3-cs-band.json'), JSON.stringify(cases, null, 1));
