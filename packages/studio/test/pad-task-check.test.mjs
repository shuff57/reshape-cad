// The Pad / Pocket panel's check: what OK waits for. Imports from ../dist; build first.
//
// The review finding: in the default preview (overlay on, final off) the viewport built only the features before the pad
// and the draft's own block, never the draft cutting the part, so the kernel never refused the draft, the panel's refusal
// stayed null and OK accepted a pocket that misses the part. The preview build's refusals also replaced the studio's own
// (hiding a later feature's while the panel was open), and an Enter before the build came back accepted against the last
// draft's answer. Now the draft is always CHECKED in place (draftCheckDoc), the preview's refusals stay out of the studio's
// (refusalsAfterBuild), and OK accepts only on the check of the very draft it holds (okVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import {
  draftCheckDoc, padDisplayDoc, draftCheckOf, draftCheckRun, draftRefusalOf, okVerdict, refusalsAfterBuild, toolIdOf,
} from '../dist/model/pad-task-core.js';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { BrepRsEngineAdapter } = await import('@shuff57/reshape-brep-adapter/brep-rs-engine-adapter');
const engine = new BrepRsEngineAdapter(THREE);
engine.loadFromBytes(brep);

const box = { id: 'b1', kind: 'box', size: [60, 40, 10], center: [0, 0, 0] };
const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 5, points: [[0, 0], [10, 0], [10, 10], [0, 10]] };
const pocket = { id: 'pocket1', kind: 'pocket', target: 'sk1', into: 'b1', depth: 3 };
const sk2 = { id: 'sk2', kind: 'sketch', plane: 'xy', offset: 5, points: [[-20, -5], [-10, -5], [-10, 5], [-20, 5]] };
const later = { id: 'pocket2', kind: 'pocket', target: 'sk2', into: 'pocket1', depth: 2 };
const doc = { version: 1, features: [box, sk, pocket, sk2, later] };
// Reversed, the pocket cuts up and away from the top face: it touches nothing.
const missing = { ...pocket, reversed: true };
const overlayOnly = (d) => ({ feature: d, check: d, overlay: true, final: false });

test('the check doc is the draft in place of its feature, every later feature kept; null when the feature is not built', () => {
  const c = draftCheckDoc(doc, 'pocket1', missing);
  assert.deepEqual(c.features.map((f) => f.id), ['b1', 'sk1', 'pocket1', 'sk2', 'pocket2']);
  assert.equal(c.features[2], missing);
  assert.equal(draftCheckDoc({ version: 1, features: [box, sk] }, 'pocket1', missing), null);
});

test('overlay only: the drawn doc holds the draft\'s block but never the draft, so only the check can refuse it (kernel)', () => {
  const check = draftCheckDoc(doc, 'pocket1', missing);
  const shown = padDisplayDoc(doc, 'pocket1', overlayOnly(missing), check);
  assert.equal(shown.toolId, toolIdOf(missing));
  assert.deepEqual(shown.doc.features.map((f) => f.id), ['b1', 'sk1', 'pocket1__tool']);
  // what the viewport used to build: no refusal for anything, so OK went through
  const drawn = engine.build(shown.doc);
  assert.equal(drawn.refusals?.get('pocket1'), undefined);
  assert.equal(drawn.refusals?.size ?? 0, 0);
  // the check, built as the viewport's onCheck does, refuses the draft in a sentence
  const built = engine.build(check);
  const run = draftCheckRun(check, 'pocket1', built.refusals, null);
  assert.equal(run.feature, missing);
  assert.match(run.refusal, /^pocket1 does not touch the part, so it cuts nothing/);
  const seen = draftCheckOf(missing, check, run);
  assert.deepEqual(okVerdict(missing, seen), { kind: 'refused', why: run.refusal });
  // the same pocket cutting down into the part builds, and OK accepts it
  const okCheck = draftCheckDoc(doc, 'pocket1', pocket);
  const okRun = draftCheckRun(okCheck, 'pocket1', engine.build(okCheck).refusals, null);
  assert.equal(okRun.refusal, null);
  assert.deepEqual(okVerdict(pocket, draftCheckOf(pocket, okCheck, okRun)), { kind: 'ok' });
});

