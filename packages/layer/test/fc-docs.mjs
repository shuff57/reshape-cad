// Generated ModelDocs for the fillet-chamfer differential and the unified test: one blend of a box edge (every size from nothing to past the face, round and bevel), of a cylinder rim, runs of consecutive
// same-size blends that the group hands to the kernel as one call (connected edges, disjoint edges, the same edge twice, three bevels at a corner, a whole box), blends of different sizes in a row, the
// whole-shape round of every primitive (zero, negative, tiny, valid, bevelled box), a hollow after a rounded open edge (the knife-edge rim), blends after another group's kinds, blends that name nothing, and
// malformed or dependent features. Plain data, seeded, no engine.
import { box, cyl, sphere, cone, torus, prism, wedge, rect, extrude, pocket, combine, mirror, pattern, hole, shell, move, rotate, fillet, between, prim, carried } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_THEMES = 12;
const FACE_PARTS = ['+x', '-x', '+y', '-y', '+z', '-z'];
const AXIS = { '+x': 0, '-x': 0, '+y': 1, '-y': 1, '+z': 2, '-z': 2 };
const EDGES = [];
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (AXIS[FACE_PARTS[i]] !== AXIS[FACE_PARTS[j]]) EDGES.push([FACE_PARTS[i], FACE_PARTS[j]]);
/** the edges of a box that share an end point with an edge (they share a face and the third axis is free) */
const touching = (a, b) => { const sh = a.filter((p) => b.includes(p)).length; const [a0, a1] = a, [b0, b1] = b; if (sh === 2) return false; const free = (e) => [0, 1, 2].find((k) => AXIS[e[0]] !== k && AXIS[e[1]] !== k); const corner = (e, s) => { const v = [0, 0, 0]; v[AXIS[e[0]]] = e[0][0] === '+' ? 1 : -1; v[AXIS[e[1]]] = e[1][0] === '+' ? 1 : -1; v[free(e)] = s; return v.join(); }; return [-1, 1].some((s) => [-1, 1].some((t) => corner([a0, a1], s) === corner([b0, b1], t))); };

