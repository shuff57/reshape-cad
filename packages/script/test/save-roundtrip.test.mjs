// W4 save round trip, script layer (docs/PLAN-next.md "W4 save round trip"). What a student saves is the script text the
// studio regenerates with toScript(doc) (ReshapeStudio.tsx, the debounced onChange); what they reopen is runScript(text).
// So "my work saves" means: runScript(toScript(doc)) gives back the SAME doc. Checked here, with no kernel, over
//   1. every code block in reshape-docs.ts and every lesson fixture in kernel/test/fixtures/student,
//   2. a hand-written corpus that covers each sketch word, rule word, soup row and primitive the language has,
//   3. edits a student makes in the studio (a dimension, a delete, a reorder, a rename), then the same trip,
//   4. the doc as JSON (stringify/parse),
//   5. the 1-based corner numbers: a stored doc is 0-based, the emitter writes +1, and an old script that says
//      .round(0, r) stops with a sentence instead of building a different part.
// The emitter writes dimensions to 1e-6 and sketch-row coordinates to 1e-9, so the first trip may move a number that
// far (QUANT); a SECOND trip must move nothing. The kernel half (volumes before == after, thousands of generated
// scripts) is packages/kernel/test/save-roundtrip.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';
import { sections } from '../dist/reshape-docs.js';
import { applyParam, generatedParams, solveDoc } from '../dist/model-codegen.js';
import { withoutFeatures, firstOrderViolation } from '../dist/model-deps.js';

const QUANT = 1e-6;
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** First difference between two JSON-like values, or null. A rotate of [0,0,0] is the same as none (the type says so). */
function firstDiff(a, b, at = '$', tol = 0) {
  if (a === b) return null;
  if (tol && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (a[k] === undefined && b[k] === undefined) continue;
    if (k === 'rotate' && [a[k], b[k]].every((r) => r === undefined || (Array.isArray(r) && r.every((n) => n === 0)))) continue;
    const d = firstDiff(a[k], b[k], `${at}.${k}`, tol);
    if (d) return d;
  }
  return null;
}

/** script -> doc -> script -> doc -> script -> doc; the problems found, [] when the trip holds. */
export function tripProblems(code) {
  const a = runScript(code);
  if (a.errors?.length) return [`first run: ${a.errors[0].message}`];
  const text = toScript(a.doc, a.namedParams);
  const b = runScript(text);
  if (b.errors?.length) return [`emitted script does not run: ${b.errors[0].message}\n${text}`];
  const bad = [];
  const d = firstDiff(a.doc, b.doc, '$', QUANT);
  if (d) bad.push(`doc differs after toScript -> runScript: ${d}`);
  if (JSON.stringify(a.params.map((p) => p.name)) !== JSON.stringify(b.params.map((p) => p.name))) bad.push('the Dimensions panel rows changed');
  if (JSON.stringify(a.namedParams.map((p) => p.name)) !== JSON.stringify(b.namedParams.map((p) => p.name))) bad.push('param() declarations changed');
  const text2 = toScript(b.doc, b.namedParams);
  if (text2 !== text) bad.push('toScript is not a fixpoint');
  const c = runScript(text2);
  const dc = c.errors?.length ? 'second trip errors' : firstDiff(b.doc, c.doc);
  if (dc) bad.push(`a second trip moved the doc: ${dc}`);
  const j = JSON.parse(JSON.stringify(a.doc));
  const dj = firstDiff(a.doc, j);
  if (dj) bad.push(`doc JSON round trip differs: ${dj}`);
  if (toScript(j, a.namedParams) !== text) bad.push('toScript(parsed JSON) differs from toScript(doc)');
  return bad;
}

// ---- corpus 1: docs + lesson fixtures ------------------------------------------------------------------------------
const docs = [];
for (const s of sections) for (const p of s.pages ?? []) if (p.code) docs.push([`docs ${s.slug}/${p.title}`, p.code]);
const FIX = path.resolve(HERE, '../../kernel/test/fixtures/student');
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.js')).sort().map((f) => [`lesson ${f}`, readFileSync(path.join(FIX, f), 'utf8')]);

