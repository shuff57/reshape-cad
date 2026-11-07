// A part made of several pieces in the unified set (docs/spikes/solidcraft-referee/GUARD-MULTIPIECE.md; audit BOOL-9 and PM-5).
//
// On the pin, through the host route, a cut or keep of a pull of two rectangles operated on the first piece only (10500 and 7500 where the part is 9000 and 3000), and
// a mirror of it mirrored the first piece only (18000 where it is 24000). The cause: the extrude-pocket step's measure counts the pieces ("b (2)"), and unified handed
// the other steps a copy of it with the piece names stripped. These tests run the audit's cases on a small EXACT engine: every body is a set of disjoint axis-aligned
// boxes, so a pull of rectangles, a cut, a keep, a join and a mirror across an axis plane have their closed-form volumes, and a body that falls apart is split into
// pieces named the way SolidCraft names them ("b", "b (2)", ...). It models no real kernel beyond that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';

const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const TR = Object.fromEntries(['unified', 'extrude-pocket', 'patterns-mirror'].map((p) => [p, lib.tr.createTranslator({ planners: p })]));

// ---- the exact box engine ---------------------------------------------------------------------------------------------------------------------------------------
const EPS = 1e-9;
const vol = (b) => (b.hi[0] - b.lo[0]) * (b.hi[1] - b.lo[1]) * (b.hi[2] - b.lo[2]);
const overlap = (a, b) => [0, 1, 2].map((i) => Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i]));
const meets = (a, b) => overlap(a, b).every((d) => d > EPS);
const inter = (a, b) => ({ lo: a.lo.map((v, i) => Math.max(v, b.lo[i])), hi: a.hi.map((v, i) => Math.min(v, b.hi[i])) });
/** a minus b: up to six disjoint boxes */
function sub(a, b) {
  if (!meets(a, b)) return [a];
  const out = []; let cur = { lo: [...a.lo], hi: [...a.hi] };
  for (let i = 0; i < 3; i++) {
    if (b.lo[i] > cur.lo[i] + EPS) { const lo = [...cur.lo]; const hi = [...cur.hi]; hi[i] = b.lo[i]; out.push({ lo, hi }); cur.lo[i] = b.lo[i]; }
    if (b.hi[i] < cur.hi[i] - EPS) { const lo = [...cur.lo]; const hi = [...cur.hi]; lo[i] = b.hi[i]; out.push({ lo, hi }); cur.hi[i] = b.hi[i]; }
  }
  return out;
}
const minus = (A, B) => B.reduce((acc, b) => acc.flatMap((a) => sub(a, b)), A);
const and = (A, B) => A.flatMap((a) => B.filter((b) => meets(a, b)).map((b) => inter(a, b)));
const or = (A, B) => [...A, ...minus(B, A)];
/** connected components: boxes that share a face (an area, not an edge or a point) are one piece */
function components(A) {
  const touch = (a, b) => { const d = overlap(a, b); return d.every((x) => x > -EPS) && d.filter((x) => x > EPS).length >= 2; };
  const seen = new Set(); const out = [];
  for (let i = 0; i < A.length; i++) {
    if (seen.has(i)) continue;
    const comp = []; const stack = [i]; seen.add(i);
    while (stack.length) { const k = stack.pop(); comp.push(A[k]); for (let j = 0; j < A.length; j++) if (!seen.has(j) && touch(A[k], A[j])) { seen.add(j); stack.push(j); } }
    out.push(comp);
  }
  return out;
}
function area(A) {
  let s = A.reduce((t, b) => { const d = [0, 1, 2].map((i) => b.hi[i] - b.lo[i]); return t + 2 * (d[0] * d[1] + d[1] * d[2] + d[0] * d[2]); }, 0);
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { const d = overlap(A[i], A[j]); if (d.every((x) => x > -EPS) && d.filter((x) => x > EPS).length === 2) s -= 2 * d.filter((x) => x > EPS).reduce((p, x) => p * x, 1); }
  return s;
}
function measureOf(name, A) {
  const v = A.reduce((t, b) => t + vol(b), 0);
  const faces = 6; // a plain block, or reported as one: no guard here reads more than "planar"
  return {
    name, volume_mm3: v, area_mm2: area(A), faces, kernel: { faces, edges: 12, vertices: 8, shells: 1 }, face_types: { plane: faces },
    bbox: { min: [0, 1, 2].map((i) => Math.min(...A.map((b) => b.lo[i]))), max: [0, 1, 2].map((i) => Math.max(...A.map((b) => b.hi[i]))) },
    center_of_mass: [0, 1, 2].map((i) => A.reduce((t, b) => t + vol(b) * (b.lo[i] + b.hi[i]) / 2, 0) / v),
  };
}

