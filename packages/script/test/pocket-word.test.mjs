// SPEC P1e §7 — the pocket word, ModelDoc-side. Import from the built output
// the same way a browser or studio import would resolve it (dist/ is produced
// by `npm run build --workspaces`, which the self-check runs first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, VOCABULARY } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { newPocket } from '../dist/model-types.js';
import { generatedParams, applyParam } from '../dist/model-codegen.js';
import { defaultName } from '../dist/model-types.js';

const SRC = "const sk1 = sketch('top'); sk1.rect(10, 8); const box1 = cuboid(40, 40, 20); pocket(sk1, box1, 5)";

test('newPocket(doc, "sk1", "box1") returns kind pocket, depth 5, pocket id', () => {
  const doc = { version: 1, features: [] };
  const f = newPocket(doc, 'sk1', 'box1');
  assert.equal(f.kind, 'pocket');
  assert.equal(f.depth, 5);
  assert.equal(f.target, 'sk1');
  assert.equal(f.into, 'box1');
  assert.ok(f.id.startsWith('pocket'));
});

test('pocket(sk, box, 7) pushes a feature with depth 7 and into set', () => {
  const r = runScript("const sk1 = sketch('top'); sk1.rect(10, 8); const box1 = cuboid(40, 40, 20); pocket(sk1, box1, 7)");
  assert.deepEqual(r.errors, []);
  const pk = r.doc.features.find((f) => f.kind === 'pocket');
  assert.ok(pk, 'a pocket feature exists');
  assert.equal(pk.depth, 7);
  assert.equal(pk.into, 'box1');
  assert.equal(pk.target, 'sk1');
});

test('pocket(sk, box) with no depth throws, naming pocket and depth', () => {
  // runScript() catches student-program throws into errors[] (see its own
  // try/catch) -- so the assertion is on the reported message, not on a
  // rethrown exception.
  const r = runScript("const sk1 = sketch('top'); const box1 = cuboid(40, 40, 20); pocket(sk1, box1)");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /pocket needs a number for depth/);
});

test('pocket(box, box, 5) — a solid where the sketch goes — throws needs a sketch', () => {
  const r = runScript("const box1 = cuboid(40, 40, 20); const box2 = cuboid(40, 40, 20); pocket(box1, box2, 5)");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /pocket\(\) needs a sketch/);
});

test('toScript emits pocket(sk1, box1, 5) and the emitted script rebuilds the pocket', () => {
  const r = runScript(SRC);
  assert.deepEqual(r.errors, []);
  const text = toScript(r.doc);
  assert.equal(
    text.split('\n').filter((l) => l.startsWith('pocket(')).length,
    1,
    `exactly one bare pocket() statement, got:\n${text}`,
  );
  assert.match(text, /pocket\(sk1, box1, 5\)/);
  // Round-trip: re-running the emitted script rebuilds a doc whose pocket has
  // the same target, into and depth -- and the same ids, since a cut does not
  // introduce a binding.
  const rt = runScript(text);
  assert.deepEqual(rt.errors, []);
  const before = r.doc.features.find((f) => f.kind === 'pocket');
  const after = rt.doc.features.find((f) => f.kind === 'pocket');
  assert.deepEqual(after, before);
  assert.deepEqual(rt.doc.features.map((f) => f.id), r.doc.features.map((f) => f.id));
});

test('featureLabel of a pocket is Pocket', () => {
  const r = runScript(SRC);
  const names = defaultName(r.doc.features.find((f) => f.kind === 'pocket'), r.doc);
  assert.equal(names, 'Pocket 1');
});

test('codegen exposes a deep slot reading 5, and setting it to 9 writes depth 9', () => {
  const r = runScript(SRC);
  const pk = r.doc.features.find((f) => f.kind === 'pocket');
  const slot = generatedParams(r.doc).find((p) => p.name === `${pk.id}_depth`);
  assert.ok(slot, 'a depth param exists for the pocket');
  assert.equal(slot.caption, 'Pocket 1 deep');
  assert.equal(slot.value, 5);
  const next = applyParam(r.doc, `${pk.id}_depth`, 9);
  const changed = next.features.find((f) => f.kind === 'pocket');
  assert.equal(changed.depth, 9);
});

test('VOCABULARY includes pocket', () => {
  assert.ok(VOCABULARY.includes('pocket'));
});