// ---- corpus 2: hand-written ----------------------------------------------------------------------------------------
const SK = "const s = sketch('top')\n";
export const HAND = {
  'rect + rounds + chamfer': `${SK}s.rect(30, 20)\ns.round(1, 3)\ns.round(3, 2)\ns.chamfer(4, 2)\npull(s, 8)`,
  'rect at': `${SK}s.rect(30, 20, { at: [5, -7] })\npull(s, 3)`,
  'rect, every rule word': `${SK}s.rect(40, 30)\ns.across(1)\ns.up(2)\ns.length(1, 40)\ns.equal(1, 3)\ns.parallel(2, 4)\ns.perpendicular(1, 2)\ns.pin(1)\npull(s, 6)`,
  'polygon + point rules': `${SK}s.polygon([[0, 0], [40, 0], [30, 25], [0, 20]])\ns.pin(1)\ns.distX(1, 2, 40)\ns.distY(1, 4, 20)\ns.angle(1, 2, 90)\npull(s, 5)`,
  'polygon, rounded and chamfered': `${SK}s.polygon([[0, 0], [50, 0], [50, 30], [25, 45], [0, 30]])\ns.round(2, 4)\ns.round(5, 3)\ns.chamfer(3, 2)\npull(s, 7)`,
  'circle': `${SK}s.circle(24)\npull(s, 9)`,
  'circle at': `${SK}s.circle(24, { at: [10, 10] })\nextrude(s, 9)`,
  'front plane, offset': "const s = sketch('front', 5)\ns.rect(20, 10)\npull(s, 4)",
  'right plane': "const s = sketch('side', -3)\ns.rect(20, 10)\npull(s, 4)",
  'top plane offset': "const s = sketch('top', 10)\ns.rect(20, 10)\npull(s, 4)",
  'datum plane': "const p = plane('top', 5)\nconst s = sketch(p)\ns.rect(20, 10)\npull(s, 4)",
  'datum plane, literal frame': "const p = plane({ origin: [0, 0, 5], u: [1, 0, 0], v: [0, 1, 0] })\nconst s = sketch(p)\ns.circle(12)\npull(s, 4)",
  'revolve a profile': "const s = sketch('front', 0)\ns.rect(10, 20, { at: [20, 10] })\nrevolve(s, 360)",
  'revolve partial turn': "const s = sketch('front', 0)\ns.rect(10, 20, { at: [20, 10] })\nrevolve(s, 180)",
  'revolve with a round': "const s = sketch('front', 0)\ns.rect(10, 20, { at: [20, 10] })\ns.round(1, 2)\nrevolve(s, 360)",
  'param-driven sketch': "const w = param('w', 30)\nconst h = param('h', 20, { min: 5, max: 60 })\nconst s = sketch('top')\ns.rect(w, h)\ns.round(2, 3)\npull(s, 5)",
  'param in a rule': "const len = param('len', 25)\nconst s = sketch('top')\ns.rect(40, 30)\ns.length(1, len)\npull(s, 4)",
  'param in a round': "const r = param('r', 3)\nconst s = sketch('top')\ns.rect(40, 30)\ns.round(1, r)\ns.round(3, r)\npull(s, 4)",
  'param in distX, distY, angle': "const dx = param('dx', 36)\nconst dy = param('dy', 18)\nconst a = param('a', 80)\nconst s = sketch('top')\ns.polygon([[0, 0], [40, 0], [30, 25], [0, 20]])\ns.distX(1, 2, dx)\ns.distY(1, 4, dy)\ns.angle(1, 2, a)\npull(s, 5)",
  'param circle and pull': "const c = param('c', 12)\nconst e = param('e', 5)\nconst s = sketch('top')\ns.circle(c, { at: [3, 4] })\npull(s, e)",
  'param in a pocket and a revolve': "const d = param('d', 4)\nconst b = box(40, 40, 20)\nconst s = sketch('top', 10)\ns.rect(10, 10)\npocket(s, b, d)",
  'soup: lines, closed': `${SK}s.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }, { k:'line', id:2, a:[40,0], b:[40,25] }, { k:'line', id:3, a:[40,25], b:[0,25] }, { k:'line', id:4, a:[0,25], b:[0,0] }])\ns.rules([{ k:'coincident', a:1, aEnd:'b', b:2, bEnd:'a' }, { k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' }, { k:'coincident', a:3, aEnd:'b', b:4, bEnd:'a' }, { k:'coincident', a:4, aEnd:'b', b:1, bEnd:'a' }, { k:'horizontal', a:1 }, { k:'vertical', a:2 }, { k:'distanceX', a:1, aEnd:'a', b:1, bEnd:'b', value:40 }])\npull(s, 6)`,
  'soup: slot sugar': `${SK}s.slot([0, 0], [40, 0], 10)\npull(s, 6)`,
  'soup: slot, off-axis': `${SK}s.slot([-20, 5], [20, 25], 6)\npull(s, 6)`,
  'soup: circle with radius rule': `${SK}s.geom([{ k:'circle', id:1, c:[0,0], r:12 }])\ns.rules([{ k:'radius', a:1, value:12 }])\npull(s, 5)`,
  'soup: param radius': "const r = param('holeR', 7)\nconst s = sketch('top')\ns.geom([{ k:'circle', id:1, c:[0,0], r:r }])\ns.rules([{ k:'radius', a:1, value:r }])\npull(s, 5)",
  'soup: arc + line segment': `${SK}s.geom([{ k:'arc', id:1, c:[0,0], r:20, a:[20,0], b:[0,20], sense:'ccw' }, { k:'line', id:2, a:[0,20], b:[20,0] }])\ns.rules([{ k:'coincident', a:1, aEnd:'b', b:2, bEnd:'a' }, { k:'coincident', a:2, aEnd:'b', b:1, bEnd:'a' }])\npull(s, 5)`,
  'soup: washer, rect minus circle, construction line': `${SK}s.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }, { k:'line', id:2, a:[40,0], b:[40,25] }, { k:'line', id:3, a:[40,25], b:[0,25] }, { k:'line', id:4, a:[0,25], b:[0,0] }, { k:'circle', id:5, c:[20,12.5], r:5 }, { k:'line', id:6, a:[0,0], b:[40,25], construction: true }])\ns.rules([{ k:'coincident', a:1, aEnd:'b', b:2, bEnd:'a' }, { k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' }, { k:'coincident', a:3, aEnd:'b', b:4, bEnd:'a' }, { k:'coincident', a:4, aEnd:'b', b:1, bEnd:'a' }, { k:'tangent', a:1, b:5, mode:'inside' }])\npull(s, 3)`,
  'soup: every rule kind': "const s = sketch('top')\ns.geom([{ k:'point', id:1, p:[0,0] }, { k:'line', id:2, a:[0,0], b:[40,0] }, { k:'line', id:3, a:[40,0], b:[40,30] }, { k:'circle', id:4, c:[20,20], r:5 }, { k:'arc', id:5, c:[0,0], r:10, a:[10,0], b:[0,10], sense:'ccw' }])\ns.rules([{ k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' }, { k:'pointOnObject', a:2, aEnd:'a', b:4 }, { k:'horizontal', a:2 }, { k:'vertical', a:3 }, { k:'parallel', a:2, b:3 }, { k:'perpendicular', a:2, b:3 }, { k:'tangent', a:2, b:4 }, { k:'tangent', a:2, aEnd:'b', b:5, bEnd:'a' }, { k:'equal', a:2, b:3 }, { k:'equal', a:4, b:5 }, { k:'symmetric', a:2, aEnd:'a', b:2, bEnd:'b', c:1 }, { k:'distance', a:2, aEnd:'a', b:3, bEnd:'a', value:10 }, { k:'distanceX', a:2, aEnd:'a', b:3, bEnd:'a', value:12 }, { k:'distanceY', a:2, aEnd:'a', b:3, bEnd:'b', value:8 }, { k:'radius', a:4, value:5 }, { k:'diameter', a:4, value:10 }, { k:'angle', a:2, b:3, value:90, quadrant:1 }, { k:'lock', a:2, aEnd:'a' }])",
  'turned ring': 'const r = ring(40, 8)\nturn(r, [90, 0, 0])',
  'turned box, cylinder, cone': 'const a = box(20, 10, 5)\nturn(a, [0, 0, 30])\nconst b = cylinder(10, 30, { at: [40, 0, 0] })\nturn(b, [90, 0, 0])\nconst c = cone(10, 20, { at: [-40, 0, 0] })\nturn(c, [0, 45, 0])',
  'moved primitives': 'const a = box(20, 10, 5, { at: [3, 4, 5] })\nconst b = sphere(12, { at: [30, 0, 0] })\nconst c = prism(5, 20, 10, { at: [0, 30, 0] })',
  'param box': "const w = param('w', 40)\nconst b = box(w, 40, 20)\nhole(b, { across: 8 })",
  'hole + round + hollow': 'const b = box(40, 40, 20)\nround(b.edge("top", "front"), 3)\nhollow(b, { wall: 2, open: "top" })',
  'cut then join': 'let a = box(40, 40, 20)\nconst b = cylinder(20, 30)\na = cut(a, b)\nconst c = box(10, 10, 10, { at: [30, 0, 0] })\na = join(a, c)',
  'mirror and repeat': 'const b = box(10, 10, 10, { at: [20, 0, 0] })\nrepeat(b, { count: 3, step: [0, 15, 0] })\nmirror(b, "left-right")',
  'repeat around': 'const b = box(10, 10, 10, { at: [30, 0, 0] })\nrepeatAround(b, { count: 4 })',
};
const hand = Object.entries(HAND).map(([k, code]) => [`hand ${k}`, code]);

