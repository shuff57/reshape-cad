// The blend-loft fold (src/blend-loft-guard.ts, src/blend-loft.ts).
//   1. DIFFERENTIAL: the untouched original guard (docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs) against the port, on hand-written and
//      generated docs: the same verdict (code and sentence) on every loft, except the one ADDED check (NEEDLE), which only ever turns a pass into a refusal.
//      postCheckBlend: the same verdict on every circle <-> circle loft (the original's only closed form).
//   2. PRISMATOID: the closed form of a straight-sided loft against hand-worked volumes.
//   3. THE STEP in the 'unified' set, through a stub engine: the route, a refusal before the engine runs (BL-<code>, no command sent), a loft built when the
//      engine's volume is the closed form, refused (BL-volume) when it is not.
// None of this shows a built solid is right on the real kernel: that is the page sweep (docs/spikes/solidcraft-referee/contract/BLEND-LOFT-FOLD.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(p).href);
const orig = await imp(path.join(root, 'docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs'));
const port = await imp(path.join(here, '../dist/blend-loft-guard.js'));
const L = await imp(path.join(here, '../dist/index.js'));
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

const sk = (id, points, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points, ...extra });
const circ = (id, cx, cy, r, extra = {}) => sk(id, [[cx - r, cy], [cx + r, cy]], { shape: 'circle', ...extra });
const rect = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const reg = (n, r, rot = 0, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(rot + 2 * Math.PI * i / n), cy + r * Math.sin(rot + 2 * Math.PI * i / n)]);
const bl = (...t) => ({ id: 'bl1', kind: 'blend', targets: t });
const doc = (...features) => ({ version: 1, features });

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

