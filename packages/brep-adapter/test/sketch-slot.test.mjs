// S-4 on the real wasm: sk.slot() extrudes to the obround closed form.
// area = 2r*len + pi*r^2 (rectangle between the centres + two half-discs).
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

function measure(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  const doc = { version: 1, features: r.doc.features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  assert.deepEqual(out.refusals ?? {}, {}, 'no refusals');
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const id = r.doc.features.at(-1).id; // last FEATURE, not last map key
  return { v: m.shapes[id].volume, r };
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('slot([-20,0],[20,0],5) x 10 = (40*10 + pi*25)*10 = 4785.398 (the earlier measured r5 slot)', () => {
  const { v } = measure("const sk = sketch('top').slot([-20, 0], [20, 0], 5)\npull(sk, 10)");
  near(v, (40 * 10 + Math.PI * 25) * 10, 'volume');
  assert.ok(Math.abs(v - 4785.398) < 1e-3, 'earlier measured figure 4785.398');
});

test('slot([0,0],[40,0],10) is the obround (800+100*pi)*h = 11141.592654 at h=10', () => {
  // The brief wrote (400+100*pi)*h; the honest area is 2r*len + pi*r^2 =
  // 20*40 + 100*pi = 800 + 100*pi. At h=10 that is the plan's 11141.592654.
  const { v } = measure("const sk = sketch('top').slot([0, 0], [40, 0], 10)\npull(sk, 10)");
  near(v, (800 + 100 * Math.PI) * 10, 'volume');
  near(v, 11141.592654, 'plan figure');
});

test('a slanted slot builds with the same closed form', () => {
  const { v } = measure("const sk = sketch('top').slot([0, 0], [30, 40], 6)\npull(sk, 7)");
  near(v, (50 * 12 + Math.PI * 36) * 7, 'volume');
});

test('D6 fixpoint: emitted text rebuilds the same volume and re-emits itself', () => {
  const { v, r } = measure("const sk = sketch('top').slot([-20, 0], [20, 0], 5)\npull(sk, 10)");
  const t = toScript(r.doc);
  assert.doesNotMatch(t, /slot/);
  const again = measure(t);
  near(again.v, v, 'rebuilt volume');
  assert.equal(toScript(again.r.doc), t);
});
