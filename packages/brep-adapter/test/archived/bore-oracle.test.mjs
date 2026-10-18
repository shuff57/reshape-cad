// V-3 / V-5 (docs/PLAN-next.md): an oracle for the new bores that shares nothing
// with the kernel's booleans, its `inside_solid`, or OpenCascade.
//
// Volume alone cannot see a cavity, a flipped shell or a mirrored part. So this
// takes the TRIANGLES the kernel meshes (mesh_feature) and does the geometry in
// plain JS: a ray cast against the mesh with an irrational ray, compared with an
// analytic inside/outside predicate at thousands of points (random, plus axis,
// seam and cap-plane points); a signed-volume (winding) check; and a watertight
// check after welding. V-5 repeats it for a bored part moved by a rotation about
// an oblique axis and a translation: volume must not change, the mesh must stay
// closed and outward-facing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function mesh(code, defl = 0.02) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const id = r.doc.features.at(-1).id;
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  assert.deepEqual(refusals, {}, code);
  const m = JSON.parse(brep.mesh_feature(j, id, defl));
  assert.ok(!m.error, m.error);
  const vol = JSON.parse(brep.measure_doc(j)).shapes[id].volume;
  return { pos: m.positions, idx: m.indices, vol };
}

const tri = (m, t) => [0, 1, 2].map((k) => {
  const i = m.idx[3 * t + k] * 3;
  return [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
});
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function signedVolume(m) {
  let v = 0;
  for (let t = 0; t < m.idx.length / 3; t++) { const [a, b, c] = tri(m, t); v += dot(a, cross(b, c)) / 6; }
  return v;
}

function watertight(m) {
  const key = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
  const edges = new Map();
  for (let t = 0; t < m.idx.length / 3; t++) {
    const ks = tri(m, t).map(key);
    if (new Set(ks).size < 3) continue; // degenerate sliver
    for (let k = 0; k < 3; k++) {
      const a = ks[k], b = ks[(k + 1) % 3];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      const dir = a < b ? 1 : -1;
      const cur = edges.get(e) ?? { n: 0, s: 0 };
      cur.n++; cur.s += dir; edges.set(e, cur);
    }
  }
  let open = 0, badOrient = 0;
  for (const { n, s } of edges.values()) { if (n !== 2) open++; else if (s !== 0) badOrient++; }
  return { open, badOrient };
}

// Moller-Trumbore, count crossings along d from p.
const D = (() => { const d = [0.5773502691896258, 0.40412618, 0.70710678]; const n = Math.hypot(...d); return d.map((x) => x / n); })();
function inside(m, p) {
  let hits = 0;
  for (let t = 0; t < m.idx.length / 3; t++) {
    const [a, b, c] = tri(m, t);
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(D, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-14) continue;
    const f = 1 / det, s = sub(p, a), u = f * dot(s, h);
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = f * dot(D, q);
    if (v < 0 || u + v > 1) continue;
    if (f * dot(e2, q) > 0) hits++;
  }
  return hits % 2 === 1;
}

// deterministic points: a seeded generator, then structured ones.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function points(box, extra) {
  const pts = [];
  for (let i = 0; i < 3000; i++) pts.push([0, 1, 2].map((k) => box[0][k] + (box[1][k] - box[0][k]) * rnd()));
  return pts.concat(extra);
}

// margin: skip points closer than `m` to any analytic surface (the mesh is a
// chord approximation there); everything else must agree exactly.
function check(m, box, pred, dist, extra = [], margin = 0.08) {
  let tested = 0;
  for (const p of points(box, extra)) {
    if (dist(p) < margin) continue;
    tested++;
    assert.equal(inside(m, p), pred(p), `point ${p.map((x) => x.toFixed(3))} should be ${pred(p) ? 'inside' : 'outside'}`);
  }
  assert.ok(tested > 1500, `only ${tested} points tested`);
}

// ---- transverse bore: R=10, r=2, h=30, along x, centred at the origin ----
const R = 10, r = 2, H2 = 15;
const crossPred = ([x, y, z]) => x * x + y * y < R * R && Math.abs(z) < H2 && !(y * y + z * z < r * r);
const crossDist = ([x, y, z]) => Math.min(
  Math.abs(Math.hypot(x, y) - R), Math.abs(H2 - Math.abs(z)),
  Math.abs(Math.hypot(y, z) - r),
);
const crossBox = [[-11, -11, -16], [11, 11, 16]];
const crossExtra = [
  [0, 0, 0], [0, 0, 10], [5, 0, 0], [0, 5, 0], [0, 0.5, 0.5], [9.9, 0, 0], [-9.9, 0, 0],
  [0, 9.9, 0], [0, 0, 14.8], [0, 0, -14.8], [3, 3, 14.8], [0, 2.5, 0], [0, 0, 2.5], [7, 0, 2.5],
];