export function fcDoc(seed) {
  const r = mulberry32(seed * 7919 + 101);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const q = (lo, hi, k = 4) => Math.round((lo + r() * (hi - lo)) * k) / k;
  const theme = seed % N_THEMES;
  const feats = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const STYLE = () => pick(['fillet', 'chamfer']);
  const dims = () => [pick([20, 30, 40, 24, 50]), pick([20, 30, 16, 40]), pick([6, 10, 20, 30])];
  const bx = (extra = {}) => { const d = dims(); const b = box(id('b'), d, [0, 0, 0], extra); feats.push(b); return b; };
  const edgeOf = (host, e, partsHost = host) => between(host, prim(partsHost, e[0]), prim(partsHost, e[1]));
  const SIZE = () => pick([0.005, 0.01, 0.5, 1, 1.5, 2, 3, 4, 5, 7, 9.99, 10, 12, 0.02, 2.5]);
  const blend = (target, edge, size, style) => { const f = fillet(id(style === 'chamfer' ? 'bevel' : 'round'), target.id ?? target, edge, size, style); feats.push(f); return f; };

  if (theme === 0) { // one blend on a box edge
    const b = bx(); const e = pick(EDGES);
    blend(b, edgeOf(b.id, e), SIZE(), STYLE());
    if (r() < 0.3) blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), SIZE(), STYLE());
  } else if (theme === 1) { // a cylinder rim
    const c = cyl(id('c'), pick([8, 15, 5]), pick([10, 20, 3]), [0, 0, 0]); feats.push(c);
    const part = pick(['+z', '-z']);
    blend(c, between(c.id, prim(c.id, part), prim(c.id, 'side')), pick([0.5, 1, 3, 4, 4.5, 7, 7.5, 14.9, 15, 0.005, 2]), STYLE());
    if (r() < 0.4) blend(feats[feats.length - 1], between(c.id, prim(c.id, part === '+z' ? '-z' : '+z'), prim(c.id, 'side')), pick([1, 2, 3]), STYLE());
  } else if (theme === 2) { // a run of same-size blends on connected edges (one call per connected component)
    const b = bx(); const style = STYLE(); const size = pick([0.5, 1, 2, 3]);
    const set = [pick(EDGES)];
    for (let k = 0, want = 2 + Math.floor(r() * 5); k < 40 && set.length < want; k++) { const e = pick(EDGES); if (!set.some((x) => x[0] === e[0] && x[1] === e[1]) && set.some((x) => touching(x, e))) set.push(e); }
    let prev = b.id;
    for (const e of set) prev = blend(prev, edgeOf(b.id, e), size, style).id;
  } else if (theme === 3) { // same-size blends on edges that do not touch, the same edge twice, edges of one face that crowd each other
    const b = bx(); const style = STYLE(); const size = pick([1, 2, 3, 5, 8, 12]);
    const es = [];
    const k = pick(['twice', 'opposite', 'random', 'opposite']);
    if (k === 'twice') { const e = pick(EDGES); es.push(e, e); } else if (k === 'opposite') es.push(['+z', '-y'], ['+z', '+y']); else for (let i = 0; i < 2 + Math.floor(r() * 3); i++) es.push(pick(EDGES));
    let prev = b.id;
    for (const e of es) prev = blend(prev, edgeOf(b.id, e), size, style).id;
  } else if (theme === 4) { // blends of different sizes or styles in a row, on touching edges
    const b = bx(); let prev = b.id;
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) prev = blend(prev, edgeOf(b.id, pick(EDGES)), pick([0.5, 1, 2, 3, 2]), r() < 0.3 ? STYLE() : 'fillet').id;
  } else if (theme === 5) { // the whole-shape round of a primitive
    const k = pick(['box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone', 'prism', 'wedge', 'torus']);
    const round = pick([0, -1, 0.005, 0.01, 0.5, 1, 2, 3, 4, 5, 9]);
    const extra = { round, ...(r() < 0.5 ? { roundStyle: 'chamfer' } : r() < 0.3 ? { roundStyle: 'fillet' } : {}) };
    const f = k === 'box' ? box(id('b'), dims(), [0, 0, 0], extra) : k === 'cylinder' ? cyl(id('c'), 8, 12, [0, 0, 0], extra) : k === 'sphere' ? { ...sphere(id('s'), 6), ...extra } : k === 'cone' ? cone(id('n'), 6, 10, [0, 0, 0], extra)
      : k === 'prism' ? prism(id('p'), 6, 7, 9, [0, 0, 0], extra) : k === 'wedge' ? wedge(id('w'), 12, 8, 6, [0, 0, 0], extra) : torus(id('t'), 10, 2, [0, 0, 0], extra);
    feats.push(f);
    if (r() < 0.5) blend(f, edgeOf(f.id, pick(EDGES)), pick([0.5, 1, 2]), STYLE());
    if (r() < 0.3) { const m = move(id('m'), f.id, [5, 0, 0]); feats.push(m); }
  } else if (theme === 6) { // a hollow after a rounded edge of the face it opens (the knife-edge rim), a bevel, a blend of another edge, a chain of blends
    const b = bx(); const wall = pick([1, 2, 3]); const size = pick([1, 2, 2, 3, 4]);
    const topEdge = pick([['+z', '+x'], ['+z', '-y'], ['+z', '+y'], ['+z', '-x']]);
    let t = blend(b, edgeOf(b.id, topEdge), size, pick(['fillet', 'fillet', 'chamfer']));
    if (r() < 0.3) t = blend(t, edgeOf(b.id, pick(EDGES)), pick([1, 2]), 'fillet');
    feats.push(shell(id('s'), t.id, r() < 0.9 ? prim(b.id, '+z') : prim(b.id, pick(FACE_PARTS)), wall));
  } else if (theme === 7) { // blends before and after other kinds
    const b = bx(); const e = edgeOf(b.id, pick(EDGES));
    const t = blend(b, e, pick([0.5, 1, 2]), STYLE());
    const k = pick(['move', 'hole', 'pocket', 'combine', 'rotate', 'mirror', 'pattern', 'blend']);
    if (k === 'move') { feats.push(move(id('m'), t.id, [3, 0, 0])); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else if (k === 'hole') { feats.push(hole(id('h'), t.id, {})); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else if (k === 'pocket') { feats.push(rect(id('sk'), 5, 5)); feats.push(pocket(id('pk'), feats[feats.length - 1].id, t.id, 2)); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else if (k === 'combine') { const b2 = box(id('b'), [10, 10, 10], [10, 0, 0]); feats.push(b2); feats.push(combine(id('c'), 'union', [t.id, b2.id])); blend(feats[feats.length - 1], between(feats[feats.length - 1].id, carried(feats[feats.length - 1].id, prim(b.id, '+z')), carried(feats[feats.length - 1].id, prim(b.id, '+y'))), 1, 'fillet'); }
    else if (k === 'rotate') { feats.push(rotate(id('rt'), t.id, [0, 0, 45])); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else if (k === 'mirror') { feats.push(mirror(id('x'), t.id, 'yz')); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else if (k === 'pattern') { feats.push(pattern(id('pt'), t.id, { count: 2 })); blend(feats[feats.length - 1], edgeOf(b.id, pick(EDGES)), 1, 'fillet'); }
    else { const t2 = blend(t, edgeOf(b.id, pick(EDGES)), pick([0.5, 1, 2]), STYLE()); feats.push(move(id('m'), t2.id, [2, 0, 0])); }
  } else if (theme === 8) { // blends that name nothing, a target that is not a solid, a refused target
    const b = bx();
    const k = pick(['face', 'one', 'nohost', 'sketch', 'ghost', 'dead', 'used', 'size']);
    if (k === 'face') blend(b, prim(b.id, '+z'), 1, 'fillet');
    else if (k === 'one') feats.push({ ...fillet(id('f'), b.id, edgeOf(b.id, ['+z', '+x']), 1), edge: { cause: 'between', feature: b.id, kind: 'edge', of: [prim(b.id, '+z')] } });
    else if (k === 'nohost') blend(b, between('zz', prim(b.id, '+z'), prim(b.id, '+x')), 1, 'fillet');
    else if (k === 'sketch') { const s = rect(id('sk'), 10, 10); feats.push(s); blend(s, edgeOf(b.id, ['+z', '+x']), 1, 'fillet'); }
    else if (k === 'ghost') { const g = box('ghost1', [10, 10, 10]); feats.push(g); blend(g, edgeOf('ghost1', ['+z', '+x']), 1, 'fillet'); }
    else if (k === 'dead') { const t = blend(b, edgeOf(b.id, ['+z', '+x']), 9, 'fillet'); blend(t, edgeOf(b.id, ['+z', '+y']), 1, 'fillet'); feats.push(move(id('m'), t.id, [1, 0, 0])); }
    else if (k === 'used') { const t = blend(b, edgeOf(b.id, ['+z', '+x']), 1, 'fillet'); blend(b, edgeOf(b.id, ['+z', '+y']), 1, 'fillet'); feats.push(move(id('m'), t.id, [1, 0, 0])); }
    else feats.push({ ...fillet(id('f'), b.id, edgeOf(b.id, ['+z', '+x']), 'big'), size: pick(['big', null, NaN]) });
  } else if (theme === 9) { // bevels at a corner: three meeting, the whole top loop, all twelve
    const b = bx(); const style = pick(['chamfer', 'chamfer', 'fillet']); const size = pick([0.5, 1, 2, 3]);
    const set = pick([[['+z', '-y'], ['+z', '+x'], ['-y', '+x']], [['+z', '+x'], ['+z', '-x'], ['+z', '+y'], ['+z', '-y']], EDGES]);
    let prev = b.id;
    for (const e of set) prev = blend(prev, edgeOf(b.id, e), size, style).id;
  } else if (theme === 10) { // blends after a hole or a pocket, named by what carried the face
    const b = bx(); const k = pick(['hole', 'pocket']);
    let t;
    if (k === 'hole') { t = hole(id('h'), b.id, { center: [pick([0, 5, 12]), 0, 0] }); feats.push(t); } else { const s = rect(id('sk'), 6, 6); feats.push(s); t = pocket(id('pk'), s.id, b.id, 2); feats.push(t); }
    const name = r() < 0.6 ? between(b.id, carried(t.id, prim(b.id, '+z')), prim(b.id, pick(['+x', '+y', '-x']))) : edgeOf(b.id, pick(EDGES));
    blend(t, name, pick([0.5, 1, 2, 5]), STYLE());
  } else { // two blends of the same edge, in every order and size
    const b = bx(); const e = pick(EDGES);
    const t = blend(b, edgeOf(b.id, e), pick([1, 2]), STYLE());
    blend(t, edgeOf(b.id, e), pick([1, 2]), STYLE());
  }
  return { version: 1, features: feats };
}

// ---- the combined documents (several groups' kinds) with blends of an edge of a box among the parts, on the part they end with -------------------------------------------------
import { combinedDoc } from './unified-docs.mjs';
const SOLIDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'extrude', 'combine', 'revolve', 'blend', 'move', 'rotate', 'mirror', 'pattern', 'hole', 'pocket', 'shell', 'draft', 'groove', 'fillet'];

/** A combined document of the earlier groups' corpus with one to three blends (round or bevel, a run of the same size half of the time) of an edge of its first box on the part it ends with, and sometimes a hollow after them. */
export function fcCombinedDoc(seed) {
  const r = mulberry32(seed * 104729 + 31);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const doc = combinedDoc(9000 + seed);
  const feats = doc.features.slice();
  let into = null; for (let i = feats.length - 1; i >= 0; i--) if (SOLIDS.includes(feats[i].kind)) { into = feats[i].id; break; }
  const root = feats.find((f) => f.kind === 'box');
  let n = 0;
  if (into && root) {
    const style = pick(['fillet', 'chamfer']); const size = pick([0.5, 1, 2, 3, 6]);
    const k = 1 + Math.floor(r() * 3);
    let prev = into;
    for (let i = 0; i < k; i++) {
      const e = pick(EDGES);
      const f = fillet(`${style === 'chamfer' ? 'bevel' : 'round'}z${++n}`, prev, between(root.id, prim(root.id, e[0]), prim(root.id, e[1])), r() < 0.5 ? size : pick([0.5, 1, 2, 3, 6]), r() < 0.7 ? style : pick(['fillet', 'chamfer']));
      feats.push(f); prev = f.id;
    }
    if (r() < 0.25) feats.push(shell(`sz${++n}`, prev, prim(root.id, '+z'), pick([1, 2, 3])));
  }
  return { version: 1, features: feats };
}
