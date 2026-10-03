// Stage 0 of SPEC-datum-family: hand-built docs reach the kernel without the
// script's frame validation, so sketch_frame must refuse a skewed, non-unit,
// zero or non-finite frame rather than build a distorted solid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const pts = [[0, 0], [30, 0], [30, 20], [0, 20]];
function build(sketch) {
  const doc = JSON.stringify({ version: 1, features: [
    { id: 'sk1', kind: 'sketch', points: pts, ...sketch },
    { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 },
  ] });
  const out = JSON.parse(brep.build_doc_json(doc));
  const m = JSON.parse(brep.measure_doc(doc));
  return { refusals: out.refusals ?? {}, shape: m.shapes?.e1 };
}

test('a skewed frame refuses with a sentence and builds no solid', () => {
  const s = Math.SQRT1_2;
  const r = build({ plane: 'xy', frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [s, s, 0] } });
  assert.match(r.refusals.e1, /not at right angles.*e1 is shown without it\.$/);
  assert.ok(!r.shape || !(r.shape.volume > 0), 'no volume for a refused feature');
});

test('non-unit, zero and non-finite frames refuse', () => {
  for (const frame of [
    { origin: [0, 0, 0], u: [2, 0, 0], v: [0, 1, 0] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 0] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1e-9, 0] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, Infinity, 0] },
  ]) {
    const r = build({ plane: 'xy', frame });
    assert.ok(r.refusals.e1, JSON.stringify(frame));
  }
});

test("a valid frame equal to 'top' matches the named plane (volume and bbox)", () => {
  const a = build({ plane: 'xy' });
  const b = build({ plane: 'xy', frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } });
  assert.deepEqual(b.refusals, {});
  assert.deepEqual(b.shape.bbox, a.shape.bbox);
  assert.ok(Math.abs(b.shape.volume - 6000) < 1e-6);
  assert.ok(Math.abs(b.shape.volume - a.shape.volume) < 1e-9);
});
