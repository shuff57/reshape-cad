// DIFFERENTIAL TEST for the extrude-pocket fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/translate-ep.mjs, with
// contract/outline-guard.mjs and contract/soup-regions.mjs, all untouched) against the compiled TypeScript port in 'extrude-pocket' mode
// (createTranslator({ planners: 'extrude-pocket' })). Both are fed the same ModelDocs through the same deterministic FAKE engine
// (test/fake-engine.mjs, no kernel, no wasm) and must produce IDENTICAL output: the full translateDoc result, ctx.soups, the ordered list of
// engine calls (so the scratch sessions of the after-the-build checks are compared too) and a thrown error.
//
// This shows the port equals the original on the inputs below. It does NOT show the built solids are right: the fake has no geometry kernel.
// See README.md for what that leaves open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs, SOUPS } from './docs.mjs';
import { epDoc, mulberry32 } from './ep-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const p7 = path.join(root, 'docs/spikes/solidcraft-referee/phase7/pane/lib');
const imp = (p) => import(pathToFileURL(p).href);

const orig = {
  ep: await imp(path.join(contract, 'translate-ep.mjs')),
  og: await imp(path.join(contract, 'outline-guard.mjs')),
  sr: await imp(path.join(contract, 'soup-regions.mjs')),
  p4: await imp(path.join(p7, 'translate-p4.mjs')),
};
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), epm: await dist('extrude-pocket.js'), og: await dist('outline-guard.js'), sr: await dist('soup-regions.js'), t: await dist('translate.js'), index: await dist('index.js') };
const EP = port.tr.createTranslator({ planners: 'extrude-pocket' });
const BASE = port.tr.createTranslator();
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- corpus (a): every case of the group, exactly as extrude-pocket-measure.mjs turns it into a ModelDoc (runScript + solveDoc) --------------
const rows = JSON.parse(fs.readFileSync(path.join(contract, 'ep-results.json'), 'utf8'));
const caseDocs = []; const caseSkipped = [];
for (const c of rows) {
  const r = runScript(c.script);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); continue; }
  caseDocs.push([`case ${c.id}`, solveDoc(r.doc), c.expect]);
}
// ---- corpus (b): generated outlines ---------------------------------------------------------------------------------------------------
const N_GEN = 240;
const generated = Array.from({ length: N_GEN }, (_, i) => [`ep seed ${5000 + i}`, epDoc(5000 + i)]);
// base-kind docs run through the group translator too (the fork also changes dependency wording, 'no usable outline' and 'combine')
const hand = handDocs();

const CONFIGS = [
  { name: 'boxBool, mt', box: true, failEvery: 0, useMt: true },
  { name: 'default fake, mt', box: false, failEvery: 0, useMt: true },
  { name: 'boxBool, every 5th call fails, no mt', box: true, failEvery: 5, useMt: false },
  { name: 'boxBool, skipVerify + unguardedSlant', box: true, failEvery: 0, useMt: true, skipVerify: true, unguardedSlant: true },
];

async function run(impl, doc, cfg) {
  const fake = makeFake({ failEvery: cfg.failEvery, boxBool: cfg.box });
  const soups = {};
  const topologyOf = cfg.topo === 'none' ? undefined : fake.topologyOf;
  const ctx = { arc, runSC: fake.runSC, ...(topologyOf ? { topologyOf } : {}), soups, ...(cfg.useMt ? { mt } : {}), ...(cfg.skipVerify ? { skipVerify: true } : {}), ...(cfg.unguardedSlant ? { unguardedSlant: true } : {}) };
  let result; let error = null;
  try { result = await impl.translateDoc(structuredClone(doc), ctx); } catch (e) { error = `${e?.constructor?.name}: ${e?.message}`; }
  return { result, error, soups, log: fake.log, ctx };
}

const tally = { cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, sentences: new Map(), checks: new Set(), checkOutcomes: { inconclusive: 0, conclusive: 0 }, internal: 0, withSoups: 0, runSCcalls: 0, scratch: 0 };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const shape = (s) => s.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|mv|cmb)\d*\b/g, '$1');

