// DIFFERENTIAL TEST for ctx.followMoves (src/follow-moves.ts): the 'shell-draft' set with NO host resolver (path B, the base's name resolution from the
// engine's topology) and followMoves ON, against the ORIGINAL group translator with its resolver (path A: the primitive's own-frame point shifted by the moves
// in the history, G-PICK). Same deterministic fake engine (box / cylinder topology, no kernel) on both sides, same ModelDocs: the 1100 cases of the group and
// the 420 generated shell / draft docs, restricted to docs with a NAMED face whose chain from the primitive to the target holds a non-copy `move`.
//
// Asserted: (1) flag OFF is byte-identical to no flag, on every doc of the pool (default behaviour untouched); (2) flag ON equals the original (ignoring
// `pickedFrom`) on every doc the fake's topology can speak for; (3) every difference is listed with its cause, and none is a wrong build the original did not
// also make: where the two differ, the flag-ON side has refused or the fake topology (a bounding box for a prism / wedge / extrude, nothing for a join) is the cause.
// This is a fake: it does not show the solids are right, only that the new resolver picks where the original's shift picks. test/live-moved-picks.mjs is the real kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { sdDoc, sdFromUsage } from './sd-docs.mjs';
import { fakeResolveAt } from './fake-resolve-at.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);
const sd = await imp(path.join(contract, 'shell-draft-translate.mjs'));
const poly = await imp(path.join(contract, 'shell-draft-polytope.mjs'));
const { createTranslator } = await imp(path.join(here, '../dist/translator.js'));
const { quarterTurns } = await imp(path.join(here, '../dist/follow-moves.js'));
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));
const SD = createTranslator({ planners: 'shell-draft' });
const BASE = createTranslator();

const { CASES_FN } = await imp(path.join(contract, 'shell-draft-cases.mjs'));
const { STEEP_FN } = await imp(path.join(contract, 'shell-draft-cases-steep.mjs'));
const { R2_FN } = await imp(path.join(contract, 'shell-draft-cases-r2.mjs'));
const env = { P: poly, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) };
const items = [];
for (const c of [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)]) {
  const r = runScript(c.script); if (r.errors.length) continue;
  const doc0 = r.doc; if (c.patch) c.patch(doc0);
  items.push({ name: `case ${c.id}`, doc: solveDoc(doc0), fromUsage: sd.draftFromUsage(c.script) });
}
for (let i = 0; i < 420; i++) { const doc = sdDoc(i); items.push({ name: `sd seed ${i}`, doc, fromUsage: sdFromUsage(i, doc) }); }

// ---- the pool: a named face whose way from the primitive to the target crosses a non-copy move; docs the group's loop and phase 4 plan differently are out (as in the shell-draft test)
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
const phaseDiff = (doc) => { const sk = {}; return doc.features.some((f) => { if (f.kind === 'sketch') sk[f.id] = f; return f.kind === 'fillet' || (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sk[f.target])) || (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sk[t]))); }); };
function chainOf(doc, name, target) { // features from the named primitive (exclusive) to the target (inclusive), following target links (combine: first target)
  const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  const out = []; let cur = target; const seen = new Set();
  while (cur && cur !== name.feature && !seen.has(cur)) { seen.add(cur); const f = byId[cur]; if (!f) return null; out.push(f); cur = f.kind === 'combine' ? f.targets?.[0] : f.target; }
  return cur === name.feature ? out : null;
}
const namedFeats = (doc) => doc.features.filter((f) => (f.kind === 'shell' && f.open && typeof f.open === 'object') || (f.kind === 'draft' && f.face && !f.whole));
const movedNamed = (doc) => namedFeats(doc).some((f) => { const n = f.kind === 'shell' ? f.open : f.face; const ch = chainOf(doc, n, f.target); return ch && ch.some((h) => h.kind === 'move' && !h.copy); });
const pool = items.filter((it) => !phaseDiff(it.doc) && movedNamed(it.doc));

