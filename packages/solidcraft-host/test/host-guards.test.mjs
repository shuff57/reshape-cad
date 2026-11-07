// SG-13 and PM-4 on the HOST ROUTE (docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md; GUARD-SG13-PNP7-PM4.md). No kernel: the host's own translateDoc
// (host-entry.mjs: unified set, joins at 'full') on the layer's fake engine, and the contract modules the host copies, as the independent reference.
//   SG-13  a soup whose rules move its drawn rows and leave freedom (or cannot all be met) is refused in the sketch-geometry contract's sentence, where the layer
//          built it; where the layer refused it already (the kernel's own conflict sentence), that sentence stands.
//   PM-4   pane.js run() calls the patterns-mirror group's preflightScript on the editor text, before anything is translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const H = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');
const HG = await imp('packages/solidcraft-host/pane/src/host-guards.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { makeFake } = await imp('packages/layer/test/fake-engine.mjs');
const { fakeResolveAt } = await imp('packages/layer/test/fake-resolve-at.mjs');
const { install, withPreamble } = await imp('packages/solidcraft-host/pane/lib/friendly-sketch.mjs');
install(globalThis);
const CONTRACT = 'docs/spikes/solidcraft-referee/contract';
const G = await imp(`${CONTRACT}/sketch-geometry.guard.mjs`);

/** what pane.js run() does: the sandbox runner, hostPrepare, then the host's translateDoc (here on the fake engine) */
async function host(src, { runSC = null } = {}) {
  const r = runScript(withPreamble(src));
  assert.deepStrictEqual(r.errors, [], src);
  const prep = H.hostPrepare(r, { recorded: true });
  assert.equal(prep.refusal, undefined, src);
  const fake = makeFake({ shellDraft: true });
  const soups = {};
  const tr = await H.translateDoc(prep.doc, { arc: H.arc, mt: H.mt, runSC: runSC ?? fake.runSC, soups, followMoves: true, resolveAt: fakeResolveAt, fromUsage: prep.fromUsage });
  return { tr, by: new Map(tr.features.map((f) => [f.id, f])), doc: prep.doc };
}

// ---- SG-13 ----------------------------------------------------------------------------------------------------------------------------------------------------
// the case files that load no kernel (the others import sg-core, which needs a SolidCraft pkg)
const SG_FILES = ['cases-attacks.mjs', 'cases-soup.mjs', 'cases-extra2.mjs'];
async function sgCases() {
  const out = [];
  for (const f of SG_FILES) {
    const m = await imp(`${CONTRACT}/sketch-geometry-harness/${f}`);
    const list = typeof m.cases === 'function' ? m.cases() : m.cases ?? m.CASES ?? [];
    for (const c of list) if (!c.custom && typeof c.script === 'string') out.push({ id: `${f}:${c.id}`, script: c.script });
  }
  return out;
}

test('SG-13: the host copy of the contract solver gives the contract guard\'s verdict on every soup of the sketch-geometry cases', async () => {
  let soups = 0; let refused = 0;
  for (const c of await sgCases()) {
    const r = runScript(c.script); if (r.errors.length) continue;
    let doc; try { doc = H.solveDoc(r.doc); } catch { continue; }
    for (const sk of doc.features.filter((f) => f.kind === 'sketch' && HG.isSoup(f))) {
      soups++;
      const want = G.solveVerdict(G.solvedOf(structuredClone(sk)));
      const got = HG.soupSolveVerdict(sk);
      assert.deepStrictEqual(got, want ?? null, `${c.id} ${sk.id}`);
      if (got) refused++;
    }
  }
  assert.ok(soups > 40, `soups read: ${soups}`);
  assert.ok(refused > 0, 'some soup is refused');
});

test('SG-13: the audit\'s HALT-4 cases are refused in the contract\'s sentence (sketch-geometry#82), sketch and pull', async () => {
  const cases = await sgCases();
  const want = {
    'cases-attacks.mjs:a5-uc-two-circles-equal-radius': 'The rules of this sketch have to move its shape (by up to 3 mm) but leave 5 ways for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give.',
    'cases-attacks.mjs:a5-uc-hole-pointon-edge': 'The rules of this sketch have to move its shape (by up to 10 mm) but leave 5 ways for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give.',
  };
  for (const [id, sentence] of Object.entries(want)) {
    const c = cases.find((x) => x.id === id); assert.ok(c, id);
    const { by } = await host(c.script);
    for (const fid of ['sk1', 'pull1']) {
      assert.equal(by.get(fid).status, 'refused', `${id} ${fid}`);
      assert.equal(by.get(fid).guard, 'SG-RULES-UNDERDETERMINED', `${id} ${fid}`);
      assert.equal(by.get(fid).refusal, sentence, `${id} ${fid}`);
    }
  }
});

const RECT = (w, h) => [
  { k: 'line', id: 1, a: [0, 0], b: [w, 0] }, { k: 'line', id: 2, a: [w, 0], b: [w, h] },
  { k: 'line', id: 3, a: [w, h], b: [0, h] }, { k: 'line', id: 4, a: [0, h], b: [0, 0] },
];
const JOIN_HV = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 },
];
const soup = (geoms, rules, after = 'const part = extrude(sk, 10);') => `const sk = sketch('top'); sk.geom(${JSON.stringify(geoms)}); sk.rules(${JSON.stringify(rules)}); ${after}`;