async function compareDoc(name, doc, cfg, A = orig.ep, B = EP) {
  const a = await run(A, doc, cfg);
  const b = await run(B, doc, cfg);
  tally.cases++;
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.soups, a.soups, `${name} [${cfg.name}]: ctx.soups differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  tally.identical++;
  tally.runSCcalls += a.log.length;
  if (a.error) tally.thrown++;
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'refused') { bump(tally.refused, f.kind); const k = shape(f.refusal); tally.sentences.set(k, (tally.sentences.get(k) ?? 0) + 1); }
    if (f.internalError) tally.internal++;
    for (const c of f.checks ?? []) { tally.checks.add(c.check); bump(tally.checkOutcomes, c.inconclusive ? 'inconclusive' : 'conclusive'); }
  }
  if (Object.keys(a.soups).length) tally.withSoups++;
  return { a, b };
}

test('createTranslator: default is base, unknown set throws, FEATURE_KINDS unchanged', () => {
  assert.equal(BASE.planners, 'base');
  assert.equal(port.tr.createTranslator({}).planners, 'base');
  assert.equal(EP.planners, 'extrude-pocket');
  assert.throws(() => port.tr.createTranslator({ planners: 'nope' }), /unknown planner set/);
  assert.deepStrictEqual(EP.FEATURE_KINDS, orig.ep.FEATURE_KINDS);
  assert.equal(port.index.createTranslator, port.tr.createTranslator);
});

test('base mode is still exactly the base translator (createTranslator() and the plain translateDoc) on the hand-written docs', async () => {
  const cfg = { name: 'base check', box: false, failEvery: 0, useMt: true };
  for (const [name, doc] of hand) {
    const a = await run(orig.p4, doc, cfg);
    for (const impl of [BASE, port.t]) {
      const b = await run(impl, doc, cfg);
      assert.deepStrictEqual(b.result, a.result, `${name}: base result differs`);
      assert.deepStrictEqual(b.error, a.error);
      assert.deepStrictEqual(b.log, a.log);
    }
  }
});

test('(a) every case of the group that turns into a ModelDoc is translated identically (all configs)', async () => {
  assert.ok(caseDocs.length >= 400, `only ${caseDocs.length} case docs (${caseSkipped.length} scripts failed to run)`);
  for (const [name, doc] of caseDocs) for (const cfg of CONFIGS) await compareDoc(name, doc, cfg);
});

test('(b) generated outlines (bow-tie, self-touch, folding tapers, tiny sizes, arcs, holes, soups of several loops) are translated identically', async () => {
  assert.ok(generated.length >= 200);
  for (const [name, doc] of generated) for (const cfg of CONFIGS) await compareDoc(name, doc, cfg);
});

test('base-kind docs through the group translator are translated identically', async () => {
  for (const [name, doc] of hand) for (const cfg of CONFIGS.slice(0, 3)) await compareDoc(`hand ${name}`, doc, cfg);
});

test('coverage: the corpus reaches the group paths (not a vacuous pass)', () => {
  const s = [...tally.sentences.keys()].join('\n');
  const has = (re, what) => assert.ok(re.test(s), `no refusal for: ${what}`);
  assert.ok((tally.built.extrude ?? 0) > 300, `built extrude ${tally.built.extrude}`);
  assert.ok((tally.built.pocket ?? 0) > 100, `built pocket ${tally.built.pocket}`);
  assert.ok((tally.built.combine ?? 0) > 20, `built combine ${tally.built.combine}`);
  assert.ok((tally.refused.extrude ?? 0) > 100 && (tally.refused.pocket ?? 0) > 50);
  for (const k of ['cut-consistency', 'join-contact', 'join-consistency']) assert.ok(tally.checks.has(k), `check ${k} never ran`);
  assert.ok(tally.checkOutcomes.conclusive > 20, 'conclusive checks');
  has(/cross each other/, 'bow-tie');
  has(/touch each other/, 'self-touch');
  has(/fold over itself/, 'folding taper');
  has(/too small to build/, 'tiny size');
  has(/is flat/, 'flat outline');
  has(/does not touch the part/, 'pocket touches nothing');
  has(/sealed cavity/, 'sealed void');
  has(/do not add up/, 'cut consistency');
  has(/direction is only built for one plain outline/, 'slant on a soup');
  has(/separate shapes, more than/, 'shape cap');
  has(/two shapes in sketch .* cross or touch/, 'soup shapes touch');
  has(/has no usable outline|two corners on the very same spot|is flat/, 'no outline');
  has(/its target|its sketch|its solid/, 'dependency wording');
  has(/through together with length/, 'through + length2');
  has(/a taper and a direction together/, 'taper + direction');
  assert.ok(tally.withSoups > 30, `soups ${tally.withSoups}`);
  assert.ok(tally.internal > 0, 'internalError path (planner threw) never reached');
});

test('planFeature in extrude-pocket mode agrees on direct calls, state mutation included (verify closures compared as present/absent)', () => {
  const fake = makeFake({ boxBool: true });
  const ctx = { arc, mt, runSC: fake.runSC, resolve: () => null };
  const scene = [{ name: 'b_b1', vol: 4000, bbox: [-10, -10, -5, 10, 10, 5], shells: 1 }, { name: 'b_b2', vol: 10, bbox: [0, 0, 0, 1, 1, 10], shells: 1 }];
  const mk = (withEp) => ({ head: {}, bodies: { b1: ['b_b1'], b2: ['b_b2'], e0: ['b_e0'] }, stale: { old: 'x' }, refused: { bad: 'm: was refused' }, sketches: {}, measure: { b1: { volume: 4000, faces: 6, shells: 1, bodies: ['b_b1'], bbox: [-10, -10, -5, 10, 10, 5] }, b2: { bbox: [-1, -1, -1, 3, 3, 3] } }, counter: 5, accLen: {}, ...(withEp ? { scene: structuredClone(scene), curvedSlant: new Set(['b_e0']) } : {}) });
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? '[fn]' : x instanceof Set ? [...x] : x === undefined ? '[undef]' : x)));
  let n = 0;
  const docs = [...generated.slice(0, 120).map(([, d]) => d), ...hand.map(([, d]) => d)];
  for (const d of docs) for (const f of d.features) {
    if (f.kind === 'sketch') continue;
    for (const withEp of [true, false]) {
      const sa = mk(withEp), sb = mk(withEp);
      for (const s of [sa, sb]) { for (const g of d.features) if (g.kind === 'sketch') s.sketches[g.id] = structuredClone(g); }
      let ra, rb;
      const into = f.kind === 'pocket' ? { ...f, into: 'b1' } : f;
      try { ra = orig.ep.planFeature(structuredClone(into), sa, ctx); } catch (e) { ra = `${e?.constructor?.name}: ${e?.message}`; }
      try { rb = EP.planFeature(structuredClone(into), sb, ctx); } catch (e) { rb = `${e?.constructor?.name}: ${e?.message}`; }
      assert.deepStrictEqual(strip(rb), strip(ra), `planFeature ${f.id}/${f.kind}`);
      assert.deepStrictEqual(strip(sb), strip(sa), `planFeature state ${f.id}/${f.kind}`);
      if (ra && typeof ra === 'object' && ra.verify) assert.equal(typeof rb.verify, 'function');
      n++;
    }
  }
  assert.ok(n > 300, `only ${n} direct plans`);
});

// ---- the pure guards, no engine at all: original .mjs against the port, same inputs -------------------------------------------------------
function attempt(fn) { try { return { v: fn() }; } catch (e) { return { thrown: `${e?.constructor?.name}: ${e?.message}` }; } }

test('outline-guard: original and port take identical decisions on generated outlines (incl. arcs, folds, bow-ties, tiny sizes, thrown errors)', () => {
  assert.equal(port.og.GAP, orig.og.GAP); assert.equal(port.og.MIN_LEN, orig.og.MIN_LEN); assert.equal(port.og.MIN_ROUND, orig.og.MIN_ROUND); assert.equal(port.og.TOUCH, orig.og.TOUCH);
  // outlines: every plain sketch of the corpus through the library's outlineOf, plus raw random polygons with bulges
  const outlines = [];
  for (const [, d] of [...generated, ...hand, ...caseDocs]) for (const f of d.features) {
    if (f.kind !== 'sketch' || (f.geoms && f.geoms.length)) continue;
    const o = arc.outlineOf(f);
    if (o.ok) outlines.push({ ...o, shape: f.shape });
  }
  const r = mulberry32(77);
  for (let i = 0; i < 300; i++) {
    const n = 3 + Math.floor(r() * 7); const R = 1 + r() * 30;
    const pts = Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n + (r() - 0.5) * (r() < 0.3 ? 3 : 0.4); const q = R * (0.3 + r()); return [q * Math.cos(a), q * Math.sin(a)]; });
    const bulges = {}; for (let k = 0; k < n; k++) if (r() < 0.35) bulges[k] = (r() - 0.5) * 3;
    outlines.push({ ok: true, points: pts, bulges, shape: undefined });
    if (r() < 0.1) outlines.push({ ok: true, points: [[0, 0], [R, 0]], shape: 'circle' });
  }
  assert.ok(outlines.length >= 400, `${outlines.length} outlines`);
  const ds = [0, 0.01, -0.01, 0.5, -0.5, 2, -2, 6, -6, 15, -15, 80, -80];
  const stat = { cross: 0, touch: 0, fold: 0, clean: 0, foldKinds: new Set() };
  for (const o of outlines) {
    const c = (f) => assert.deepStrictEqual(attempt(() => f(port.og)), attempt(() => f(orig.og)));
    c((g) => g.sampleOutline(o, arc));
    c((g) => g.outlineSize(o, arc));
    const t = attempt(() => orig.og.selfTouch(o, arc));
    c((g) => g.selfTouch(o, arc));
    if (t.v === 'cross') stat.cross++; else if (t.v === 'touch') stat.touch++; else stat.clean++;
    const sm = attempt(() => orig.og.sampleOutline(o, arc));
    if (sm.v) {
      c((g) => g.selfClearance(g === port.og ? sm.v.pts : sm.v.pts, sm.v.owner, o.points.length, 1e-4));
      c((g) => g.offsetLoop(sm.v.pts, 1.5));
      c((g) => g.offsetLoop(sm.v.pts, -1.5));
    }
    for (const d of ds) {
      c((g) => g.taperFold(o, arc, d, null));
      c((g) => g.taperFold(o, arc, d, o.shape === 'circle' ? outlineR(o) : null));
      const tf = attempt(() => orig.og.taperFold(o, arc, d, null));
      if (tf.v) { stat.fold++; stat.foldKinds.add(tf.v.why); }
    }
  }
  // loops of several shapes: nested squares, side by side, grown towards each other
  const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  const loopSets = [
    [{ poly: sq(0, 0, 40), depth: 0 }, { poly: sq(10, 10, 10), depth: 1 }],
    [{ poly: sq(0, 0, 40), depth: 0 }, { poly: sq(10, 10, 10), depth: 1 }, { poly: sq(14, 14, 2), depth: 2 }],
    [{ poly: sq(0, 0, 10), depth: 0 }, { poly: sq(12, 0, 10), depth: 0 }],
    [{ poly: sq(0, 0, 10), depth: 0 }, { poly: sq(10.5, 0, 10), depth: 0 }, { poly: sq(30, 0, 10), depth: 0 }],
    [{ poly: sq(0, 0, 40), depth: 0 }, { poly: sq(2, 2, 36), depth: 1 }],
  ];
  const lfold = { null: 0, loops: 0, edge: 0, overlap: 0 };
  for (const L of loopSets) for (const d of ds) {
    const a = attempt(() => orig.og.taperFoldLoops(structuredClone(L), d));
    assert.deepStrictEqual(attempt(() => port.og.taperFoldLoops(structuredClone(L), d)), a);
    lfold[a.v ? a.v.why : 'null']++;
  }
  assert.ok(stat.cross > 5 && stat.touch > 0 && stat.fold > 50 && stat.clean > 100, JSON.stringify({ ...stat, foldKinds: [...stat.foldKinds] }));
  assert.ok(lfold.null > 5 && lfold.loops + lfold.edge + lfold.overlap > 5, JSON.stringify(lfold));
  tally.guards = { outlines: outlines.length, ...stat, foldKinds: [...stat.foldKinds], loopFolds: lfold };
});
const outlineR = (o) => Math.hypot(o.points[1][0] - o.points[0][0], o.points[1][1] - o.points[0][1]) / 2;

test('soup-regions: original and port agree on soupLoops and evenOddPicks (decisions and sentences)', () => {
  const sks = [];
  for (const [, d] of [...generated, ...hand, ...caseDocs]) for (const f of d.features) if (f.kind === 'sketch' && f.geoms) sks.push(f);
  for (const k of Object.keys(SOUPS)) sks.push(SOUPS[k]());
  const sentences = new Set(); let picked = 0;
  for (const sk of sks) {
    for (const fn of ['soupLoops', 'evenOddPicks']) {
      const a = attempt(() => orig.sr[fn](structuredClone(sk)));
      assert.deepStrictEqual(attempt(() => port.sr[fn](structuredClone(sk))), a, `${fn} ${sk.id}`);
      if (a.v?.sentence) sentences.add(a.v.sentence.replace(/[-\d.\[\], ]+/g, '#'));
      if (fn === 'evenOddPicks' && a.v?.picks) picked++;
    }
  }
  assert.ok(sks.length > 80 && picked > 30 && sentences.size >= 4, `soups ${sks.length}, picked ${picked}, sentences ${sentences.size}: ${[...sentences].join(' | ')}`);
  tally.soupGuard = { sketches: sks.length, picked, distinctSentences: sentences.size };
});

test('exports of the helpers agree (boxContact, JOIN_TOUCH_SENTENCE, plainKernelSentence)', () => {
  const r = mulberry32(5);
  for (let i = 0; i < 300; i++) {
    const box = () => { const a = [0, 1, 2].map(() => Math.round(r() * 6)); return [...a, ...a.map((v) => v + Math.round(r() * 4))]; };
    const a = box(), b = box();
    assert.equal(port.epm.boxContact(a, b), orig.ep.boxContact(a, b));
  }
  assert.equal(port.epm.JOIN_TOUCH_SENTENCE('c9'), orig.ep.JOIN_TOUCH_SENTENCE('c9'));
  const feats = [{ id: 'e1', kind: 'extrude' }, { id: 'p1', kind: 'pocket' }, { id: 'c1', kind: 'combine', op: 'union' }, { id: 'c2', kind: 'combine', op: 'subtract' }, { id: 'c3', kind: 'combine', op: 'intersect' }, { id: 'f1', kind: 'fillet' }, { id: 'h1', kind: 'hole' }];
  const raws = [null, undefined, '', 'join cannot preserve the original faces', 'zero-thickness edge contact', 'profile loop is not closed', 'the taper closes the profile', 'extrude distance is zero', 'cannot attach a plane to a wire', 'through all needs a body', 'boom', 42];
  for (const f of feats) for (const raw of raws) assert.equal(port.epm.plainKernelSentence(f, raw), orig.ep.plainKernelSentence(f, raw));
});

test('NEGATIVE CONTROLS: the comparison fails when it should', async () => {
  // 1. different engines on the two sides
  const cfgA = CONFIGS[0];
  let seen = 0;
  for (const [, doc] of generated.filter(([, d]) => d.features.some((f) => f.kind === 'pocket')).slice(0, 12)) {
    const a = await run(orig.ep, doc, cfgA);
    const b = await run(EP, doc, { ...cfgA, box: false });
    try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.log, a.log); } catch { seen++; }
  }
  assert.ok(seen >= 3, `a different engine was noticed on only ${seen} of 12 docs`);
  // 2. a one-number change in an emitted command
  const hit = caseDocs.find(([n]) => n.includes('def-top'))?.[1] ?? caseDocs[0][1];
  const r0 = await run(orig.ep, hit, cfgA);
  const tampered = structuredClone(r0.result);
  const f = tampered.features.find((x) => x.status === 'built' && x.kind === 'extrude');
  const ex = f.commands.find((c) => c.command === 'solid.extrude');
  ex.params.distance += 1e-9;
  assert.throws(() => assert.deepStrictEqual(tampered, r0.result));
  // 3. the base planner set is NOT the group's: running the port in base mode over the group's corpus must be caught by the same comparison
  let differing = 0;
  for (const [name, d] of caseDocs.slice(0, 120)) {
    const x = await run(orig.ep, d, cfgA); const y = await run(BASE, d, cfgA);
    try { assert.deepStrictEqual(y.result, x.result); assert.deepStrictEqual(y.log, x.log); } catch { differing++; }
  }
  assert.ok(differing > 60, `base mode only differed on ${differing} of 120 cases: the comparison is not discriminating`);
  // 4. a port with ONE changed number (a wrong shape cap) is caught on the corpus
  const mutated = port.tr.createTranslator({ planners: 'extrude-pocket' });
  const wrapped = { ...mutated, translateDoc: async (d, c) => {
    const res = await mutated.translateDoc(d, c);
    for (const ft of res.features) for (const cmd of ft.commands) if (cmd.command === 'solid.extrude' && typeof cmd.params.distance === 'number') cmd.params.distance *= 1 + 1e-12;
    return res;
  } };
  let caught = 0;
  for (const [name, d] of caseDocs.slice(0, 60)) {
    const x = await run(orig.ep, d, cfgA); const y = await run(wrapped, d, cfgA);
    try { assert.deepStrictEqual(y.result, x.result); } catch { caught++; }
  }
  assert.ok(caught > 20, `the 1e-12 mutation was caught on only ${caught} cases`);
  // 5. a guard with a changed threshold is caught by the pure comparison
  const o = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], shape: undefined };
  const bad = { ...port.og, taperFold: (oo, ar, d, c) => orig.og.taperFold(oo, ar, d * 0.5, c) };
  const diff = [-12, -8, 8, 12].filter((d) => JSON.stringify(attempt(() => bad.taperFold(o, arc, d, null))) !== JSON.stringify(attempt(() => port.og.taperFold(o, arc, d, null))));
  assert.ok(diff.length >= 1, 'a halved taper distance was not noticed');
});

test.after(() => {
  const s = tally;
  const sorted = [...s.sentences.entries()].sort((x, y) => y[1] - x[1]);
  console.log(`\nEXTRUDE-POCKET DIFFERENTIAL SUMMARY
  corpus (a): ${caseDocs.length} of ${rows.length} group cases became ModelDocs (${caseSkipped.length} scripts do not run: ${caseSkipped.map((c) => c[0]).join(', ') || 'none'})
  corpus (b): ${generated.length} generated outline docs (seeds 5000..${5000 + N_GEN - 1}); ${hand.length} base-kind hand docs
  configs: ${CONFIGS.map((c) => c.name).join('; ')}
  translateDoc cases: ${s.cases}, identical: ${s.identical}, threw: ${s.thrown}, planner-error (internalError) features: ${s.internal}, cases with soups: ${s.withSoups}
  engine calls compared: ${s.runSCcalls}
  built: ${JSON.stringify(s.built)}; refused: ${JSON.stringify(s.refused)}
  checks that ran: ${[...s.checks].join(', ')}; outcomes ${JSON.stringify(s.checkOutcomes)}
  distinct refusal sentence shapes: ${s.sentences.size}
  outline guards: ${JSON.stringify(s.guards)}
  soup guards: ${JSON.stringify(s.soupGuard)}`);
  void sorted;
});
