#!/usr/bin/env node
// FEASIBILITY PROBE round 2, not part of the translator. holes-probe-recess.mjs showed solidcraft's native solid.hole (type
// counterbore|countersink) is right on the 12 gauntlet recess cases. This probe goes where that one did not: the geometries a naive
// mapping of solid.hole would get silently WRONG. Every case runs the native solid.hole and is scored against
//   (1) brep-rs, run from the equivalent reSHape Script (it is the only live kernel that cuts recesses; OCCT ignores them),
//   (2) an independent closed form / numeric integral.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes-probe-recess2.mjs --out=<dir>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSC, brep, runScript, solveDoc, translateDoc, arc, mt, OUT } from './holes-base.mjs';

const PI = Math.PI;
const cyl = (d, L) => PI * (d / 2) ** 2 * L;
const lens = (r, d) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
const unionArea = (r, d) => 2 * PI * r * r - lens(r, d);
function csRem(d, D, a, bl) { // frustum of the cone clipped at depth bl, plus the bore below it
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
// 16 x 12 pocket, 4 deep, centred (22,15): the 9 mm recess circle fits inside it, so the closed forms below are exact
const POCKET = `${PLATE} const s2 = sketch('top', 10); s2.rect(16, 12, { at: [22, 15] }); const p = pocket(s2, plate, 4);`;

/** brep-rs measure of a whole script */
function brepOf(src) {
  const run = runScript(src);
  if (run.errors?.length) return { scriptError: run.errors.map((e) => e.message ?? String(e))[0] };
  const doc = run.doc; const last = doc.features.at(-1).id;
  const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const s = got.shapes?.[last];
  if (s && !Object.keys(got.refusals ?? {}).length) return { volume: s.volume, faces: s.faces };
  return { refused: Object.values(got.refusals ?? {}).join(' | ') || 'brep-rs built nothing' };
}
/** truck: translate the script UP TO (not including) the final hole, then append native solid.hole command(s). */
function nativeOf(baseSrc, holes, baseBody) {
  const run = runScript(baseSrc);
  const doc = solveDoc(run.doc);
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
  const last = tr.features.at(-1);
  const body = baseBody ?? last.measure.bodies[0];
  const v0 = last.measure.volume;
  const cmds = [...tr.commands, ...holes.map((p) => ({ command: 'solid.hole', params: { ...p, body } }))];
  const r = runSC(cmds);
  if (!r.ok) return { refused: `${r.failed?.command}: ${r.failed?.error}`, v0 };
  const bs = r.measure.bodies;
  const b = bs.find((x) => x.name === body) ?? bs[0];
  return { v0, volume: b.volume_mm3, faces: b.faces, bodies: bs.length, removed: v0 - b.volume_mm3 };
}
const cs = (D, a) => ({ type: 'countersink', cs_diameter: D, cs_angle: `${a} deg` });
const cb = (D, h) => ({ type: 'counterbore', cb_diameter: D, cb_depth: h });

const rows = [];
function run(id, what, baseSrc, fullSrc, holes, closedRemoved, baseBody) {
  const n = nativeOf(baseSrc, holes, baseBody);
  const k = brepOf(fullSrc);
  const row = { id, what, script: fullSrc, native: n, brep: k, closedRemoved };
  const base = n.v0;
  if (n.volume !== undefined) {
    row.dClosedRemoved = closedRemoved ? Math.abs(n.removed - closedRemoved) / closedRemoved : null;
    if (k.volume !== undefined) { row.brepRemoved = base - k.volume; row.dBrep = Math.abs(n.volume - k.volume) / k.volume; }
  }
  rows.push(row);
  const f = (v) => (typeof v === 'number' ? v.toFixed(3) : '-');
  console.log(`${id.padEnd(40)} native removed ${f(n.removed)}${n.refused ? ' REFUSED ' + n.refused.slice(0, 80) : ''} | closed ${f(closedRemoved)} | brep ${k.refused ? 'REFUSED "' + k.refused + '"' : k.scriptError ? 'SCRIPT-ERR ' + k.scriptError : 'removed ' + f(row.brepRemoved) + ' V=' + f(k.volume)} | dBrep ${row.dBrep?.toExponential(1)} dClosed ${row.dClosedRemoved?.toExponential(1)}`);
}

const platePos = (x, y) => [20 + x, 15 + y, 10];
// (a) countersink cone deeper than a blind hole
for (const deep of [1, 2, 2.5, 3, 4]) {
  run(`cs-cone-deeper-than-blind-deep${deep}`, `countersink 12/90 over a 6 bore, blind ${deep} (cone alone is 3 deep)`, PLATE,
    `${PLATE} hole(plate, { across: 6, deep: ${deep}, countersink: { across: 12, angle: 90 } });`,
    [{ position: platePos(0, 0), diameter: 6, depth: deep, ...cs(12, 90) }], csRem(6, 12, 90, deep));
}
// (b) bore column over a pocket: the recess must be measured from the TOP face (z=10), not from the pocket floor (z=6)
run('cb-in-pocket-9x7', 'counterbore 9 x 7 deep, bore 4 through, centred in a 4-deep pocket (floor at 6, top at 10): the recess reaches 3 below the floor',
  POCKET, `${POCKET} hole(p, { across: 4, at: [2, 0], counterbore: { across: 9, deep: 7 } });`,
  [{ position: platePos(2, 0), diameter: 4, ...cb(9, 7) }],
  // material only below z=6: bore 6 long + recess ring 3 deep (z 6..3 within the 9 circle, minus the bore)
  cyl(4, 6) + (cyl(9, 3) - cyl(4, 3)));
run('cb-in-pocket-9x3', 'counterbore 9 x 3 deep, bore 4, centred in the 4-deep pocket: the recess is entirely in air; only the bore (6 of floor) is cut',
  POCKET, `${POCKET} hole(p, { across: 4, at: [2, 0], counterbore: { across: 9, deep: 3 } });`,
  [{ position: platePos(2, 0), diameter: 4, ...cb(9, 3) }], cyl(4, 6));
run('cs-in-pocket-8x90', 'countersink 8/90 over a 4 bore (cone 2 deep, all of it in the 4 mm of air above the floor): only the bore through the floor is cut',
  POCKET, `${POCKET} hole(p, { across: 4, at: [2, 0], countersink: { across: 8, angle: 90 } });`,
  [{ position: platePos(2, 0), diameter: 4, ...cs(8, 90) }], cyl(4, 6));
// (c) counterbore deeper than the part
for (const d of [20, 21, 30]) {
  run(`cb-deeper-than-part-${d}`, `counterbore 12 x ${d} in a 20 thick box (bore 6 through)`, BOX,
    `${BOX} hole(b, { across: 6, counterbore: { across: 12, deep: ${d} } });`,
    [{ position: [0, 0, 10], diameter: 6, ...cb(12, d) }], cyl(12, 20));
}
// (d) overlapping recesses of adjacent bores (holes())
{
  const sx = 5; const sy = 7;
  const fourCb = [[-sx, -sy], [sx, -sy], [-sx, sy], [sx, sy]].map(([x, y]) => ({ position: platePos(x, y), diameter: 4, ...cb(12, 3) }));
  run('holes-cb-overlap', 'holes() 4 bores d4, apart [10,14], counterbore d12 x 3: the recesses of the two bores 10 apart overlap (lens)', PLATE,
    `${PLATE} holes(plate, { across: 4, apart: [10, 14], counterbore: { across: 12, deep: 3 } });`,
    fourCb, 2 * unionArea(6, 10) * 3 + 4 * cyl(4, 7));
  const fourCs = [[-sx, -sy], [sx, -sy], [-sx, sy], [sx, sy]].map(([x, y]) => ({ position: platePos(x, y), diameter: 4, ...cs(14, 90) }));
  // numeric truth for overlapping countersinks: integrate the depth of the union of two cones (depth below the top surface at (x,y) is the larger of the two cones' depths), plus bores
  const R = 7; const r = 2; const depthAt = (x, y, cx) => { const q = Math.hypot(x - cx, y); return q <= r ? 10 : q <= R ? Math.min(10, R - q) : 0; };
  let s = 0; const n = 1400; const hh = (2 * 12) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < 14 / hh; j++) { const x = -12 + (i + 0.5) * hh; const y = -7 + (j + 0.5) * hh; s += Math.max(depthAt(x, y, -sx), depthAt(x, y, sx)) * hh * hh; }
  // the two rows are 14 apart, cones of radius 7 only touch at one point: total = 2 rows x (x in [-12,12], y in [-7,7] about the row axis)
  run('holes-cs-overlap', 'holes() 4 bores d4, apart [10,14], countersink d14/90 (cone 5 deep): neighbouring cones overlap', PLATE,
    `${PLATE} holes(plate, { across: 4, apart: [10, 14], countersink: { across: 14, angle: 90 } });`,
    fourCs, 2 * s);
}
writeFileSync(path.join(OUT, 'holes-probe-recess2.json'), JSON.stringify(rows, null, 1));
console.log(`wrote ${path.join(OUT, 'holes-probe-recess2.json')}`);