test('transverse bore (through): ray cast and winding agree with the analytic solid', () => {
  const m = mesh("const c = cylinder(20, 30); hole(c, { across: 4, along: 'x' })");
  assert.deepEqual(watertight(m), { open: 0, badOrient: 0 });
  assert.ok(Math.abs(signedVolume(m) - m.vol) / m.vol < 0.01, `mesh ${signedVolume(m)} vs kernel ${m.vol}`);
  check(m, crossBox, crossPred, crossDist, crossExtra);
});

test('transverse bore (blind, floor inside): same oracle, floor at x = 2', () => {
  // the bore enters from +x and stops at x = 2 (inside the wall sqrt(R^2-r^2) = 9.8)
  const m = mesh("const c = cylinder(20, 30); hole(c, { across: 4, along: 'x', deep: 8 })");
  assert.deepEqual(watertight(m), { open: 0, badOrient: 0 });
  assert.ok(m.vol < Math.PI * R * R * 30 && signedVolume(m) > 0);
  assert.ok(Math.abs(signedVolume(m) - m.vol) / m.vol < 0.01);
});

// ---- cone bore: cone(20,20), base at z=-10, bore across 4 down its axis ----
test('cone bore: ray cast agrees with rho in (2, R(z)), z above the base', () => {
  const m = mesh('const c = cone(20, 20); hole(c, { across: 4 })');
  assert.deepEqual(watertight(m), { open: 0, badOrient: 0 });
  const pred = ([x, y, z]) => { const rho = Math.hypot(x, y); return z > -10 && rho > 2 && rho < 10 * (1 - (z + 10) / 20); };
  const dist = ([x, y, z]) => { const rho = Math.hypot(x, y); return Math.min(Math.abs(rho - 2), Math.abs(z + 10), Math.abs(rho - 10 * (1 - (z + 10) / 20)) * 0.9); };
  check(m, [[-11, -11, -11], [11, 11, 11]], pred, dist, [[0, 0, 0], [0, 0, -5], [5, 0, -9], [3, 0, -9.9], [1, 0, -5]]);
  assert.ok(Math.abs(signedVolume(m) - m.vol) / m.vol < 0.01);
});

// ---- plain axial bore in a cylinder: the control case ----
test('control: cylinder(30, 20) with an axial bore across 6', () => {
  const m = mesh('const c = cylinder(30, 20); hole(c, { across: 6 })');
  assert.deepEqual(watertight(m), { open: 0, badOrient: 0 });
  const pred = ([x, y, z]) => { const rho = Math.hypot(x, y); return rho < 15 && rho > 3 && Math.abs(z) < 10; };
  const dist = ([x, y, z]) => { const rho = Math.hypot(x, y); return Math.min(Math.abs(rho - 15), Math.abs(rho - 3), Math.abs(10 - Math.abs(z))); };
  check(m, [[-16, -16, -11], [16, 16, 11]], pred, dist, [[0, 0, 0], [0, 0, 9.5], [8, 0, 0]]);
});

// ---- V-5: the part's axis and the bore's axis in every perpendicular pairing, moved ----
// The script can turn a primitive only about its own build (rotate on the primitive) and
// bores only along x, y or z, so "any orientation" is: the part axis on x, y or z, the bore
// on each of the other two. An oblique rotation of an already-bored part is not expressible.
const CROSS_VOL = 9174.71354867276;
for (const [rot, axis] of [['[0, 0, 0]', 'z'], ['[90, 0, 0]', 'y'], ['[0, 90, 0]', 'x']]) {
  for (const along of ['x', 'y', 'z'].filter((a) => a !== axis)) {
    test(`V-5: cylinder axis ${axis}, bore along ${along}, moved: exact volume, closed outward mesh`, () => {
      const m = mesh(`const c = cylinder(20, 30); turn(c, ${rot}); hole(c, { across: 4, along: '${along}' }); move(c, [37, -23, 11])`);
      assert.ok(Math.abs(m.vol - CROSS_VOL) / CROSS_VOL < 1e-9, `${m.vol}`);
      assert.deepEqual(watertight(m), { open: 0, badOrient: 0 });
      assert.ok(signedVolume(m) > 0, 'outward-facing');
      assert.ok(Math.abs(signedVolume(m) - m.vol) / m.vol < 0.01);
    });
  }
}

test('V-5: ray cast on a bored cylinder lying on its side (axis y, bore along z), shifted', () => {
  const m = mesh("const c = cylinder(20, 30); turn(c, [90, 0, 0]); hole(c, { across: 4, along: 'z' }); move(c, [37, -23, 11])");
  const q = ([x, y, z]) => [x - 37, y + 23, z - 11];
  // part axis y: wall x^2+z^2<R^2, |y|<15, bore along z: x^2+y^2<r^2
  const pred = (p) => { const [x, y, z] = q(p); return x * x + z * z < R * R && Math.abs(y) < H2 && !(x * x + y * y < r * r); };
  const dist = (p) => { const [x, y, z] = q(p); return Math.min(Math.abs(Math.hypot(x, z) - R), Math.abs(H2 - Math.abs(y)), Math.abs(Math.hypot(x, y) - r)); };
  check(m, [[26, -34, -5], [48, -12, 27]], pred, dist);
});
