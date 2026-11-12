// PROTOTYPE, off by default (ctx.probeBlockedSteps; host-entry.mjs): a hollow, draft, round or bevel blocked by a refused step is told its OWN mistake, found by
// translating the script once more without the steps that were not built. No kernel here: the host's translateDoc on the layer's fake engine.
// What is pinned: the layer's three blocked sentences are the ones the host looks for; what is left out and how parts are handed on; nothing but the blocked step's
// sentence and guard changes (statuses, commands, every other step); a step that would build keeps its blocked sentence; text that is not the student's mistake
// is never shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const H = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { makeFake } = await imp('packages/layer/test/fake-engine.mjs');
const { fakeResolveAt } = await imp('packages/layer/test/fake-resolve-at.mjs');
const { install, withPreamble } = await imp('packages/solidcraft-host/pane/lib/friendly-sketch.mjs');
install(globalThis);

/** what pane.js run() does, on the fake engine; `extra` = more ctx (the switch) */
async function host(src, extra = {}) {
  const r = runScript(withPreamble(src));
  assert.deepStrictEqual(r.errors, [], src);
  const prep = H.hostPrepare(r, { recorded: true });
  assert.equal(prep.refusal, undefined, src);
  const fake = makeFake({ shellDraft: true });
  const tr = await H.translateDoc(prep.doc, { arc: H.arc, mt: H.mt, runSC: fake.runSC, soups: {}, followMoves: true, resolveAt: fakeResolveAt, fromUsage: prep.fromUsage, probeBlocked: true, ...extra });
  return { tr, by: new Map(tr.features.map((f) => [f.id, f])), doc: prep.doc, fromUsage: prep.fromUsage };
}
const ON = { probeBlockedSteps: true };
// a hole the holes group refuses before anything is sent to the engine (a countersink wider than the part is thick at this spot)
const BAD_HOLE = `hole(b, { across: 4, countersink: { across: 9, angle: 175 } })`;
const BOX = `const b = box(30, 20, 10)\n`;
const lean = (tr) => tr.features.map((f) => ({ id: f.id, status: f.status, refusal: f.refusal ?? null, guard: f.guard ?? null, commands: f.commands ?? null }));

test('the layer\'s blocked sentences are the ones the host looks for, and they name the step that blocks', async () => {
  const cases = { shell: [`hollow(b, { wall: 2, open: 'top' })`, 'shell1'], draft: [`draft(b.face('right'), 5)`, 'draft1'], fillet: [`round(b.edge('top', 'front'), 2)`, 'round1'] };
  for (const [kind, [step, id]] of Object.entries(cases)) {
    const { by } = await host(`${BOX}${BAD_HOLE}\n${step}`);
    assert.equal(by.get('hole1').status, 'refused', kind);
    assert.equal(by.get(id).status, 'refused', kind);
    const m = H.BLOCKED_SENTENCE[kind].exec(by.get(id).refusal);
    assert.ok(m, `${kind}: ${by.get(id).refusal}`);
    assert.equal(m[1], 'hole1', kind);
  }
  // a refusal of its own is not a blocked sentence
  const { by } = await host(`${BOX}hollow(b, { wall: 12, open: 'top' })`);
  assert.equal(by.get('shell1').guard, 'G-THICK');
  assert.equal(H.BLOCKED_SENTENCE.shell.test(by.get('shell1').refusal), false);
});

