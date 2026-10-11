// Integration sweep of S4 (docs/PLAN-next.md, "Integration sweep of S4"): regressions for the defects the cross-slice stress
// families (wrong-solid-sweep-s4.mjs) and the standing sweep found in the MERGED build. Each test failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mine, brep, assertWatertight, assertOcct } from './s4i-harness.mjs';

const PI = Math.PI;

// perm#4862 (seed 1): a ball sealed inside a cylinder whose bottom edge is rounded. carry_subtract (S4c) met a revolved tool
// (a sphere, which S4h taught `extract` to read) that only boolean_planar_with frames: its one band had zlo = zhi = 0, an area of
// 0, and drop_degenerate_faces deleted the whole ball. The shell stayed closed and the partner operation lost the ball in step
// (V(A-B) + V(A*B) = V(A) with V(A*B) = 0), so every guard waved the rounded cylinder through with an empty refusals map.
test('a ball sealed inside a rounded cylinder is a void or a refusal, never the rounded cylinder', () => {
  for (const [round, ball] of [[3.34, '7.51, { at: [-3.46, -2.19, 2.1] }'], [3, '8, { at: [0, 0, 0] }'], [4, '6, { at: [5, 0, -3] }']]) {
    const head = `let v = cylinder(38, 40, { at: [0, 0, 0] })\nround(v.edge('bottom', 'side'), ${round})\n`;
    const whole = mine(head);
    assert.deepEqual(whole.refusals, {});
    const m = mine(`${head}const p1 = sphere(${ball})\nv = cut(v, p1)`);
    const r = +/^[\d.]+/.exec(ball)[0] / 2;
    const want = whole.volume - (4 / 3) * PI * r ** 3;
    if (Object.keys(m.refusals).length) {
      assert.match(Object.values(m.refusals).join(' '), /cannot boolean/);
    } else {
      assert.ok(Math.abs(m.volume - want) <= 1e-6 * whole.volume, `${round} ${ball}: volume ${m.volume}, a void leaves ${want} (the rounded cylinder alone is ${whole.volume})`);
      assertWatertight(m);
    }
  }
});

// The same ball in a part with no round still builds as the sealed void it always did (the older path), so the guard must not
// have turned a build into a refusal.
test('a ball sealed inside a plain cylinder or a rounded box still builds as a void', () => {
  for (const code of [
    "let v = cylinder(38, 40, { at: [0, 0, 0] })\nconst p1 = sphere(8, { at: [0, 0, 0] })\nv = cut(v, p1)",
    "let v = box(40, 40, 40, { at: [0, 0, 0] })\nround(v.edge('bottom', 'front'), 3)\nconst p1 = sphere(8, { at: [0, 0, 0] })\nv = cut(v, p1)",
  ]) {
    const m = mine(code);
    assert.deepEqual(m.refusals, {}, code);
    assertWatertight(m);
    assertOcct(m, code);
  }
});

// seed 3 idx 6263 (and, before S4, any cut of one overlapping hollow part by another): an operand with a sealed cavity has two
// shells, and the per-face soundness probes can all miss the thin overlap of two walls, so cut(A, B) came back as A (10.2% high,
// refusals empty) and the third hollow box of a row joined 3.3% high. An operand with an inner shell now needs inclusion-exclusion
// with its partner operation; an answer is the exact one or a refusal.
test('overlapping hollow boxes: every boolean is exact or refused, never one operand unchanged', () => {
  const head = 'let a = box(54, 37, 11, { at: [0, 0, 0] })\nhollow(a, { wall: 1 })\nconst b = box(54, 37, 11, { at: [47, -1.4, 0] })\nhollow(b, { wall: 1 })\n';
  const third = 'const c = box(54, 37, 11, { at: [94, -2.8, 0] })\nhollow(c, { wall: 1 })\n';
  const truth = { cut: 5598 - 516.4, keep: 516.4, join: 2 * 5598 - 516.4 }; // OpenCascade agrees to 1e-12
  for (const [op, want] of Object.entries(truth)) {
    const m = mine(`${head}let r = ${op}(a, b)`);
    if (Object.keys(m.refusals).length) assert.match(Object.values(m.refusals).join(' '), /cannot boolean/, op);
    else assert.ok(Math.abs(m.volume - want) <= 1e-9 * want, `${op}: ${m.volume} vs ${want}`);
  }
  const row = mine(`${head}${third}let ab = join(a, b)\nlet abc = join(ab, c)`);
  if (Object.keys(row.refusals).length) assert.match(Object.values(row.refusals).join(' '), /cannot boolean/);
  else assert.ok(Math.abs(row.volume - 15761.2) <= 1e-9 * 15761.2, `three in a row: ${row.volume} vs 15761.2`);
  const pat = mine('let v = box(54, 37, 11, { at: [0, 0, 0] })\nhollow(v, { wall: 1 })\nrepeat(v, { count: 3, step: [47, -1.4, 0] })');
  if (Object.keys(pat.refusals).length) assert.match(Object.values(pat.refusals).join(' '), /overlap/);
  else assert.ok(Math.abs(pat.volume - 15761.2) <= 1e-9 * 15761.2, `pattern of three hollow boxes: ${pat.volume} vs 15761.2`);
});