function sweepCorpus(corpus) {
  const failed = [];
  for (const [key, code] of corpus) {
    const bad = tripProblems(code);
    if (bad.length) failed.push(`${key}\n    ${bad.join('\n    ')}\n${code}`);
  }
  return failed;
}

test('corpus sizes: the docs, the lesson fixtures and the hand corpus are all really there', () => {
  assert.ok(docs.length >= 40, `docs examples: ${docs.length}`);
  assert.ok(fixtures.length >= 18, `lesson fixtures: ${fixtures.length}`);
  assert.ok(hand.length >= 30, `hand corpus: ${hand.length}`);
});

test('every docs example survives script -> doc -> script -> doc', () => {
  const failed = sweepCorpus(docs);
  assert.deepEqual(failed, [], `${failed.length} of ${docs.length} docs examples changed on a save:\n${failed.slice(0, 3).join('\n')}`);
});

test('every lesson fixture (script and solution) survives the trip', () => {
  const failed = sweepCorpus(fixtures);
  assert.deepEqual(failed, [], `${failed.length} of ${fixtures.length}:\n${failed.slice(0, 3).join('\n')}`);
});

test('every hand-written script survives the trip, and builds a doc in the first place', () => {
  for (const [key, code] of hand) {
    const r = runScript(code);
    assert.deepEqual(r.errors, [], `${key} must run: ${JSON.stringify(r.errors)}`);
    assert.ok(r.doc.features.length > 0, key);
  }
  const failed = sweepCorpus(hand);
  assert.deepEqual(failed, [], `${failed.length} of ${hand.length}:\n${failed.slice(0, 3).join('\n')}`);
});

