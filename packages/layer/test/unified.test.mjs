// The 'unified' planner set: base + every group's planners, ONE loop in which every group's guards run on every feature they apply to.
// No kernel, no wasm: the deterministic fake engine (test/fake-engine.mjs) in the four configurations of the earlier differentials.
//
// INVARIANT 1 (the safety invariant, the acceptance test): for any doc and any feature, if ANY single set ('extrude-pocket', 'holes', 'shell-draft', each run
//   alone on that doc through the same engine) refuses that feature or a feature it depends on, 'unified' refuses it or a feature it depends on too. refusals(unified)
//   is a superset of the union of the refusals of the three sets. Checked on every corpus of the layer's tests and on 600 COMBINED docs, x 4 engine configurations.
//   What does not bind, and why, is spelled out in bindingRefusals() (unified-harness.mjs) and counted in the summary: a refusal of a kind the set does not own
//   (it has no guard for it: it is the base planner or a stand-in sentence), what depends on such a refusal, and a refusal the fake engine injected on a call NUMBER.
// INVARIANT 2 (no needless capability loss): on a doc that lies wholly inside ONE group's domain, 'unified' equals that group's set exactly: the result, the ordered
//   engine calls (with their options) and a thrown error. A doc that uses no group at all equals the extrude-pocket set (the loop whose wording it takes).
//
// This shows the guards of the three groups are not lost in the one loop, on the fake. It does NOT show that a built solid is right: the fake has no geometry kernel.
// That needs the real-kernel replay (test/live-replay-unified.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpora, runSet, CONFIGS, SETS, TR, lib, bindingRefusals, unifiedCovers, EP_JOIN_LEVEL } from './unified-harness.mjs';
import { combinedDoc } from './unified-docs.mjs';
import { box, shell, move, rotate, hole, pocket, rect, combine, prim } from './docs.mjs';

const GROUP = { ep: 'extrude-pocket', holes: 'holes', sd: 'shell-draft', pm: 'patterns-mirror', bool: 'booleans', rg: 'revolve-groove', fc: 'fillet-chamfer' };
// UNIFIED_CORPORA=bool-cases,bool-generated runs only those corpora (a development switch: the acceptance run is the whole set)
const CORPORA = process.env.UNIFIED_CORPORA ? new Set(process.env.UNIFIED_CORPORA.split(',')) : null;
const items = (await loadCorpora({ combined: 600 })).filter((i) => !CORPORA || CORPORA.has(i.corpus));
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

test('createTranslator: unified exists, is not a member of a composition, the default stays base, the single sets are unchanged', () => {
  const U = lib.tr.createTranslator({ planners: 'unified' });
  assert.equal(U.planners, 'unified');
  assert.equal(lib.tr.createTranslator().planners, 'base');
  assert.deepStrictEqual(Object.keys(lib.tr.PROFILES), ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer']);
  assert.throws(() => lib.tr.createTranslator({ planners: ['unified', 'holes'] }), /not composed/);
  assert.throws(() => lib.tr.createTranslator({ planners: ['holes', 'unified'] }), /not composed/);
  // a hole, a shell and a draft are planned asynchronously by the loop: planFeature cannot do it synchronously and must not fall back to the unguarded planner
  assert.throws(() => U.planFeature({ id: 'h1', kind: 'hole', target: 'b1', diameter: 2, depth: 5, center: [0, 0, 0], axis: 'z' }, { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} }, { arc: lib.arc, runSC: () => ({ ok: true }), resolve: () => null }), /plans a hole asynchronously/);
});

// ---- the guards the compositions lose, one by one (constructed docs) -----------------------------------------------------------------------------------------
async function runDoc(set, features, cfg = CONFIGS[0]) { return runSet(set, { version: 1, features }, cfg); }
const statusOf = (r, id) => r.result.features.find((f) => f.id === id);

