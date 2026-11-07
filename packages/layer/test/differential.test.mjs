// DIFFERENTIAL TEST: the ORIGINAL spike translator (docs/spikes/solidcraft-referee/phase7/pane/lib/*.mjs, untouched) against
// the compiled TypeScript port (dist/). Both are fed the same ModelDocs through the same deterministic FAKE engine
// (test/fake-engine.mjs, no kernel, no wasm) and must produce IDENTICAL output: the full translateDoc result (features,
// commands, refusals, evidence, internal state), the ctx.soups side channel, and the exact sequence of engine calls.
// Equivalence is shown only for what this test feeds in; see README.md for what that does not cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs, generatedDoc, SOUPS } from './docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const spike = path.join(root, 'docs/spikes/solidcraft-referee/phase7/pane');
const imp = (p) => import(pathToFileURL(p).href);

const orig = {
  tr: await imp(path.join(spike, 'lib/translate-p4.mjs')),
  sm: await imp(path.join(spike, 'lib/sketch-map.mjs')),
  rn: await imp(path.join(spike, 'lib/resolve-names.mjs')),
  rc: await imp(path.join(spike, 'lib/rule-check.mjs')),
};
const port = {
  tr: await imp(path.join(here, '../dist/translate.js')),
  sm: await imp(path.join(here, '../dist/sketch-map.js')),
  rn: await imp(path.join(here, '../dist/resolve-names.js')),
  rc: await imp(path.join(here, '../dist/rule-check.js')),
  index: await imp(path.join(here, '../dist/index.js')),
};
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));
const { install, withPreamble } = await imp(path.join(spike, 'lib/friendly-sketch.mjs'));
install(globalThis);

// ---- the doc corpus --------------------------------------------------------------------------------------------
const examples = JSON.parse(fs.readFileSync(path.join(spike, 'examples.json'), 'utf8'));
const exampleDocs = []; // [name, doc]
const exampleSkipped = [];
for (const e of examples) {
  if (e.doc) { exampleDocs.push([`example ${e.id} (doc)`, solveDoc(structuredClone(e.doc))]); continue; }
  if (typeof e.script === 'string') {
    const r = runScript(withPreamble(e.script));
    if (r.errors.length) { exampleSkipped.push([e.id, r.errors[0].message]); continue; } // the script is a misuse example; no doc exists
    exampleDocs.push([`example ${e.id} (script)`, solveDoc(r.doc)]);
  }
}
const hand = handDocs();
const generated = Array.from({ length: 160 }, (_, i) => [`generated seed ${1000 + i}`, generatedDoc(1000 + i)]);
const extraDocs = [...hand, ...generated];

const CONFIGS = [
  { name: 'failEvery 0, mt', failEvery: 0, useMt: true },
  { name: 'failEvery 4, no mt', failEvery: 4, useMt: false },
  { name: 'no topologyOf', failEvery: 0, useMt: true, topo: 'none' },
  { name: 'topologyOf throws, failEvery 3', failEvery: 3, useMt: true, topo: 'throws' },
];

// ---- running ---------------------------------------------------------------------------------------------------
async function run(impl, doc, cfg) {
  const fake = makeFake({ failEvery: cfg.failEvery });
  const soups = {};
  const topologyOf = cfg.topo === 'none' ? undefined : cfg.topo === 'throws' ? async () => { throw new Error('fake: topology down'); } : fake.topologyOf;
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, runSC: fake.runSC, ...(topologyOf ? { topologyOf } : {}), soups, ...(cfg.useMt ? { mt } : {}) };
  let result; let error = null;
  try { result = await impl.translateDoc(structuredClone(doc), ctx); } catch (e) { error = `${e?.constructor?.name}: ${e?.message}`; }
  return { result, error, soups, log: fake.log, ctx };
}