test('final result without a block: the drawn doc IS the check doc, so the viewport builds it once', () => {
  const pad = { id: 'pull1', kind: 'extrude', target: 'sk2', height: 4 };
  const d = { version: 1, features: [box, sk2, pad] };
  const draft = { ...pad, height: 6 };
  const check = draftCheckDoc(d, 'pull1', draft);
  const shown = padDisplayDoc(d, 'pull1', { feature: draft, check: draft, overlay: true, final: true }, check);
  assert.equal(shown.doc, check);
  assert.equal(shown.toolId, null);
  // a pocket's final result keeps its block on top when the overlay is ticked too
  const both = padDisplayDoc(doc, 'pocket1', { feature: pocket, check: pocket, overlay: true, final: true }, draftCheckDoc(doc, 'pocket1', pocket));
  assert.deepEqual(both.doc.features.map((f) => f.id), ['b1', 'sk1', 'pocket1', 'sk2', 'pocket2', 'pocket1__tool']);
  // nothing to draw: no doc, whatever is checked
  assert.equal(padDisplayDoc(doc, 'pocket1', { feature: null, check: pocket, overlay: true, final: false }, null), null);
});

test('OK waits for the check of the draft it holds: an Enter before the build lands never uses the last draft\'s answer', () => {
  const check = draftCheckDoc(doc, 'pocket1', missing);
  // nothing back yet
  assert.deepEqual(okVerdict(missing, draftCheckOf(missing, check, null)), { kind: 'wait' });
  // the last answer was for the draft before this one (the one that built): still waiting, its sentence kept
  const before = draftCheckDoc(doc, 'pocket1', pocket);
  const last = { doc: before, feature: pocket, refusal: null };
  const seen = draftCheckOf(missing, check, last);
  assert.deepEqual(seen, { feature: null, refusal: null });
  assert.deepEqual(okVerdict(missing, seen), { kind: 'wait' });
  // a stale refusal does not block a draft that has not been checked either: it waits
  const staleNo = draftCheckOf(pocket, before, { doc: check, feature: missing, refusal: 'no' });
  assert.deepEqual(okVerdict(pocket, staleNo), { kind: 'wait' });
  // the answer for this draft arrives
  assert.deepEqual(okVerdict(missing, draftCheckOf(missing, check, { doc: check, feature: missing, refusal: 'it misses' })),
    { kind: 'refused', why: 'it misses' });
  // the same draft object checked in an OLDER document (the model changed underneath) is not its answer
  const older = { ...doc, features: [...doc.features] };
  assert.deepEqual(okVerdict(missing, draftCheckOf(missing, check, { doc: older, feature: missing, refusal: null })), { kind: 'wait' });
  // a feature with nothing to build it in (suppressed, past the rollback bar) has nothing to refuse it
  assert.deepEqual(okVerdict(missing, draftCheckOf(missing, null, null)), { kind: 'ok' });
});

test('the draft\'s sentence comes from its own id, else the whole build\'s error', () => {
  const r = new Map([['pocket2', 'later one'], ['pocket1', 'this one']]);
  assert.equal(draftRefusalOf(r, 'pocket1', null), 'this one');
  assert.equal(draftRefusalOf(new Map([['pocket2', 'later one']]), 'pocket1', null), null);
  assert.equal(draftRefusalOf(undefined, 'pocket1', 'the kernel stopped'), 'the kernel stopped');
  assert.equal(draftCheckRun({ version: 1, features: [box] }, 'pocket1', r, null), null);
});

test('a preview build leaves the studio\'s refusals as they were, so a later feature\'s sentence stays (kernel)', () => {
  // the model as it is: the later pocket misses (its sketch is off the part)
  const off = { ...sk2, points: [[100, 100], [110, 100], [110, 110], [100, 110]] };
  const model = { version: 1, features: [box, sk, pocket, off, later] };
  const mine = engine.build(model).refusals;
  assert.match(mine.get('pocket2') ?? '', /pocket2/);
  // the overlay's build holds features up to the draft only, so it has no word for pocket2
  const shown = padDisplayDoc(model, 'pocket1', overlayOnly(pocket), draftCheckDoc(model, 'pocket1', pocket));
  const preview = engine.build(shown.doc).refusals ?? new Map();
  assert.equal(preview.get('pocket2'), undefined);
  assert.equal(refusalsAfterBuild(mine, preview, true), mine);
  assert.equal(refusalsAfterBuild(mine, preview, false), preview);
});
