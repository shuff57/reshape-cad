// A face/edge pick whose NAME no longer resolves after a rebuild is dropped, though its feature id survived. Imports from
// ../dist; build first.
//
// The review finding: the studio dropped a pick only when its owning feature id was gone, and a script re-run reuses ids
// (pull1 stays pull1 when its sketch loses a corner), so a pick on a face that no longer exists survived. The viewport now
// reports nameLostBetween(engine, previous build, new build) through onStats and the studio drops those picks with
// dropStalePicks. A name lost means: it resolved before and does not now -- the kernel hands out names it cannot resolve
// back yet (a shell's faces), and those picks must stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { dropStalePicks, nameLostBetween, emptySelection } from '../dist/selection-model.js';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { BrepRsEngineAdapter } = await import('@shuff57/reshape-brep-adapter/brep-rs-engine-adapter');
const engine = new BrepRsEngineAdapter(THREE);
engine.loadFromBytes(brep);

const pull = (points) => ({
  version: 1,
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points },
    { id: 'pull1', kind: 'extrude', target: 'sk1', height: 5 },
  ],
});
// a re-run: the same ids, the sketch now a triangle, so the wall swept from edge 3 is gone
const BEFORE = pull([[0, 0], [20, 0], [20, 10], [0, 10]]);
const AFTER = pull([[0, 0], [20, 0], [0, 10]]);

/** The named face pick a click on face `index` of pull1 makes. */
function facePick(built, doc, index) {
  const face = engine.faceAt(built.shapes.get('pull1'), index);
  const name = engine.nameFace(built, doc, 'pull1', face);
  assert.ok(name, `face ${index} has a name`);
  return { kind: 'face', target: 'pull1', name };
}
const withPicks = (...picks) => ({ ...emptySelection(), items: [{ kind: 'feature', target: 'pull1' }, ...picks], primary: picks.at(-1) ?? null });
const has = () => true;

test('a re-run keeps pull1 but drops the wall a pick named: that pick goes, the others stay', () => {
  const a = engine.build(BEFORE);
  const b = engine.build(AFTER);
  const wall3 = facePick(a, BEFORE, 3);
  const wall0 = facePick(a, BEFORE, 0);
  assert.equal(wall3.name.cause, 'swept');
  assert.equal(wall3.name.edge, 3);
  const lost = nameLostBetween(engine, a, b);
  assert.equal(lost('pull1', 'face', wall3.name), true);
  assert.equal(lost('pull1', 'face', wall0.name), false);
  // the owning feature is still there, so the old prune (feature id only) kept both
  const sel = withPicks(wall0, wall3);
  assert.equal(dropStalePicks(sel, has), sel);
  const next = dropStalePicks(sel, has, (i) => lost(i.target, i.kind, i.name));
  assert.deepEqual(next.items, [{ kind: 'feature', target: 'pull1' }, wall0]);
  assert.equal(next.primary, null);
  // an edge between the gone wall and the top goes with it
  const edges = engine.edges(a.shapes.get('pull1')).map((e) => engine.nameEdge(a, BEFORE, 'pull1', e.edge)).filter(Boolean);
  const onWall3 = edges.find((n) => JSON.stringify(n).includes('"edge":3'));
  assert.ok(onWall3);
  assert.equal(lost('pull1', 'edge', onWall3), true);
});

test('nothing is lost across the same build, an unchanged rebuild, or a shape that is not built now', () => {
  const a = engine.build(BEFORE);
  const wall3 = facePick(a, BEFORE, 3);
  assert.equal(nameLostBetween(engine, a, a)('pull1', 'face', wall3.name), false);
  assert.equal(nameLostBetween(engine, null, a)('pull1', 'face', wall3.name), false);
  assert.equal(nameLostBetween(engine, a, engine.build(BEFORE))('pull1', 'face', wall3.name), false);
  // pull1 switched off (suppressed / rolled back): its faces cannot be asked about, so the pick stays
  const sketchOnly = engine.build({ version: 1, features: [BEFORE.features[0]] });
  assert.equal(nameLostBetween(engine, a, sketchOnly)('pull1', 'face', wall3.name), false);
});

test('a name the kernel never could resolve is not "lost": the pick stays across a rebuild', () => {
  const resolvesNever = { resolveFace: () => null, resolveEdge: () => null };
  const a = engine.build(BEFORE);
  const b = engine.build(AFTER);
  const wall3 = facePick(a, BEFORE, 3);
  assert.equal(nameLostBetween(resolvesNever, a, b)('pull1', 'face', wall3.name), false);
  // a resolver that throws cannot tell either way
  const throws = { resolveFace: () => { throw new Error('not built yet'); }, resolveEdge: () => { throw new Error('x'); } };
  assert.equal(nameLostBetween(throws, a, b)('pull1', 'face', wall3.name), false);
});

test('dropStalePicks: a pick whose feature is gone goes; feature items and unnamed picks are left alone', () => {
  const name = { cause: 'cap', end: 'top', feature: 'pull1', kind: 'face' };
  const face = { kind: 'face', target: 'pull1', name };
  const unnamed = { kind: 'edge', target: 'pull1', name: null };
  const sel = { ...emptySelection(), items: [{ kind: 'feature', target: 'gone1' }, face, unnamed], primary: face };
  // feature items are the studio's own (withFeatureIds), never dropped here
  const r1 = dropStalePicks(sel, (id) => id !== 'pull1');
  assert.deepEqual(r1.items, [{ kind: 'feature', target: 'gone1' }]);
  assert.equal(r1.primary, null);
  // `lost` is asked only for named faces and edges, and once per item
  let asked = 0;
  const r2 = dropStalePicks(sel, has, () => { asked++; return false; });
  assert.equal(r2, sel);
  assert.equal(asked, 1);
});