test('SG-13: a soup whose rules hold as drawn, or pin what they move, builds; a dependent of a refused pull gets the contract\'s pointer sentence', async () => {
  // as drawn: residual 0, nothing for a solver to choose
  { const { by } = await host(soup(RECT(40, 20), [...JOIN_HV, { k: 'lock', a: 1, aEnd: 'a' }, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }])); assert.equal(by.get('pull1').status, 'built'); }
  // resized by its rules, but pinned completely (a lock and both dimensions): dofMoved 0
  { const { by } = await host(soup(RECT(38, 17), [...JOIN_HV, { k: 'lock', a: 1, aEnd: 'a' }, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 20 }])); assert.equal(by.get('pull1').status, 'built'); }
  // resized with no lock: free to slide, refused; the move after the pull points at it
  const { by } = await host(soup(RECT(38, 20), [...JOIN_HV, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }], 'const part = extrude(sk, 10); move(part, [0, 0, 5]);'));
  assert.equal(by.get('pull1').guard, 'SG-RULES-UNDERDETERMINED');
  assert.equal(by.get('pull1').refusal, 'The rules of this sketch have to move its shape (by up to 1 mm) but leave 3 ways for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give.');
  assert.equal(by.get('move1').status, 'refused');
  assert.equal(by.get('move1').guard, HG.PREFLIGHT_DEP_GUARD);
  assert.equal(by.get('move1').refusal, `move1 was not built because pull1 was refused: ${by.get('pull1').refusal}`);
});

test('SG-13: where the layer refused the pull already, its own sentence stands (the pane\'s diag-conflict example)', async () => {
  const ex = JSON.parse(readFileSync(path.join(root, 'packages/solidcraft-host/pane/examples.json'), 'utf8'));
  const e = (Array.isArray(ex) ? ex : ex.examples).find((x) => x.id === 'diag-conflict');
  const r = runScript(withPreamble(e.script)); const doc = H.hostPrepare(r, { recorded: true }).doc;
  assert.equal(HG.hostPreflight(doc).get('pull1')?.guard, 'SG-RULES-CONFLICT', 'the guard would refuse it');
  // an engine that refuses every pull, in its own words, as the kernel refuses this sketch's second width
  const fake = makeFake({ shellDraft: true });
  const runSC = async (cmds) => (cmds.some((c) => c.command === 'solid.extrude') ? { ok: false, failed: { command: 'solid.extrude', error: 'over-constrained' } } : fake.runSC(cmds));
  const tr = await H.translateDoc(doc, { arc: H.arc, mt: H.mt, runSC, soups: {}, followMoves: true, resolveAt: fakeResolveAt });
  const pull = tr.features.find((f) => f.id === 'pull1');
  assert.equal(pull.status, 'refused');
  assert.notEqual(pull.guard, 'SG-RULES-CONFLICT');
  assert.match(pull.refusal, /over-constrain/);
  assert.equal(tr.features.find((f) => f.id === 'sk1').status, 'noop', 'the sketch is not reported refused when no guard of these fired');
});

// ---- PM-4 -----------------------------------------------------------------------------------------------------------------------------------------------------
test('PM-4: the host exports the group\'s preflightScript, and pane.js run() refuses on it before the doc is checked or translated', async () => {
  const L = await imp('packages/layer/dist/index.js');
  assert.equal(H.preflightScript, L.preflightScript);
  const plate = "const b = box(60, 60, 10); const sk = sketch('top', 10); sk.circle(6, { at: [20, 0] }); const c = pocket(sk, b, 4);";
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: 720 });`)?.sentence, L.PREFLIGHT_SENTENCE);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: -360 });`)?.sentence, L.PREFLIGHT_SENTENCE);
  assert.equal(H.preflightScript(`${plate} const a = 90; repeatAround(c, { count: 4, angle: a });`)?.sentence, L.PREFLIGHT_SENTENCE_VAR);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: 360 });`), null);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4 });`), null);
  const pane = readFileSync(path.join(root, 'packages/solidcraft-host/pane/pane.js'), 'utf8');
  const run = pane.slice(pane.indexOf('async function run('), pane.indexOf("$('run').onclick"));
  const at = (s) => { const i = run.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('preflightScript(srcText)') > at('if (r.errors.length)'), 'after the script error report');
  assert.ok(at('preflightScript(srcText)') < at('validDoc(r.doc)'), 'before the doc is checked');
  assert.ok(at('preflightScript(srcText)') < at('await translateDoc('), 'before anything is translated');
  assert.ok(run.includes('if (pf) return failState(summary, \'refused\', `REFUSED BEFORE BUILD: ${pf.sentence}`'), 'refused in the group\'s sentence, nothing built');
});
