// SPEC-datum-family Stage 3 on the real wasm: a doc with a `datum` row builds
// exactly like the same part without it; the kernel ignores the datum and
// `onDatum`. Closed forms: 40x25 rect pulled 12 = 12000.
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
const { applyParam } = await import('@shuff57/reshape-script/model-codegen');

function measureDoc(features) {
  const doc = { version: 1, features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  assert.deepEqual(out.refusals ?? {}, {}, 'no refusals');
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const s = m.shapes[features.at(-1).id]; // last FEATURE, not last key (map is sorted)
  return { volume: s.volume, bbox: s.bbox, faces: s.faces };
}
function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return { ...measureDoc(r.doc.features), r };
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const nearBox = (a, b, msg) => a.flat().forEach((x, i) => near(x, b.flat()[i], `${msg}[${i}]`));
const FRAME = '{ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }';

test('datum + framed sketch + extrude: 12000, z in [10,22], 6 faces, identical to the literal frame', () => {
  const a = measure(`const sk = sketch(plane(${FRAME}))\nsk.rect(40, 25)\npull(sk, 12)`);
  assert.deepEqual(a.r.doc.features.map((f) => f.kind), ['datum', 'sketch', 'extrude']);
  near(a.volume, 12000, 'volume');
  nearBox(a.bbox, [[-20, -12.5, 10], [20, 12.5, 22]], 'bbox');
  assert.equal(a.faces, 6);
  const b = measure(`const sk = sketch(${FRAME})\nsk.rect(40, 25)\npull(sk, 12)`);
  assert.equal(b.r.doc.features.length, 2);
  near(a.volume, b.volume, 'literal frame volume');
  nearBox(a.bbox, b.bbox, 'literal frame bbox');
});

test('a datum row changes nothing the kernel builds (with and without, same measurements)', () => {
  const a = measure(`const sk = sketch(plane('top', 10))\nsk.rect(40, 25)\npull(sk, 12)`);
  const stripped = a.r.doc.features.filter((f) => f.kind !== 'datum').map(({ onDatum, ...f }) => f);
  const b = measureDoc(stripped);
  near(a.volume, b.volume, 'volume');
  nearBox(a.bbox, b.bbox, 'bbox');
  near(a.volume, 12000, 'closed form');
});

test('an only-datum doc builds with no refusal', () => {
  const r = runScript("plane('top', 3)\nplane({ origin: [1,2,3], u: [1,0,0], v: [0,1,0] })");
  assert.deepEqual(r.errors, []);
  const out = JSON.parse(brep.build_doc_json(JSON.stringify({ version: 1, features: r.doc.features })));
  assert.deepEqual(out.refusals ?? {}, {});
});

test('handedness (Stage 2) still holds through a datum: front y in [-12,0]; swapped u,v mirrors', () => {
  const body = (s) => `const sk = ${s}\nsk.rect(40, 25)\npull(sk, 12)`;
  const front = measure(body("sketch('front')"));
  for (const s of ["sketch(plane('front'))", 'sketch(plane({ origin: [0,0,0], u: [1,0,0], v: [0,0,1] }))']) {
    const m = measure(body(s));
    near(m.volume, 12000, 'volume');
    nearBox(m.bbox, front.bbox, 'bbox');
  }
  near(front.bbox[0][1], -12, 'y min');
  near(front.bbox[1][1], 0, 'y max');
  const sw = measure(body('sketch(plane({ origin: [0,0,0], u: [0,1,0], v: [1,0,0] }))'));
  near(sw.bbox[0][2], -12, 'swapped: z min');
});

test('param(): a named-plane datum offset bound to param() moves the sketch and the part (measured)', () => {
  const code = "const lift = param('lift', 10, { min: 0, max: 50 })\nconst sk = sketch(plane('top', lift))\nsk.rect(40, 25)\npull(sk, 12)";
  const a = measure(code);
  nearBox(a.bbox, [[-20, -12.5, 10], [20, 12.5, 22]], 'bbox at 10');
  const rt = runScript(toScript(a.r.doc, a.r.namedParams));
  assert.deepEqual(rt.errors, []);
  const moved = applyParam(a.r.doc, 'pl1_offset', 30);
  const m = measureDoc(moved.features);
  nearBox(m.bbox, [[-20, -12.5, 30], [20, 12.5, 42]], 'bbox at 30');
  near(m.volume, 12000, 'volume unchanged');
});

test('round trip: the emitted plane statement rebuilds the same part', () => {
  const a = measure(`const sk = sketch(plane({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 0, 1] }))\nsk.rect(30, 20)\npull(sk, 10)`);
  const t = toScript(a.r.doc);
  assert.match(t, /const pl1 = plane\(/);
  const b = measure(t);
  near(b.volume, a.volume, 'volume');
  nearBox(b.bbox, a.bbox, 'bbox');
});
