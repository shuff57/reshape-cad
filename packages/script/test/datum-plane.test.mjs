// SPEC-datum-family Stage 3: the `datum` feature (type 'plane'). Pure tests, no
// kernel: cascade delete, the reorder guard, D6 round-trip, param(), and the
// pure studio-facing helpers (labels, handles, flat view, selection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { orphanedBy, withoutFeatures, whyDeletingCosts, firstOrderViolation, danglingRefs } from '../dist/model-deps.js';
import { dependsOn, datumRefs, nameMap, topLevel, isSketchOnly, placementLabel, sketchFrameOf } from '../dist/model-types.js';
import { generatedParams, applyParam } from '../dist/model-codegen.js';
import { handlesFor, featureCenter, flatViewPlane, placementOf } from '../dist/model-handles.js';
import { ownerOf } from '../dist/model-selection.js';
import { studentWord } from '../dist/model-check.js';

const run = (c) => { const r = runScript(c); assert.deepEqual(r.errors, [], JSON.stringify(r.errors)); return r; };
const FRAME = "{ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }";
const SRC = `const sk = sketch(plane(${FRAME}))\nsk.rect(40, 25)\npull(sk, 12)`;

test('cascade delete: deleting a datum takes its sketch and the extrude on it, and says plane', () => {
  const r = run(SRC);
  const ids = r.doc.features.map((f) => f.id);
  assert.deepEqual(ids, ['pl1', 'sk1', 'pull1']);
  const doomed = orphanedBy(r.doc, ['pl1']);
  assert.deepEqual([...doomed].sort(), [...ids].sort());
  assert.deepEqual(withoutFeatures(r.doc, ['pl1']).features, []);
  const names = nameMap(r.doc);
  const why = whyDeletingCosts(r.doc, ['pl1'], (id) => names[id]);
  assert.match(why, /plane Custom plane 1/);
  assert.match(why, /go too/);
  // deleting the sketch leaves the plane (it stands alone)
  assert.deepEqual(withoutFeatures(r.doc, [ids[1]]).features.map((f) => f.id), ['pl1']);
  assert.deepEqual(danglingRefs(r.doc), []);
});

test('dependsOn: the one datumRefs line; a sketch names its datum, not through `target`', () => {
  const r = run("const sk = sketch(plane('top', 4))\nsk.rect(4, 4)");
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  assert.deepEqual(datumRefs(sk), ['pl1']);
  assert.deepEqual(dependsOn(sk), ['pl1']);
  assert.equal('target' in sk, false);
  assert.deepEqual(dependsOn(r.doc.features[0]), []);
  // a plain sketch still depends on nothing
  assert.deepEqual(dependsOn(run("sketch('top')").doc.features[0]), []);
});

test('reorder guard: a sketch cannot move above its datum, a datum cannot move below its sketch', () => {
  const r = run(SRC);
  const [pl, sk, ex] = r.doc.features;
  assert.equal(firstOrderViolation([pl, sk, ex]), null);
  assert.deepEqual(firstOrderViolation([sk, pl, ex]), { feature: sk.id, missing: [pl.id] });
  assert.deepEqual(firstOrderViolation([sk, ex, pl]), { feature: sk.id, missing: [pl.id] });
  assert.ok(firstOrderViolation([pl, ex, sk]));
  // an unrelated box may sit anywhere relative to the plane
  const box = { id: 'box1', kind: 'box', size: [1, 1, 1], center: [0, 0, 0] };
  assert.equal(firstOrderViolation([box, pl, sk, ex]), null);
  assert.equal(firstOrderViolation([pl, box, sk, ex]), null);
});

test('D6: datum statement precedes the sketch; doc and the second toScript are byte-equal', () => {
  for (const code of [
    SRC,
    "const sk = sketch(plane('front', 7))\nsk.rect(30, 20)\npull(sk, 5)",
    "plane('side', 2)\nconst b = sketch('top')\nb.rect(5, 5)",
    "const p = plane('top', 3)\nsketch(p).rect(2, 2)\nsketch(p).circle(3)",
  ]) {
    const a = run(code);
    const t1 = toScript(a.doc);
    const b = run(t1);
    assert.equal(JSON.stringify(b.doc), JSON.stringify(a.doc), code);
    assert.equal(toScript(b.doc), t1, code);
  }
  const t = toScript(run(SRC).doc);
  assert.ok(t.indexOf('plane(') < t.indexOf('sketch(pl1)'));
});

