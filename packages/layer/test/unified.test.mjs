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
import { loadCorpora, runSet, CONFIGS, SETS, TR, lib, bindingRefusals, unifiedCovers } from './unified-harness.mjs';
import { combinedDoc } from './unified-docs.mjs';
import { box, shell, move, rotate, hole, pocket, rect, combine, prim } from './docs.mjs';

const GROUP = { ep: 'extrude-pocket', holes: 'holes', sd: 'shell-draft', pm: 'patterns-mirror' };
const items = await loadCorpora({ combined: 600 });
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

test('createTranslator: unified exists, is not a member of a composition, the default stays base, the single sets are unchanged', () => {
  const U = lib.tr.createTranslator({ planners: 'unified' });
  assert.equal(U.planners, 'unified');
  assert.equal(lib.tr.createTranslator().planners, 'base');
  assert.deepStrictEqual(Object.keys(lib.tr.PROFILES), ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror']);
  assert.throws(() => lib.tr.createTranslator({ planners: ['unified', 'holes'] }), /not composed/);
  assert.throws(() => lib.tr.createTranslator({ planners: ['holes', 'unified'] }), /not composed/);
  // a hole, a shell and a draft are planned asynchronously by the loop: planFeature cannot do it synchronously and must not fall back to the unguarded planner
  assert.throws(() => U.planFeature({ id: 'h1', kind: 'hole', target: 'b1', diameter: 2, depth: 5, center: [0, 0, 0], axis: 'z' }, { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} }, { arc: lib.arc, runSC: () => ({ ok: true }), resolve: () => null }), /plans a hole asynchronously/);
});

// ---- the guards the compositions lose, one by one (constructed docs) -----------------------------------------------------------------------------------------
async function runDoc(set, features, cfg = CONFIGS[0]) { return runSet(set, { version: 1, features }, cfg); }
const statusOf = (r, id) => r.result.features.find((f) => f.id === id);

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

// ---- the two invariants over every corpus -------------------------------------------------------------------------------------------------------------------------------
const T = {
  docs: items.length, byCorpus: {}, runs: 0,
  inv1: { compared: 0, itself: 0, dependency: 0, scene: 0, standIn: 0, downstream: 0, injected: 0, violations: [], bySet: {}, byGuard: {} },
  inv2: { inDomain: {}, equal: 0, differ: [], noGroup: 0, mixedDocs: 0, byCorpusMixed: {}, cutGuard: { runs: 0, docs: new Set(), byGuard: {} } },
  thrown: { unified: 0, unifiedOnly: [], sets: 0 },
  lint: { refusals: 0, worse: [], epWording: 0 },
  pureBase: { docs: 0, sameDecisionAs: { holes: 0, 'shell-draft': 0, base: 0, 'extrude-pocket': 0, 'patterns-mirror': 0 } },
};
for (const it of items) bump(T.byCorpus, it.corpus);

test('invariants 1 and 2, and the sentence lint: every corpus x four engine configurations, unified against each single set', { timeout: 3_000_000 }, async () => {
  for (const it of items) {
    const d = lib.un.domainOf(it.doc);
    const present = ['ep', 'holes', 'sd', 'pm'].filter((k) => d[k]);
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
          if (!u.error && !refRun.error && k >= 0 && ['PM-SNAPCUT', 'PM-WEB'].includes(uf[k].guard)) { T.inv2.cutGuard.runs++; T.inv2.cutGuard.docs.add(`${it.corpus} ${it.name}`); bump(T.inv2.cutGuard.byGuard, `${ref}: ${uf[k].guard}, the group's set ${rf[k].status}`); }
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
        if (cfg.fake.failEvery) allowed.add('no full stop');
        const extra = P.filter((p) => !allowed.has(p));
        // the extrude-pocket group's own sentences have no full stop (kept: they are the group's wording); when its loop refuses a pull / pocket / join that the single set did not refuse
        // (an earlier difference in the chain, for example a pattern in front of it), no single set's sentence for that feature has the problem to compare with
        if (['extrude', 'pocket', 'combine'].includes(it.doc.features[i].kind) && extra.length && extra.every((p) => p === 'no full stop')) { T.lint.epWording++; return; }
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
#   docs not in one group's domain (use two or more groups): ${T.inv2.mixedDocs} (${JSON.stringify(T.inv2.byCorpusMixed)})
# unified: thrown: ${T.thrown.unified} unified runs rejected, ${T.thrown.sets} single-set runs rejected, ${T.thrown.unifiedOnly.length} rejected by unified and by no single set
# unified: sentence lint: ${T.lint.refusals} unified refusals, ${T.lint.worse.length} worse than every single set's sentence for the same feature (not counted: ${T.lint.epWording} extrude-pocket sentences without a full stop for a feature the single set did not refuse)
# unified: docs that use no group: ${T.pureBase.docs / CONFIGS.length} (x configs); same refused/built vector as holes ${T.pureBase.sameDecisionAs.holes}, shell-draft ${T.pureBase.sameDecisionAs['shell-draft']}, extrude-pocket ${T.pureBase.sameDecisionAs['extrude-pocket']} of ${T.pureBase.docs} runs`);
  assert.ok(true);
});