const CFG = { shellDraft: true, boxBool: true };
const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
function runOrig(item) {
  const fake = makeFake({ sync: true, ...CFG });
  let result; let error = null;
  try { result = sd.translateDocGuarded(structuredClone(item.doc), { arc, skipSketchVolume: true, skipOpenOutline: true, runSC: fake.runSC, resolveAt: fakeResolveAt, mt }, { fromUsage: item.fromUsage, off: [] }); } catch (e) { error = errOf(e); }
  return { result, error };
}
async function runPort(item, followMoves) {
  const fake = makeFake({ sync: false, ...CFG });
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, mt, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {}, ...(item.fromUsage ? { fromUsage: item.fromUsage } : {}), ...(followMoves === undefined ? {} : { followMoves }) };
  let result; let error = null;
  try { const { _state, ...rest } = await SD.translateDoc(structuredClone(item.doc), ctx); result = rest; } catch (e) { error = errOf(e); }
  return { result, error };
}
// pickedFrom names the pick source and differs by design; coordinates are compared to 1e-9 (the shifted point and the moved centroid differ in the last digits)
const rnd = (v) => (typeof v === 'number' ? (Math.abs(v) < 5e-10 ? 0 : Math.round(v * 1e9) / 1e9) : Array.isArray(v) ? v.map(rnd) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rnd(x)])) : v);
const noFrom = (r) => (r ? rnd({ ...r, features: r.features.map(({ pickedFrom, ...f }) => f) }) : r);

const T = { docs: pool.length, offIdentical: 0, same: 0, differ: 0, causes: {}, examples: {}, names: {}, builtBothSameMeasure: 0 };
test('flag OFF (and an explicit false) is identical to no flag on every doc of the pool, and on the base set', async () => {
  assert.ok(pool.length > 60, `pool of ${pool.length}`);
  for (const it of pool) {
    const none = await runPort(it, undefined); const off = await runPort(it, false);
    assert.deepStrictEqual(off, none, it.name);
    T.offIdentical++;
  }
  for (const it of pool.slice(0, 80)) { // the base set too
    const mk = async (flag) => { const f = makeFake({ boxBool: true }); try { const { _state, ...r } = await BASE.translateDoc(structuredClone(it.doc), { arc, skipSketchVolume: true, skipOpenOutline: true, mt, runSC: f.runSC, topologyOf: f.topologyOf, soups: {}, ...(flag === undefined ? {} : { followMoves: flag }) }); return r; } catch (e) { return errOf(e); } };
    assert.deepStrictEqual(await mk(false), await mk(undefined), it.name);
  }
});