/** hand-written docs: one per sentence of the guard, and the supported classes */
function handDocs() {
  const out = [];
  const add = (name, d) => out.push({ name, doc: d });
  add('none', doc(bl()));
  add('one', doc(sk('a', rect(0, 0, 10, 10)), bl('a')));
  add('three', doc(sk('a', rect(0, 0, 10, 10)), sk('b', rect(0, 0, 5, 5), { offset: 5 }), sk('c', rect(0, 0, 2, 2), { offset: 9 }), bl('a', 'b', 'c')));
  add('not-sketch', doc(sk('a', rect(0, 0, 10, 10)), { id: 'b1', kind: 'box', size: [1, 1, 1] }, bl('a', 'b1')));
  add('missing', doc(sk('a', rect(0, 0, 10, 10)), bl('a', 'nope')));
  add('same', doc(sk('a', rect(0, 0, 10, 10)), bl('a', 'a')));
  add('soup', doc(sk('a', rect(0, 0, 10, 10), { geoms: [{ kind: 'line' }] }), sk('b', rect(0, 0, 5, 5), { offset: 5 }), bl('a', 'b')));
  add('frame', doc(sk('a', rect(0, 0, 10, 10), { frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), sk('b', rect(0, 0, 5, 5), { offset: 5 }), bl('a', 'b')));
  add('planes', doc(sk('a', rect(0, 0, 10, 10)), sk('b', rect(0, 0, 5, 5), { plane: 'xz', offset: 5 }), bl('a', 'b')));
  add('undrawn', doc(sk('a', [[0, 0], [40, 0], [40, 25], [0, 25]], { constraints: [1, 2, 3, 4] }), sk('b', rect(0, 0, 5, 5), { offset: 5 }), bl('a', 'b')));
  add('flat circle', doc(circ('a', 0, 0, 0), circ('b', 0, 0, 5, { offset: 5 }), bl('a', 'b')));
  add('flat line', doc(sk('a', [[0, 0], [5, 0], [10, 0]]), sk('b', reg(3, 3), { offset: 5 }), bl('a', 'b')));
  add('crossing', doc(sk('a', [[0, 0], [10, 10], [10, 0], [0, 10]]), sk('b', rect(0, 0, 5, 5), { offset: 5 }), bl('a', 'b')));
  add('dup', doc(sk('a', [[0, 0], [10, 0], [10, 0], [10, 10], [0, 10]]), sk('b', reg(5, 3), { offset: 5 }), bl('a', 'b')));
  add('gap0', doc(sk('a', rect(0, 0, 10, 10)), sk('b', rect(0, 0, 5, 5)), bl('a', 'b')));
  add('sliver', doc(sk('a', rect(0, 0, 400, 400)), sk('b', rect(0, 0, 200, 200), { offset: 0.001 }), bl('a', 'b')));
  add('shared', doc(sk('a', rect(0, 0, 10, 10)), sk('b', rect(0, 0, 5, 5), { offset: 5 }), bl('a', 'b'), { id: 'p1', kind: 'extrude', target: 'a', length: 3 }));
  add('cc', doc(circ('a', 0, 0, 20), circ('b', 0, 0, 10, { offset: 30 }), bl('a', 'b')));
  add('cc tilt', doc(circ('a', 0, 0, 20), circ('b', 200, 0, 10, { offset: 30 }), bl('a', 'b')));
  add('cc small', doc(circ('a', 0, 0, 0.3), circ('b', 0, 0, 0.2, { offset: 1 }), bl('a', 'b')));
  add('cc coarse', doc(circ('a', 0, 0, 2), circ('b', 0, 0, 1, { offset: 200 }), bl('a', 'b')));
  add('pc coarse', doc(sk('a', rect(0, 0, 100, 100)), circ('b', 0, 0, 2, { offset: 30 }), bl('a', 'b')));
  add('pc small', doc(sk('a', rect(0, 0, 1, 1)), circ('b', 0, 0, 0.3, { offset: 1 }), bl('a', 'b')));
  add('rect-circ', doc(sk('a', rect(0, 0, 40, 40)), circ('b', 0, 0, 15, { offset: 40 }), bl('a', 'b')));
  add('rect-circ size', doc(sk('a', rect(0, 0, 10, 10)), circ('b', 0, 0, 15, { offset: 40 }), bl('a', 'b')));
  add('rect-circ thin', doc(sk('a', rect(0, 0, 40, 40)), circ('b', 0, 0, 15, { offset: 20 }), bl('a', 'b')));
  add('hex-circ', doc(sk('a', reg(6, 20)), circ('b', 0, 0, 15, { offset: 30 }), bl('a', 'b')));
  add('hex-circ thin', doc(sk('a', reg(6, 20)), circ('b', 0, 0, 15, { offset: 5 }), bl('a', 'b')));
  add('tri-circ', doc(sk('a', reg(3, 20)), circ('b', 0, 0, 15, { offset: 30 }), bl('a', 'b')));
  add('hex turned-circ', doc(sk('a', reg(6, 20, 0.3)), circ('b', 0, 0, 15, { offset: 30 }), bl('a', 'b')));
  add('rounded-circ', doc(sk('a', rect(0, 0, 40, 40), { rounds: { 0: 6, 1: 6, 2: 6, 3: 6 } }), circ('b', 0, 0, 15, { offset: 30 }), bl('a', 'b')));
  add('rounded long-circ', doc(sk('a', rect(0, 0, 40, 30), { rounds: { 0: 6, 1: 6, 2: 6, 3: 6 } }), circ('b', 0, 0, 15, { offset: 30 }), bl('a', 'b')));
  add('rounded-rect', doc(sk('a', rect(0, 0, 40, 40), { rounds: { 0: 6, 1: 6, 2: 6, 3: 6 } }), sk('b', rect(0, 0, 20, 20), { offset: 30 }), bl('a', 'b')));
  add('rr', doc(sk('a', rect(0, 0, 40, 40)), sk('b', rect(0, 0, 20, 20), { offset: 30 }), bl('a', 'b')));
  add('rr neg', doc(sk('a', rect(0, 0, 40, 40), { offset: 30 }), sk('b', rect(0, 0, 20, 20)), bl('b', 'a')));
  add('rr front', doc(sk('a', rect(0, 0, 40, 40), { plane: 'xz' }), sk('b', rect(3, 2, 20, 10), { plane: 'xz', offset: 30 }), bl('a', 'b')));
  add('count', doc(sk('a', rect(0, 0, 40, 40)), sk('b', reg(6, 10), { offset: 30 }), bl('a', 'b')));
  add('twist', doc(sk('a', rect(0, 0, 40, 40)), sk('b', reg(4, 14, Math.PI / 8), { offset: 30 }), bl('a', 'b')));
  add('wrong way', doc(sk('a', rect(0, 0, 40, 40)), sk('b', reg(4, 14, Math.PI / 4), { offset: 30 }), bl('a', 'b')));
  add('square tie', doc(sk('a', reg(4, 20, Math.PI / 4)), sk('b', reg(4, 10, 0), { offset: 30 }), bl('a', 'b')));
  add('start', doc(sk('a', rect(0, 0, 40, 40)), sk('b', [[10, -10], [10, 10], [-10, 10], [-10, -10]].reverse(), { offset: 30 }), bl('a', 'b')));
  add('start2', doc(sk('a', reg(6, 20)), sk('b', reg(6, 10).slice(2).concat(reg(6, 10).slice(0, 2)), { offset: 30 }), bl('a', 'b')));
  add('cw', doc(sk('a', rect(0, 0, 40, 40).reverse()), sk('b', rect(0, 0, 20, 20).reverse(), { offset: 30 }), bl('a', 'b')));
  add('needle', doc(sk('a', rect(0, 0, 1, 1)), sk('b', rect(0, 0, 0.5, 0.5), { offset: 3000 }), bl('a', 'b')));
  add('long but fine', doc(sk('a', rect(0, 0, 1, 1)), sk('b', rect(0, 0, 0.5, 0.5), { offset: 1000 }), bl('a', 'b')));
  return out;
}

/** generated docs: random pairs of the guard's classes, including near-misses */
function generatedDocs(n, seed) {
  const r = lcg(seed); const U = (a, b) => a + (b - a) * r(); const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const plane = pick(['xy', 'xy', 'xz', 'yz']); const off0 = pick([0, 0, U(-50, 50)]); const gap = pick([U(-100, 100), U(-1, 1), U(1e5, 1e6) * pick([1, 1e-3]), 1e-7]);
    const size = pick([U(0.1, 1), U(1, 100), U(100, 2000)]);
    const n1 = pick([3, 4, 5, 6, 8]);
    const shape = () => {
      const k = pick(['rect', 'reg', 'poly', 'circ', 'rounded', 'scaled']);
      if (k === 'rect') return { points: rect(U(-size, size) * 0.2, U(-size, size) * 0.2, size * U(0.2, 1), size * U(0.2, 1)) };
      if (k === 'reg') return { points: reg(pick([3, 4, 5, 6, 7, 8]), size * U(0.2, 1), pick([0, 0, U(-0.05, 0.05), U(0, 6)])) };
      if (k === 'poly') return { points: Array.from({ length: n1 }, (_, j) => { const t = 2 * Math.PI * j / n1 + U(-0.3, 0.3); const rr = size * U(0.3, 1); return [rr * Math.cos(t), rr * Math.sin(t)]; }) };
      if (k === 'circ') { const c = [U(-size, size) * pick([0, 0.1, 3]), U(-size, size) * pick([0, 0.1])]; const rr = size * U(0.05, 1); return { points: [[c[0] - rr, c[1]], [c[0] + rr, c[1]]], shape: 'circle' }; }
      if (k === 'rounded') { const w = size * U(0.3, 1); const h = w * U(1, 1.4); const rr = Math.min(w, h) * U(0.05, 0.45); return { points: rect(0, 0, w, h), rounds: { 0: rr, 1: rr, 2: rr, 3: rr } }; }
      const base = reg(n1, size * U(0.3, 1), U(0, 1)); const s = U(0.2, 3); const jit = pick([0, 0, 1e-4, 1e-2]);
      return { points: base.map((p) => [p[0] * s + U(-jit, jit) * size, p[1] * s + U(-jit, jit) * size]) };
    };
    const a = shape(); let b = shape();
    if (r() < 0.35 && !a.shape && !a.rounds) { const s = U(0.2, 3); const dx = U(-size, size) * 0.3; b = { points: a.points.map((p) => [p[0] * s + dx, p[1] * s]) }; if (r() < 0.3) b.points.reverse(); }
    const fs = [sk('a', a.points, { plane, offset: off0, ...(a.shape ? { shape: a.shape } : {}), ...(a.rounds ? { rounds: a.rounds } : {}) }), sk('b', b.points, { plane, offset: off0 + gap, ...(b.shape ? { shape: b.shape } : {}), ...(b.rounds ? { rounds: b.rounds } : {}) })];
    fs.push(gap >= 0 ? bl('a', 'b') : bl('b', 'a'));
    if (r() < 0.05) fs.push({ id: 'p1', kind: 'extrude', target: 'b', length: 3 });
    out.push({ name: `gen ${seed}/${i}`, doc: doc(...fs) });
  }
  return out;
}

