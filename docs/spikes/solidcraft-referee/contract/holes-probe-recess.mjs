#!/usr/bin/env node
// FEASIBILITY PROBE, not part of the translator. Counterbore and countersink are refused by phase0/translate.mjs
// ("not mapped in phase 0"). SolidCraft has a native solid.hole with type counterbore|countersink (features.rs:54). This script runs
// the gauntlet's recess cases through solid.hole directly and scores the volume against the saved FreeCAD ref and a closed form,
// so the next round knows whether a mapping would be right before anyone writes it.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes-probe-recess.mjs --out=<dir>
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runSC, REPO, OUT } from './holes-base.mjs';

const PI = Math.PI;
const cyl = (d, L) => PI * (d / 2) ** 2 * L;
const cbRem = (d, R, cbd, bl) => cyl(d, bl) + cyl(R, cbd) - cyl(d, cbd);
function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
const fc = (id) => { try { return JSON.parse(readFileSync(path.join(REPO, 'docs/replica/freecad/gauntlet/variants/refs', `ref-${id}.json`), 'utf8')); } catch { return null; } };

const P = (id, o) => ({ id, w: 40, d: 30, h: 10, at: [0, 0], ...o });
const CASES = [
  P('hole-counterbore__through-offset', { across: 6, at: [-9, 6], cb: [12, 3], rem: (o) => cbRem(6, 12, 3, o.h) }),
  P('hole-counterbore__deep-recess', { h: 20, across: 6, cb: [14, 7], rem: (o) => cbRem(6, 14, 7, o.h) }),
  P('hole-counterbore__blind', { across: 6, deep: 7, cb: [10, 3], rem: () => cbRem(6, 10, 3, 7) }),
  P('hole-counterbore__wide-thin', { w: 60, d: 40, h: 6, across: 5, cb: [24, 2], rem: (o) => cbRem(5, 24, 2, o.h) }),
  P('hole-countersink__angle-90-offset', { across: 6, at: [6, -4], cs: [12, 90], rem: (o) => csRem(6, 12, 90, o.h) }),
  P('hole-countersink__angle-120', { across: 5, cs: [14, 120], rem: (o) => csRem(5, 14, 120, o.h) }),
  P('hole-countersink__angle-60', { across: 4, cs: [10, 60], rem: (o) => csRem(4, 10, 60, o.h) }),
  P('hole-countersink__thick-block', { h: 30, across: 8, cs: [16, 90], rem: (o) => csRem(8, 16, 90, o.h) }),
  P('hole-countersink__blind', { across: 6, deep: 6, cs: [12, 90], rem: () => csRem(6, 12, 90, 6) }),
  P('hole-countersink__cone-deeper-than-plate-roomy', { d: 40, across: 5, cs: [30, 90], rem: (o) => csRem(5, 30, 90, o.h) }),
  P('hole-countersink__cone-deeper-than-plate-angle-60', { d: 40, h: 6, across: 5, cs: [24, 60], rem: (o) => csRem(5, 24, 60, o.h) }),
  P('hole-countersink__cone-deeper-than-plate', { across: 5, cs: [30, 90], rem: (o) => csRem(5, 30, 90, o.h), note: 'tangent rim: the 30 mouth equals the 30 plate depth' }),
];

const rows = [];
for (const c of CASES) {
  const box = { command: 'solid.box', params: { length: c.w, width: c.d, height: c.h, center: [c.w / 2, c.d / 2, c.h / 2], body_name: 'P' } };
  const params = { position: [c.w / 2 + c.at[0], c.d / 2 + c.at[1], c.h], diameter: c.across, body: 'P' };
  if (c.deep !== undefined) params.depth = c.deep;
  if (c.cb) Object.assign(params, { type: 'counterbore', cb_diameter: c.cb[0], cb_depth: c.cb[1] });
  if (c.cs) Object.assign(params, { type: 'countersink', cs_diameter: c.cs[0], cs_angle: `${c.cs[1]} deg` });
  const r = runSC([box, { command: 'solid.hole', params }]);
  const row = { id: c.id, note: c.note, params };
  if (!r.ok) { row.refused = `${r.failed?.command}: ${r.failed?.error}`; rows.push(row); continue; }
  const b = r.measure.bodies.find((x) => x.name === 'P') ?? r.measure.bodies[0];
  const v0 = c.w * c.d * c.h;
  const closedV = v0 - c.rem(c);
  const ref = fc(c.id);
  row.bodies = r.measure.bodies.length; row.volume = b.volume_mm3; row.faces = b.faces; row.faceTypes = b.face_types;
  row.closedVolume = closedV; row.dClosed = Math.abs(b.volume_mm3 - closedV) / closedV;
  row.dClosedRemoved = Math.abs((v0 - b.volume_mm3) - c.rem(c)) / c.rem(c);
  if (ref) { row.fcVolume = ref.volume; row.fcFaces = ref.faces; row.dFc = Math.abs(b.volume_mm3 - ref.volume) / ref.volume; row.dFcRemoved = Math.abs((v0 - b.volume_mm3) - (v0 - ref.volume)) / (v0 - ref.volume); row.dBbox = Math.max(...[0, 1, 2].map((i) => Math.abs(b.bbox.min[i] - ref.bbox[i]) + Math.abs(b.bbox.max[i] - ref.bbox[i + 3]))); }
  rows.push(row);
  const e = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  console.log(`${c.id.padEnd(54)} vol ${b.volume_mm3.toFixed(4)} closed ${closedV.toFixed(4)} dClosed ${e(row.dClosed)} dClosedRem ${e(row.dClosedRemoved)} | fc ${ref ? ref.volume.toFixed(4) : '-'} dFc ${e(row.dFc)} dFcRem ${e(row.dFcRemoved)} faces ${row.faces}/${ref?.faces ?? '-'} bodies ${row.bodies}`);
}
writeFileSync(path.join(OUT, 'holes-probe-recess.json'), JSON.stringify(rows, null, 1));
console.log(`wrote ${path.join(OUT, 'holes-probe-recess.json')}`);
