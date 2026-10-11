// A hole whose tool lands in the empty GAP between the copies of a pattern cuts
// nothing, so the kernel must say so. Before (measured 2026-10-03): a BLIND hole
// there came back with no refusal and the volume unchanged (8000 for two
// 20x20x10 boxes), while the through version refused. The cause was the one
// accepted exception in `cut_missed`: a tool wholly inside the part's bounding
// box that changes nothing was left unrefused, because it may sit in a shell's
// own void (shell-hole.test.mjs). That exception is now narrowed to the box of a
// SINGLE shell, so a gap between lumps is a miss but a cavity is still not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const id = r.doc.features.at(-1).id;
  return { refusals, vol: JSON.parse(brep.measure_doc(j)).shapes[id]?.volume };
}
const pat = (n) => `const b = box(20, 20, 10)\nlinearPattern(b, { count: ${n}, step: 30 })\n`;

test('blind hole in the gap of a 2-copy pattern refuses (it used to cut nothing, silently)', () => {
  const { refusals } = build(pat(2) + 'hole(b, { across: 6, deep: 4 })');
  assert.match(refusals.hole1 ?? '', /does not touch the part, so it cuts nothing/);
});

test('through hole in the same gap still refuses', () => {
  const { refusals } = build(pat(2) + 'hole(b, { across: 6 })');
  assert.match(refusals.hole1 ?? '', /does not touch the part/);
});

test('a through hole into the middle copy of three builds, exact', () => {
  const { refusals, vol } = build(pat(3) + 'hole(b, { across: 6 })');
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(vol - (3 * 4000 - Math.PI * 9 * 10)) < 1e-6 * 12000, `${vol}`);
});

test('a blind hole before the pattern, then copied, builds in every copy (closed form)', () => {
  const { refusals, vol } = build('const b = box(20, 20, 10)\nhole(b, { across: 6, deep: 4 })\nlinearPattern(b, { count: 3, step: 30 })');
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(vol - (3 * 4000 - 3 * Math.PI * 9 * 4)) < 1e-6 * 12000, `${vol}`);
});

test('a blind hole into any copy of three builds, exact (K-3: the lump is cut alone)', () => {
  for (const [at, deep] of [['[0, 0]', 4], ['[-30, 0]', 4], ['[30, 0]', 4], ['[0, 0]', 9], ['[0, 5]', 2.5]]) {
    const { refusals, vol } = build(pat(3) + `hole(b, { across: 6, deep: ${deep}, at: ${at} })`);
    assert.deepEqual(refusals, {}, `${at} deep ${deep}`);
    assert.ok(Math.abs(vol - (12000 - Math.PI * 9 * deep)) < 1e-9 * 12000, `${at} deep ${deep}: ${vol}`);
  }
});

test('two holes in two copies, one blind and one through, keep every floor (floors == bores)', () => {
  const { refusals, vol } = build(pat(3) + 'hole(b, { across: 6, deep: 4, at: [-30, 0] })\nhole(b, { across: 4, at: [30, 0] })');
  assert.deepEqual(refusals, {});
  assert.ok(Math.abs(vol - (12000 - Math.PI * 9 * 4 - Math.PI * 4 * 10)) < 1e-9 * 12000, `${vol}`);
});

test('a blind hole whose tool spans the gap between copies still never returns a wrong number', () => {
  // wide enough (across 40) to reach two lumps from the middle: exact or a refusal
  const { refusals, vol } = build(pat(3) + 'hole(b, { across: 40, deep: 4 })');
  if (Object.keys(refusals).length === 0) assert.ok(vol < 12000 && vol > 12000 - Math.PI * 400 * 4 - 1e-6, `${vol}`);
});

test('OpenCascade agrees on a blind hole into the middle copy of three', async () => {
  const { buildDoc } = await import('../dist/occt-build.js');
  const arc = await import('../../sketch/dist/sketch-arc.js');
  const { pathToFileURL } = await import('node:url');
  const dir = path.resolve(PKG, '../../../node_modules/replicad-opencascadejs/dist');
  const glue = await import(pathToFileURL(path.join(dir, 'replicad_single.js')).href);
  const oc = await glue.default({ locateFile: (f) => path.join(dir, f) });
  const r = runScript(pat(3) + 'hole(b, { across: 6, deep: 4 })');
  const id = r.doc.features.at(-1).id;
  const shape = buildDoc(oc, { version: 1, features: r.doc.features }, arc).shapes.get(id);
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const mine = JSON.parse(brep.measure_doc(JSON.stringify(r.doc))).shapes[id].volume;
  assert.ok(Math.abs(g.Mass() - mine) < 1e-7 * mine, `${g.Mass()} vs ${mine}`);
});