const verdictOf = (G, d) => { try { const v = G.guardBlend(d, d.features.find((f) => f.kind === 'blend'), { outlineOf: arc.outlineOf }); return v ? { code: v.code, sentence: v.sentence } : null; } catch (e) { return { threw: e.constructor.name, message: e.message } } };

test('the port gives the original guard\'s verdict on every loft, except where the added NEEDLE check refuses a loft the original passes', () => {
  const docs = [...handDocs(), ...generatedDocs(3000, 11), ...generatedDocs(3000, 12)];
  const codes = new Map(); let needles = 0; let passes = 0;
  for (const { name, doc: d } of docs) {
    const o = verdictOf(orig, d); const p = verdictOf(port, d);
    if (p?.code === 'needle') { assert.equal(o, null, `${name}: NEEDLE refused a loft the original also refused`); needles++; continue; }
    assert.deepEqual(p, o, name);
    if (!o) passes++;
    codes.set(o?.code ?? o?.threw ?? 'pass', (codes.get(o?.code ?? o?.threw ?? 'pass') ?? 0) + 1);
  }
  // the inputs reach every sentence of the guard but three ('dup': the outline reader already refuses a repeated corner as 'unreadable'; 'ambiguous' and
  // 'start' need hand-built non-convex pairs, which the original's own battery covers: contract/blend-loft.r4-results.json), the supported set and the added check
  for (const c of ['targets', 'not-sketch', 'same', 'soup', 'frame', 'planes', 'undrawn', 'flat', 'crossing', 'unreadable', 'gap0', 'sliver', 'shared', 'tilt', 'coarse', 'size-mix', 'thin', 'arcs', 'circle-poly', 'count', 'sides', 'tie', 'pass']) assert.ok(codes.get(c), `no input reached '${c}' (${[...codes].join(', ')})`);
  assert.ok(needles >= 1 && passes >= 200, `needles ${needles}, passes ${passes}`);
});