// The same defect with ONE shell: two open cups (hollow ... open: 'top') are concave, so the half-space reading of the other operand
// is wrong too, and cut(A, B) came back as A (3778 for a true 3508.8, 7.7% high). A concave polyhedral operand needs the partner check.
test('overlapping open cups: cut and join are exact or refused', () => {
  const head = "let a = box(54, 37, 11, { at: [0, 0, 0] })\nhollow(a, { wall: 1, open: 'top' })\nconst b = box(54, 37, 11, { at: [47, -1.4, 0] })\nhollow(b, { wall: 1, open: 'top' })\n";
  const vA = 54 * 37 * 11 - 52 * 35 * 10;
  const shared = vA + vA - mine(`${head}let r = join(a, b)`).volume; // the join was always right; the others follow from it
  for (const [op, want] of [['cut', vA - shared], ['keep', shared]]) {
    const m = mine(`${head}let r = ${op}(a, b)`);
    if (Object.keys(m.refusals).length) assert.match(Object.values(m.refusals).join(' '), /cannot boolean/, op);
    else assert.ok(Math.abs(m.volume - want) <= 1e-9 * vA, `${op}: ${m.volume} vs ${want}`);
  }
  assert.ok(Math.abs(vA - shared - 3508.8) < 1e-6, `the open cups share ${shared}`);
});

// idx 3987 seed 1: the mirrored overlapping pattern of a drilled cylinder meshed open at chords 0.15 to 0.3 (closed at 0.05 and 0.5),
// so the pattern fold's own check at those two missed it. mesh_solid now retries an open mesh at nine finer chords.
test('a mirrored overlapping pattern of drilled cylinders meshes closed at every chord', () => {
  const m = mine("let v = cylinder(18.27, 14.36, { at: [0, 0, 0] })\nhole(v, { across: 3.15, at: [3.61, 1.87], deep: 2.6 })\nrepeat(v, { count: 3, step: [11.15, 1.43, 0] })\nv = mirror(v, 'left-right')");
  assert.deepEqual(m.refusals, {});
  // directed edges: every edge must be walked once each way (touching lumps and all)
  const openEdges = (defl) => {
    const mesh = JSON.parse(brep.mesh_feature(m.json, m.id, defl)), P = mesh.positions, I = mesh.indices, W = 1e-6, ids = new Map(), canon = [];
    for (let i = 0; i < P.length / 3; i++) { const k = [0, 1, 2].map((a) => Math.round(P[3 * i + a] / W)).join(','); if (!ids.has(k)) ids.set(k, ids.size); canon[i] = ids.get(k); }
    const dir = new Map();
    for (let t = 0; t < I.length; t += 3) { const c = [canon[I[t]], canon[I[t + 1]], canon[I[t + 2]]]; if (new Set(c).size < 3) continue; for (let e = 0; e < 3; e++) { const k = `${c[e]}>${c[(e + 1) % 3]}`; dir.set(k, (dir.get(k) ?? 0) + 1); } }
    let n = 0; for (const [k, c] of dir) { const [a, b] = k.split('>'); if ((dir.get(`${b}>${a}`) ?? 0) !== c) n++; }
    return n;
  };
  for (const defl of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) assert.equal(openEdges(defl), 0, `open edges at chord ${defl}`);
  assertOcct(m, 'mirrored drilled pattern');
});

// the aligned rows were always exact and must stay built (the guard may not turn a build into a refusal here)
test('aligned hollow boxes in a row still build, and agree with OpenCascade', () => {
  for (const [count, step] of [[2, 47], [3, 47], [4, 47], [3, 50]]) {
    const m = mine(`let v = box(54, 37, 11, { at: [0, 0, 0] })\nhollow(v, { wall: 1 })\nrepeat(v, { count: ${count}, step: [${step}, 0, 0] })`);
    assert.deepEqual(m.refusals, {});
    assertWatertight(m);
    assertOcct(m, `x${count} step ${step}`);
  }
});