/** runSC over the exact box model. Every call simulates the command list from an empty design, as the bridge does. */
function exactEngine() {
  let calls = 0;
  const runSC = async (cmds) => {
    calls++;
    const sketches = new Map(); const bodies = new Map(); let cur = null;
    const fresh = (base) => { let k = 2; while (bodies.has(`${base} (${k})`)) k++; return `${base} (${k})`; };
    const place = (name, A) => { const cs = components(A); if (!cs.length) { bodies.delete(name); return; } bodies.set(name, cs[0]); for (const c of cs.slice(1)) bodies.set(fresh(name), c); };
    for (const c of cmds) {
      const p = c.params ?? {};
      if (c.command === 'sketch.create') { cur = { plane: p.plane, segs: [] }; sketches.set(p.name, cur); }
      else if (c.command === 'sketch.line') { const pts = p.points; for (let i = 0; i + 1 < pts.length; i++) cur.segs.push([pts[i], pts[i + 1]]); if (p.closed) cur.segs.push([pts[pts.length - 1], pts[0]]); }
      else if (c.command.startsWith('sketch.')) { /* rules and finish: the drawn rows are already where the rules put them */ }
      else if (c.command === 'solid.extrude' && p.operation === 'new') {
        const sk = sketches.get(p.sketch);
        if (!sk) return { ok: false, failed: { command: c.command, error: `exact: no sketch ${p.sketch}` } };
        // closed loops of the drawn segments; each is taken as the rectangle it bounds (the cases here draw rectangles only)
        const key = (q) => `${q[0]},${q[1]}`; const left = sk.segs.slice(); const rects = [];
        while (left.length) {
          const loop = [left.shift()]; let end = key(loop[0][1]);
          for (let guard = 0; guard < 1000 && end !== key(loop[0][0]); guard++) { const k = left.findIndex((s) => key(s[0]) === end || key(s[1]) === end); if (k < 0) break; const s = left.splice(k, 1)[0]; loop.push(s); end = key(s[0]) === end ? key(s[1]) : key(s[0]); }
          const xs = loop.flat().map((q) => q[0]); const ys = loop.flat().map((q) => q[1]);
          rects.push({ lo: [Math.min(...xs), Math.min(...ys)], hi: [Math.max(...xs), Math.max(...ys)] });
        }
        const chosen = p.profiles ? rects.filter((r) => p.profiles.some((q) => q.point[0] > r.lo[0] && q.point[0] < r.hi[0] && q.point[1] > r.lo[1] && q.point[1] < r.hi[1])) : rects;
        const { origin: o, x_dir: u, y_dir: v } = sk.plane; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const boxes = chosen.map((r) => {
          const pts = [];
          for (const x of [r.lo[0], r.hi[0]]) for (const y of [r.lo[1], r.hi[1]]) for (const t of [0, p.distance]) pts.push([0, 1, 2].map((i) => o[i] + u[i] * x + v[i] * y + n[i] * t));
          return { lo: [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))), hi: [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i]))) };
        });
        boxes.forEach((b, i) => bodies.set(i === 0 ? p.body_name : fresh(p.body_name), [b]));
      } else if (c.command === 'solid.combine') {
        const T = bodies.get(p.target); const tools = p.tools.map((t) => bodies.get(t));
        if (!T || tools.some((t) => !t)) return { ok: false, failed: { command: c.command, error: 'exact: no such body' } };
        const U = tools.reduce((acc, t) => or(acc, t), []);
        const R = p.operation === 'cut' ? minus(T, U) : p.operation === 'intersect' ? and(T, U) : or(T, U);
        if (!p.keep_tools) for (const t of p.tools) bodies.delete(t);
        place(p.target, R);
      } else if (c.command === 'solid.mirror') {
        const ax = p.plane.normal.findIndex((x) => Math.abs(x) > 0.5); const at = p.plane.origin[ax];
        for (const name of p.bodies) {
          const A = bodies.get(name); if (!A) return { ok: false, failed: { command: c.command, error: `exact: no such body ${name}` } };
          const M = A.map((b) => { const lo = [...b.lo]; const hi = [...b.hi]; lo[ax] = 2 * at - b.hi[ax]; hi[ax] = 2 * at - b.lo[ax]; return { lo, hi }; });
          place(name, p.combine ? or(A, M) : A);
          if (!p.combine) bodies.set(fresh(name), M);
        }
      } else return { ok: false, failed: { command: c.command, error: `exact: ${c.command} is not modelled` } };
    }
    return { ok: true, measure: { bodies: [...bodies].map(([name, A]) => measureOf(name, A)) } };
  };
  return { runSC, calls: () => calls };
}

