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

test('u>=0 profiles are unchanged; a profile STRADDLING the axis now says so (W3: it used to build the union of its two sides)', () => {
  near(script("const sk = sketch('front'); sk.rect(10, 20, { at: [10, 10] }); spin(sk, 360)").s.volume, ring);
  // The symmetric straddle used to build the cylinder pi 5^2 20, which is right only because the two sides coincide; an
  // asymmetric one (-10..20) built the union of the two spins. Both are refused now: draw the half outline instead.
  for (const at of ['[0, 10]', '[3, 10]']) {
    const r = script(`const sk = sketch('front'); sk.rect(10, 20, { at: ${at} }); spin(sk, 360)`);
    assert.equal(r.s, undefined);
    assert.match(Object.values(r.refusals).join(' '), /crosses the axis it spins about, so the two sides would overlap/);
  }
  // half of it, from the axis out, is the same cylinder
  near(script("const sk = sketch('front'); sk.rect(5, 20, { at: [2.5, 10] }); spin(sk, 360)").s.volume, PI * 25 * 20);
});

test('an empty build refuses plainly; a datum stays a silent no-op', () => {
  const sk = { id: 's', kind: 'sketch', plane: 'front', offset: 0, points: [[5, 0], [15, 0], [15, 20], [5, 20]] };
  const { refusals, s } = run({ version: 1, features: [sk, { id: 'e', kind: 'extrude', target: 's', height: 0 }, { id: 'pl', kind: 'datum', type: 'plane', plane: 'xy', offset: 5 }] }, 'e');
  assert.equal(s, undefined);
  assert.match(refusals.e, /^extrude e: the pull height is 0, so there is nothing to pull .* e is shown without it\.$/);
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

test('cone: overshoot and exact tools agree, and both build (the bore on a pointed cone\'s own axis is a circle on the wall)', () => {
  const over = script('const c = cone(15, 20); hole(c, { across: 6 })');
  const exact = script('const c = cone(15, 20); hole(c, { across: 6, deep: 20 })');
  assert.deepEqual(over.refusals, {});
  assert.deepEqual(exact.refusals, {});
  // R = 7.5, H = 20, r = 3: the cone narrows to the bore at zc = 12. Left =
  // frustum below zc minus the bore there = pi R^2 H/3 (1 - (1 - zc/H)^3) - pi r^2 zc.
  const want = Math.PI * 7.5 * 7.5 * 20 / 3 * (1 - (1 - 12 / 20) ** 3) - Math.PI * 9 * 12;
  near(over.s.volume, want, 1e-9);
  near(over.s.volume, exact.s.volume, 1e-9);
  assert.equal(over.s.faces, exact.s.faces);
});

test('a transverse bore through a cylinder side builds exactly (it used to refuse); a bore as wide as the part still refuses plainly', () => {
  const doc = { version: 1, features: [{ id: 'c', kind: 'cylinder', radius: 7.5, height: 20 }, { id: 'h', kind: 'hole', target: 'c', diameter: 6, depth: 40, axis: 'x' }] };
  const { refusals, s } = run(doc, 'h');
  assert.deepEqual(refusals, {});
  // removed = 4 * integral_{-r}^{r} sqrt(r^2 - y^2) sqrt(R^2 - y^2) dy, y = r sin(t): Simpson, no kernel code.
  const R = 7.5, r = 3, n = 200000, h = PI / n;
  const g = (t) => 2 * r * r * Math.cos(t) ** 2 * 2 * Math.sqrt(R * R - (r * Math.sin(t)) ** 2);
  let acc = g(-PI / 2) + g(PI / 2);
  for (let i = 1; i < n; i++) acc += g(-PI / 2 + h * i) * (i % 2 ? 4 : 2);
  near(s.volume, PI * R * R * 20 - (acc * h) / 3, 1e-9);
  assert.equal(s.faces, 4);
  const wide = { version: 1, features: [{ id: 'c', kind: 'cylinder', radius: 7.5, height: 20 }, { id: 'h', kind: 'hole', target: 'c', diameter: 15, depth: 40, axis: 'x' }] };
  const w = run(wide, 'h');
  assert.equal(w.s, undefined);
  assert.match(w.refusals.h, /^hole h: a bore across the side of a round part builds only when it runs at right angles straight through the part's axis, .* -- h is shown without it\.$/);
});