test('flag ON, no host resolver: equals the original (path A, shift by the moves) on the named-pick docs with a move; the rest is listed with its cause', async () => {
  for (const it of pool) {
    const a = runOrig(it); const b = await runPort(it, true);
    let same = false;
    try { assert.deepStrictEqual(noFrom(b.result), noFrom(a.result)); assert.deepStrictEqual(b.error, a.error); same = true; } catch { /* below */ }
    if (same) { T.same++; continue; }
    T.differ++;
    const fa = a.result?.features ?? []; const fb = b.result?.features ?? [];
    const i = fa.findIndex((x, k) => JSON.stringify(rnd([x.status, x.refusal, x.commands, x.measure])) !== JSON.stringify(rnd([fb[k]?.status, fb[k]?.refusal, fb[k]?.commands, fb[k]?.measure])));
    const x = fa[i]; const y = fb[i];
    const kinds = new Set(it.doc.features.map((f) => f.kind));
    const fakeLimit = ['prism', 'wedge', 'extrude', 'combine', 'mirror', 'pattern', 'rotate', 'hole', 'pocket', 'groove', 'revolve', 'sphere', 'cone', 'torus'].filter((k) => kinds.has(k));
    let cause;
    const rawOn = String(y?.raw ?? '');
    const primRotated = /is rotated; this demo resolves primitive faces only on unrotated primitives/.test(rawOn);
    const rotatedRoot = (() => { const n = (it.doc.features.find((f) => f.id === (x?.id)) ?? {}); const nm = n.open ?? n.face; const r = it.doc.features.find((f) => f.id === nm?.feature); return !!(r && r.rotate && r.rotate.some((v) => v)); })();
    const fakeLabel = rotatedRoot && /solidcraft names that face .*, not .* as a (box|cylinder)'s|own parameters put that face/.test(rawOn);
    if (fakeLabel) cause = `flag-ON refused: the NAMED primitive is turned and the FAKE topology does not model a turned primitive (its labels do not turn with the body and its box is not rotated; the real kernel's do, measured); original ${x.status}`;
    else if (primRotated) cause = `flag-ON refused: the NAMED primitive is rotated by other than whole quarter turns (the base resolver's standing refusal, not a move); original ${x.status}`;
    else if (a.error !== b.error) cause = 'a thrown error on one side';
    else if (!x || !y) cause = 'results differ only outside status / sentence / commands / measure';
    else if (x.status === 'built' && y.status === 'built') cause = JSON.stringify(rnd(x.measure)) === JSON.stringify(rnd(y.measure)) ? 'both built, SAME measure, only the pick point differs' : 'both built, DIFFERENT measure';
    else if (x.status === 'built') cause = `original built, flag-ON refused (${y.guard ?? 'no guard'})`;
    else if (y.status === 'built') cause = `original refused (${x.guard ?? 'no guard'}), flag-ON built`;
    else if (x.refusal === y.refusal) cause = `both refused, same sentence, other guard name (${x.guard ?? 'none'} / ${y.guard ?? 'none'})`;
    else cause = `both refused, other sentence (${x.guard ?? 'none'} / ${y.guard ?? 'none'}): the flag-ON side's own pick finds no face before the chain check, the original's checks the chain first`;
    const key = `${cause} [doc has: ${fakeLimit.join(', ') || 'only box / cylinder / move / shell / draft'}]`;
    T.causes[key] = (T.causes[key] ?? 0) + 1;
    (T.names[key] ??= []).push(it.name); (T.examples[key] ??= []).length < 3 && T.examples[key].push({ name: it.name, id: x?.id, orig: x && { status: x.status, guard: x.guard, refusal: x.refusal?.slice(0, 160), faces: x.commands?.[0]?.params?.faces, vol: x.measure?.volume }, on: y && { status: y.status, guard: y.guard, refusal: y.refusal?.slice(0, 160), faces: y.commands?.[0]?.params?.faces, vol: y.measure?.volume } });
    if (cause === 'both built, DIFFERENT measure' || cause.startsWith('original refused')) T.builtBothSameMeasure += 0;
  }
  // every doc whose parts are all boxes / cylinders moved by plain moves must be identical: the fake's topology speaks for those
  const plainOnly = (it) => it.doc.features.every((f) => ['box', 'cylinder', 'move', 'shell', 'draft', 'datum'].includes(f.kind) && !(f.kind === 'move' && f.copy) && !(f.rotate && f.rotate.some((v) => v)) && !f.round);
  let plain = 0; let plainSame = 0; let plainSameSentence = 0; const bad = [];
  for (const it of pool.filter(plainOnly)) {
    plain++;
    const a = runOrig(it); const b = await runPort(it, true);
    try { assert.deepStrictEqual(noFrom(b.result), noFrom(a.result)); assert.deepStrictEqual(b.error, a.error); plainSame++; } catch {
      // allowed: the same features built or refused with the same sentence; only a refusal's guard name / raw text (which check refused it first) differs
      const lite = (r) => noFrom(r) && { ...noFrom(r), features: noFrom(r).features.map(({ guard, raw, faces, commands, ...f }) => (f.status === 'refused' ? f : { ...f, commands })) };
      try { assert.deepStrictEqual(lite(b.result), lite(a.result)); plainSameSentence++; } catch { bad.push(it.name); }
    }
  }
  T.plain = { docs: plain, same: plainSame, sameSentence: plainSameSentence, differ: bad };
  // hard claims: the flag never makes a build the original does not make with a DIFFERENT result, and never opens another face
  const wrongish = Object.entries(T.causes).filter(([k]) => k.startsWith('both built, DIFFERENT') || k.startsWith('original refused'));
  assert.deepStrictEqual(wrongish, [], 'a doc where flag-ON builds and the original refuses, or both build differently');
  assert.ok(plain > 30, `${plain} plain docs`);
  assert.deepStrictEqual(bad, [], `plain box / cylinder docs that differ: ${bad.join(', ')}`);
});

