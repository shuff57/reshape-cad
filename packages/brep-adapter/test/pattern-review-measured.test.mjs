// The review fixes to repeat / mirror of pockets and holes (B1, B2, B4, M3, M5; B3 is a text round trip), measured on the
// solid brep-rs builds. Every expected number is a closed form computed here, or a live reference built from the same
// cuts made by hand; the document checks are in packages/script/test/pattern-review-fixes.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');
const { solveDoc } = await import('@shuff57/reshape-script/model-codegen');

const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

/** Run, solve (as the app does on adoption), build and measure the last feature. */
function built(code, { errors = [] } = {}) {
  const r = runScript(code);
  assert.deepEqual(r.errors.map((e) => String(e.message ?? e)), errors, code);
  const doc = solveDoc(r.doc);
  const id = doc.features.at(-1).id;
  const json = JSON.stringify({ ...doc, measure: id });
  const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
  const s = JSON.parse(brep.measure_doc(json)).shapes[id];
  return { r, doc, id, json, refusals, volume: s?.volume, bbox: s?.bbox };
}
/** Every mesh edge used by exactly two triangles (vertices welded by position). */
function closed(m) {
  const mesh = JSON.parse(brep.mesh_feature(m.json, m.id, 0.1));
  assert.ok(!mesh.error, mesh.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(mesh.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(mesh.indices[t + e]), b = key(mesh.indices[t + ((e + 1) % 3)]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  return [...uses.values()].every((n) => n === 2);
}
const shoelace = (pts) => Math.abs(pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

// ---- B1 ----
test('B1: a repeat copy that lands on the joined pad cuts it (closed form, and the same as cutting it by hand)', () => {
  const head = `const s = sketch('top'); s.rect(40, 30); const plate = pull(s, 10);
const s2 = sketch('top'); s2.rect(40, 30, { at: [30, 0] });
const body = join(plate, pull(s2, 10));
const c = sketch('top', 10); c.circle(6, { at: [0, 0] });
const p = pocket(c, body, 5);
`;
  const m = built(head + 'repeat(p, { count: 2, step: 40 })');
  assert.deepEqual(m.refusals, {});
  // plate 40 x 30 x 10 and pad 40 x 30 x 10 overlapping 10 x 30 x 10, less two pockets 6 across and 5 deep
  const want = 40 * 30 * 10 * 2 - 10 * 30 * 10 - 2 * Math.PI * 3 * 3 * 5;
  assert.ok(near(m.volume, want), `${m.volume} vs ${want}`);
  assert.deepEqual(m.bbox, [[-20, -15, 0], [50, 15, 10]]);
  assert.ok(closed(m), 'mesh closed');
  const byHand = built(head + `const c2 = sketch('top', 10); c2.circle(6, { at: [40, 0] }); pocket(c2, p, 5)`);
  assert.ok(near(m.volume, byHand.volume), `${m.volume} vs by hand ${byHand.volume}`);
  // the bug: the copy was left out, and the part kept a single pocket
  const one = built(head);
  assert.ok(near(one.volume - m.volume, Math.PI * 3 * 3 * 5), 'the copy removes one more pocket');
});

// ---- B2 ----
test('B2: a slanted pull centres its bounding box off the sketch middle, so a hole copy placed from the sketch is refused', () => {
  const head = `const s = sketch('top'); s.rect(60, 20); const p = pull(s, 10, { direction: [1, 0, 1] }); hole(p, { across: 4, at: [5, 0] });\n`;
  const plain = built(head);
  assert.deepEqual(plain.refusals, {});
  // the slide carries the top 10 along x: the box runs -30..40, centred at 5, not at the sketch middle 0
  assert.ok(near(plain.bbox[0][0], -30) && near(plain.bbox[1][0], 40), JSON.stringify(plain.bbox));
  // a sheared prism keeps its volume (area x height); the hole, at world x = 10, stays inside the part all the way down
  assert.ok(near(plain.volume, 60 * 20 * 10 - Math.PI * 2 * 2 * 10), String(plain.volume));
  const why = 'mirror() of a hole drills a copy of the hole at each place, and the part it drills was pulled along a slant, so brep-rs cannot yet tell where the middle of the part is, and a hole is placed from the middle. Drill the extra holes yourself, one hole(...) each.';
  const m = built(head + "mirror(p, 'left-right', { at: 0 })", { errors: [why] });
  // nothing was added: the part is the one hole, as before
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, plain.volume));
});

// ---- B4 ----
test('B4: a repeat copy of a sketch with rules cuts the solved outline (closed form, and the same as cutting it by hand)', () => {
  const head = `const s = sketch('top'); s.rect(80, 30); const plate = pull(s, 10);
const c = sketch('top', 10); c.polygon([[-30,-5],[-20,-5],[-20,5],[-30,5]]); c.length(1, 4);
const p = pocket(c, plate, 4);
`;
  const m = built(head + 'repeat(p, { count: 2, step: 30 })');
  assert.deepEqual(m.refusals, {});
  const solved = m.doc.features.find((f) => f.id === 'sk2').points;
  const area = shoelace(solved);
  assert.ok(near(area, 70, 1e-6), `the rule makes a trapezoid of area 70, got ${area}`);
  const want = 80 * 30 * 10 - 2 * area * 4;
  assert.ok(near(m.volume, want, 1e-9), `${m.volume} vs ${want}`);
  assert.ok(closed(m), 'mesh closed');
  // the bug cut the drawn 10 x 10 square for the copy: 24000 - 4 * (70 + 100)
  assert.ok(Math.abs(m.volume - (24000 - 4 * (area + 100))) > 100);
  const lit = (pts) => `[${pts.map((q) => `[${q[0] + 30}, ${q[1]}]`).join(', ')}]`;
  const byHand = built(head + `const c2 = sketch('top', 10); c2.polygon(${lit(solved)}); pocket(c2, p, 4)`);
  assert.ok(near(m.volume, byHand.volume, 1e-9), `${m.volume} vs by hand ${byHand.volume}`);
});

// ---- B3, measured: the reopened script builds the same solid ----
test('B3: a saved repeat of a pocket reopens and builds the same solid', () => {
  const src = `const s = sketch('top'); s.rect(80, 30); const plate = pull(s, 10);
const c = sketch('top', 10); c.circle(6, { at: [-20, 0] });
const p = pocket(c, plate, 4);
repeat(p, { count: 3, step: 20 })`;
  const a = built(src);
  const b = built(toScript(a.r.doc));
  assert.deepEqual(a.refusals, {});
  assert.ok(near(a.volume, 80 * 30 * 10 - 3 * Math.PI * 9 * 4));
  assert.ok(near(b.volume, a.volume));
});

// ---- M3 ----
test('M3: a tapered or slanted pull reaches past its sketch outline, so a through hole across it asks for a depth', () => {
  for (const [opts, lo, hi] of [
    ['{ taper: 10 }', -30 - 20 * Math.tan(Math.PI / 18), 30 + 20 * Math.tan(Math.PI / 18)],
    ['{ direction: [1, 0, 1] }', -30, 50],
  ]) {
    const part = built(`const s = sketch('top'); s.rect(60, 20); const p = pull(s, 20, ${opts});`);
    // the outline runs -30..30; the solid does not stay inside it
    assert.ok(near(part.bbox[0][0], lo, 1e-9) && near(part.bbox[1][0], hi, 1e-9), `${opts} ${JSON.stringify(part.bbox)}`);
    const r = runScript(`const s = sketch('top'); s.rect(60, 20); const p = pull(s, 20, ${opts}); hole(p, { across: 4, along: 'x' })`);
    assert.deepEqual(r.errors.map((e) => String(e.message)), [
      "hole() cannot find how thick this extrude is along x yet, so it cannot drill all the way through. Give it a depth: hole(shape, { across: 4, deep: 20 }).",
    ]);
  }
});

// ---- M5 ----
test('M5: a pocket pattern whose copy misses a cylinder is refused by the script, and the part builds with no refusal', () => {
  const why = 'repeat() of a pocket cuts a copy of the pocket at each place, and copy 2 of the cut lies wholly off the part, so it would cut nothing. Cut the extra pockets yourself, one sketch and pocket(...) each.';
  const m = built(`const b = cylinder(40, 10);
const c = sketch('top', 5); c.circle(6, { at: [10, 0] });
const p = pocket(c, b, 4);
repeat(p, { count: 3, step: 20 })`, { errors: [why] });
  // before, the kernel refused copy 2 ("does not touch the part") and copy 3 with "cannot find solid": no refusal now
  assert.deepEqual(m.refusals, {});
  assert.ok(near(m.volume, Math.PI * 20 * 20 * 10 - Math.PI * 3 * 3 * 4), String(m.volume));
  // copies that stay on the disc are all cut
  const ok = built(`const b = cylinder(40, 10);
const c = sketch('top', 5); c.circle(6, { at: [-10, 0] });
const p = pocket(c, b, 4);
repeat(p, { count: 3, step: 10 })`);
  assert.deepEqual(ok.refusals, {});
  assert.ok(near(ok.volume, Math.PI * 20 * 20 * 10 - 3 * Math.PI * 3 * 3 * 4), String(ok.volume));
});
