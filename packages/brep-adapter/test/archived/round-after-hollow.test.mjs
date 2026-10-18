// A round or chamfer asked for AFTER a hollow (K-1b, docs/specs/SPEC-round-after-cut.md).
// A hollow of a plain box is a cut whose tool is the inner box, so it goes through the same replay as a
// hole: round the plain box first, then cut the inner box back out, but only when the inner box provably
// stays clear of the rounded corner. Otherwise the kernel refuses in a sentence and shows the hollow part.
//
// Oracles, none of them the replay itself:
//   closed form  V = outer - inner - (1 - pi/4) r^2 L   (round)   or   - s^2 L / 2   (chamfer), L the edge length
//   the asymmetric box (40 x 30 x 20) shows WHICH edge was rounded
//   OpenCascade builds the same document and must agree on volume and face count
//   a sweep of the round across the wall thickness: builds => closed form, else refuses; never another number
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const { facesOf } = await import('../dist/topo-resolve.js');
const arc = await import('../../sketch/dist/sketch-arc.js');

const PI = Math.PI;
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const id = r.doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(j));
  return { doc: r.doc, json: j, id, refusals, s: m.shapes[id] };
}
function occt(doc, id) {
  const shape = buildDoc(oc, { version: 1, features: doc.features }, arc).shapes.get(id);
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  return { volume: g.Mass(), faces: facesOf(oc, shape).length };
}
const wedge = (r, L) => (1 - PI / 4) * r * r * L;
const chamfer = (s, L) => 0.5 * s * s * L;
const HOLLOW = 40 * 40 * 20 - 36 * 36 * 16; // wall 2, closed

test('closed hollow then round a corner the wall keeps clear of: exact closed form', () => {
  const r = build("const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nround(b.edge('top', 'front'), 1.5)");
  assert.deepEqual(r.refusals, {});
  near(r.s.volume, HOLLOW - wedge(1.5, 40));
  const c = build("const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nchamfer(b.edge('top', 'front'), 1.5)");
  assert.deepEqual(c.refusals, {});
  near(c.s.volume, HOLLOW - chamfer(1.5, 40));
});

test('an asymmetric box shows WHICH edge was rounded after a hollow', () => {
  const hollow = 40 * 30 * 20 - 36 * 26 * 16;
  for (const [edge, L] of [[['top', 'front'], 40], [['top', 'right'], 30], [['front', 'right'], 20]]) {
    const r = build(`const b = box(40, 30, 20)\nshell(b, { wall: 2 })\nround(b.edge('${edge[0]}', '${edge[1]}'), 1.5)`);
    assert.deepEqual(r.refusals, {}, edge.join('/'));
    near(r.s.volume, hollow - wedge(1.5, L));
  }
});

test('an open-top hollow (a cup) then a round: exact or refused with a sentence, never another number', () => {
  const cup = 40 * 30 * 20 - 36 * 26 * 18;
  const r = build("const b = box(40, 30, 20)\nshell(b, { wall: 2, open: 'top' })\nround(b.edge('front', 'right'), 1.5)");
  if (Object.keys(r.refusals).length === 0) near(r.s.volume, cup - wedge(1.5, 20));
  else {
    // the boolean cannot take an inner box flush with the open face against a rounded body yet
    assert.match(r.refusals.round1, /hollow/);
    near(r.s.volume, cup); // the cup is shown, unrounded
  }
});

test('the OCCT referee agrees on volume and face count', () => {
  for (const code of [
    "const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nround(b.edge('top', 'front'), 1.5)",
  ]) {
    const r = build(code);
    assert.deepEqual(r.refusals, {}, code);
    const o = occt(r.doc, r.id);
    near(r.s.volume, o.volume, 1e-7);
    assert.equal(r.s.faces, o.faces, code);
  }
});

test('a sweep of the round across the wall thickness: closed form or a refusal, never another number', () => {
  let built = 0, refused = 0;
  for (const rr of [0.5, 1, 1.5, 1.9, 1.999, 2, 2.001, 2.5, 3, 5]) {
    const r = build(`const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nround(b.edge('top', 'front'), ${rr})`);
    if (Object.keys(r.refusals).length === 0) {
      near(r.s.volume, HOLLOW - wedge(rr, 40));
      assert.ok(rr < 2, `r = ${rr} reaches the cavity and must not build`);
      built++;
    } else {
      assert.ok((r.refusals.round1 ?? '').length > 0);
      near(r.s.volume, HOLLOW); // the hollow part is shown, not an empty or rounded-solid one
      refused++;
    }
  }
  assert.ok(built >= 4 && refused >= 4, `${built} built, ${refused} refused`);
});

test('a round that reaches the cavity refuses in a sentence that says what to do', () => {
  const r = build("const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nround(b.edge('top', 'front'), 3)");
  assert.match(r.refusals.round1 ?? '', /round|cut|hollow/i);
  assert.match(r.refusals.round1, /before you/);
});

test('hollow, round, then drill still builds when everything stays clear', () => {
  const r = build("const b = box(40, 40, 20)\nshell(b, { wall: 2 })\nround(b.edge('top', 'front'), 1.5)\nhole(b, { across: 6 })");
  // a hole after a round of a hollowed box is the existing refusal or an exact build; never a wrong number
  if (Object.keys(r.refusals).length === 0) near(r.s.volume, HOLLOW - wedge(1.5, 40) - 2 * PI * 9 * 2);
  else assert.ok(r.refusals.hole1);
});

test('the order that always built is unchanged: round first, then hollow refuses as before or is exact', () => {
  const r = build("const b = box(40, 40, 20)\nround(b.edge('top', 'front'), 1.5)\nshell(b, { wall: 2 })");
  if (Object.keys(r.refusals).length === 0) near(r.s.volume, 40 * 40 * 20 - wedge(1.5, 40) - 36 * 36 * 16);
  else assert.ok(r.refusals.shell1);
});