test('postCheckBlend gives the original\'s verdict on every circle <-> circle loft', () => {
  const r = lcg(5);
  for (let i = 0; i < 2000; i++) {
    const r1 = 0.5 + 50 * r(); const r2 = 0.5 + 50 * r(); const h = 0.1 + 100 * r();
    const d = doc(circ('a', 0, 0, r1), circ('b', 10 * r(), 0, r2, { offset: h }), bl('a', 'b'));
    const exact = h / 3 * Math.PI * (r1 * r1 + r2 * r2 + r1 * r2);
    const kv = exact * (1 + (r() - 0.5) * 2e-3);
    const o = orig.postCheckBlend(d, d.features[2], { kernelVolume: kv, outlineOf: arc.outlineOf });
    const p = port.postCheckBlend(d, d.features[2], { kernelVolume: kv, outlineOf: arc.outlineOf });
    assert.deepEqual(p && { code: p.code, sentence: p.sentence }, o && { code: o.code, sentence: o.sentence });
  }
});

test('prismatoidVolume is the volume of a straight-sided loft', () => {
  const sq = (s) => rect(0, 0, s, s);
  // frustum of a square pyramid: h/3 (A1 + A2 + sqrt(A1 A2))
  assert.ok(Math.abs(port.prismatoidVolume(sq(40), sq(20), 0, 30) - 28000) < 1e-9);
  // 40 x 40 to 30 x 10 over 25: 25/6 (1600 + 300 + 4 * 35 * 25)
  assert.ok(Math.abs(port.prismatoidVolume(sq(40), rect(0, 0, 30, 10), 0, 25) - 22500) < 1e-9);
  // a prism (same outline both ends) is area x height, whatever the offset of the second
  assert.ok(Math.abs(port.prismatoidVolume(reg(6, 10), reg(6, 10, 0, 7, -3), 0, 12) - 12 * 1.5 * Math.sqrt(3) * 100) < 1e-9);
  // the sign of the gap does not matter
  assert.equal(port.prismatoidVolume(sq(40), sq(20), 0, -30), port.prismatoidVolume(sq(40), sq(20), 0, 30));
});

test('postCheckBlend checks a straight-sided pair against the prismatoid: flat sides to 1e-6, slightly warped sides to 2.5e-4', () => {
  const d = doc(sk('a', rect(0, 0, 40, 40)), sk('b', rect(0, 0, 20, 20), { offset: 30 }), bl('a', 'b'));
  const f = d.features[2];
  assert.equal(port.postCheckBlend(d, f, { kernelVolume: 28000 * (1 + 5e-7), outlineOf: arc.outlineOf }), null);
  assert.equal(port.postCheckBlend(d, f, { kernelVolume: 28000 * (1 + 2e-6), outlineOf: arc.outlineOf })?.code, 'volume');
  const w = doc(sk('a', rect(0, 0, 40, 40)), sk('b', [[-10, -10], [10, -10.001], [10, 10], [-10, 10]], { offset: 30 }), bl('a', 'b'));
  assert.equal(port.postCheckBlend(w, w.features[2], { kernelVolume: port.prismatoidVolume(rect(0, 0, 40, 40), w.features[1].points, 0, 30) * (1 + 1e-4), outlineOf: arc.outlineOf }), null);
  assert.equal(port.postCheckBlend(w, w.features[2], { kernelVolume: 28000 * 1.01, outlineOf: arc.outlineOf })?.code, 'volume');
  // circle <-> polygon has no closed form: never refused after the build
  const m = doc(sk('a', rect(0, 0, 40, 40)), circ('b', 0, 0, 15, { offset: 40 }), bl('a', 'b'));
  assert.equal(port.postCheckBlend(m, m.features[2], { kernelVolume: 1, outlineOf: arc.outlineOf }), null);
});

