// A tangent row is symmetric in its two geometries: naming the arc before the
// line must solve to the same geometry and the same DoF as naming the line
// first. Before the fix the arc-first form failed with
// "geometry 3 is a line and has no 'c' point".
// Reference: FreeCAD 26.3rc1 solved the arc-first slot to dof 0, bbox
// [-6,0,36,12] (docs/replica/freecad/gauntlet/variants/refs/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await import('../dist/sketch-session.js');

const GEOMS = [
  { k: 'line', id: 1, a: [0, 0], b: [30, 0] },
  { k: 'arc', id: 2, c: [30, 6], r: 6, a: [30, 12], b: [30, 0], sense: 'cw' },
  { k: 'line', id: 3, a: [30, 12], b: [0, 12] },
  { k: 'arc', id: 4, c: [0, 6], r: 6, a: [0, 0], b: [0, 12], sense: 'cw' },
];
const joins = (arcFirst) => {
  // [line, lineEnd, arc, arcEnd]
  const J = [[1, 'b', 2, 'b'], [3, 'a', 2, 'a'], [3, 'b', 4, 'b'], [1, 'a', 4, 'a']];
  const rows = [];
  for (const [l, le, a, ae] of J) {
    rows.push({ k: 'coincident', a: l, aEnd: le, b: a, bEnd: ae });
    rows.push(arcFirst ? { k: 'tangent', a, aEnd: ae, b: l, bEnd: le } : { k: 'tangent', a: l, aEnd: le, b: a, bEnd: ae });
  }
  return rows;
};
const TAIL = [
  { k: 'horizontal', a: 1 }, { k: 'radius', a: 2, value: 6 }, { k: 'equal', a: 2, b: 4 },
  { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'lock', a: 1, aEnd: 'a' },
];

function solveRows(geoms, rules) {
  const s = new SketchSession2D();
  s.loadFromBytes(brep);
  const refusal = s.open(geoms, rules);
  assert.equal(refusal, null, `open refused: ${refusal}`);
  const ok = s.solve();
  assert.ok(ok, `solve failed: ${s.lastError()}`);
  const out = { dof: s.diagnose().dof, geoms: s.solvedGeoms() };
  s.close();
  return out;
}
const flat = (gs) => JSON.stringify(gs);
const maxDiff = (a, b) => {
  const fa = JSON.parse(flat(a)), fb = JSON.parse(flat(b));
  let d = 0;
  const walk = (x, y) => {
    if (typeof x === 'number') d = Math.max(d, Math.abs(x - y));
    else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], y[k]);
    else assert.deepEqual(x, y);
  };
  walk(fa, fb);
  return d;
};

test('slot: arc-then-line tangent rows solve to the same geometry and DoF as line-then-arc', () => {
  const lineFirst = solveRows(GEOMS, [...joins(false), ...TAIL]);
  const arcFirst = solveRows(GEOMS, [...joins(true), ...TAIL]);
  assert.equal(lineFirst.dof, 0);
  assert.equal(arcFirst.dof, lineFirst.dof);
  assert.ok(maxDiff(lineFirst.geoms, arcFirst.geoms) < 1e-9, 'identical solved points');
});

test('slot: arc-first DoF equals FreeCAD reference when the ref file is present', () => {
  const ref = path.resolve(HERE, '../../../docs/replica/freecad/gauntlet/variants/refs/ref-sk-circle-arc-tangent__slot-arc-first-order.json');
  if (!existsSync(ref)) return;
  const fc = JSON.parse(readFileSync(ref, 'utf8'));
  const ours = solveRows(GEOMS, [...joins(true), ...TAIL]);
  assert.equal(ours.dof, fc.dof);
});

test('simple line-circle tangent is symmetric too', () => {
  const geoms = [
    { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
    { k: 'circle', id: 2, c: [20, 5.5], r: 5 },
  ];
  const tail = [{ k: 'horizontal', a: 1 }, { k: 'lock', a: 1, aEnd: 'a' }, { k: 'radius', a: 2, value: 5 }];
  const lc = solveRows(geoms, [...tail, { k: 'tangent', a: 1, b: 2 }]);
  const cl = solveRows(geoms, [...tail, { k: 'tangent', a: 2, b: 1 }]);
  assert.equal(cl.dof, lc.dof);
  assert.ok(maxDiff(lc.geoms, cl.geoms) < 1e-9);
});