// ---- the cases (the audit's, docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md "Live confirmation") ---------------------------------------------------------------
const TWO = "const s1 = sketch('top'); s1.rect(20, 20, { at: [-20, 0] }); s1.rect(20, 20, { at: [20, 0] }); const two = pull(s1, 15);";
const ONE = "const s1 = sketch('top'); s1.rect(60, 20); const two = pull(s1, 15);";
const TOOL = "const s2 = sketch('top'); s2.rect(60, 10, { at: [0, 10] }); const tool = pull(s2, 15);";
// closed forms: each piece is 20 x 20 x 15 = 6000, the tool 60 x 10 x 15 = 9000 and it overlaps each piece by 20 x 5 x 15 = 1500
const MULTI = [
  { id: 'BOOL-9 cut', src: `${TWO} ${TOOL} cut(two, tool)`, closed: 2 * (6000 - 1500) },
  { id: 'BOOL-9 keep', src: `${TWO} ${TOOL} keep(two, tool)`, closed: 2 * 1500 },
  { id: 'PM-5 mirror', src: `${TWO} mirror(two, 'top-bottom')`, closed: 2 * 12000 },
  { id: 'cut by two pieces', src: `${TWO} ${TOOL} cut(tool, two)`, closed: 9000 - 2 * 1500 },
  { id: 'join of two pieces', src: `${TWO} ${TOOL} join(two, tool)`, closed: 2 * 6000 + 9000 - 2 * 1500 },
  { id: 'mirror of the cut', src: `${TWO} ${TOOL} const c = cut(two, tool); mirror(c, 'top-bottom')`, closed: 2 * 2 * (6000 - 1500) },
];
const SINGLE = [
  { id: 'one piece, cut', src: `${ONE} ${TOOL} cut(two, tool)`, closed: 18000 - 4500 },
  { id: 'one piece, keep', src: `${ONE} ${TOOL} keep(two, tool)`, closed: 4500 },
  { id: 'one piece, mirror', src: `${ONE} mirror(two, 'top-bottom')`, closed: 36000 },
];
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
const run = async (set, doc, level) => {
  const eng = exactEngine();
  const { _state, ...tr } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC: eng.runSC, soups: {}, followMoves: true, ...(level ? { unifiedEpJoinChecks: level } : {}) });
  const scene = await eng.runSC(tr.commands);
  return { tr, last: tr.features[tr.features.length - 1], scene: scene.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) };
};
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
// the host runs the unified set at 'full' (packages/solidcraft-host/pane/src/host-entry.mjs HOST_EP_JOIN_CHECKS); the library default is 'cheap'
const LEVELS = ['full', 'cheap'];