test('blockedProbePlan: the refused steps are left out and hand their part on; a step whose part cannot be handed on is not probed', async () => {
  // nothing blocked: no second translation
  { const { tr, doc } = await host(`${BOX}hollow(b, { wall: 2, open: 'top' })`); assert.equal(H.blockedProbePlan(doc, tr, undefined), null); }
  // a hollow after a refused hole: the hole is left out and the hollow works on the box
  { const { tr, doc } = await host(`${BOX}${BAD_HOLE}\nhollow(b, { wall: 2, open: 'top' })`);
    const p = H.blockedProbePlan(doc, tr, undefined);
    assert.deepEqual(p.candidates, ['shell1']);
    assert.deepEqual(p.doc.features.map((f) => [f.id, f.target ?? null]), [['box1', null], ['shell1', 'box1']]);
    assert.equal(doc.features.find((f) => f.id === 'shell1').target, 'hole1', 'the doc itself is not changed'); }
  // a chain: the draft waits on the blocked hollow; both are probed, and the draft still works on the hollow
  { const { tr, doc } = await host(`${BOX}${BAD_HOLE}\nhollow(b, { wall: 2, open: 'top' })\ndraft(b.face('right'), 5)`);
    const p = H.blockedProbePlan(doc, tr, undefined);
    assert.deepEqual(p.candidates, ['shell1', 'draft1']);
    assert.deepEqual(p.doc.features.map((f) => [f.id, f.target ?? null]), [['box1', null], ['shell1', 'box1'], ['draft1', 'shell1']]); }
  // two refused holes in a row are both left out
  { const { tr, doc } = await host(`${BOX}${BAD_HOLE}\n${BAD_HOLE}\nhollow(b, { wall: 2, open: 'top' })`);
    assert.deepEqual(H.blockedProbePlan(doc, tr, undefined).doc.features.map((f) => [f.id, f.target ?? null]), [['box1', null], ['shell1', 'box1']]); }
  // synthetic: the part itself was refused (nothing to hand on), and a round whose edge names a face of the refused hole
  const tr = (rows) => ({ features: rows.map(([id, kind, status, refusal]) => ({ id, kind, status, refusal })) });
  const docRoot = { version: 1, features: [{ id: 'cyl1', kind: 'cylinder' }, { id: 'hole1', kind: 'hole', target: 'cyl1' }, { id: 'draft1', kind: 'draft', target: 'hole1' }] };
  assert.equal(H.blockedProbePlan(docRoot, tr([['cyl1', 'cylinder', 'refused', 'x'], ['hole1', 'hole', 'refused', 'y'], ['draft1', 'draft', 'refused', 'draft1 (draft): it needs hole1, which could not be built, so draft1 is shown without it.']]), undefined), null);
  const docJoin = { version: 1, features: [{ id: 'box1', kind: 'box' }, { id: 'box2', kind: 'box' }, { id: 'op1', kind: 'combine', a: 'box1', b: 'box2' }, { id: 'round1', kind: 'fillet', target: 'op1' }] };
  assert.equal(H.blockedProbePlan(docJoin, tr([['box1', 'box', 'built'], ['box2', 'box', 'built'], ['op1', 'combine', 'refused', 'x'], ['round1', 'fillet', 'refused', 'round1 builds on op1, which could not be built, so round1 is shown without it too -- fix op1 first.']]), undefined), null);
  const docName = { version: 1, features: [{ id: 'box1', kind: 'box' }, { id: 'hole1', kind: 'hole', target: 'box1' }, { id: 'round1', kind: 'fillet', target: 'hole1', edge: { between: ['hole1:wall', 'box1:top'] } }, { id: 'round2', kind: 'fillet', target: 'hole1', edge: { between: ['box1:top', 'box1:front'] } }] };
  const blocked = (id) => `${id} builds on hole1, which could not be built, so ${id} is shown without it too -- fix hole1 first.`;
  const pn = H.blockedProbePlan(docName, tr([['box1', 'box', 'built'], ['hole1', 'hole', 'refused', 'x'], ['round1', 'fillet', 'refused', blocked('round1')], ['round2', 'fillet', 'refused', blocked('round2')]]), undefined);
  assert.deepEqual(pn.candidates, ['round2'], 'round1 names a face of the hole that was not built');
  // an id that only starts like the refused one is not a mention of it
  const docNear = { version: 1, features: [{ id: 'box1', kind: 'box' }, { id: 'hole1', kind: 'hole', target: 'box1' }, { id: 'round1', kind: 'fillet', target: 'hole1', edge: { between: ['hole10:wall', 'box1:top'] } }] };
  assert.deepEqual(H.blockedProbePlan(docNear, tr([['box1', 'box', 'built'], ['hole1', 'hole', 'refused', 'x'], ['round1', 'fillet', 'refused', blocked('round1')]]), undefined).candidates, ['round1']);
});

test('blockedProbePlan: the from-word record of the drafts stays paired with the drafts that are left', () => {
  const doc = { version: 1, features: [{ id: 'box1', kind: 'box' }, { id: 'draft1', kind: 'draft', target: 'box1' }, { id: 'draft2', kind: 'draft', target: 'draft1' }, { id: 'draft3', kind: 'draft', target: 'draft2' }] };
  const tr = { features: [{ id: 'box1', status: 'built' }, { id: 'draft1', status: 'built' }, { id: 'draft2', status: 'refused', refusal: 'draft2 (draft): some reason of its own.' }, { id: 'draft3', status: 'refused', refusal: 'draft3 (draft): it needs draft2, which could not be built, so draft3 is shown without it.' }] };
  const use = [{ from: 'bottom', neutral: false }, { from: 'top', neutral: false }, { from: null, neutral: false }];
  const p = H.blockedProbePlan(doc, tr, use);
  assert.deepEqual(p.doc.features.map((f) => [f.id, f.target ?? null]), [['box1', null], ['draft1', 'box1'], ['draft3', 'draft1']]);
  assert.deepEqual(p.fromUsage, [use[0], use[2]]);
  assert.equal(use.length, 3, 'the caller\'s record is not changed');
});