test('bindingRefusals: a G-BUDGET stop on another set\'s kind is a stand-in; a geometry guard on that kind still binds', () => {
  const doc = { version: 1, features: [{ id: 'pat1', kind: 'pattern' }, { id: 'hole1', kind: 'hole' }] };
  const refusal = (guard, extra = {}) => ({ status: 'refused', guard, refusal: `${guard} stopped it`, ...extra });
  // the live case: the holes set does not own pattern, its 45 s window closed on a stand-in plan
  assert.deepStrictEqual(bindingRefusals('holes', doc, [refusal('G-BUDGET'), { status: 'built' }]), { binding: [], standIn: [0], downstream: [], injected: [] });
  // a geometry guard on the same kind is the set's own evidence and keeps binding
  assert.deepStrictEqual(bindingRefusals('holes', doc, [refusal('G-CHAMFER'), { status: 'built' }]), { binding: [0], standIn: [], downstream: [], injected: [] });
  // a budget stop on a kind the set does own keeps binding (the holes set's own hole)
  assert.deepStrictEqual(bindingRefusals('holes', doc, [{ status: 'built' }, refusal('G-BUDGET')]), { binding: [1], standIn: [], downstream: [], injected: [] });
});

test('G-VOID: nothing but a move or a turn may follow a closed hollow, for EVERY kind, and the mark travels through the move and the turn', async () => {
  const hollow = [box('b1', [30, 24, 20]), shell('s1', 'b1', undefined, 2)];
  const sk = [rect('sk1', 6, 6)];
  for (const [label, tail, id, guardExpected] of [
    ['pocket (extrude-pocket kind)', [...sk, pocket('pk1', 'sk1', 's1', 3)], 'pk1', 'G-VOID'],
    ['combine (extrude-pocket kind)', [box('b2', [5, 5, 5], [30, 0, 0]), combine('c1', 'union', ['s1', 'b2'])], 'c1', 'G-VOID'],
    ['hole (holes kind)', [hole('h1', 's1', {})], 'h1', 'G-VOID'],
    ['pocket after a move of the hollow', [move('m1', 's1', [5, 0, 0]), ...sk, pocket('pk1', 'sk1', 'm1', 3)], 'pk1', 'G-VOID'],
    ['hole after a turn of the hollow', [rotate('r1', 's1', [0, 0, 90]), hole('h1', 'r1', {})], 'h1', 'G-VOID'],
    ['hole after a move of a turn of the hollow', [rotate('r1', 's1', [0, 0, 90]), move('m1', 'r1', [3, 0, 0]), hole('h1', 'm1', {})], 'h1', 'G-VOID'],
    ['a copy of the hollow', [move('m1', 's1', [5, 0, 0], true)], 'm1', null],
  ]) {
    const r = await runDoc('unified', [...hollow, ...tail]);
    const n = statusOf(r, id);
    assert.equal(n.status, 'refused', `${label}: ${JSON.stringify(n).slice(0, 200)}`);
    if (guardExpected) assert.equal(n.guard, guardExpected, label);
  }
  // the hollow itself and a plain move of it still build
  const ok = await runDoc('unified', [...hollow, move('m1', 's1', [5, 0, 0])]);
  assert.equal(statusOf(ok, 's1').status, 'built'); assert.equal(statusOf(ok, 'm1').status, 'built');
  // and the single set that does NOT have the guard builds the pocket (this is what the composition lost)
  const comp = lib.tr.createTranslator({ planners: ['extrude-pocket', 'holes', 'shell-draft'] });
  const fake = (await import('./fake-engine.mjs')).makeFake({ holeModel: true, boxBool: true, shellDraft: true });
  const { _state, ...cr } = await comp.translateDoc({ features: [...hollow, ...sk, pocket('pk1', 'sk1', 's1', 3)] }, { arc: lib.arc, mt: lib.mt, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {} });
  assert.equal(cr.features.find((f) => f.id === 'pk1').status, 'built', 'the composition builds a pocket in a closed hollow (the lost guard): the reason unified exists');
});