test('a turned ring is still turned after a save (the emitter used to drop turn() for rings)', () => {
  for (const [code, kind, rot] of [
    ['const r = ring(40, 8)\nturn(r, [90, 10, 20])', 'torus', [90, 10, 20]],
    ['const r = ring(40, 8, { at: [5, 6, 7] })\nturn(r, [0, 0, 15])', 'torus', [0, 0, 15]],
  ]) {
    const first = runScript(code);
    assert.deepEqual(first.doc.features[0].rotate, rot, `${kind}: the script itself turns it`);
    const text = toScript(first.doc, first.namedParams);
    assert.match(text, /turn\(/, `${kind}: the saved text still says turn()`);
    assert.deepEqual(runScript(text).doc.features[0].rotate, rot, `${kind}: ...and reopening gives the same turn`);
  }
});

// ---- 2: edits ------------------------------------------------------------------------------------------------------
const reopen = (doc, named) => {
  const r = runScript(toScript(doc, named));
  assert.deepEqual(r.errors, []);
  return r;
};

test('editing a dimension in the Dimensions panel, then saving, reopens at the edited value', () => {
  const r = runScript("const s = sketch('top')\ns.rect(40, 30)\ns.round(2, 3)\npull(s, 6)\nconst b = box(20, 20, 10, { at: [60, 0, 0] })");
  const slots = generatedParams(r.doc).map((p) => p.name);
  assert.ok(slots.length >= 4, slots.join());
  const pullSlot = slots.find((n) => /^(pull|extrude|e)\w*_height$/.test(n)) ?? slots.find((n) => n.endsWith('_height') && !n.startsWith('box'));
  const boxW = slots.find((n) => n.startsWith('box') && n.endsWith('_width'));
  let doc = r.doc;
  doc = applyParam(doc, boxW, 33.25);
  if (pullSlot) doc = applyParam(doc, pullSlot, 9.5);
  const back = reopen(doc, r.namedParams);
  assert.equal(back.doc.features.find((f) => f.kind === 'box').size[0], 33.25);
  if (pullSlot) assert.equal(firstDiff(back.doc, doc, '$', QUANT), null);
  assert.equal(firstDiff(back.doc, doc, '$', QUANT), null);
});

test('editing a soup dimension (a rule value) and re-solving, then saving, reopens at the edited value and the solved rows', () => {
  const r = runScript("const s = sketch('top')\ns.geom([{ k:'line', id:1, a:[0,0], b:[40,0] }, { k:'line', id:2, a:[40,0], b:[40,25] }, { k:'line', id:3, a:[40,25], b:[0,25] }, { k:'line', id:4, a:[0,25], b:[0,0] }])\ns.rules([{ k:'coincident', a:1, aEnd:'b', b:2, bEnd:'a' }, { k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' }, { k:'coincident', a:3, aEnd:'b', b:4, bEnd:'a' }, { k:'coincident', a:4, aEnd:'b', b:1, bEnd:'a' }, { k:'horizontal', a:1 }, { k:'vertical', a:2 }, { k:'horizontal', a:3 }, { k:'vertical', a:4 }, { k:'distanceX', a:1, aEnd:'a', b:1, bEnd:'b', value:40 }])\npull(s, 6)");
  assert.deepEqual(r.errors, []);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  const edited = { ...r.doc, features: r.doc.features.map((f) => (f === sk ? { ...f, rules: f.rules.map((q) => (q.k === 'distanceX' ? { ...q, value: 55.5 } : q)) } : f)) };
  // The session solver (wasm) moves the rows; here the moved rows are written by hand, to the third decimal digits the solver leaves.
  const moved = { ...edited, features: edited.features.map((f) => (f.kind !== 'sketch' ? f : { ...f, geoms: f.geoms.map((g) => ({ ...g, a: g.a.map((v, i) => (i === 0 && v === 40 ? 55.5 : v + 1e-11)), b: g.b.map((v, i) => (i === 0 && v === 40 ? 55.5 : v - 1e-12)) })), geom: undefined })) };
  const solved = moved;
  const back = reopen(solved, r.namedParams);
  assert.equal(firstDiff({ ...back.doc, features: back.doc.features.map((f) => ({ ...f, geom: undefined })) }, solved, '$', QUANT), null);
  assert.equal(back.doc.features.find((f) => f.kind === 'sketch').rules.find((q) => q.k === 'distanceX').value, 55.5);
});

test('deleting a feature (and what leans on it), then saving, reopens without it and with the rest unchanged', () => {
  const r = runScript('const a = box(40, 40, 20)\nhole(a, { across: 8 })\nconst b = cylinder(10, 30, { at: [60, 0, 0] })\nround(b, 2)');
  const gone = withoutFeatures(r.doc, ['box1']);
  assert.ok(gone.features.length < r.doc.features.length);
  const back = reopen(gone);
  assert.equal(firstDiff(back.doc, gone, '$', QUANT), null);
  assert.ok(!back.doc.features.some((f) => f.id === 'box1' || f.kind === 'hole'));
  assert.ok(back.doc.features.some((f) => f.kind === 'cylinder'));
});

test('reordering two independent features, then saving, reopens in the new order', () => {
  const r = runScript('const a = box(40, 40, 20)\nconst b = cylinder(10, 30, { at: [60, 0, 0] })\nconst c = sphere(12, { at: [-60, 0, 0] })');
  const swapped = { ...r.doc, features: [r.doc.features[2], r.doc.features[0], r.doc.features[1]] };
  assert.equal(firstOrderViolation(swapped.features), null);
  const back = reopen(swapped);
  assert.deepEqual(back.doc.features.map((f) => f.kind), ['sphere', 'box', 'cylinder']);
  assert.equal(firstDiff(back.doc.features.map((f) => ({ ...f, id: '' })), swapped.features.map((f) => ({ ...f, id: '' })), '$', QUANT), null);
});

test('a feature name saved in the doc JSON survives stringify/parse', () => {
  const r = runScript('const a = box(40, 40, 20)');
  const named = { ...r.doc, features: r.doc.features.map((f) => ({ ...f, name: 'Base plate' })) };
  assert.equal(JSON.parse(JSON.stringify(named)).features[0].name, 'Base plate');
});

// ---- 4: the 1-based corner change ----------------------------------------------------------------------------------
test('a doc stored 0-based (rounds {0: r}) is emitted 1-based and reopens to the same corner', () => {
  const stored = {
    version: 1,
    features: [
      { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [30, 0], [30, 20], [0, 20]], rounds: { 0: 3, 2: 2 }, chamfers: { 3: 1.5 } },
      { id: 'e1', kind: 'extrude', target: 'sk1', height: 5 },
    ],
  };
  const text = toScript(stored);
  assert.match(text, /\.round\(1, 3\)/);
  assert.match(text, /\.round\(3, 2\)/);
  assert.match(text, /\.chamfer\(4, 1\.5\)/);
  const back = runScript(text);
  assert.deepEqual(back.errors, []);
  const sk = back.doc.features.find((f) => f.kind === 'sketch');
  assert.deepEqual(sk.rounds, { 0: 3, 2: 2 });
  assert.deepEqual(sk.chamfers, { 3: 1.5 });
});