test('a blocked hollow with a mistake of its own says so; nothing else changes; switched off, nothing changes at all', async () => {
  const src = `${BOX}${BAD_HOLE}\nhollow(b, { wall: 12, open: 'top' })`;
  const off = await host(src); const on = await host(src, ON);
  assert.match(off.by.get('shell1').refusal, /it needs hole1, which could not be built/);
  assert.equal(on.by.get('shell1').status, 'refused');
  assert.equal(on.by.get('shell1').guard, 'G-THICK');
  assert.equal(on.by.get('shell1').refusal, 'Hollowing box1 to 12 thick would collapse it, so shell1 is shown without it -- the wall has to be under 10.');
  assert.match(on.by.get('shell1').raw, /^blocked \(shell1 \(hollow\): it needs hole1/);
  assert.deepEqual(lean(on.tr).filter((f) => f.id !== 'shell1'), lean(off.tr).filter((f) => f.id !== 'shell1'));
  assert.deepEqual(on.tr.commands, off.tr.commands, 'the commands the page builds are the first translation\'s');
  assert.deepEqual(on.by.get('shell1').commands, off.by.get('shell1').commands);
  // the switch absent or false: the same as before
  assert.deepEqual(lean((await host(src, { probeBlockedSteps: false })).tr), lean(off.tr));
});

test('a blocked step that would build without the refused steps keeps its blocked sentence', async () => {
  for (const step of [`hollow(b, { wall: 2, open: 'top' })`, `draft(b.face('right'), 5)`]) {
    const src = `${BOX}${BAD_HOLE}\n${step}`;
    assert.deepEqual(lean((await host(src, ON)).tr), lean((await host(src)).tr), step);
  }
});

test('a second hollow blocked by a refused hole is told it is a second hollow; a draft waiting on a hollow with its own mistake stays blocked', async () => {
  const twice = await host(`${BOX}hollow(b, { wall: 2, open: 'top' })\n${BAD_HOLE}\nhollow(b, { wall: 1, open: 'top' })`, ON);
  assert.equal(twice.by.get('shell1').status, 'built');
  assert.equal(twice.by.get('shell2').guard, 'G-TWICE');
  assert.match(twice.by.get('shell2').refusal, /box1 is already hollow/);
  const chain = await host(`${BOX}${BAD_HOLE}\nhollow(b, { wall: 12, open: 'top' })\ndraft(b.face('right'), 5)`, ON);
  assert.equal(chain.by.get('shell1').guard, 'G-THICK');
  assert.match(chain.by.get('draft1').refusal, /it needs shell1, which could not be built/);
  // the hollow would build, so the hollow after it is judged on it: a second hollow
  const two = await host(`${BOX}${BAD_HOLE}\nhollow(b, { wall: 2, open: 'top' })\nhollow(b, { wall: 1, open: 'top' })`, ON);
  assert.match(two.by.get('shell1').refusal, /it needs hole1, which could not be built/);
  assert.equal(two.by.get('shell2').guard, 'G-TWICE');
});

test('ownRefusalShown: text about the translation, not about the student\'s step, is never shown', () => {
  const r = (refusal, guard) => ({ status: 'refused', refusal, ...(guard ? { guard } : {}) });
  assert.equal(H.ownRefusalShown('shell', r('Hollowing box1 to 12 thick would collapse it, so shell1 is shown without it -- the wall has to be under 10.', 'G-THICK')), true);
  assert.equal(H.ownRefusalShown('fillet', r('The edges of a sphere cannot be picked yet, so round1 is shown without it -- round an edge of a box.')), true);
  assert.equal(H.ownRefusalShown('fillet', r('round1 (fillet): the edge could not be resolved to a single edge (no resolution)')), false);
  assert.equal(H.ownRefusalShown('fillet', r('round1 (fillet): needs a single target body')), false);
  assert.equal(H.ownRefusalShown('shell', r('shell1 (hollow): box1 is not a single solid, so shell1 is shown without it.')), false);
  assert.equal(H.ownRefusalShown('draft', r('draft1 (draft): something with no guard code')), false);
  assert.equal(H.ownRefusalShown('shell', r('shell1 (hollow): solidcraft refused it -- boom', 'engine')), false);
  assert.equal(H.ownRefusalShown('shell', r('shell1 (hollow): it needs hole1, which could not be built, so shell1 is shown without it.')), false);
  assert.equal(H.ownRefusalShown('draft', r('draft1 is not built because sk1 could not be built, so draft1 is shown without it.', 'HOST-PREFLIGHT-DEP')), false);
  assert.equal(H.ownRefusalShown('shell', { status: 'built' }), false);
  assert.equal(H.ownRefusalShown('shell', undefined), false);
});
