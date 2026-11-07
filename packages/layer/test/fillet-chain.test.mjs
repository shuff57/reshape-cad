// Named fillets on one connected chain go to the engine as ONE call, in every planner set, with a post-build face count (src/fillet-chain.ts; GUARD-FILLET-CHAIN.md, fix 1).
// No kernel: the deterministic fake engine (fcModel: every edge of a blend adds one face), its topology, and the shell-draft differential's fake primitive-frame resolver.
// TANGENT is a fake kernel that does what the SolidCore probe recorded (SOLIDCORE-PROBE-0.40.0-rc.2.md, fillet-sequence evidence): a blend sent ALONE on an edge that
// touches an edge rounded by an earlier call also rounds the edges it runs tangent into (two more faces, less volume). One call over the touching edges is right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFake } from './fake-engine.mjs';
import { fakeResolveAt } from './fake-resolve-at.mjs';
import { lib } from './unified-harness.mjs';

const NON_FC = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove'];
const ALL = [...NON_FC, 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(ALL.map((p) => [p, lib.tr.createTranslator({ planners: p })]));
const FACE_SENTENCE = (id) => `The round ${id} did not give the part the new face it should, so ${id} is shown without it -- use a smaller size.`; // fc-sentences.ts 'face-count', verbatim

const P = (part) => ({ cause: 'primitive', feature: 'b1', kind: 'face', part });
const between = (a, b) => ({ cause: 'between', feature: 'b1', kind: 'edge', of: [P(a), P(b)] });
const box = { id: 'b1', kind: 'box', size: [40, 30, 10], center: [0, 0, 5] };
const fillet = (id, target, edge, size = 1.5, style = 'fillet') => ({ id, kind: 'fillet', target, edge, size, style });
const SIDES = { front: ['-z', '-y'], back: ['-z', '+y'], left: ['-z', '-x'], right: ['-z', '+x'] };
const MID = { front: [0, -15, 0], back: [0, 15, 0], left: [-20, 0, 0], right: [20, 0, 0] };
const chain = (sides, size = 1.5) => sides.map((s, i) => fillet(`r${i + 1}`, i ? `r${i}` : 'b1', between(...SIDES[s]), Array.isArray(size) ? size[i] : size));

/** the end points of a bottom / side edge of the 40 x 30 x 10 box standing on z = 0, from the point the call sends (its middle) */
const BB = { min: [-20, -15, 0], max: [20, 15, 10] };
function ends(p) {
  const fixed = [0, 1, 2].filter((a) => Math.abs(p[a] - BB.min[a]) < 1e-9 || Math.abs(p[a] - BB.max[a]) < 1e-9);
  const free = [0, 1, 2].find((a) => !fixed.includes(a));
  return [BB.min[free], BB.max[free]].map((v) => p.map((x, a) => (a === free ? v : x)));
}
const touches = (p, q) => ends(p).some((a) => ends(q).some((b) => Math.hypot(...a.map((v, i) => v - b[i])) < 1e-9));
/** TANGENT: a blend sent alone on an edge touching an edge an earlier call rounded adds two more faces and takes 2 mm3 more (the extra rounds). */
function tangent(fake) {
  const runSC = (cmds, ...rest) => {
    const res = fake.runSC(cmds, ...rest);
    if (!res.ok) return res;
    const earlier = []; let extra = 0; let body = null;
    for (const c of cmds) {
      if (c.command !== 'solid.fillet' && c.command !== 'solid.chamfer') continue;
      if (c.params.edges.length === 1 && earlier.some((q) => touches(q, c.params.edges[0]))) { extra += 2; body = c.params.body; }
      earlier.push(...c.params.edges);
    }
    if (!extra) return res;
    return { ...res, measure: { ...res.measure, bodies: res.measure.bodies.map((b) => (b.name === body ? { ...b, faces: b.faces + extra, kernel: { ...b.kernel, faces: b.kernel.faces + extra }, volume_mm3: b.volume_mm3 - extra } : b)) } };
  };
  return { ...fake, runSC };
}

const engineOf = (kind) => { const f = makeFake({ sync: true, fcModel: true }); return kind === 'tangent' ? tangent(f) : f; };
/** path B: the engine's topology (every set); path A: shell-draft's primitive-frame resolver, no topology (the node rig) */
async function run(set, features, { path = 'B', engine = 'plain', extra = {} } = {}) {
  const fake = engineOf(engine);
  const ctx = { arc: lib.arc, mt: lib.mt, runSC: fake.runSC, soups: {}, ...(path === 'B' ? { topologyOf: fake.topologyOf } : { resolveAt: fakeResolveAt }), ...extra };
  const { _state, ...r } = await TR[set].translateDoc({ version: 1, features: structuredClone(features) }, ctx);
  // the patterns-mirror step's wall clock (wallMs) is not compared: two runs of the same doc differ by a millisecond under load
  for (const f of r.features) delete f.wallMs;
  return r;
}
const blends = (r) => r.commands.filter((c) => c.command === 'solid.fillet' || c.command === 'solid.chamfer');
const byId = (r) => Object.fromEntries(r.features.map((f) => [f.id, f]));

test('four bottom fillets (one connected chain) are ONE call in every set, on both pick paths; every member is noted built, in document order', async () => {
  const doc = [box, ...chain(['front', 'back', 'left', 'right'])];
  const cases = [...ALL.map((s) => [s, 'B']), ['shell-draft', 'A']];
  for (const [set, path] of cases) {
    const r = await run(set, doc, { path });
    const b = blends(r);
    assert.equal(b.length, 1, `${set}/${path}: one blend call (${JSON.stringify(b)})`);
    assert.deepEqual(b[0].params.edges, [MID.front, MID.back, MID.left, MID.right], `${set}/${path}: the four edges, in member order`);
    assert.deepEqual(r.features.map((f) => f.id), ['b1', 'r1', 'r2', 'r3', 'r4'], `${set}/${path}: notes in document order`);
    const t = byId(r);
    for (const id of ['r1', 'r2', 'r3', 'r4']) assert.equal(t[id].status, 'built', `${set}/${path} ${id}: ${JSON.stringify(t[id]).slice(0, 300)}`);
    assert.equal(t.r4.measure.faces, 10, `${set}/${path}: 6 faces + 4 blends`);
    assert.equal(t.r4.measure.volume, t.r1.measure.volume, `${set}/${path}: every member measures the same part`);
    if (NON_FC.includes(set)) {
      assert.deepEqual(t.r1.commands, [b[0]], `${set}/${path}: the lead sends the call`);
      for (const id of ['r2', 'r3', 'r4']) { assert.deepEqual(t[id].commands, [], `${set}/${path} ${id}: nothing more is sent`); assert.equal(t[id].pickedFrom, 'one call with r1 (r1, r2, r3, r4)'); }
    }
  }
});

test('the per-edge kernel that rounds tangent edges: one call is right; a blend it still gets alone is caught by the post-build face count', async () => {
  // the chain as one call: the TANGENT kernel builds it right (no edge goes alone after a touching one)
  for (const [set, path] of [...NON_FC.map((s) => [s, 'B']), ['shell-draft', 'A']]) {
    const t = byId(await run(set, [box, ...chain(['front', 'back', 'left', 'right'])], { path, engine: 'tangent' }));
    assert.equal(t.r4.status, 'built', `${set}/${path}`);
    assert.equal(t.r4.measure.faces, 10, `${set}/${path}: no extra round`);
  }
  // before this fix (skipFilletChain): one call per edge, and the TANGENT kernel's extra rounds were built and reported as built
  for (const [set, path] of [...NON_FC.map((s) => [s, 'B']), ['shell-draft', 'A']]) {
    const t = byId(await run(set, [box, ...chain(['front', 'back', 'left', 'right'])], { path, engine: 'tangent', extra: { skipFilletChain: true } }));
    assert.equal(t.r4.status, 'built', `${set}/${path}: the old route built it`);
    assert.ok(t.r4.measure.faces > 10, `${set}/${path}: with the extra rounds (${t.r4.measure.faces} faces)`);
  }
  // touching edges of DIFFERENT sizes are never one call: the second goes alone, the kernel rounds more than it, the face count refuses it with the fillet-chamfer set's sentence
  for (const [set, path] of [...NON_FC.map((s) => [s, 'B']), ['shell-draft', 'A']]) {
    const r = await run(set, [box, ...chain(['front', 'left'], [1.5, 1])], { path, engine: 'tangent' });
    const t = byId(r);
    assert.equal(blends(r).length, 1, `${set}/${path}: only the first was accepted`);
    assert.equal(t.r1.status, 'built', `${set}/${path}`);
    assert.equal(t.r2.status, 'refused', `${set}/${path}: ${JSON.stringify(t.r2).slice(0, 300)}`);
    assert.equal(t.r2.guard, 'FC-FACE-COUNT', `${set}/${path}`);
    if (set !== 'patterns-mirror') assert.equal(t.r2.refusal, FACE_SENTENCE('r2'), `${set}/${path}`);
    else assert.equal(t.r2.refusal, FACE_SENTENCE('r2'), `${set}/${path}: kept as it is by the patterns-mirror step`);
  }
  // on the plain kernel the same two build (each blend adds its one face)
  for (const [set, path] of [...NON_FC.map((s) => [s, 'B']), ['shell-draft', 'A']]) {
    const t = byId(await run(set, [box, ...chain(['front', 'left'], [1.5, 1])], { path }));
    assert.equal(t.r2.status, 'built', `${set}/${path}`);
    assert.equal(t.r2.measure.faces, 8);
  }
});

test('two edges that do not touch stay two calls; a lone fillet is as before; ctx.skipFilletChain is the old route exactly', async () => {
  for (const [set, path] of [...NON_FC.map((s) => [s, 'B']), ['shell-draft', 'A']]) {
    const r = await run(set, [box, ...chain(['front', 'back'])], { path });
    assert.deepEqual(blends(r).map((c) => c.params.edges), [[MID.front], [MID.back]], `${set}/${path}: one call per component`);
    assert.deepEqual(r.features.map((f) => f.status), ['built', 'built', 'built'], `${set}/${path}`);
    const one = await run(set, [box, ...chain(['left'])], { path });
    const old = await run(set, [box, ...chain(['left'])], { path, extra: { skipFilletChain: true } });
    assert.deepEqual(one, old, `${set}/${path}: a lone fillet is unchanged`);
  }
  for (const set of NON_FC) {
    const r = await run(set, [box, ...chain(['front', 'back', 'left', 'right'])], { extra: { skipFilletChain: true } });
    assert.equal(blends(r).length, 4, `${set}: skipFilletChain sends one call per feature`);
  }
});

test('a run that cannot be grouped is planned one by one, as before: the same edge twice, a member that names something else, a bevel among rounds', async () => {
  for (const set of NON_FC) {
    // the same edge twice: grouping would send it twice; one by one the second is refused as before
    const twice = [box, fillet('r1', 'b1', between('-z', '-y')), fillet('r2', 'r1', between('-y', '-z'))];
    assert.deepEqual(await run(set, twice), await run(set, twice, { extra: { skipFilletChain: true } }), `${set}: the same edge twice`);
    // a bevel between two rounds breaks the run (different style): three calls
    const mixed = [box, fillet('r1', 'b1', between(...SIDES.front)), fillet('r2', 'r1', between(...SIDES.left), 1.5, 'chamfer'), fillet('r3', 'r2', between(...SIDES.back))];
    assert.equal(blends(await run(set, mixed)).length, 3, `${set}: a bevel breaks the run`);
    // a member whose edge names faces that do not meet: the run is left ungrouped and that member is refused with its own sentence, as before
    const bad = [box, fillet('r1', 'b1', between(...SIDES.front)), fillet('r2', 'r1', between('-z', '+z'))];
    assert.deepEqual(await run(set, bad), await run(set, bad, { extra: { skipFilletChain: true } }), `${set}: an unresolvable member`);
  }
});

test('the fillet-chamfer and unified sets are untouched: identical with the switch on and off', async () => {
  for (const set of ['fillet-chamfer', 'unified']) {
    for (const doc of [[box, ...chain(['front', 'back', 'left', 'right'])], [box, ...chain(['front', 'left'], [1.5, 1])], [box, ...chain(['front', 'back'])]]) {
      assert.deepEqual(await run(set, doc, { engine: 'tangent' }), await run(set, doc, { engine: 'tangent', extra: { skipFilletChain: true } }), set);
    }
  }
});
