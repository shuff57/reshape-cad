// Wrong-solid findings G1 and G6 (docs/PLAN-next.md section 25): brep-rs built a closed, wrong solid with an empty
// refusals map. G1: a cut whose tool pokes out of a curved base was built as a sealed void, V(A) - V(tool). G6: two
// overlapping tori were treated as disjoint (union = two shells, V1 + V2; cut = A whole).
// The contract: refuse in a sentence, or build the solid OpenCascade builds. Never the wrong volume.
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

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors ?? [], [], 'script runs');
  const features = r.doc.features;
  const id = features.at(-1).id;
  const json = JSON.stringify({ version: 1, features });
  const out = JSON.parse(brep.build_doc_json(json));
  const refused = Object.keys(out.refusals ?? {}).length > 0;
  const meas = refused ? null : JSON.parse(brep.measure_doc(json)).shapes?.[id];
  return { refused, volume: meas?.volume, refusals: out.refusals };
}

// OpenCascade / closed-form volumes, measured on the wrong-solid sweep.
const CASES = [
  // G1: a 1 x 20 x 20 slab through a sphere; the sealed-void answer was 7781.2309
  ['sphere cut by a slab that pokes out', "let v = sphere(25, {at:[0,5,-5]}); const p1 = box(1,20,20,{at:[0,5,-5]}); v = cut(v,p1)", 7792.5926154062145, 7781.230868723421],
  // G6: overlapping rings; the two-shell answer was 16060.31
  ['overlapping rings joined', "let v = ring(40,11,{at:[1,1,10]}); const p1 = ring(40,10,{at:[1,0,0]}); v = join(v,p1)", 15971.612447357775, 16060.31376167266],
];

for (const [name, code, truth, wrong] of CASES) {
  test(`${name}: refused or exact, never the wrong solid`, () => {
    const r = build(code);
    if (r.refused) {
      assert.match(Object.values(r.refusals)[0], /cannot boolean|cannot/);
      return;
    }
    assert.ok(Math.abs(r.volume - wrong) > 1, `built the known wrong volume ${r.volume}`);
    assert.ok(Math.abs(r.volume - truth) <= 1e-6 * truth, `volume ${r.volume} vs ${truth}`);
  });
}

test('a tool sealed well inside a sphere is still a cavity, exactly', () => {
  // cavity pin: a 10 mm cube centred in a 50 mm sphere (a script's second shape defaults to x = 45, so say where it is)
  const r = build('let v = sphere(50, {at:[0,0,0]}); const p1 = box(10,10,10, {at:[0,0,0]}); v = cut(v,p1)');
  if (r.refused) return; // honest: not built for a sphere base
  const want = (4 / 3) * Math.PI * 25 ** 3 - 1000;
  assert.ok(Math.abs(r.volume - want) <= 1e-6 * want, `${r.volume} vs ${want}`);
});

test('the same cut with the cube left at its default place (x = 45, clear of the sphere) removes nothing', () => {
  // Used to refuse; the sphere and the box are apart, so the answer is the whole sphere (S4h).
  const r = build('let v = sphere(50); const p1 = box(10,10,10); v = cut(v,p1)');
  if (r.refused) return;
  const whole = (4 / 3) * Math.PI * 25 ** 3;
  assert.ok(Math.abs(r.volume - whole) <= 1e-6 * whole, `${r.volume} vs ${whole}`);
});