const tally = { cases: 0, identical: 0, built: 0, refused: 0, noop: 0, kinds: new Set(), kindsBuilt: new Set(), refusalKinds: new Set(), withEvidence: 0, withSoups: 0, thrown: 0 };

async function compareDoc(name, doc, cfg) {
  const a = await run(orig.tr, doc, cfg);
  const b = await run(port.tr, doc, cfg);
  tally.cases++;
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.soups, a.soups, `${name} [${cfg.name}]: ctx.soups differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  tally.identical++;
  if (a.error) tally.thrown++;
  for (const f of a.result?.features ?? []) {
    tally[f.status]++;
    tally.kinds.add(f.kind);
    if (f.status === 'built') tally.kindsBuilt.add(f.kind);
    if (f.status === 'refused') tally.refusalKinds.add(f.kind);
    if (f.evidence) tally.withEvidence++;
  }
  if (Object.keys(a.soups).length) tally.withSoups++;
  return { a, b };
}

const kept = new Map(); // name -> {doc, tr}  for the resolveAfter checks

test('FEATURE_KINDS is the same list', () => {
  assert.deepStrictEqual(port.tr.FEATURE_KINDS, orig.tr.FEATURE_KINDS);
  assert.deepStrictEqual(port.index.FEATURE_KINDS, orig.tr.FEATURE_KINDS);
  assert.equal(orig.tr.FEATURE_KINDS.length, 23);
});

test('every example (doc or script) is translated identically', async () => {
  assert.ok(exampleDocs.length >= 40, `only ${exampleDocs.length} example docs`);
  for (const [name, doc] of exampleDocs) for (const cfg of CONFIGS) {
    const { a } = await compareDoc(name, doc, cfg);
    if (cfg === CONFIGS[0]) kept.set(name, { doc, tr: a.result, ctx: a.ctx });
  }
});

test('hand-written docs are translated identically', async () => {
  assert.ok(hand.length >= 40, `only ${hand.length} hand-written docs`);
  for (const [name, doc] of hand) for (const cfg of CONFIGS) {
    const { a } = await compareDoc(name, doc, cfg);
    if (cfg === CONFIGS[0]) kept.set(name, { doc, tr: a.result, ctx: a.ctx });
  }
});

test('generated docs are translated identically', async () => {
  for (const [name, doc] of generated) for (const cfg of CONFIGS) {
    const { a } = await compareDoc(name, doc, cfg);
    if (cfg === CONFIGS[0]) kept.set(name, { doc, tr: a.result, ctx: a.ctx });
  }
});

test('every FEATURE_KIND appears in the corpus, is built somewhere, and every kind is refused somewhere or is a no-op kind', () => {
  const all = new Set(orig.tr.FEATURE_KINDS);
  const inDocs = new Set();
  for (const [, d] of [...exampleDocs, ...extraDocs]) for (const f of d.features) inDocs.add(f.kind);
  for (const k of all) assert.ok(inDocs.has(k), `no doc in the corpus has a '${k}' feature`);
  for (const k of all) {
    if (k === 'datum' || k === 'sketch') { assert.ok(tally.kinds.has(k)); continue; } // staged / no-op kinds
    assert.ok(tally.kindsBuilt.has(k), `kind '${k}' was never BUILT by the fake in any case (only refused): coverage hole`);
  }
  for (const k of ['extrude', 'shell', 'fillet', 'hole', 'pocket', 'combine', 'draft', 'blend', 'move', 'pattern']) assert.ok(tally.refusalKinds.has(k), `kind '${k}' was never refused in any case`);
});

test('the corpus exercises evidence, soups, refusals and engine failures (not a vacuous pass)', () => {
  assert.ok(tally.built > 300, `built ${tally.built}`);
  assert.ok(tally.refused > 150, `refused ${tally.refused}`);
  assert.ok(tally.thrown > 0, 'the throw path (move of a sketch) was not exercised');
  assert.ok(tally.withEvidence > 10, `evidence on ${tally.withEvidence}`);
  assert.ok(tally.withSoups > 5, `soups in ${tally.withSoups}`);
});

test('resolveAfter gives identical answers for every name in the corpus', async () => {
  let count = 0; let okCount = 0;
  for (const [name, { doc, tr, ctx }] of kept) {
    if (!tr) continue;
    const jobs = [];
    for (const f of doc.features) {
      const nm = f.kind === 'shell' ? f.open : f.kind === 'fillet' ? f.edge : f.kind === 'draft' ? f.face : null;
      if (nm && typeof nm === 'object') jobs.push({ nm, want: f.kind === 'fillet' ? 'edge' : 'face', target: f.target ?? null, before: f.id });
    }
    for (const j of jobs) for (const variant of [{ t: j.target, b: j.before }, { t: null, b: null }, { t: j.target, b: null }]) {
      // fresh translation per implementation (resolveAfter reads its own result's _state)
      const cfg = CONFIGS[0];
      const a = await run(orig.tr, doc, cfg), b = await run(port.tr, doc, cfg);
      let ra, rb;
      try { ra = await orig.tr.resolveAfter(a.result, structuredClone(doc), j.nm, a.ctx, j.want, variant.t, variant.b); } catch (e) { ra = `${e?.constructor?.name}: ${e?.message}`; }
      try { rb = await port.tr.resolveAfter(b.result, structuredClone(doc), j.nm, b.ctx, j.want, variant.t, variant.b); } catch (e) { rb = `${e?.constructor?.name}: ${e?.message}`; }
      assert.deepStrictEqual(rb, ra, `${name}: resolveAfter differs`);
      assert.deepStrictEqual(b.log, a.log, `${name}: engine calls differ in resolveAfter`);
      count++; if (ra && ra.ok) okCount++;
      if (count >= 400) break;
    }
    if (count >= 400) break;
  }
  assert.ok(count > 20, `only ${count} resolveAfter comparisons`);
  tally.resolveAfter = { count, ok: okCount };
});

test('resolveAfter without ctx.topologyOf throws/behaves the same', async () => {
  const doc = { version: 1, features: [{ id: 'b1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] }] };
  const name = { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' };
  const outs = [];
  for (const impl of [orig.tr, port.tr]) {
    const fake = makeFake();
    const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, mt, runSC: fake.runSC, topologyOf: fake.topologyOf };
    const tr = await impl.translateDoc(structuredClone(doc), ctx);
    let r; try { r = await impl.resolveAfter(tr, doc, name, { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, mt, runSC: fake.runSC }, 'face', 'b1', null); } catch (e) { r = `${e?.constructor?.name}: ${e?.message}`; }
    outs.push(r);
  }
  assert.deepStrictEqual(outs[1], outs[0]);
});

test('mapSketch, docProfileIndices and checkRules agree on every soup sketch in the corpus (incl. perturbed solves and bad rows)', () => {
  const soupsSeen = [];
  for (const [, d] of [...exampleDocs, ...extraDocs]) for (const f of d.features) if (f.kind === 'sketch' && (f.geoms || f.geom)) soupsSeen.push(f);
  for (const k of Object.keys(SOUPS)) soupsSeen.push(SOUPS[k]());
  assert.ok(soupsSeen.length >= 15, `only ${soupsSeen.length} soup sketches`);
  const frame = (e) => { try { return { v: e() }; } catch (x) { return { thrown: `${x?.constructor?.name}: ${x?.message}` }; } };
  let mapped = 0, refusedMaps = 0, checks = 0;
  for (const sk of soupsSeen) {
    for (const opts of [{}, { name: 'sk_x_1' }, { frame: { origin: [1, 2, 3], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] } }]) {
      const a = frame(() => orig.sm.mapSketch(structuredClone(sk), structuredClone(opts)));
      const b = frame(() => port.sm.mapSketch(structuredClone(sk), structuredClone(opts)));
      assert.deepStrictEqual(b, a, 'mapSketch differs');
      if (a.v?.ok) mapped++; else refusedMaps++;
    }
    assert.deepStrictEqual(frame(() => port.sm.frameOf(sk)), frame(() => orig.sm.frameOf(sk)));
    const geoms = sk.geoms ?? sk.geom ?? [];
    // a profile list whose interiors sit at assorted points (inside and outside the loops)
    const profiles = [[1, 1], [15, 10], [5, 5], [-3, -3], [25, 15], [12, 12], [0.5, 0.5]].map((interior) => ({ interior }));
    assert.deepStrictEqual(frame(() => port.sm.docProfileIndices(profiles, structuredClone(geoms))), frame(() => orig.sm.docProfileIndices(profiles, structuredClone(geoms))), 'docProfileIndices differs');
    // checkRules on the rows as drawn and on deterministically perturbed rows, with and without a start state
    const jig = (g, s) => {
      const c = structuredClone(g); const j = (p) => (Array.isArray(p) ? p.map((v, i) => v + s * (i + 1) * 0.013) : p);
      for (const key of ['a', 'b', 'c', 'p']) if (c[key] && Array.isArray(c[key])) c[key] = j(c[key]);
      if (typeof c.r === 'number') c.r += s * 0.02;
      return c;
    };
    for (const s of [0, 1, -2]) {
      const solved = geoms.map((g) => jig(g, s));
      for (const start of [null, geoms]) {
        const a = frame(() => orig.rc.checkRules(structuredClone(solved), structuredClone(sk.rules ?? []), start && structuredClone(start)));
        const b = frame(() => port.rc.checkRules(structuredClone(solved), structuredClone(sk.rules ?? []), start && structuredClone(start)));
        assert.deepStrictEqual(b, a, 'checkRules differs');
        checks++;
      }
    }
    for (const g of geoms) for (const end of [undefined, 'a', 'b', 'c']) for (const lock of [false, true]) assert.deepStrictEqual(port.rc.pointOf(g, end, lock), orig.rc.pointOf(g, end, lock));
  }
  assert.ok(mapped > 5 && refusedMaps > 5, `mapped ${mapped}, refused ${refusedMaps}`);
  tally.soupChecks = { sketches: soupsSeen.length, mapped, refusedMaps, checks };
});

test('nameText, pickPoint, extrudeCommands agree', () => {
  const names = [
    { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }, { cause: 'swept', feature: 'e1', kind: 'face', from: 'sk1', edge: 2 },
    { cause: 'rounded', feature: 'e1', kind: 'face', from: 'sk1', corner: 1 }, { cause: 'cap', feature: 'e1', kind: 'face', end: 'top' },
    { cause: 'carried', feature: 'c1', kind: 'face', of: { cause: 'primitive', feature: 'b1', kind: 'face', part: '-x' } },
    { cause: 'between', feature: 'b1', kind: 'edge', of: [{ cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' }, { cause: 'cap', feature: 'e1', kind: 'face', end: 'top' }] },
    { cause: 'between', feature: 'b1', kind: 'edge' }, { cause: 'odd', feature: 'q' }, { cause: 'made' }, null, undefined, 'str', 7,
  ];
  for (const n of names) assert.equal(port.rn.nameText(n), orig.rn.nameText(n));
  const hit = (i, d) => ({ index: i, dist: d });
  const faces = [
    { index: 1, centroid: [0, 0, 1], centroid_hit: hit(1, 0) }, { index: 2, centroid: [0, 0, 1], centroid_hit: hit(3, 0) },
    { index: 2, centroid: [0, 0, 1], centroid_hit: hit(3, 0), inner_point: [1, 1, 1], inner_hit: hit(2, 1e-9) },
    { index: 2, centroid: [0, 0, 1], centroid_hit: hit(2, 5) }, { index: 4, centroid: [0, 0, 1] }, { index: 4, centroid: [0, 0, 1], inner_point: [0, 0, 0] },
  ];
  for (const f of faces) for (const tol of [1e-4, 1e-6, 10]) assert.deepStrictEqual(port.rn.pickPoint(f, tol), orig.rn.pickPoint(f, tol));
  const m = { commands: [{ command: 'sketch.create', params: {} }], sketchName: 'k' };
  assert.deepStrictEqual(port.sm.extrudeCommands(m, { height: 4 }), orig.sm.extrudeCommands(m, { height: 4 }));
  assert.deepStrictEqual(port.sm.extrudeCommands(m, { height: 4, body: 'B' }), orig.sm.extrudeCommands(m, { height: 4, body: 'B' }));
});

test('planFeature called directly agrees (state mutation included)', () => {
  const fake = makeFake();
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, mt, runSC: fake.runSC, resolve: () => null };
  const st = () => ({ head: {}, bodies: { b1: ['b_b1'], b2: ['b_b2'] }, stale: { old: 'x' }, refused: { bad: 'was refused' }, sketches: {}, measure: { b1: { bbox: [0, 0, 0, 4, 4, 4] }, b2: { bbox: [-1, -1, -1, 3, 3, 3] } }, counter: 5, accLen: {} });
  const feats = [...hand.flatMap(([, d]) => d.features).slice(0, 80), { id: 'nope', kind: 'nothing' }, { id: 'x', kind: 'box' }];
  for (const f of feats) {
    const sa = st(), sb = st(); let ra, rb;
    try { ra = orig.tr.planFeature(structuredClone(f), sa, ctx); } catch (e) { ra = `${e?.constructor?.name}: ${e?.message}`; }
    try { rb = port.tr.planFeature(structuredClone(f), sb, ctx); } catch (e) { rb = `${e?.constructor?.name}: ${e?.message}`; }
    assert.deepStrictEqual(rb, ra, `planFeature ${f.id}/${f.kind}`);
    assert.deepStrictEqual(sb, sa, `planFeature state ${f.id}/${f.kind}`);
  }
});

test('NEGATIVE CONTROL: the comparison does fail when the two sides are fed different engines', async () => {
  const doc = hand.find(([n]) => n === 'plain-extrude')[1];
  const a = await run(orig.tr, doc, { failEvery: 0, useMt: true });
  const b = await run(port.tr, doc, { failEvery: 1, useMt: true });
  assert.throws(() => assert.deepStrictEqual(b.result, a.result));
  const a2 = await run(orig.tr, hand.find(([n]) => n === 'holes')[1], CONFIGS[0]);
  const tampered = structuredClone(a2.result);
  tampered.features[1].commands[0].params.radius += 1e-9;
  assert.throws(() => assert.deepStrictEqual(tampered, a2.result));
});

test.after(() => {
  const s = tally;
  console.log(`\nDIFFERENTIAL SUMMARY
  docs: ${exampleDocs.length} from examples.json (${exampleSkipped.length} example scripts are misuse cases that fail to run and produce no doc), ${hand.length} hand-written, ${generated.length} generated
  translateDoc cases: ${s.cases} (doc x ${CONFIGS.length} engine configs: ${CONFIGS.map((c) => c.name).join('; ')}), identical: ${s.identical}, threw: ${s.thrown}
  features: built ${s.built}, refused ${s.refused}, noop ${s.noop}; features with resolution evidence: ${s.withEvidence}; cases with soups: ${s.withSoups}
  kinds seen: ${[...s.kinds].sort().join(',')}
  kinds built: ${[...s.kindsBuilt].sort().join(',')}
  kinds refused somewhere: ${[...s.refusalKinds].sort().join(',')}
  resolveAfter comparisons: ${JSON.stringify(s.resolveAfter)}
  sketch helpers: ${JSON.stringify(s.soupChecks)}`);
});
