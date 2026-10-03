// A blind hole (deep: shorter than the part) must START AT THE DRILLED FACE.
// Measured on the real wasm: volume closed-form AND face count (a floating
// internal cavity has the right volume but 9 faces and an untouched top).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const doc = JSON.stringify(r.doc);
  const last = r.doc.features.at(-1).id; // shapes{} is keyed by id, sorted
  const m = JSON.parse(brep.measure_doc(doc));
  assert.deepEqual(JSON.parse(brep.build_doc_json(doc)).refusals, {}, code);
  const s = m.shapes[last];
  return { ...s, faces: s.faces ?? s.faceCount ?? s.face_count };
}
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} vs ${b}`);
const BOX = 'const b = cuboid(40, 40, 20); ';

test('probe measure shape', () => {
  const s = measure(BOX + 'hole(b, { across: 6, deep: 10 })');
  assert.ok(Number.isFinite(s.faces), JSON.stringify(Object.keys(s)));
});

test('deep 10 in a 20 box: blind, 8 faces, opens on +z, bbox unchanged', () => {
  const s = measure(BOX + 'hole(b, { across: 6, deep: 10 })');
  near(s.volume, 32000 - 90 * Math.PI);
  assert.equal(s.faces, 8);
  near(s.bbox[1][2], 10); near(s.bbox[0][2], -10);
});

test('the opening is on the top: a counterbore (cut from the mouth) changes the volume as a recess would', () => {
  const s = measure(BOX + 'hole(b, { across: 6, deep: 10, counterbore: { across: 12, deep: 4 } })');
  near(s.volume, 32000 - 90 * Math.PI - Math.PI * (36 - 9) * 4);
  assert.equal(s.faces, 10);
});

test('two blind bores from the same face: 6 + 2*2 faces', () => {
  const s = measure(BOX + 'hole(b, { across: 6, deep: 10, at: [-10, 0] }); hole(b, { across: 4, deep: 6, at: [10, 0] })');
  near(s.volume, 32000 - 90 * Math.PI - 24 * Math.PI);
  assert.equal(s.faces, 10);
});

test('deep equal to the thickness and beyond is a through hole (7 faces)', () => {
  for (const d of [20, 30]) {
    const s = measure(BOX + `hole(b, { across: 6, deep: ${d} })`);
    near(s.volume, 32000 - 180 * Math.PI);
    assert.equal(s.faces, 7);
  }
});

test('no deep is still through', () => {
  const s = measure(BOX + 'hole(b, { across: 6 })');
  near(s.volume, 32000 - 180 * Math.PI);
  assert.equal(s.faces, 7);
});

test('along x and along y start at the +x / +y face', () => {
  for (const [ax, i] of [['x', 0], ['y', 1]]) {
    const s = measure(`const b = cuboid(40, 30, 20); hole(b, { across: 6, deep: 10, along: '${ax}' })`);
    near(s.volume, 24000 - 90 * Math.PI);
    assert.equal(s.faces, 8, ax);
    const r = runScript(`const b = cuboid(40, 30, 20); hole(b, { across: 6, deep: 10, along: '${ax}' })`);
    const f = r.doc.features.at(-1);
    near(f.center[i], ((ax === 'x' ? 40 : 30) - 10) / 2);
  }
});

test('holes() pattern with deep: four blind bores, 6 + 4*2 faces', () => {
  const s = measure(BOX + 'holes(b, { across: 6, apart: [20, 20], deep: 10 })');
  near(s.volume, 32000 - 4 * 90 * Math.PI);
  assert.equal(s.faces, 14);
});

test('counterbore and countersink with deep keep their own volumes', () => {
  const cb = measure(BOX + 'hole(b, { across: 6, deep: 15, counterbore: { across: 10, deep: 5 } })');
  near(cb.volume, 32000 - 9 * Math.PI * 15 - Math.PI * (25 - 9) * 5);
  const cs = measure(BOX + 'hole(b, { across: 6, deep: 15, countersink: { across: 10, angle: 90 } })');
  assert.ok(cs.volume < 32000 - 9 * Math.PI * 15 && cs.volume > 32000 - 25 * Math.PI * 15, String(cs.volume));
  assert.equal(cs.faces, 9); // 6 + wall + floor + cone
});

test('a prism with deep: blind from the top', () => {
  const R = 5, H = 20, area = (3 * Math.sqrt(3) / 2) * R * R;
  const s = measure(`const p = prism(6, ${R * 2}, ${H}); hole(p, { across: 4, deep: 8 })`);
  near(s.volume, area * H - 4 * Math.PI * 8);
  assert.equal(s.faces, 10); // 6 sides + top + bottom + bore wall + floor
  near(s.bbox[1][2], H / 2);
});

test('a box with at: [5, 5] and deep: 10', () => {
  const s = measure(BOX + 'hole(b, { across: 6, deep: 10, at: [5, 5] })');
  near(s.volume, 32000 - 90 * Math.PI);
  assert.equal(s.faces, 8);
});

test('unknown thickness (turned box): no deep errors plainly; deep still builds, centred', () => {
  const src = 'const t = cuboid(10, 10, 10); turn(t, [0, 90, 0]); ';
  const r2 = runScript(src + 'hole(t, { across: 2 })');
  assert.match(r2.errors[0].message, /cannot find how thick this box is/);
  const r = runScript(src + 'hole(t, { across: 2, deep: 4 })');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features.at(-1).center, [0, 0, 0]);
});

test('round trip: at + deep reload to the same doc, volume and faces', () => {
  const code = BOX + 'hole(b, { across: 6, deep: 10, at: [5, 5] })';
  const r1 = runScript(code);
  const src = toScript(r1.doc);
  assert.ok(!/at: \[5, 5\]/.test(src) || /at: \[5, 5\]/.test(src));
  assert.ok(!/-5/.test(src.replace(/at: \[5, 5\]/, '')) , src);
  const r2 = runScript(src);
  assert.deepEqual(r2.errors, []);
  assert.deepEqual(r2.doc, r1.doc);
  assert.equal(toScript(r2.doc), src);
});
