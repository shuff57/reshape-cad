// SD-5 (docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md, GUARD-SD5-DOF1.md): the from-bottom draft guard (G-FROM) on the HOST ROUTE reads how each draft
// gave its neutral from the DOC the sandboxed interpreter returned (DraftFeature.neutralFrom), not from the script text. The textual reader (draftFromUsage)
// counted every `draft(` in comments and strings and paired by position, so a comment line, a string, or a loop let a stale from-bottom draft build.
// No kernel: the host's own translateDoc (host-entry.mjs: unified set, joins at 'full') on the layer's fake engine with its shell-draft model and fake pick source.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const H = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { toScript } = await imp('packages/script/dist/reshape-script-gen.js');
const { solveDoc } = await imp('packages/script/dist/model-codegen.js');
const { makeFake } = await imp('packages/layer/test/fake-engine.mjs');
// the fake has no topology reply, so the pick comes from the layer tests' fake resolver (G-FROM runs before the pick either way)
const { fakeResolveAt } = await imp('packages/layer/test/fake-resolve-at.mjs');
const { install, withPreamble } = await imp('packages/solidcraft-host/pane/lib/friendly-sketch.mjs');
install(globalThis);

/** what the sandbox runner does (runner-entry.mjs), then solveDoc as pane.js run() does */
const sandbox = (src) => { const r = runScript(withPreamble(src)); assert.deepStrictEqual(r.errors, [], src); return solveDoc(r.doc); };
const host = async (doc, fromUsage) => {
  const fake = makeFake({ shellDraft: true });
  const tr = await H.translateDoc(structuredClone(doc), { arc: H.arc, mt: H.mt, runSC: fake.runSC, soups: {}, followMoves: true, resolveAt: fakeResolveAt, ...(fromUsage ? { fromUsage } : {}) });
  return tr.features.filter((f) => f.kind === 'draft');
};
const STALE = "const b = box(40, 40, 20); const m = move(b, [0, 0, 30]); draft(m.face('right'), 5, { from: 'bottom' });";
const FROM_STALE = (id) => `${id} (draft): from:'bottom' would put the neutral plane at -10, but the bottom of this part is at 20 now (the part was moved, joined or turned), so ${id} is shown without it -- give the plane yourself, for example neutral: 20.`;

const VARIANTS = {
  plain: STALE,
  'a commented draft( line before it (the audit\'s live case)': `// draft(x, 1, { neutral: 0 })\n${STALE}`,
  'a block comment': `/* draft(b, 2, { neutral: 3 }) */ ${STALE}`,
  'a string holding draft(': `const note = "draft(b, 1, { neutral: 0 })"; ${STALE}`,
  'a template string': 'const t = `draft(${1})`; ' + STALE,
};

test('SD-5: the interpreter records neutralFrom on a draft only when it gave from: and no neutral:', () => {
  const d = (opts) => runScript(`const b = box(40, 40, 20); draft(b.face('right'), 5${opts});`).doc.features.find((f) => f.kind === 'draft');
  assert.equal(d(", { from: 'bottom' }").neutralFrom, 'bottom');
  assert.equal(d(", { from: 'top' }").neutralFrom, 'top');
  assert.equal(d(", { from: 'bottom', neutral: 3 }").neutralFrom, undefined);
  assert.equal(d(', { neutral: 3 }').neutralFrom, undefined);
  assert.equal(d('').neutralFrom, undefined);
});

test('SD-5: comment, string and template variants: the textual reader misaligns them, the doc record refuses every one with G-FROM', async () => {
  for (const [what, src] of Object.entries(VARIANTS)) {
    const doc = sandbox(src);
    const [d] = await host(doc, H.hostFromUsage(doc, { recorded: true }));
    assert.equal(d.status, 'refused', `${what}: ${JSON.stringify(d).slice(0, 300)}`);
    assert.equal(d.guard, 'G-FROM', what);
    assert.equal(d.refusal, FROM_STALE(d.id), what);
    // the old host input: built for every variant but the plain one (the bug this closes)
    const [old] = await host(doc, H.draftFromUsage(src));
    assert.equal(old.status, what === 'plain' ? 'refused' : 'built', `textual reader on "${what}"`);
  }
});

