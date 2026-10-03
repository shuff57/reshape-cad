// M-1 refusal census (docs/PLAN-next.md). What does the real kernel do with
// the code a student actually writes?  Two corpora:
//   1. every CAD lesson script/solution of shCode unit 8-1, COPIED into
//      test/fixtures/student/ (never read from the sibling repo at test time);
//   2. a generated order matrix: hole / round / chamfer / hollow in every order
//      on a box, plus the same on a cylinder.
// Each case is built on the real wasm and its outcome is PINNED by the exact
// refusal sentence (or by "builds"), so a capability change fails this test and
// forces the pin, the plan and the docs to be updated together.
// Set CENSUS_WRITE=1 to rewrite docs/refusal-census.json from the run.
// The wasm must be rebuilt first (see brep-rs/AGENTS.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

const run = (code) => {
  const r = runScript(code);
  if (r.errors?.length) return { script: r.errors[0].message ?? JSON.stringify(r.errors[0]) };
  const out = JSON.parse(
    brep.build_doc_json(JSON.stringify({ version: 1, features: r.doc.features })),
  );
  const refusals = out.refusals ?? {};
  return Object.keys(refusals).length ? { refused: refusals } : { builds: true };
};

// ---- corpus 1: shCode 8-1 lessons -------------------------------------
const FIX = path.join(HERE, 'fixtures/student');
const lessons = readdirSync(FIX).filter((f) => f.endsWith('.js')).sort();

// ---- corpus 2: order matrix -------------------------------------------
const op = {
  hole: (v) => `hole(${v}, { across: 8 })`,
  round: (v) => `round(${v}.edge('top', 'front'), 3)`,
  chamfer: (v) => `chamfer(${v}.edge('top', 'front'), 3)`,
  hollow: (v) => `hollow(${v}, { wall: 2.5, open: 'top' })`,
};
const names = Object.keys(op);
const orders = [];
for (const a of names) {
  orders.push([a]);
  for (const b of names) if (b !== a) orders.push([a, b]);
}
const matrix = [];
for (const o of orders) {
  matrix.push({
    key: `box: ${o.join(' then ')}`,
    code: `const b = box(40, 40, 20)\n${o.map((n) => op[n]('b')).join('\n')}`,
  });
}
matrix.push({
  key: 'cylinder: hole along axis',
  code: `const c = cylinder(30, 20)\nhole(c, { across: 6 })`,
});
matrix.push({ key: 'sphere: hole', code: `const s = sphere(20)\nhole(s, { across: 6 })` });

const results = {};
for (const f of lessons)
  results[`lesson ${f}`] = run(readFileSync(path.join(FIX, f), 'utf8'));
for (const m of matrix) results[`matrix ${m.key}`] = run(m.code);

// Pinned outcomes. 'builds' or a substring of the kernel's sentence.
const EXPECT = Object.fromEntries([
  ["lesson 8-1-10-lab-sketch-and-pull.script.js", 'builds'],
  ["lesson 8-1-10-lab-sketch-and-pull.solution.js", 'builds'],
  ["lesson 8-1-11-project-desk-tray.script.js", 'builds'],
  ["lesson 8-1-11-project-desk-tray.solution.js", 'builds'],
  ["lesson 8-1-2-lab-your-first-box.script.js", 'builds'],
  ["lesson 8-1-2-lab-your-first-box.solution.js", 'builds'],
  ["lesson 8-1-3-lab-change-your-mind.script.js", 'builds'],
  ["lesson 8-1-3-lab-change-your-mind.solution.js", 'builds'],
  ["lesson 8-1-4-lab-drill-a-hole.script.js", 'builds'],
  ["lesson 8-1-4-lab-drill-a-hole.solution.js", 'builds'],
  ["lesson 8-1-5-lab-round-an-edge.script.js", 'builds'],
  ["lesson 8-1-5-lab-round-an-edge.solution.js", 'builds'],
  ["lesson 8-1-6-lab-hollow-it-out.script.js", 'builds'],
  ["lesson 8-1-6-lab-hollow-it-out.solution.js", 'builds'],
  ["lesson 8-1-8-lab-read-the-script.script.js", 'builds'],
  ["lesson 8-1-8-lab-read-the-script.solution.js", 'builds'],
  ["lesson 8-1-9-lab-write-it-yourself.script.js", 'builds'],
  ["lesson 8-1-9-lab-write-it-yourself.solution.js", 'builds'],
  ["matrix box: hole", 'builds'],
  ["matrix box: hole then round", 'builds'],
  ["matrix box: hole then chamfer", 'builds'], // planar boolean: 32000 - 16 pi 20 - 180 exact
  ["matrix box: hole then hollow", "can only hollow a box or a straight cylinder yet"],
  ["matrix box: round", 'builds'],
  ["matrix box: round then hole", 'builds'],
  ["matrix box: round then chamfer", "can only chamfer a convex edge"],
  ["matrix box: round then hollow", "can only hollow a box or a straight cylinder yet"],
  ["matrix box: chamfer", 'builds'],
  ["matrix box: chamfer then hole", 'builds'], // planar boolean, same closed form
  ["matrix box: chamfer then round", "can only round an edge of a box yet"],
  ["matrix box: chamfer then hollow", "can only hollow a box or a straight cylinder yet"],
  ["matrix box: hollow", 'builds'],
  ["matrix box: hollow then hole", 'builds'],
  ["matrix box: hollow then round", "would reach a cut made earlier"],
  ["matrix box: hollow then chamfer", 'builds'], // planar boolean (S1): 11264 - 45 = 11219 exact
  ["matrix cylinder: hole along axis", 'builds'],
  ["matrix sphere: hole", 'builds'],
]);

test('the census covers the lesson corpus and the matrix', () => {
  assert.ok(lessons.length >= 10, `only ${lessons.length} lesson files`);
  assert.ok(matrix.length >= 18);
});

test('census report', { skip: !process.env.CENSUS_WRITE }, () => {
  writeFileSync(
    path.resolve(HERE, '../../../docs/refusal-census.json'),
    JSON.stringify(results, null, 2) + '\n',
  );
});

for (const [key, got] of Object.entries(results)) {
  test(`census: ${key}`, () => {
    const want = EXPECT[key];
    assert.ok(want !== undefined, `unpinned: ${key} => ${JSON.stringify(got)}`);
    if (want === 'builds') return assert.deepEqual(got, { builds: true });
    assert.ok(got.refused, `${key} was pinned as refused (${want}) but ${JSON.stringify(got)}`);
    const text = Object.values(got.refused).join(' | ');
    assert.ok(text.includes(want), `${key}: expected "${want}" in "${text}"`);
  });
}