// ---- the step, through a stub engine ------------------------------------------------------------------------------------------------------------------
/** An engine that builds whatever loft it is sent with the volume `volumeOf(doc)` (one body per body_name). */
function stub(volume) {
  const calls = [];
  const runSC = async (cmds) => {
    calls.push(cmds);
    const bodies = [];
    for (const c of cmds) if (c.params?.body_name) bodies.push({ name: c.params.body_name, volume_mm3: volume, faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, bbox: { min: [-20, -20, 0], max: [20, 20, 30] }, center_of_mass: [0, 0, 10] });
    return { ok: true, measure: { bodies } };
  };
  return { runSC, calls };
}
const T = L.createTranslator({ planners: 'unified' });
const run = async (d, volume) => { const s = stub(volume); const tr = await T.translateDoc(solveDoc(d), { arc, mt, runSC: s.runSC, resolveAt: () => null }); return { tr, calls: s.calls, f: tr.features.find((x) => x.kind === 'blend') }; };

test('the unified set runs the loft guard whatever the document\'s style (a document that drills a hole is in the holes style)', async () => {
  const d = doc({ id: 'b1', kind: 'box', size: [10, 10, 10], center: [100, 0, 5] }, { id: 'h1', kind: 'hole', target: 'b1', center: [100, 0, 10], diameter: 2, depth: 3, axis: 'z' }, sk('a', rect(0, 0, 40, 40)), sk('b', reg(6, 10), { offset: 30 }), bl('a', 'b'));
  assert.equal(L.domainOf(d).style, 'holes');
  const { f } = await run(d, 1);
  assert.equal(f.guard, 'BL-count');
});

test('a loft the guard refuses is refused before the engine runs, in the guard\'s sentence', async () => {
  const { f, calls } = await run(doc(sk('a', rect(0, 0, 40, 40)), sk('b', reg(6, 10), { offset: 30 }), bl('a', 'b')), 1);
  assert.equal(f.status, 'refused');
  assert.equal(f.guard, 'BL-count');
  assert.match(f.refusal, /^The first sketch has 4 corners and the second has 6/);
  assert.equal(calls.length, 0);
});

test('a loft the guard passes is built when the engine\'s volume is the closed form, and refused (BL-volume) when it is not', async () => {
  const d = doc(sk('a', rect(0, 0, 40, 40)), sk('b', rect(0, 0, 20, 20), { offset: 30 }), bl('a', 'b'));
  const ok = await run(d, 28000);
  assert.equal(ok.f.status, 'built');
  assert.ok(ok.f.commands.some((c) => c.command === 'solid.loft'));
  const bad = await run(d, 28000 * 1.001);
  assert.equal(bad.f.status, 'refused');
  assert.equal(bad.f.guard, 'BL-volume');
  assert.match(bad.f.refusal, /has a volume that is off from the exact value/);
  const cc = doc(circ('a', 0, 0, 20), circ('b', 0, 0, 10, { offset: 30 }), bl('a', 'b'));
  assert.equal((await run(cc, 7000 * Math.PI * (1 + 5e-5))).f.status, 'built');
  assert.equal((await run(cc, 7000 * Math.PI * (1 + 5e-4))).f.guard, 'BL-volume');
});

test('no other set runs the loft guard (their differential tests compare against originals that have none)', async () => {
  const d = solveDoc(doc(sk('a', rect(0, 0, 40, 40)), sk('b', reg(6, 10), { offset: 30 }), bl('a', 'b')));
  const s = stub(1);
  const tr = await L.createTranslator({ planners: 'base' }).translateDoc(d, { arc, mt, runSC: s.runSC, resolveAt: () => null });
  assert.notEqual(tr.features.find((x) => x.kind === 'blend').guard, 'BL-count');
});
