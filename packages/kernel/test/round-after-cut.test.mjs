// A round (or chamfer) asked for AFTER a hole (docs/specs/SPEC-round-after-cut.md).
// The kernel rounds the plain root box first and re-applies the holes, but only when every
// hole provably stays clear of the rounded corner; otherwise it refuses in a sentence that
// says what to do. It never fillets a boolean result, so K2b is untouched.
//
// Oracles (none of them is the replay itself):
//   closed form  V = box - pi (d/2)^2 t - (1 - pi/4) r^2 L          (round, edge length L)
//   the asymmetric box (distinct edge lengths) shows WHICH edge was rounded
//   OpenCascade builds the same document and must agree on volume and face count
//   a sweep of the hole across the disjointness limit: builds => closed form, else refuses
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

test('hole then round: exact closed form, 8 faces, same as round-first', () => {
  const after = build("const b = box(40, 40, 20)\nhole(b, { across: 8 })\nround(b.edge('top', 'front'), 3)");
  assert.deepEqual(after.refusals, {});
  near(after.s.volume, 32000 - PI * 16 * 20 - wedge(3, 40));
  assert.equal(after.s.faces, 8);
  const first = build("const b = box(40, 40, 20)\nround(b.edge('top', 'front'), 3)\nhole(b, { across: 8 })");
  assert.deepEqual(first.refusals, {});
  near(after.s.volume, first.s.volume); // regression pin: the order that always built
});

test('an asymmetric box shows WHICH edge was rounded (edge lengths 40, 30, 20)', () => {
  for (const [edge, L] of [[['top', 'front'], 40], [['top', 'right'], 30], [['front', 'right'], 20]]) {
    const r = build(`const b = box(40, 30, 20)\nhole(b, { across: 6 })\nround(b.edge('${edge[0]}', '${edge[1]}'), 2)`);
    assert.deepEqual(r.refusals, {}, edge.join('/'));
    // a through hole along z: 20 deep. wedge length is the rounded edge's own length.
    near(r.s.volume, 40 * 30 * 20 - PI * 9 * 20 - wedge(2, L));
  }
});

test('the OCCT referee agrees on volume and face count', () => {
  const r = build("const b = box(40, 40, 20)\nhole(b, { across: 8 })\nround(b.edge('top', 'front'), 3)");
  const o = occt(r.doc, r.id);
  near(r.s.volume, o.volume, 1e-7);
  assert.equal(r.s.faces, o.faces);
});

test('a blind hole then a round refuses honestly: the kernel cannot cut a blind hole into a rounded box in either order', () => {
  const first = build("const b = box(40, 40, 20)\nround(b.edge('top', 'front'), 3)\nhole(b, { across: 8, deep: 6 })");
  assert.match(first.refusals.hole1 ?? '', /cannot cut this hole yet/); // the order that always existed
  const r = build("const b = box(40, 40, 20)\nhole(b, { across: 8, deep: 6 })\nround(b.edge('top', 'front'), 3)");
  assert.ok((r.refusals.round1 ?? '').length > 0, 'must refuse, not return the unrounded box silently');
  near(r.s.volume, 32000 - PI * 16 * 6); // shown without the round
});

test('sweep the hole across the limit: it builds exactly or refuses, never another number', () => {
  // hole d=8 at y0 occupies y in [y0-4, y0+4]; the rounded corner at the front (y = -20) is y in [-20, -17]
  let built = 0, refused = 0;
  for (let y0 = -15.5; y0 <= 0; y0 += 0.5) {
    const r = build(`const b = box(40, 40, 20)\nhole(b, { across: 8, at: [0, ${y0}] })\nround(b.edge('top', 'front'), 3)`);
    if (Object.keys(r.refusals).length) {
      refused++;
      assert.match(r.refusals.round1, /would reach a cut made earlier/, `y0=${y0}`);
      assert.ok(y0 - 4 < -17 + 1e-6, `y0=${y0} refused although far from the edge`);
    } else {
      built++;
      near(r.s.volume, 32000 - PI * 16 * 20 - wedge(3, 40));
      assert.ok(y0 - 4 > -17 - 1e-6, `y0=${y0} built although it meets the corner`);
    }
  }
  assert.ok(built >= 20 && refused >= 3, `built ${built}, refused ${refused}`);
});

test('twenty touching configurations all refuse with the sentence that says what to do', () => {
  let n = 0;
  for (const across of [6, 8, 10, 12]) {
    for (const off of [0, 0.5, 1, 1.5, 2]) {
      // the hole's near wall sits at or inside the rounded corner: y = -(20 - r) + ... pushed to touch
      const y0 = -(17 - across / 2) - off; // wall at y = -17 - off (inside the 3 mm corner zone or past it)
      if (y0 - across / 2 < -20 + 1e-6) continue; // would leave the box
      const r = build(`const b = box(40, 40, 20)\nhole(b, { across: ${across}, at: [0, ${y0}] })\nround(b.edge('top', 'front'), 3)`);
      assert.match(r.refusals.round1 ?? '', /round before you cut/, `across ${across} y0 ${y0}`);
      n++;
    }
  }
  assert.ok(n >= 10, `only ${n} configurations`);
});

test('chamfer after a hole refuses honestly (the kernel cannot cut a hole into a chamfered box)', () => {
  const r = build("const b = box(40, 40, 20)\nhole(b, { across: 8 })\nchamfer(b.edge('top', 'front'), 3)");
  const text = r.refusals.bevel1 ?? '';
  assert.ok(text.length > 0, 'must refuse, not silently drop the chamfer');
  // the shown shape is the box with its hole, no chamfer
  near(r.s.volume, 32000 - PI * 16 * 20);
});

test('a second round after a hole refuses, shown without it', () => {
  const r = build("const b = box(40, 40, 20)\nhole(b, { across: 8 })\nround(b.edge('top', 'front'), 3)\nround(b.edge('top', 'right'), 3)");
  assert.ok((r.refusals.round2 ?? '').length > 0);
  near(r.s.volume, 32000 - PI * 16 * 20 - wedge(3, 40)); // the first round is kept
});

test('hollow then a round that reaches the cavity refuses in the replay sentence (K-1b builds the clear cases: round-after-hollow.test.mjs)', () => {
  const r = build("const b = box(40, 40, 20)\nhollow(b, { wall: 2, open: 'top' })\nround(b.edge('front', 'right'), 3)");
  assert.match(r.refusals.round1 ?? '', /would reach a cut made earlier/);
});

test('a refused replay shows the source shape and keeps a refusal entry (never an empty result)', () => {
  const r = build("const b = box(40, 40, 20)\nhole(b, { across: 8, at: [0, -15] })\nround(b.edge('top', 'front'), 3)");
  assert.ok(r.refusals.round1);
  near(r.s.volume, 32000 - PI * 16 * 20);
});
