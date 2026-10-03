// K8: a revolve wholly on the negative-u side of the axis builds exactly (or
// refuses, never an empty solid); any empty build refuses; a through hole is
// the same whether its tool overshoots the part or is exact. Real wasm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function run(doc, id) {
  const s = JSON.stringify(doc);
  const refusals = JSON.parse(brep.build_doc_json(s)).refusals ?? {};
  return { refusals, s: JSON.parse(brep.measure_doc(s)).shapes?.[id] };
}
function script(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  return run(r.doc, r.doc.features.at(-1).id); // shapes{} is keyed by id, sorted
}
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const PI = Math.PI;
const ring = PI * (15 ** 2 - 5 ** 2) * 20;

test('negative-u revolve: 360 builds the closed-form ring, same as the mirrored profile', () => {
  const neg = script("const sk = sketch('front'); sk.rect(10, 20, { at: [-10, 10] }); spin(sk, 360)");
  const pos = script("const sk = sketch('front'); sk.rect(10, 20, { at: [10, 10] }); spin(sk, 360)");
  assert.deepEqual(neg.refusals, {});
  near(neg.s.volume, ring);
  assert.equal(neg.s.faces, pos.s.faces);
  assert.ok(neg.s.faces > 0);
  near(neg.s.bbox[0][0], -15); near(neg.s.bbox[1][0], 15);
});

test('negative-u revolve: partial angles are the exact fraction, swept on the far side', () => {
  for (const [a, f] of [[180, 0.5], [90, 0.25]]) {
    const neg = script(`const sk = sketch('front'); sk.rect(10, 20, { at: [-10, 10] }); spin(sk, ${a})`);
    const pos = script(`const sk = sketch('front'); sk.rect(10, 20, { at: [10, 10] }); spin(sk, ${a})`);
    assert.deepEqual(neg.refusals, {});
    near(neg.s.volume, ring * f);
    assert.equal(neg.s.faces, pos.s.faces);
  }
});

test('straddling and u>=0 profiles are unchanged', () => {
  near(script("const sk = sketch('front'); sk.rect(10, 20, { at: [0, 10] }); spin(sk, 360)").s.volume, PI * 25 * 20);
  near(script("const sk = sketch('front'); sk.rect(10, 20, { at: [10, 10] }); spin(sk, 360)").s.volume, ring);
});

test('an empty build refuses plainly; a datum stays a silent no-op', () => {
  const sk = { id: 's', kind: 'sketch', plane: 'front', offset: 0, points: [[5, 0], [15, 0], [15, 20], [5, 20]] };
  const { refusals, s } = run({ version: 1, features: [sk, { id: 'e', kind: 'extrude', target: 's', height: 0 }, { id: 'pl', kind: 'datum', type: 'plane', plane: 'xy', offset: 5 }] }, 'e');
  assert.equal(s, undefined);
  assert.match(refusals.e, /^e builds an empty solid .* e is shown without it\.$/);
  assert.equal(refusals.pl, undefined);
});

test('through hole down a cylinder (default overshoot) = 3534.29 - 565.49, 4 faces', () => {
  const r = script('const c = cylinder(15, 20); hole(c, { across: 6 })');
  assert.deepEqual(r.refusals, {});
  near(r.s.volume, 2968.8050576423525);
  assert.equal(r.s.faces, 4);
});

test('off-axis through hole at:[4,0] gives the same', () => {
  const r = script('const c = cylinder(15, 20); hole(c, { across: 6, at: [4, 0] })');
  assert.deepEqual(r.refusals, {});
  near(r.s.volume, 2968.8050576423525);
  assert.equal(r.s.faces, 4);
});

test('overshoot and exact tools agree on box, prism, cylinder', () => {
  for (const [shape, h] of [['cuboid(30, 20, 10)', 10], ['prism(6, 10, 20)', 20], ['cylinder(15, 20)', 20], ['cylinder(15, 20)', 20]]) {
    const over = script(`const p = ${shape}; hole(p, { across: 4 })`);
    const exact = script(`const p = ${shape}; hole(p, { across: 4, deep: ${h} })`);
    assert.deepEqual(over.refusals, {}, shape);
    assert.deepEqual(exact.refusals, {}, shape);
    near(over.s.volume, exact.s.volume, 1e-9);
    assert.equal(over.s.faces, exact.s.faces, shape);
  }
});

test('cone: overshoot and exact behave identically (both an honest refusal; pointed-cone bore is a kernel gap)', () => {
  const over = script('const c = cone(15, 20); hole(c, { across: 6 })');
  const exact = script('const c = cone(15, 20); hole(c, { across: 6, deep: 20 })');
  assert.equal(over.s, undefined);
  assert.equal(exact.s, undefined);
  assert.match(over.refusals.hole1, /cannot cut this hole yet/);
  assert.equal(over.refusals.hole1, exact.refusals.hole1);
});

test('a transverse bore through a cylinder side still refuses plainly', () => {
  const doc = { version: 1, features: [{ id: 'c', kind: 'cylinder', radius: 7.5, height: 20 }, { id: 'h', kind: 'hole', target: 'c', diameter: 6, depth: 40, axis: 'x' }] };
  const { refusals, s } = run(doc, 'h');
  assert.equal(s, undefined);
  assert.match(refusals.h, /^hole h: brep-rs cannot cut this hole yet -- h is shown without it\.$/);
});
