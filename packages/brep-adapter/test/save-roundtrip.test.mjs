// W4 save round trip, kernel half (docs/PLAN-next.md "W4 save round trip"; the script half is
// packages/script/test/save-roundtrip.test.mjs). A student's model is saved as script text (toScript) or as doc JSON, and
// reopened with runScript / JSON.parse. Here the REAL kernel measures the model before and after, over a large corpus:
//   every docs example, every lesson fixture, a seeded slice of the wrong-solid sweep generators (wrong-solid-sweep-lib.mjs
//   families and wrong-solid-sweep-s4.mjs: holes, rounds, hollows, patterns, mirrors, turned parts, compounds) and of the 2D
//   audit generator (sketch-audit-lib.mjs: rects with rounds and chamfers, polygons, circles, slots, arcs, revolves), plus
//   doc-first cases (a stored doc, written by the studio, never a script).
// For each: doc before == doc after (to the emitter's 1e-6 / 1e-9 rounding, bit-identical on a second trip), and the kernel's
// measure (volume, bbox, faces, edges, refusals) before == after. Env: SAVE_N = scripts per generator family (default 40);
// SAVE_N=300 is the ~6000-script run recorded in the PLAN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundTrip, runScript, toScript, measure, firstDiff, QUANT } from './save-roundtrip-lib.mjs';
import { genScript } from './wrong-solid-sweep-lib.mjs';
import { genS4 } from './wrong-solid-sweep-s4.mjs';
import { genSketch } from './sketch-audit-lib.mjs';

const { sections } = await import('@shuff57/reshape-script/reshape-docs');
const HERE = fileURLToPath(new URL('.', import.meta.url));
const N = Number(process.env.SAVE_N ?? 40);

const corpora = {};
corpora.docs = sections.flatMap((s) => (s.pages ?? []).filter((p) => p.code).map((p) => [`${s.slug}/${p.title}`, p.code]));
const FIX = path.join(HERE, 'fixtures/student');
corpora.lessons = readdirSync(FIX).filter((f) => f.endsWith('.js')).sort().map((f) => [f, readFileSync(path.join(FIX, f), 'utf8')]);
const SWEEP_FAMILIES = ['matrix', 'perm', 'holes', 'csg', 'grid', 'ringpair', 'census', 'random', 'pair', 'hole'];
corpora.sweep = SWEEP_FAMILIES.flatMap((fam) => Array.from({ length: N }, (_, i) => [`${fam}#${i}`, genScript(fam, i, 7).code]));
corpora.s4 = Array.from({ length: N * 4 }, (_, i) => [`s4#${i}`, genS4(i, 3).code]);
const SKETCH_FAMILIES = ['rect', 'poly', 'circle', 'slot', 'arc', 'pullarc', 'revolve', 'revarc'];
corpora.sketch = SKETCH_FAMILIES.flatMap((fam) => Array.from({ length: N }, (_, i) => [`${fam}#${i}`, genSketch(fam, i, 11).code]));

const summary = {};
for (const [name, corpus] of Object.entries(corpora)) {
  test(`save round trip: ${name} (${corpus.length} scripts): same doc, same kernel measure`, { timeout: 3600 * 1000 }, () => {
    let ran = 0, skipped = 0, built = 0;
    const failed = [];
    for (const [key, code] of corpus) {
      const r = roundTrip(code);
      if (r.skipped) { skipped++; continue; } // the script itself stops with a sentence: nothing was ever saved
      ran++;
      if (r.m1 && Object.keys(r.m1.refusals).length === 0 && Object.keys(r.m1.shapes).length) built++;
      if (r.bad.length) failed.push(`${name} ${key}\n    ${r.bad.join('\n    ')}\n${code}`);
    }
    summary[name] = { total: corpus.length, ran, skipped, built };
    console.log(`save round trip ${name}:`, JSON.stringify(summary[name]));
    assert.deepEqual(failed, [], `${failed.length} of ${ran} changed on a save:\n${failed.slice(0, 3).join('\n')}`);
    assert.ok(ran > corpus.length * 0.7, `${name}: only ${ran} of ${corpus.length} scripts run at all, the corpus is wrong`);
    assert.ok(built > ran * 0.3, `${name}: only ${built} of ${ran} build on the kernel, the volume check is hollow`);
  });
}

// ---- doc first: what the studio saves is a doc, not a script ---------------------------------------------------------------
const H = 7;
const rectGeoms = [
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
];
const rectRules = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 },
];
const sk = (extra) => ({ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, ...extra });
const pull = { id: 'pull1', kind: 'extrude', target: 'sk1', height: H };
const DOCS = {
  // stored 0-based: rounds {0: ..} is the FIRST corner, chamfers {3: ..} the fourth
  'stored 0-based rounds and chamfer': [sk({ points: [[-15, -10], [15, -10], [15, 10], [-15, 10]], rounds: { 0: 3, 2: 2 }, chamfers: { 3: 1.5 } }), pull],
  'stored rect sketch with rules and a pin': [sk({ points: [[-15, -10], [15, -10], [15, 10], [-15, 10]], constraints: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 1, value: 20 }] }), pull],
  'stored soup rect': [sk({ points: [], geoms: rectGeoms, rules: rectRules }), pull],
  'stored soup with long coordinates': [sk({ points: [], geoms: rectGeoms.map((g) => ({ ...g, a: g.a.map((v) => v + 1 / 3), b: g.b.map((v) => v + 2 / 3) })), rules: rectRules.slice(0, 4) }), pull],
  'stored circle sketch': [sk({ points: [[-8, 0], [8, 0]], shape: 'circle' }), pull],
  // (a polygon sketch with `bulges` is NOT here: nothing in the studio or the language writes one any more -- arcs are soup rows --
  //  and toScript cannot say a bulge in polygon words; see the PLAN section "W4 save round trip", latent items.)
  'stored turned ring': [{ id: 'ring1', kind: 'torus', ringRadius: 15, tubeRadius: 4, center: [0, 0, 0], rotate: [90, 0, 30] }],
  'stored box, hole, hollow': [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    { id: 'hole1', kind: 'hole', target: 'box1', diameter: 8, depth: 22, axis: 'z', center: [5, 5, 0] },
  ],
};
for (const [name, features] of Object.entries(DOCS)) {
  test(`doc first: ${name} -> toScript -> runScript is the same doc, same kernel measure; JSON too`, () => {
    const doc = { version: 1, features };
    const before = measure(doc);
    const text = toScript(doc);
    const back = runScript(text);
    assert.deepEqual(back.errors, [], `${text}`);
    // a soup sketch is stored by its rows; runScript also fills in the legacy polygon fields (points, rect rules) beside them
    const core = (f) => (f.geoms ? { id: f.id, kind: f.kind, plane: f.plane, offset: f.offset, geoms: f.geoms, rules: f.rules } : f);
    assert.equal(firstDiff(doc.features.map(core), back.doc.features.map(core), '$', QUANT), null, text);
    assert.equal(firstDiff(before, measure(back.doc), '$', QUANT), null, `kernel measure changed on a save:\n${text}`);
    const viaJson = JSON.parse(JSON.stringify(doc));
    assert.equal(firstDiff(before, measure(viaJson)), null, 'JSON round trip changed the kernel measure');
    assert.equal(toScript(viaJson), text);
  });
}