test('param(): a named-plane datum offset is a slot, round-trips, and applyParam moves the sketch with it', () => {
  const code = "const lift = param('lift', 10, { min: 0, max: 50 })\nconst sk = sketch(plane('top', lift))\nsk.rect(40, 25)\npull(sk, 12)";
  const r = run(code);
  const slot = generatedParams(r.doc).find((p) => p.name === 'pl1_offset');
  assert.ok(slot, 'the datum offset is a slot');
  assert.equal(slot.value, 10);
  assert.ok(!generatedParams(r.doc).some((p) => p.name === 'sk1_offset'), 'the sketch does not offer a second, divergent offset');
  const t = toScript(r.doc, r.namedParams);
  assert.match(t, /const pl1 = plane\('top', lift\)/);
  assert.equal(JSON.stringify(run(t).doc), JSON.stringify(r.doc));
  assert.equal(toScript(run(t).doc, run(t).namedParams), t);
  const moved = applyParam(r.doc, 'pl1_offset', 25);
  assert.equal(moved.features.find((f) => f.id === 'pl1').offset, 25);
  assert.equal(moved.features.find((f) => f.id === 'sk1').offset, 25, 'the sketch follows its datum');
  // and the regenerated script reads back to the same moved doc
  assert.equal(JSON.stringify(run(toScript(moved, r.namedParams)).doc), JSON.stringify(moved));
});

test('a literal-frame datum has no param slot (stated limit) and no handle', () => {
  const r = run(SRC);
  assert.ok(!generatedParams(r.doc).some((p) => p.name.startsWith('pl1_')));
  assert.deepEqual(handlesFor(r.doc.features[0], r.doc), []);
});

test('timeline label, plane word, topLevel and sketch-only treat a datum sensibly', () => {
  const named = run("plane('top', 4)").doc;
  assert.equal(nameMap(named).pl1, 'Plane 1');
  assert.equal(nameMap(run(SRC).doc).pl1, 'Custom plane 1');
  assert.equal(studentWord('datum'), 'plane');
  assert.deepEqual(topLevel(named), [], 'a datum draws no solid');
  assert.equal(isSketchOnly(named), true);
  assert.equal(placementLabel({ plane: 'xz' }), 'xz');
  assert.equal(placementLabel({ plane: 'xy', frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), 'custom plane');
});

test('handles/center: a named datum has one offset handle; framed sketches are handled on their real plane', () => {
  const r = run("const sk = sketch(plane('front', 6))\nsk.rect(40, 25)\npull(sk, 12)");
  const [pl, sk, ex] = r.doc.features;
  const h = handlesFor(pl, r.doc);
  assert.equal(h.length, 1);
  assert.equal(h[0].param, 'pl1_offset');
  assert.deepEqual(h[0].origin, [0, 6, 0]);
  assert.deepEqual(featureCenter(pl, r.doc), [0, 6, 0]);
  // xz keeps its measured -Y sweep: cap at y = 6 - 12
  assert.deepEqual(handlesFor(ex, r.doc)[0].origin.map((n) => Math.round(n * 1e9) / 1e9), [0, -6, 0]);

  const f = run(SRC);
  const fsk = f.doc.features[1];
  const fc = featureCenter(fsk, f.doc);
  assert.equal(fc[2], 10, 'sketch centre sits at z = 10, not on the xy placeholder');
  const cap = handlesFor(f.doc.features[2], f.doc)[0];
  assert.equal(cap.origin[2], 22);
  assert.deepEqual(cap.axis, [0, 0, 1]);
  const corner = handlesFor(fsk, f.doc)[0];
  assert.equal(corner.origin[2], 10);
  // the resolver and the handles agree
  assert.deepEqual(placementOf(fsk).origin, sketchFrameOf(fsk).origin);
});

test('flatViewPlane: a named sketch looks down its plane, a framed sketch and a datum do not claim one', () => {
  const a = run("sketch(plane('side', 1)).rect(1, 1)");
  assert.equal(flatViewPlane(a.doc.features[1]), 'yz');
  assert.equal(flatViewPlane(a.doc.features[0]), null);
  const b = run(SRC);
  assert.equal(flatViewPlane(b.doc.features[1]), null);
  assert.equal(flatViewPlane(undefined), null);
});

test('selection: a datum id resolves as its own owner', () => {
  const r = run(SRC);
  assert.equal(ownerOf(r.doc, { target: 'pl1' }), 'pl1');
  assert.equal(ownerOf(r.doc, { target: 'nope' }), null);
});
