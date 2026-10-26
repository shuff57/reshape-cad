// Generated ModelDocs for the booleans differential and the unified test: operands of every primitive kind (axis-aligned, turned by 90 / 45 / a generic angle, rounded), pulled and spun
// solids (a ring-shaped spin is a TUBE tool), joins / cuts / keeps of two to four operands with the offsets that matter to the group's guards (apart, touching along a face, an edge or a point,
// overlapping, a sliver, tangent sides, a tool wholly inside), a cut that splits the part in two pieces and what follows it, a tool a later feature uses again (keep_tools), chains of combines
// with moves, turns, mirrors and patterns in between, a combine of a refused or used-up operand, and combines of a curved remainder. Plain data, seeded, no engine.
import { box, cyl, sphere, cone, torus, prism, wedge, rect, circ, extrude, pocket, revolve, combine, mirror, pattern, hole, move, rotate, fillet } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_THEMES = 12;

export function boolDoc(seed) {
  const r = mulberry32(seed * 7919 + 101);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const q = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const theme = seed % N_THEMES;
  const feats = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const OPS = ['union', 'subtract', 'intersect'];
  const turn = () => pick([undefined, undefined, undefined, [0, 0, 90], [0, 90, 0], [90, 0, 0], [0, 0, 45], [0, 0, 30], [20, 10, 5]]);
  const prime = (kind, at, big = false) => {
    const i = id(kind[0]);
    const k = big ? 1.6 : 1;
    const rot = r() < 0.18 ? turn() : undefined;
    const x = rot ? { rotate: rot } : {};
    let f;
    if (kind === 'box') f = box(i, [pick([8, 10, 12, 20]) * k, pick([8, 10, 16]) * k, pick([4, 6, 10, 20]) * k], at, r() < 0.07 ? { round: 1, ...x } : x);
    else if (kind === 'cylinder') f = cyl(i, pick([3, 4, 5, 6]) * k, pick([8, 12, 20]) * k, at, x);
    else if (kind === 'sphere') f = sphere(i, pick([3, 5, 8]) * k, at);
    else if (kind === 'cone') f = cone(i, pick([4, 6]) * k, pick([8, 12]) * k, at, x);
    else if (kind === 'torus') f = torus(i, pick([8, 10]) * k, pick([1, 2, 3]), at, x);
    else if (kind === 'prism') f = prism(i, pick([3, 4, 6]), pick([5, 7]) * k, pick([6, 10]) * k, at, x);
    else f = wedge(i, pick([8, 12]) * k, pick([6, 8]) * k, pick([4, 6]) * k, at, x);
    feats.push(f);
    return f;
  };
  const kinds = ['box', 'box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge'];
  const at = (spread) => [q(-spread, spread), q(-spread, spread), q(-spread / 2, spread / 2)];
  const comb = (op, targets) => { const c = combine(id('c'), op, targets); feats.push(c); return c; };

  if (theme === 0) { // two boxes: apart, touching a face / an edge / a point, overlapping, a sliver
    const a = prime('box', [0, 0, 0], true);
    const [w, d, h] = a.rotate ? [20, 20, 20] : a.size;
    const gap = pick([0, 0.0003, 0.002, 0.05, 1, 5, -0.003, -0.05, -3, -w / 2]);
    const off = pick([[w / 2, 0, 0], [w / 2, d / 2, 0], [w / 2, d / 2, h / 2], [0, 0, 0], [3, 2, 1]]);
    const b = box(id('b'), [pick([6, 10, 14]), pick([6, 10]), pick([6, 10, 20])], off.map((v, i) => (i === 0 && v !== 0 ? v + gap : v)));
    feats.push(b);
    comb(pick(OPS), [a.id, b.id]);
    if (r() < 0.4) comb(pick(OPS), [feats[feats.length - 1].id, prime(pick(kinds), at(10)).id]);
  } else if (theme === 1) { // a box and a cylinder: through, blind, tangent to one, two, four sides, wholly inside
    const W = pick([20, 30, 40]); const D = pick([20, 30, 40]); const H = pick([10, 20]);
    const a = box(id('b'), [W, D, H], [0, 0, 0]); feats.push(a);
    const rad = pick([3, 5, W / 2, D / 2, Math.min(W, D) / 2, 4]);
    const cx = pick([0, W / 2 - rad, -(W / 2 - rad), W / 2 - rad + 0.0004, 2]); const cy = pick([0, D / 2 - rad, -(D / 2 - rad), 3]);
    const hh = pick([H, H * 2, H / 2, H - 2, 4]); const cz = pick([0, (H - hh) / 2, (hh - H) / 2 * 0, H / 2 - hh / 2]);
    const t = cyl(id('t'), rad, hh, [cx, cy, cz], pick([{}, {}, { rotate: [0, 0, 45] }])); feats.push(t);
    comb(pick(['subtract', 'subtract', 'union', 'intersect']), [a.id, t.id]);
    if (r() < 0.35) { const t2 = cyl(id('t'), pick([2, 3]), H * 2, [pick([-8, 8]), pick([-5, 5]), 0]); feats.push(t2); comb('subtract', [feats[feats.length - 2].id, t2.id]); }
  } else if (theme === 2) { // curved pairs: cylinders crossing, a ball and a cylinder, a cone and a ball, a torus and a cylinder, a hollow ball
    const k = pick(['cc', 'sc', 'cone', 'torus', 'hollow', 'ss', 'torusbox']);
    if (k === 'cc') { const a = cyl(id('c'), 5, 20, [0, 0, 0]); const b = cyl(id('c'), pick([3, 5, 7]), pick([12, 20]), [pick([0, 0, 2, 4]), pick([0, 3]), 0], { rotate: pick([undefined, [90, 0, 0], [0, 90, 0], [0, 0, 45]]) }); feats.push(a, b); comb(pick(OPS), [a.id, b.id]); }
    else if (k === 'sc') { const s = sphere(id('s'), 8, [0, 0, 0]); const c = cyl(id('c'), 3, 24, [pick([0, 0, 1]), 0, 0]); feats.push(s, c); comb(pick(OPS), [s.id, c.id]); }
    else if (k === 'cone') { const a = cone(id('k'), 6, 12, [0, 0, 0]); const b = pick([cyl(id('c'), 3, 16, [pick([0, 0, 2]), 0, 0]), sphere(id('s'), 5, [pick([0, 0, 2]), 0, 0]), cone(id('k'), 4, 10, [0, 0, pick([0, 3])])]); feats.push(a, b); comb(pick(OPS), [a.id, b.id]); }
    else if (k === 'torus') { const t = torus(id('t'), 10, 2, [0, 0, 0]); const c = cyl(id('c'), pick([8, 12, 10, 6]), 10, [0, 0, 0]); feats.push(t, c); comb(pick(OPS), [t.id, c.id]); }
    else if (k === 'hollow') { const s1 = sphere(id('s'), 10, [0, 0, 0]); const s2 = sphere(id('s'), pick([4, 6]), [pick([0, 2]), 0, 0]); feats.push(s1, s2); comb('subtract', [s1.id, s2.id]); }
    else if (k === 'ss') { const s1 = sphere(id('s'), 8, [0, 0, 0]); const s2 = sphere(id('s'), pick([5, 8]), [pick([4, 8, 12]), 0, 0]); feats.push(s1, s2); comb(pick(OPS), [s1.id, s2.id]); }
    else { const t = torus(id('t'), 8, 2, [0, 0, 0]); const b = box(id('b'), pick([[30, 30, 10], [12, 12, 4], [20, 20, 3]]), [0, 0, 0]); feats.push(t, b); comb(pick(OPS), [b.id, t.id]); }
  } else if (theme === 3) { // three and four operands; the same operand twice
    const a = prime('box', [0, 0, 0], true); const b = prime(pick(kinds), at(8)); const c = prime(pick(kinds), at(12)); const ids = [a.id, b.id, c.id];
    if (r() < 0.4) ids.push(prime(pick(kinds), at(12)).id);
    if (r() < 0.2) ids[ids.length - 1] = ids[1];
    comb(pick(OPS), ids);
  } else if (theme === 4) { // a cut that splits the part in two, then what follows it
    const W = pick([30, 40]); const a = box(id('b'), [W, 20, 10], [0, 0, 0]); feats.push(a);
    const t = box(id('t'), [pick([4, 6, 10]), 40, 20], [pick([0, 5, -5]), 0, 0]); feats.push(t);
    const c1 = comb('subtract', [a.id, t.id]);
    const after = pick(['cut', 'join', 'keep', 'hole', 'pocket', 'move', 'pattern', 'mirror', 'fillet', 'second']);
    if (after === 'cut') { const t3 = box(id('t'), [4, 4, 30], [pick([-12, 12]), 0, 0]); feats.push(t3); comb('subtract', [c1.id, t3.id]); }
    else if (after === 'join') { const j = box(id('b'), [8, 8, 8], [pick([-12, 12]), 0, 0]); feats.push(j); comb('union', [c1.id, j.id]); }
    else if (after === 'keep') { const k = box(id('b'), [W * 2, 8, 30], [0, 0, 0]); feats.push(k); comb('intersect', [c1.id, k.id]); }
    else if (after === 'hole') feats.push(hole(id('h'), c1.id, {}));
    else if (after === 'pocket') { const s = id('sk'); feats.push(rect(s, 5, 5), pocket(id('pk'), s, c1.id, 3)); }
    else if (after === 'move') feats.push(move(id('m'), c1.id, [5, 0, 0]));
    else if (after === 'pattern') feats.push(pattern(id('p'), c1.id, { count: 2, step: [0, 40, 0] }));
    else if (after === 'mirror') feats.push(mirror(id('x'), c1.id, 'xz'));
    else if (after === 'fillet') feats.push(fillet(id('f'), c1.id, { cause: 'between', feature: c1.id, kind: 'edge', of: ['+z', '+x'] }, 1));
    else { const t2 = box(id('t'), [4, 40, 20], [pick([-12, 12]), 0, 0]); feats.push(t2); comb('subtract', [c1.id, t2.id]); }
  } else if (theme === 5) { // a tool a later feature uses again
    const a = box(id('b'), [30, 30, 10], [0, 0, 0]); const t = cyl(id('t'), pick([4, 5]), 20, [pick([0, 6]), 0, 0]); feats.push(a, t);
    const c1 = comb(pick(['subtract', 'intersect', 'union']), [a.id, t.id]);
    const b2 = box(id('b'), [20, 20, 10], [pick([30, 12, 40]), 0, 0]); feats.push(b2);
    comb(pick(OPS), [b2.id, t.id]);
    if (r() < 0.4) comb(pick(OPS), [c1.id, feats[feats.length - 1].id]);
  } else if (theme === 6) { // turned operands: slivers between turned boxes, a tilted cylinder against a box
    const a = box(id('b'), [20, 20, 10], [0, 0, 0], { rotate: pick([undefined, [0, 0, 45], [0, 0, 30], [10, 20, 30]]) }); feats.push(a);
    const t = pick([cyl(id('c'), 4, 16, [pick([0, 5]), 0, 0], { rotate: pick([undefined, [0, 90, 0], [30, 0, 0], [0, 0, 45]]) }), box(id('b'), [10, 10, 10], [pick([9.9, 10.05, 14, 8]), 0, 0], { rotate: pick([undefined, [0, 0, 45], [0, 0, 30]]) })]); feats.push(t);
    comb(pick(OPS), [a.id, t.id]);
  } else if (theme === 7) { // pulled and spun operands: a ring is a TUBE tool
    const kind = pick(['pull', 'ring', 'spin', 'circle']);
    const base = box(id('b'), [30, 30, 20], [0, 0, 0]); feats.push(base);
    if (kind === 'pull') { const s = id('sk'); const e = id('e'); feats.push({ ...rect(s, 10, 8), points: [[-5, -4], [5, -4], [5, 4], [-5, 4]] }, extrude(e, s, pick([8, 30]))); comb(pick(OPS), [base.id, e]); }
    else if (kind === 'circle') { const s = id('sk'); const e = id('e'); feats.push(circ(s, pick([4, 5, 15, 10]), pick([0, 5, 10]), 0), extrude(e, s, pick([8, 30]))); comb(pick(OPS), [base.id, e]); }
    else { const s = id('sk'); const v = id('v'); feats.push({ ...rect(s, 6, 14), points: kind === 'ring' ? [[3, 0], [6, 0], [6, 14], [3, 14]] : [[0, 0], [6, 0], [6, 14], [0, 14]] }, revolve(v, s, pick([360, 360, 180]))); comb(pick(['subtract', 'subtract', 'union', 'intersect']), [base.id, v]); }
  } else if (theme === 8) { // chains of combines with moves, turns, mirrors, patterns between
    const a = prime('box', [0, 0, 0], true); let cur = a.id;
    const steps = 2 + Math.floor(r() * 3);
    for (let i = 0; i < steps; i++) {
      const w = pick(['comb', 'comb', 'move', 'rotate', 'mirror', 'pattern', 'hole']);
      if (w === 'comb') { const t = prime(pick(kinds), at(10)); cur = comb(pick(OPS), [cur, t.id]).id; }
      else if (w === 'move') { feats.push(move(id('m'), cur, [pick([2, -3, 6]), 0, 0])); cur = feats[feats.length - 1].id; }
      else if (w === 'rotate') { feats.push(rotate(id('r'), cur, pick([[0, 0, 90], [0, 0, 45]]))); cur = feats[feats.length - 1].id; }
      else if (w === 'mirror') { feats.push(mirror(id('x'), cur, pick(['yz', 'xz']))); cur = feats[feats.length - 1].id; }
      else if (w === 'pattern') { feats.push(pattern(id('p'), cur, { count: 2, step: [pick([40, 25]), 0, 0] })); cur = feats[feats.length - 1].id; }
      else { feats.push(hole(id('h'), cur, { diameter: 3, depth: 8 })); cur = feats[feats.length - 1].id; }
    }
  } else if (theme === 9) { // a curved remainder (G21), a keep that overshoots (G19)
    const k = pick(['rim', 'cap', 'slab']);
    if (k === 'rim') { const c = cyl(id('c'), 10, 20, [0, 0, 0]); const b = box(id('b'), [pick([20.2, 20.6, 22, 30]), pick([20.2, 21, 30]), 24], [0, 0, 0]); feats.push(c, b); comb('subtract', [c.id, b.id]); }
    else if (k === 'cap') { const p = box(id('b'), [400, 400, 20], [0, 0, 0]); const s = sphere(id('s'), pick([140, 200, 60]), [0, 0, pick([140 + 8, 200 + 3, 60 + 6, 140 + 5])]); feats.push(p, s); comb('intersect', [p.id, s.id]); }
    else { const p = box(id('b'), [100, 100, 20], [0, 0, 0]); const c = cyl(id('c'), pick([30, 120, 500]), 40, [50 + 30 - pick([3, 6, 20]), 0, 0]); feats.push(p, c); comb(pick(['intersect', 'subtract']), [p.id, c.id]); }
  } else if (theme === 10) { // dependencies: a refused or used-up operand, a combine of a combine, a one-target combine
    const a = box(id('b'), [20, 20, 10], [0, 0, 0]); const b = box(id('b'), [10, 10, 10], [8, 0, 0]); feats.push(a, b);
    const w = pick(['refused', 'used', 'one', 'missing', 'ghost']);
    if (w === 'refused') { const bad = comb('union', [a.id, a.id]); feats.push(hole(id('h'), bad.id, {})); comb('subtract', [bad.id, b.id]); }
    else if (w === 'used') { comb('union', [a.id, b.id]); comb('subtract', [a.id, b.id]); feats.push(move(id('m'), b.id, [1, 0, 0])); }
    else if (w === 'one') { comb('union', [a.id]); comb('union', [b.id]); }
    else if (w === 'missing') { comb('subtract', [a.id, 'nope']); comb('union', [id('z'), b.id]); }
    else { const g = box('ghost1', [10, 10, 10], [4, 0, 0]); feats.push(g); comb('union', [a.id, g.id]); comb('intersect', [b.id, g.id]); }
  } else { // a mix: rounded boxes (G18), holes and pockets before and after, pieces of a pattern as operands
    const a = box(id('b'), [30, 30, 20], [0, 0, 0], r() < 0.5 ? { round: 3 } : {}); feats.push(a);
    const t = pick([cyl(id('c'), pick([4, 12, 14]), 30, [pick([0, 10, 14]), 0, 0]), sphere(id('s'), pick([8, 18]), [pick([0, 12]), 0, 0]), box(id('b'), [10, 10, 30], [10, 10, 0])]); feats.push(t);
    const pre = pick(['hole', 'pocket', 'none', 'none']);
    if (pre === 'hole') feats.push(hole(id('h'), a.id, { diameter: 4, depth: 30 }));
    if (pre === 'pocket') { const s = id('sk'); feats.push(rect(s, 6, 6), pocket(id('pk'), s, a.id, 4)); }
    comb(pick(OPS), [a.id, t.id]);
  }
  return { version: 1, features: feats };
}