test('SD-5: a loop that emits two stale drafts: both refused (the textual reader saw one draft( and left the second unguarded)', async () => {
  const src = "const parts = [move(box(40, 40, 20), [0, 0, 30]), move(box(40, 40, 20, { at: [100, 0, 0] }), [0, 0, 30])];\n"
    + "for (const p of parts) draft(p.face('right'), 5, { from: 'bottom' });";
  const doc = sandbox(src);
  const ds = await host(doc, H.hostFromUsage(doc, { recorded: true }));
  assert.equal(ds.length, 2);
  for (const d of ds) { assert.equal(d.status, 'refused', JSON.stringify(d).slice(0, 300)); assert.equal(d.guard, 'G-FROM'); assert.equal(d.refusal, FROM_STALE(d.id)); }
  const old = await host(doc, H.draftFromUsage(src));
  assert.deepStrictEqual(old.map((d) => d.status), ['refused', 'built']);
});

test('SD-5: no over-refusal on the recorded route: a hand-set neutral on a moved part, from: on an unmoved part, a default neutral', async () => {
  for (const src of [
    "const b = box(40, 40, 20); const m = move(b, [0, 0, 30]); draft(m.face('right'), 5, { neutral: -10 });",
    "const b = box(40, 40, 20); const m = move(b, [0, 0, 30]); draft(m.face('right'), 5, { from: 'bottom', neutral: 20 });",
    "const b = box(40, 40, 20); draft(b.face('right'), 5, { from: 'bottom' });",
    "// draft(x, 1, { from: 'bottom' })\nconst b = box(40, 40, 20); const m = move(b, [0, 0, 30]); draft(m.face('right'), 5);",
  ]) {
    const doc = sandbox(src);
    const [d] = await host(doc, H.hostFromUsage(doc, { recorded: true }));
    assert.equal(d.status, 'built', `${src}: ${JSON.stringify(d).slice(0, 300)}`);
  }
});

test('SD-5 translateRaw (no script): a draft with no record is from-unknown and still guarded; the record is used when the doc carries it', async () => {
  const strip = (doc) => ({ ...doc, features: doc.features.map(({ neutralFrom, ...f }) => f) });
  // the stale case with its record removed: G-FROM still refuses it (maybe: the root's bottom)
  const doc = sandbox(STALE);
  const use = H.hostFromUsage(strip(doc), { recorded: false });
  assert.deepStrictEqual(use, [{ from: null, neutral: false, maybe: ['bottom'] }]);
  const [d] = await host(strip(doc), use);
  assert.equal(d.status, 'refused'); assert.equal(d.guard, 'G-FROM'); assert.equal(d.refusal, FROM_STALE(d.id));
  // with the record, recorded: false reads it
  assert.deepStrictEqual(H.hostFromUsage(doc, { recorded: false }), [{ from: 'bottom', neutral: false }]);
  // a neutral no from: word gives (mid-part, hand-set) builds; an unmoved part drafted from its own bottom builds
  for (const src of ["const b = box(40, 40, 20); const m = move(b, [0, 0, 30]); draft(m.face('right'), 5, { neutral: 25 });", "const b = box(40, 40, 20); draft(b.face('right'), 5, { from: 'bottom' });"]) {
    const dd = strip(sandbox(src));
    const [x] = await host(dd, H.hostFromUsage(dd, { recorded: false }));
    assert.equal(x.status, 'built', `${src}: ${JSON.stringify(x).slice(0, 300)}`);
  }
  // a root whose extent the interpreter cannot read gives 0 for either word: both are checked
  const cone = strip(sandbox("const c = sphere(10); const m = move(c, [0, 0, 30]); draft(m, 5, { whole: true, from: 'bottom' });"));
  const cu = H.hostFromUsage(cone, { recorded: false });
  assert.deepStrictEqual(cu[0].maybe, ['bottom', 'top']);
});

test('SD-5: toScript writes the recorded from: word back, so the record survives a round trip on a moved part', () => {
  const r = runScript(STALE);
  const src2 = toScript(r.doc);
  assert.match(src2, /from: 'bottom'/);
  const again = runScript(src2);
  assert.deepStrictEqual(again.errors, []);
  assert.deepStrictEqual(again.doc.features, r.doc.features);
});