test('the exact engine reproduces the two-piece pull', async () => {
  const r = await run('unified', docOf(TWO), 'full');
  assert.equal(r.last.status, 'built');
  assert.deepStrictEqual(r.last.measure.bodies, ['b_pull1', 'b_pull1 (2)']);
  assert.ok(near(r.last.measure.volume, 12000));
});

test('a cut, keep, join and mirror of a part that is two pieces: every piece is in it (BOOL-9, PM-5), built to the closed form', async () => {
  for (const level of LEVELS) for (const c of MULTI) {
    const r = await run('unified', docOf(c.src), level);
    const bad = r.tr.features.filter((f) => f.status === 'refused');
    assert.deepStrictEqual(bad.map((f) => `${f.id}: ${f.refusal}`), [], `${c.id} (${level})`);
    assert.equal(r.last.status, 'built', `${c.id} (${level})`);
    assert.ok(near(r.last.measure.volume, c.closed), `${c.id} (${level}): the feature measures ${r.last.measure.volume}, closed form ${c.closed}`);
    assert.ok(near(r.scene, c.closed), `${c.id} (${level}): the scene is ${r.scene}, closed form ${c.closed}`);
  }
});

test('the mirror of two pieces is what the patterns-mirror set alone builds; the extrude-pocket set still refuses the cut and keep in its own sentence', async () => {
  const doc = docOf(MULTI[2].src);
  const u = await run('unified', doc, 'full'); const pm = await run('patterns-mirror', doc);
  assert.equal(pm.last.status, 'built');
  assert.ok(near(pm.last.measure.volume, 24000));
  assert.ok(near(u.last.measure.volume, pm.last.measure.volume));
  for (const [c, word] of [[MULTI[0], 'subtract'], [MULTI[1], 'intersect']]) {
    const ep = await run('extrude-pocket', docOf(c.src));
    assert.equal(ep.last.status, 'refused');
    assert.equal(ep.last.refusal, `op1: a ${word} is not built yet when one of its parts is 2 separate pieces; make every part one piece`);
  }
});

test('a step that needs ONE body now sees the pieces and refuses in its own existing sentence (pattern, hollow)', async () => {
  const pat = await run('unified', docOf(`${TWO} repeat(two, { count: 2, step: [0, 40, 0] })`), 'full');
  assert.equal(pat.last.status, 'refused');
  assert.equal(pat.last.refusal, 'repeat(): this works on one shape at a time, and what it was given is several separate shapes -- join them first.');
  const hol = await run('unified', docOf(`${TWO} hollow(two, { wall: 2 })`), 'full');
  assert.equal(hol.last.status, 'refused');
  assert.equal(hol.last.refusal, 'shell1 (hollow): pull1 is not a single solid, so shell1 is shown without it.');
});

test('a part of one piece: unchanged (the same commands and the closed form, cut / keep / mirror)', async () => {
  for (const level of LEVELS) for (const c of SINGLE) {
    const r = await run('unified', docOf(c.src), level);
    assert.equal(r.last.status, 'built', `${c.id} (${level}): ${r.last.refusal}`);
    assert.ok(near(r.last.measure.volume, c.closed), `${c.id} (${level}): ${r.last.measure.volume} vs ${c.closed}`);
    assert.ok(near(r.scene, c.closed));
    assert.deepStrictEqual(r.last.measure.bodies, ['b_pull1']);
  }
  // the one-piece cut is a single solid.combine of the part with the tool, as before the change
  const r = await run('unified', docOf(SINGLE[0].src), 'full');
  const combines = r.tr.commands.filter((c) => c.command === 'solid.combine');
  assert.deepStrictEqual(combines, [{ command: 'solid.combine', params: { target: 'b_pull1', tools: ['b_pull2'], operation: 'cut' } }]);
});