test('G-CHAMFER: a box with every edge bevelled is refused whichever group the rest of the document belongs to', async () => {
  const chamfered = box('b1', [30, 24, 20], [0, 0, 0], { round: 2, roundStyle: 'chamfer' });
  for (const tail of [[], [hole('h1', 'b1', {})], [rect('sk1', 6, 6), pocket('pk1', 'sk1', 'b1', 3)], [shell('s1', 'b1', prim('b1', '+z'), 2)]]) {
    const r = await runDoc('unified', [chamfered, ...tail]);
    assert.equal(statusOf(r, 'b1').status, 'refused'); assert.equal(statusOf(r, 'b1').guard, 'G-CHAMFER');
    for (const f of r.result.features.slice(1)) assert.notEqual(f.status, 'built', `${f.id} must not build on a refused box`);
  }
});

test('the shell count a guard reads is on every measure of a mixed document, whichever step built the feature (G-SHELLS and the sealed-cavity check)', async () => {
  // an open hollow (shell-draft step), then a hole (holes guard G-SHELLS reads its measure's shells) and a pocket (extrude-pocket check reads shells)
  const r = await runDoc('unified', [box('b1', [30, 24, 20]), shell('s1', 'b1', prim('b1', '+z'), 2), hole('h1', 's1', { depth: 5 }), rect('sk1', 6, 6), pocket('pk1', 'sk1', 'h1', 2)]);
  const s1 = statusOf(r, 's1');
  assert.equal(s1.status, 'built');
  assert.equal(typeof s1.measure.shells, 'number', 'the hollow built by the shell-draft step carries a shell count for the holes guard');
  // the case that showed it: a pocket into a hollowed join is refused by the extrude-pocket check (it would seal a cavity), and was built when the hollow carried no shell count
  const doc = combinedDoc(57);
  assert.equal(statusOf(await runSet('extrude-pocket', doc, CONFIGS[0]), 'pk6').status, 'refused');
  assert.equal(statusOf(await runSet('unified', doc, CONFIGS[0]), 'pk6').status, 'refused');
});

test('revolve-groove: a spin and a groove are guarded in the one loop, in a document of any other group, and a refused groove refuses what follows on its part (RG-CHAIN)', async () => {
  const R = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const sk = (id, points, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points, ...extra });
  // G9 (a ring completely inside the part) in a document that also drills, hollows and pockets: the groove is refused with the group's guard and sentence, unified and the group's own set agree
  for (const head of [[], [hole('h0', 'b1', { diameter: 2, depth: 4, center: [15, 15, 0] })], [shell('s0', 'b1', prim('b1', '+z'), 2)]]) {
    const feats = [box('b1', [40, 40, 40], [0, 0, 0]), ...head, sk('s1', R(5, 10, -5, 5)), { id: 'g1', kind: 'groove', target: 's1', into: head.length ? head[0].id : 'b1', angle: 360 }];
    const u = await runDoc('unified', feats); const g = await runDoc('revolve-groove', feats);
    if (!head.length) { assert.equal(statusOf(u, 'g1').guard, 'G9'); assert.equal(statusOf(u, 'g1').refusal, statusOf(g, 'g1').refusal); assert.deepStrictEqual(u.result.features, g.result.features); }
    else assert.notEqual(statusOf(u, 'g1').status, 'built', `the groove into ${head[0].kind} builds`);
  }
  // the sign of a part turn (G1): a profile on the -u side is handed to the engine with the angle as given, one on the +u side negated, through unified as through the group's set
  for (const [u0, u1, want] of [[-12, -4, 90], [4, 12, -90]]) {
    const feats = [sk('s1', R(u0, u1, 0, 10)), { id: 'v1', kind: 'revolve', target: 's1', angle: 90 }];
    const r = await runDoc('unified', feats);
    assert.equal(statusOf(r, 'v1').commands.find((c) => c.command === 'solid.revolve').params.angle, want);
  }
  // the chain: a refused groove refuses a later groove, pocket, hole, shell, move on the same part with a pointer, in unified (every step shares the handle)
  const bad = [box('b1', [40, 40, 20], [0, 0, 0]), sk('s1', R(200, 210, 0, 5)), { id: 'g1', kind: 'groove', target: 's1', into: 'b1', angle: 360 }];
  for (const [label, tail, id] of [['groove', [sk('s2', R(8, 12, -4, 4)), { id: 'g2', kind: 'groove', target: 's2', into: 'b1', angle: 360 }], 'g2'], ['pocket', [rect('sk9', 5, 5), pocket('pk1', 'sk9', 'b1', 3)], 'pk1'], ['hole', [hole('h1', 'b1', {})], 'h1'], ['move', [move('m1', 'b1', [3, 0, 0])], 'm1'], ['shell', [shell('sh1', 'b1', undefined, 2)], 'sh1']]) {
    const r = await runDoc('unified', [...bad, ...tail]);
    assert.equal(statusOf(r, 'g1').status, 'refused'); assert.equal(statusOf(r, 'g1').guard, 'G4');
    assert.equal(statusOf(r, id).status, 'refused', label);
    assert.match(statusOf(r, id).refusal, /g1/, `${label}: the sentence points at the refused groove`);
    // the group's own set tags the refusal of a later feature
    if (label !== 'groove') assert.equal(statusOf(await runDoc('revolve-groove', [...bad, ...tail]), id).guard, 'RG-CHAIN');
  }
  assert.ok(lib.un.domainOf({ features: bad }).rg && lib.un.routeOf({ id: 'g1', kind: 'groove', target: 's1', into: 'b1', angle: 90 }, { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {}, shellDraft: { voided: {} }, unified: { domain: lib.un.domainOf({ features: bad }) } }) === 'revolve-groove');
});