test('quarterTurns: whole quarter turns only, right-handed, x then y then z', () => {
  const R = quarterTurns([0, 0, 90]); assert.deepStrictEqual(R.map((r) => r.map((v) => v + 0)), [[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  assert.equal(quarterTurns([0, 0, 45]), null); assert.equal(quarterTurns([90.5, 0, 0]), null); assert.equal(quarterTurns([Infinity, 0, 0]), null);
  assert.ok(quarterTurns([0, 0, 0]).every((r, i) => r.every((v, j) => v === (i === j ? 1 : 0))));
  assert.ok(quarterTurns([360, -90, 270]));
});

test('the base set: a moved box is refused with the flag off and shelled with it on; a copy, a non-quarter turn and a join after a move are refused in a sentence', async () => {
  const box = { id: 'b1', kind: 'box', size: [20, 10, 6], center: [0, 0, 0], rotate: [0, 0, 0] };
  const shell = (target) => ({ id: 's1', kind: 'shell', target, thickness: 1, open: { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' } });
  const run = async (features, flag) => {
    const f = makeFake({ boxBool: true, shellDraft: true });
    const { _state, ...r } = await BASE.translateDoc({ features }, { arc, skipSketchVolume: true, skipOpenOutline: true, mt, runSC: f.runSC, topologyOf: f.topologyOf, soups: {}, followMoves: flag });
    return r.features.at(-1);
  };
  const mv = { id: 'm1', kind: 'move', target: 'b1', offset: [7, 3, 2], copy: false };
  assert.equal((await run([box, mv, shell('m1')], false)).status, 'refused');
  const on = await run([box, mv, shell('m1')], true);
  assert.equal(on.status, 'built', on.refusal);
  assert.equal(on.commands[0].params.faces[0][2] > 4.9, true); // the pick is on the moved top face (z = 3 + 2)
  const sentence = async (features) => { const r = await run(features, true); assert.equal(r.status, 'refused'); assert.ok(!/\n/.test(r.refusal)); return r.refusal; };
  assert.match(await sentence([box, { ...mv, copy: true }, shell('m1')]), /a copying move is not mapped/); // the base never builds a copy, so the target is refused first
  // the resolver's own refusal of a copy, reached directly (a host whose planner did build the copy)
  const { followMoves } = await imp(path.join(here, '../dist/follow-moves.js'));
  const face = { ok: true, kind: 'face', area: 1, shape: { featureId: 'b1' }, faces: [], plane: { n: [0, 0, 1], d: 3 }, evidence: { name: 'b1.face[+z]' } };
  const cp = followMoves(face, { features: [box, { ...mv, copy: true }], bboxOf: () => undefined, targetId: 'm1' });
  assert.equal(cp.ok, false); assert.match(cp.sentence, /copying move, so which copy the name means is not known; nothing is picked$/);
  const mvd = followMoves(face, { features: [box, mv], bboxOf: () => undefined, targetId: 'm1' });
  assert.deepStrictEqual(mvd.plane, { n: [0, 0, 1], d: 5 });
  const none = followMoves(face, { features: [box], bboxOf: () => undefined, targetId: 'b1' });
  assert.equal(none, face); // never placed: returned unchanged
  const turned = followMoves(face, { features: [box, { id: 'r1', kind: 'rotate', target: 'b1', angles: [90, 0, 0] }], bboxOf: () => [-10, -5, -3, 10, 5, 3], targetId: 'r1' });
  assert.deepStrictEqual(turned.plane.n.map((v) => v + 0), [0, -1, 0]); // +z turned 90 about x (right-handed) lies along -y
  assert.equal(turned.plane.d, 3); // the plane z = 3 becomes y = -3
  assert.match(await sentence([box, { id: 'r1', kind: 'rotate', target: 'b1', angles: [0, 0, 45] }, shell('r1')]), /whole quarter turns \(90, 180 or 270 degrees\)/);
  assert.match(await sentence([box, mv, { id: 'x1', kind: 'mirror', target: 'm1', plane: 'yz' }, shell('x1')]), /moved or turned and then x1 is a mirror/);
});

test.after(() => {
  console.log(`\nMOVED-PICK differential (fake engine): pool ${T.docs} named-pick docs with a move; flag off == no flag on ${T.offIdentical}; flag ON == original on ${T.same}, differs on ${T.differ}`);
  console.log(`plain box / cylinder / move docs: ${T.plain?.docs}, identical ${T.plain?.same}, same features and sentences but another guard name ${T.plain?.sameSentence}`);
  for (const [k, n] of Object.entries(T.causes).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
  if (process.env.SHOW_NAMES) console.log(JSON.stringify(T.names, null, 1));
  if (process.env.SHOW_EXAMPLES) console.log(JSON.stringify(T.examples, null, 1));
});