test('a constraint stored on corner 0 (pin) is emitted as corner 1 and comes back as corner 0', () => {
  const stored = {
    version: 1,
    features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [30, 0], [30, 20], [0, 20]], constraints: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 1, value: 20 }] }],
  };
  const text = toScript(stored);
  assert.match(text, /\.pin\(1\)/);
  assert.match(text, /\.across\(1\)/);
  assert.match(text, /\.length\(2, 20\)/);
  const sk = runScript(text).doc.features[0];
  assert.deepEqual(sk.constraints.map((c) => c.corner ?? c.edge), [0, 0, 1]);
});

test('an old script that says .round(0, r) or .chamfer(0, d) stops with a sentence, and builds nothing', () => {
  for (const call of ['round(0, 3)', 'chamfer(0, 2)']) {
    const r = runScript(`const s = sketch('top')\ns.rect(30, 20)\ns.${call}\npull(s, 5)`);
    assert.equal(r.errors.length, 1, call);
    assert.match(r.errors[0].message, /whole number from 1 to 4 \(corner 1 is the first corner\)/, call);
    assert.equal(r.doc.features.some((f) => f.kind === 'extrude'), false, 'nothing after the bad line is built');
  }
});

test('the old 0-based numbering at its LAST corner (.round(3, r) on a rectangle) now means corner 3, not corner 4: it builds, and it is the third corner', () => {
  // The silent-change hazard: an old script's .round(3, r) used to round the fourth corner. It still runs, now on the third.
  const sk = runScript("const s = sketch('top')\ns.rect(30, 20)\ns.round(3, 4)").doc.features[0];
  assert.deepEqual(sk.rounds, { 2: 4 });
});

test('no stored script in the repo still uses a 0 corner (.round(0, ...) / .chamfer(0, ...))', () => {
  const root = path.resolve(HERE, '../../..');
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'pkg', 'target', '.claude', '.codegraph', '.omo', '.msgbox'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|ts|tsx|md|json|html)$/.test(e.name) && !p.endsWith('save-roundtrip.test.mjs') && !p.endsWith('PLAN-next.md') && !p.endsWith('sketch-corner-numbers.test.mjs')) {
        const text = readFileSync(p, 'utf8');
        text.split('\n').forEach((line, i) => { if (/\.(round|chamfer)\(\s*0\s*,/.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 120)}`); });
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, [], 'a stored script with a 0 corner now stops with a sentence');
});