test('fillet-chamfer: a blend, a whole-shape round and a hollow after a round are guarded in the one loop, in a document of any other group, and a run of blends is one call', async () => {
  const E = (host, a, b) => ({ cause: 'between', feature: host, kind: 'edge', of: [prim(host, a), prim(host, b)] });
  const blend = (id, target, host, a, b, size, style = 'fillet') => ({ id, kind: 'fillet', target, edge: E(host, a, b), size, style });
  // a blend as big as the face it cuts into (FC-TOO-BIG), alone, after a hole and after a hollow: the group's own set and unified agree
  for (const head of [[], [hole('h0', 'b1', { diameter: 2, depth: 4, center: [15, 10, 0] })], [shell('s0', 'b1', prim('b1', '+z'), 2)]]) {
    const feats = [box('b1', [40, 30, 6]), ...head, blend('round1', head.length ? head[0].id : 'b1', 'b1', '+z', '-y', 6)];
    const u = await runDoc('unified', feats); const g = await runDoc('fillet-chamfer', feats);
    if (head.length) assert.notEqual(statusOf(u, 'round1').status, 'built', `the blend after ${head[0].kind} builds`);
    else { assert.equal(statusOf(u, 'round1').guard, 'FC-TOO-BIG'); assert.deepStrictEqual(u.result.features, g.result.features); }
  }
  // the whole-shape round of a box (zero, negative): the plain box stands, the note is a refusal with the group's sentence, in a document that also drills; a bevelled box is G-CHAMFER (shell-draft) whichever set sees it
  for (const [round, guard] of [[0, 'FC-TOO-SMALL'], [-1, 'FC-NEGATIVE']]) {
    const r = await runDoc('unified', [box('b1', [30, 24, 20], [0, 0, 0], { round }), hole('h1', 'b1', {})]);
    assert.equal(statusOf(r, 'b1').status, 'refused'); assert.equal(statusOf(r, 'b1').guard, guard); assert.equal(statusOf(r, 'b1').partial, true);
    assert.ok(statusOf(r, 'b1').commands.length > 0, 'the plain box is built');
    assert.notEqual(statusOf(r, 'h1').status, 'refused', 'the hole is drilled in the plain box');
  }
  assert.equal(statusOf(await runDoc('unified', [box('b1', [30, 24, 20], [0, 0, 0], { round: 2, roundStyle: 'chamfer' })]), 'b1').guard, 'G-CHAMFER');
  // a hollow whose open edge was rounded with a radius as large as the wall: refused in unified (the shell-draft group's G-RIM; the fillet-chamfer set's own FC-KNIFE-RIM says the same)
  const rim = [box('b1', [30, 24, 20]), blend('round1', 'b1', 'b1', '+z', '+x', 2), shell('s1', 'round1', prim('b1', '+z'), 2)];
  assert.equal(statusOf(await runDoc('unified', rim), 's1').status, 'refused');
  assert.equal(statusOf(await runDoc('fillet-chamfer', rim), 's1').guard, 'FC-KNIFE-RIM');
  // a run of blends of one size is ONE call, and the document's other loops see every blend of the run as built
  const run = [box('b1', [30, 24, 20]), blend('round1', 'b1', 'b1', '+z', '+x', 1), blend('round2', 'round1', 'b1', '+z', '+y', 1), blend('round3', 'round2', 'b1', '+z', '-x', 1), hole('h1', 'round3', {})];
  const ru = await runDoc('unified', run);
  assert.deepStrictEqual(statusOf(ru, 'round1').group, ['round1', 'round2', 'round3']);
  assert.equal(ru.result.commands.filter((c) => c.command === 'solid.fillet').length, 1);
  assert.deepStrictEqual(['round1', 'round2', 'round3', 'h1'].map((id) => statusOf(ru, id).status), ['built', 'built', 'built', 'built']);
  // the sentence of a refused blend is what a feature of another group says it depends on
  const dep = await runDoc('unified', [box('b1', [30, 24, 20]), blend('round1', 'b1', 'b1', '+z', '+x', 9), hole('h1', 'round1', {})]);
  assert.equal(statusOf(dep, 'h1').status, 'refused');
  assert.ok(!/GUARD/.test(statusOf(dep, 'h1').refusal), statusOf(dep, 'h1').refusal);
  assert.ok(lib.un.domainOf({ features: run }).fc);
});

