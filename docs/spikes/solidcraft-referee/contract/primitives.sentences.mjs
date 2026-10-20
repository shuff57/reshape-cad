// SPIKE, referee only (round 5). Every refusal sentence quoted in primitives.json comes from HERE: one real input per sentence, run through the cited producer
// (the interpreter, primitives.call-lint.mjs, primitives.guard.mjs, or budgetSentence), and the builder takes the sentence from the output, so a quoted sentence
// can not drift from what the code says. `bun contract/primitives.sentences.mjs` prints each one and exits 1 if a sentence is not ONE plain sentence.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as G from './primitives.guard.mjs';
import * as L from './primitives.call-lint.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { runScript } = await import(pathToFileURL(path.join(HERE, '..', '..', '..', '..', 'packages/script/dist/reshape-script.js')).href);
const runSides = (s) => { const r = runScript(s); return r.errors.length ? null : r.doc.features.filter((f) => f.kind === 'prism').map((f) => f.sides); };
const D = (f) => ({ version: 1, features: [{ id: 'f1', center: [0, 0, 0], ...f }] });

/** key -> { by: 'guard'|'lint'|'interpreter'|'budget', script|doc|call+seconds } */
export const INPUTS = {
  boxCornerBig: { by: 'guard', script: 'box(12, 20, 30, { corner: 6 });' },
  boxCornerSmall: { by: 'guard', script: 'box(40, 30, 20, { corner: 0.00001 });' },
  boxChamfer: { by: 'guard', doc: D({ kind: 'box', size: [10, 10, 10], round: 1, roundStyle: 'chamfer' }) },
  cylLeftover: { by: 'guard', script: 'cylinder(4, 20, { corner: 1.98 });' },
  cylCornerHeight: { by: 'guard', script: 'cylinder(48, 10, { corner: 5 });' },
  cylCornerSmall: { by: 'guard', script: 'cylinder(24, 30, { corner: 0.000001 });' },
  boxRoundThin: { by: 'guard', script: 'box(1000, 700, 4, { corner: 1 });' },
  cylRoundFlat: { by: 'guard', script: 'cylinder(1000, 4, { corner: 1 });' },
  sphereCorner: { by: 'lint', script: 'sphere(10, { corner: 1 });' },
  coneTurnedMovedFlat: { by: 'guard', script: 'const c = cone(20, 4, { at: [5, 0, 0] }); turn(c, [0, 0, 30]);' },
  coneTurnedSlender: { by: 'guard', script: 'const c = cone(20, 400); turn(c, [0, 30, 0]);' },
  coneFlat: { by: 'guard', script: 'cone(1000, 0.2);' },
  coneSecondRadius: { by: 'lint', script: 'cone(20, 30, 10);' },
  ringThick: { by: 'guard', script: 'ring(10, 12);' },
  ringThin: { by: 'guard', script: 'ring(100, 1);' },
  prismSidesScript: { by: 'interpreter', script: 'prism(2, 30, 12);' },
  prismSidesFraction: { by: 'lint', script: 'prism(2.6, 30, 12);' },
  prismSidesDoc: { by: 'guard', doc: D({ kind: 'prism', sides: 2.6, radius: 15, height: 12 }) },
  sizeNegative: { by: 'interpreter', script: 'box(-10, 20, 30);' },
  unknownOptionBox: { by: 'lint', script: 'box(10, 20, 30, { colour: 5 });' },
  surplus: { by: 'lint', script: 'box(1, 2, 3, { at: [0, 0, 0] }, 99);' },
  sliderCyl: { by: 'guard', doc: D({ kind: 'cylinder', radius: 1, height: 30, round: 3 }) },
  farPlanarSmall: { by: 'guard', doc: D({ kind: 'wedge', width: 0.01, depth: 0.01, height: 0.01, center: [1e6, -1e6, 1e6] }) },
  farCurved: { by: 'guard', doc: D({ kind: 'sphere', radius: 1, center: [10000, 0, 0] }) },
  farBigCurved: { by: 'guard', doc: D({ kind: 'sphere', radius: 20000, center: [50000, 0, 0] }) },
  farAbsolute: { by: 'guard', doc: D({ kind: 'box', size: [10, 10, 10], center: [1e7, 0, 0] }) },
  bigCurved: { by: 'guard', doc: D({ kind: 'sphere', radius: 35000 }) },
  bigPlanar: { by: 'guard', doc: D({ kind: 'box', size: [1e7, 10, 10] }) },
  smallCurved: { by: 'guard', doc: D({ kind: 'sphere', radius: 0.25 }) },
  cylSlender: { by: 'guard', script: 'cylinder(2, 100);' },
  planarThin: { by: 'guard', script: 'box(100000, 1, 1);' },
  budget20: { by: 'budget', call: 'ring(40, 10)', seconds: 20 },
  budget2: { by: 'budget', call: 'ring(40, 10)', seconds: 2 },
};

export function produce(key) {
  const i = INPUTS[key]; if (!i) throw new Error('no input for ' + key);
  if (i.by === 'budget') return G.budgetSentence(i.call, i.seconds);
  let doc = i.doc;
  if (i.script !== undefined) {
    if (i.by === 'lint') { const l = L.lintScript(i.script, runSides); return l[0]?.sentence ?? null; }
    const r = runScript(i.script);
    if (i.by === 'interpreter') return r.errors[0]?.message ?? null;
    if (r.errors.length) throw new Error(key + ': script does not run: ' + r.errors[0].message);
    // a lint hit comes first in the product; for guard keys it must be silent
    doc = r.doc;
  }
  return G.guardFirst(doc)?.sentence ?? null;
}
export const S = (key) => { const s = produce(key); if (!s) throw new Error('sentence missing for ' + key); return s; };

/** one sentence, plain: the guard lint, plus the interpreter and budget ones */
export function problems(s) {
  const bad = [];
  if (/solid\.|solidcraft|truck|brep|occt|kernel|invalid input|major|minor|torus|fillet|body|feature|mesh|tessell|wasm|\bF\d+:/i.test(s)) bad.push('engine-word');
  if (!/[.]$/.test(s) || /[.] [A-Z]/.test(s)) bad.push('not-one-sentence');
  if (s.length > 330) bad.push('too-long');
  return bad;
}
if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
  let fail = 0;
  for (const k of Object.keys(INPUTS)) {
    const s = produce(k); const p = s ? problems(s) : ['no sentence'];
    if (p.length) fail++;
    console.log(`${p.length ? 'FAIL' : 'ok  '} ${k.padEnd(20)} [${INPUTS[k].by}] ${s ?? '(none)'} ${p.join(',')}`);
  }
  // the budget template in the browser harness is the same text
  const html = readFileSync(path.join(HERE, 'primitives-r4/browser/bench.html'), 'utf8');
  const m = /window\.sentenceFor = \(call, seconds\) => `([^`]*)`/.exec(html);
  const same = m && m[1].replace('${call}', 'ring(40, 10)').replace('${seconds}', '2') === G.budgetSentence('ring(40, 10)', 2);
  console.log(`${same ? 'ok  ' : 'FAIL'} bench.html sentenceFor template equals budgetSentence`); if (!same) fail++;
  process.exit(fail ? 1 : 0);
}