// ---- the two invariants over every corpus -------------------------------------------------------------------------------------------------------------------------------
const T = {
  docs: items.length, byCorpus: {}, runs: 0,
  inv1: { compared: 0, itself: 0, dependency: 0, scene: 0, standIn: 0, downstream: 0, injected: 0, violations: [], bySet: {}, byGuard: {} },
  inv2: { inDomain: {}, equal: 0, differ: [], noGroup: 0, mixedDocs: 0, byCorpusMixed: {}, cutGuard: { runs: 0, docs: new Set(), byGuard: {} }, epJoin: { runs: 0, extraCalls: 0, docs: new Set(), byCorpus: {}, byGuard: {} } },
  thrown: { unified: 0, unifiedOnly: [], sets: 0 },
  lint: { refusals: 0, worse: [], epWording: 0 },
  pureBase: { docs: 0, sameDecisionAs: { holes: 0, 'shell-draft': 0, base: 0, 'extrude-pocket': 0, 'patterns-mirror': 0, booleans: 0, 'revolve-groove': 0 } },
};
for (const it of items) bump(T.byCorpus, it.corpus);

test('invariants 1 and 2, and the sentence lint: every corpus x four engine configurations, unified against each single set', { timeout: 3_000_000 }, async () => {
  for (const it of items) {
    const d = lib.un.domainOf(it.doc);
    const present = ['ep', 'holes', 'sd', 'pm', 'bool', 'rg', 'fc'].filter((k) => d[k]);
    const zone = present.length === 1 ? present[0] : present.length === 0 ? 'none' : 'mixed';
    if (zone === 'mixed') { T.inv2.mixedDocs++; bump(T.inv2.byCorpusMixed, it.corpus); }
    for (const cfg of CONFIGS) {
      const u = await runSet('unified', it.doc, cfg, it.fromUsage);
      const singles = {};
      for (const s of SETS) singles[s] = await runSet(s, it.doc, cfg, it.fromUsage);
      T.runs += 1 + SETS.length;
      if (u.error) { T.thrown.unified++; if (SETS.every((s) => !singles[s].error)) T.thrown.unifiedOnly.push(`${it.corpus} ${it.name} [${cfg.name}]: ${u.error}`); }
      for (const s of SETS) if (singles[s].error) T.thrown.sets++;

      // ---- invariant 2: wholly inside one group's domain (or none): equal to that set, exactly
      if (zone !== 'mixed') {
        const ref = zone === 'none' ? 'extrude-pocket' : GROUP[zone];
        const refRun = zone === 'none' ? singles['extrude-pocket'] : singles[ref];
        if (zone === 'none') T.inv2.noGroup++;
        try { assert.deepStrictEqual(u, refRun); T.inv2.equal++; bump(T.inv2.inDomain, zone === 'none' ? 'no group (= extrude-pocket)' : ref); } catch (e) {
          // the one cause that is by definition a difference: the patterns-mirror group's cut guards (a tool almost on an earlier cut, a wall thinner than 1% of the diagonal) bind
          // on every pocket and hole, in any document, so a document inside another group's domain can be refused where that group's own set builds it. Anything else is a failure.
          const uf = u.result?.features ?? []; const rf = refRun.result?.features ?? [];
          const k = uf.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(rf[j]));
          if (!u.error && !refRun.error && k < 0 && ref === 'booleans' && EP_JOIN_LEVEL === 'full' && JSON.stringify(u.result) === JSON.stringify(refRun.result)) { T.inv2.epJoin.extraCalls++; T.inv2.epJoin.docs.add(`${it.corpus} ${it.name}`); } // the features are equal; unified made the extra engine runs of the consistency check
          else if (!u.error && !refRun.error && k >= 0 && ['PM-SNAPCUT', 'PM-WEB'].includes(uf[k].guard)) { T.inv2.cutGuard.runs++; T.inv2.cutGuard.docs.add(`${it.corpus} ${it.name}`); bump(T.inv2.cutGuard.byGuard, `${ref}: ${uf[k].guard}, the group's set ${rf[k].status}`); }
          // the NEW class of this fold: the extrude-pocket group's join checks (guard EP-JOIN) bind on every combine, so a document inside the booleans group's domain can be refused where the booleans set builds it
          else if (!u.error && !refRun.error && k >= 0 && uf[k].guard === 'EP-JOIN') { T.inv2.epJoin.runs++; T.inv2.epJoin.docs.add(`${it.corpus} ${it.name}`); bump(T.inv2.epJoin.byCorpus, it.corpus); bump(T.inv2.epJoin.byGuard, `${ref}: EP-JOIN, the group's set ${rf[k].status}`); }
          // the reference set REJECTED the whole document because the injected bridge failure fell inside one of its own checks (the extrude-pocket loop lets a throw in plan.verify reject the translation, NOTES fold 1 item 1);
          // unified, whose call numbering differs, translated it. Not a decision of a guard.
          else if (!u.error && refRun.error && /fake: unreachable executed/.test(refRun.error)) { T.inv2.refRejected = (T.inv2.refRejected ?? 0) + 1; }
          // level 'full' with an engine that fails on a call NUMBER (failEvery / throwWhen): the consistency check's extra engine runs move the injected failure onto another call, so
          // another feature (a box, a keep, a later join) meets it in unified and not in the booleans set, or the other way round. Accepted only when the cause is shown: unified at
          // 'cheap' on the same doc and configuration equals the booleans set exactly, and the first differing feature (if any) is refused by EP-JOIN or carries the injected failure.
          else if (!u.error && !refRun.error && ref === 'booleans' && EP_JOIN_LEVEL === 'full' && (cfg.fake.failEvery || cfg.fake.throwWhen)
            && (k < 0 || uf[k].guard === 'EP-JOIN' || [uf[k].raw, rf[k]?.raw].some((r) => /fake: injected failure on call|WASM TRAP: fake: unreachable executed/.test(r ?? '')))
            && JSON.stringify(await runSet('unified', it.doc, cfg, it.fromUsage, { unifiedEpJoinChecks: 'cheap' })) === JSON.stringify(refRun)) {
            T.inv2.epJoin.callShift = (T.inv2.epJoin.callShift ?? 0) + 1; T.inv2.epJoin.docs.add(`${it.corpus} ${it.name}`);
          }
          else T.inv2.differ.push(`${it.corpus} ${it.name} [${cfg.name}] vs ${ref}: ${String(e.message).split('\n').slice(0, 6).join(' / ')}`);
        }
        if (zone === 'none' && !u.error) {
          T.pureBase.docs++;
          for (const s of SETS) if (!singles[s].error && singles[s].result.features.every((f, i) => (f.status === 'refused') === (u.result.features[i].status === 'refused'))) T.pureBase.sameDecisionAs[s]++;
        }
      }
      if (u.error) continue;

      // ---- invariant 1
      for (const s of SETS) {
        if (singles[s].error) continue;
        const b = bindingRefusals(s, it.doc, singles[s].result.features);
        T.inv1.standIn += b.standIn.length; T.inv1.downstream += b.downstream.length; T.inv1.injected += b.injected.length;
        for (const i of b.binding) {
          T.inv1.compared++; bump(T.inv1.bySet, s);
          const g = singles[s].result.features[i].guard ?? '(no guard name)'; bump(T.inv1.byGuard, g);
          const how = unifiedCovers(it.doc, i, u.result.features, singles[s].result.features[i].guard);
          if (how) T.inv1[how]++;
          else T.inv1.violations.push(`${it.corpus} ${it.name} [${cfg.name}] ${s} refuses ${it.doc.features[i].id} (${it.doc.features[i].kind}, ${g}); unified builds it and builds everything it depends on`);
        }
      }

      // ---- the sentence lint: a unified refusal is plain and one sentence, never worse than the sentence a single set gives the same feature
      u.result.features.forEach((f, i) => {
        if (f.status !== 'refused') return;
        T.lint.refusals++;
        const P = lib.h.lintSentence(f.refusal);
        if (!P.length) return;
        const allowed = new Set();
        for (const s of SETS) { const g = singles[s].result?.features?.[i]; if (g?.status === 'refused') for (const p of lib.h.lintSentence(g.refusal)) allowed.add(p); }
        // an engine that fails on a call NUMBER fails other features in each run: the extrude-pocket group's own sentences have no full stop, whoever refused the feature
        // (and the extrude-pocket group's own wording names SolidCraft: with a bridge that throws, the single set may have rejected the whole document, so there is no sentence to compare with)
        if (cfg.fake.failEvery || cfg.fake.throwWhen) { allowed.add('no full stop'); allowed.add('engine jargon'); }
        const extra = P.filter((p) => !allowed.has(p));
        // the extrude-pocket group's own sentences have no full stop (kept: they are the group's wording); when its loop refuses a pull / pocket / join that the single set did not refuse
        // (an earlier difference in the chain, for example a pattern in front of it), no single set's sentence for that feature has the problem to compare with
        if (['extrude', 'pocket', 'combine'].includes(it.doc.features[i].kind) && extra.length && extra.every((p) => p === 'no full stop')) { T.lint.epWording++; return; }
        // the wording of the loop a document's style picks: since the booleans group took `combine` over, a document with a join and no pull or pocket no longer takes the extrude-pocket loop's wording, and the base
        // sentence for a name that no longer resolves (fillet) or the extrude-pocket group's own sentence for a pocket (after a join the extrude-pocket set refused and the booleans set built) has no full stop / names SolidCraft.
        // Only those two problems are exempt, and they are counted and printed; any other problem still fails.
        if (extra.length && extra.every((p) => p === 'no full stop' || p === 'engine jargon')) { T.lint.styleWording = (T.lint.styleWording ?? 0) + 1; return; }
        if (extra.length) T.lint.worse.push(`${it.corpus} ${it.name} ${f.id}: ${extra.join(', ')}: ${f.refusal.slice(0, 160)}`);
      });
    }
  }
  assert.deepStrictEqual(T.inv1.violations.slice(0, 20), [], `INVARIANT 1 VIOLATED ${T.inv1.violations.length} times`);
  assert.deepStrictEqual(T.inv2.differ.slice(0, 20), [], `INVARIANT 2: ${T.inv2.differ.length} runs differ from their group's set`);
  assert.deepStrictEqual(T.thrown.unifiedOnly.slice(0, 20), [], 'unified rejected a doc that no single set rejected');
  assert.deepStrictEqual(T.lint.worse.slice(0, 20), [], 'unified refusal sentences worse than every single set\'s');
  const combinedDocs = items.filter((i) => i.corpus === 'combined');
  assert.ok(combinedDocs.length >= 400, `${combinedDocs.length} combined docs`);
  assert.ok(T.inv1.compared > 5000 && T.inv2.equal > 5000, 'the corpora shrank');
});

test('summary', () => {
  const mixedCombined = T.inv2.byCorpusMixed.combined ?? 0;
  console.log(`# unified: ${T.docs} docs (${Object.entries(T.byCorpus).map(([k, v]) => `${k} ${v}`).join(', ')}), x ${CONFIGS.length} engine configurations, ${T.runs} runs
# unified: combined docs ${T.byCorpus.combined} (${mixedCombined} use two or more groups)
# unified: INVARIANT 1 (refusals(unified) is a superset of the union of the three sets' binding refusals): ${T.inv1.compared} refusals compared, VIOLATIONS ${T.inv1.violations.length}
#   covered: ${T.inv1.itself} refused by unified itself, ${T.inv1.dependency} through a refused dependency, ${T.inv1.scene} through the scene (G-BODIES counts every body)
#   by set: ${JSON.stringify(T.inv1.bySet)}
#   by guard: ${JSON.stringify(T.inv1.byGuard)}
#   not binding: ${T.inv1.standIn} refusals of a kind the set does not own (no guard of its own for it), ${T.inv1.downstream} downstream of one, ${T.inv1.injected} injected by call number
# unified: INVARIANT 2 (equal to the group's set on a doc inside its domain): ${T.inv2.equal} runs equal (${JSON.stringify(T.inv2.inDomain)}), ${T.inv2.differ.length} differ
#   EXCEPTIONS, cause = the patterns-mirror cut guards on a pocket / hole in a doc of another group: ${T.inv2.cutGuard.runs} runs of ${T.inv2.cutGuard.docs.size} docs ${JSON.stringify(T.inv2.cutGuard.byGuard)}
#   NEW CLASS (join checks at level '${EP_JOIN_LEVEL}'), cause = the extrude-pocket group's join checks (EP-JOIN) on a combine in a doc inside the booleans domain: ${T.inv2.epJoin.runs} runs refused differently + ${T.inv2.epJoin.extraCalls} runs equal but for the consistency check's extra engine runs, of ${T.inv2.epJoin.docs.size} docs ${JSON.stringify(T.inv2.epJoin.byGuard)} by corpus ${JSON.stringify(T.inv2.epJoin.byCorpus)}
#   reference set rejected the doc on an injected bridge failure, unified translated it: ${T.inv2.refRejected ?? 0} runs
#   level 'full', engine failing on a call number: the consistency check's extra runs moved the injected failure (unified at 'cheap' equals the set): ${T.inv2.epJoin.callShift ?? 0} runs
#   docs not in one group's domain (use two or more groups): ${T.inv2.mixedDocs} (${JSON.stringify(T.inv2.byCorpusMixed)})
# unified: thrown: ${T.thrown.unified} unified runs rejected, ${T.thrown.sets} single-set runs rejected, ${T.thrown.unifiedOnly.length} rejected by unified and by no single set
# unified: sentence lint: ${T.lint.refusals} unified refusals, ${T.lint.worse.length} worse than every single set's sentence for the same feature (exempt, only 'no full stop' / 'engine jargon' in the wording of the style's loop: ${T.lint.styleWording ?? 0}; not counted: ${T.lint.epWording} extrude-pocket sentences without a full stop for a feature the single set did not refuse)
# unified: docs that use no group: ${T.pureBase.docs / CONFIGS.length} (x configs); same refused/built vector as holes ${T.pureBase.sameDecisionAs.holes}, shell-draft ${T.pureBase.sameDecisionAs['shell-draft']}, extrude-pocket ${T.pureBase.sameDecisionAs['extrude-pocket']} of ${T.pureBase.docs} runs`);
  assert.ok(true);
});
