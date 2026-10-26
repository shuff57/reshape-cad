// Generated ModelDocs for the shell-draft differential test. Plain data, seeded. Categories (seed % N_CATEGORIES) cover: hollows of a plain box open on every side with the wall
// from tiny up past the limit (near t and 2t of the narrowest dimension), hollows of cylinders and of prisms with even and odd side counts, closed hollows, L / notched / boss
// parts (join, cut, pocket, mirror, pattern) before the hollow, moves / turns / copies before the hollow, drafts of one face with angles and signs on every side, whole-shape
// drafts, drafts of compound parts (the reach guards), draft-then-hollow and hollow-then-draft, hollows after holes and fillets, turned boxes (ties), and malformed docs.
import { box, cyl, sphere, cone, torus, prism, wedge, rect, circ, extrude, pocket, combine, mirror, pattern, hole, shell, move, rotate, fillet, draft, prim, between } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_CATEGORIES = 14;
const WORDS = ['+z', '-z', '-y', '+y', '-x', '+x'];
const lPoly = (a = 20, b = 10, c = 20) => [[0, 0], [a, 0], [a, b], [b, b], [b, c], [0, c]];
const polySketch = (id, points, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points, ...extra });

export function sdDoc(seed) {
  const r = mulberry32(seed * 104729 + 7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const cat = seed % N_CATEGORIES;
  const feats = [];
  const dims = () => [pick([20, 24, 30, 40, 16, 12]), pick([20, 24, 30, 40, 16, 12]), pick([8, 10, 12, 20, 30])];
  const sz = dims();
  const center = () => pick([[0, 0, 0], [0, 0, 0], [15, -7, 3], [5, 5, 5], [0, 0, 20]]);
  const wallFor = (limit) => pick([0.3, 1, 2, 3, limit * 0.5, limit - 0.5, limit - 1e-7, limit, limit + 0.5, 2 * limit, 5, 6, 0.0001]);
  const open = (id, part) => (part === null ? undefined : prim(id, part));
  const angle = () => pick([1, 2, 3, 5, 8, 15, 30, 45, 60, 75, 88, 89, 90, -3, -10, -30, 0.5, 0.005, 100]);
  const neutralOf = (bbLo, bbHi) => pick([0, bbLo, bbHi, (bbLo + bbHi) / 2, bbLo - 3, 7]);

  switch (cat) {
    case 0: { // hollow of a plain box, every open side, wall near the limit
      const c = center();
      feats.push(box('b1', sz, c, r() < 0.15 ? { rotate: [0, 0, pick([90, 180, 45])] } : {}));
      const part = pick([...WORDS, null]);
      const ax = part ? 'xyz'.indexOf(part[1]) : 2;
      const limit = Math.min(sz[ax], ...[0, 1, 2].filter((i) => i !== ax).map((i) => sz[i] / 2));
      feats.push(shell('s1', 'b1', open('b1', part), wallFor(limit)));
      if (r() < 0.2) feats.push(shell('s2', 's1', open('b1', pick(WORDS)), pick([1, 2])));
      break;
    }
    case 1: { // cylinder / cone / sphere hollows: top, bottom, side, other words
      const c = center();
      const k = pick(['cyl', 'cyl', 'cyl', 'cone', 'sphere']);
      if (k === 'cyl') feats.push(cyl('c1', pick([6, 8, 12]), pick([10, 20, 30]), c, r() < 0.15 ? { rotate: [0, 90, 0] } : r() < 0.1 ? { round: 1, roundStyle: pick(['fillet', 'chamfer']) } : {}));
      else if (k === 'cone') feats.push(cone('c1', 8, 12, c));
      else feats.push(sphere('c1', 8, c));
      const part = pick([...WORDS, 'side', null]);
      feats.push(shell('s1', 'c1', open('c1', part), pick([0.5, 1, 2, 3, 6, 8, 9, 12])));
      break;
    }
    case 2: { // prisms (even and odd side counts), wedge: hollow open every side
      const n = pick([3, 4, 5, 6, 7, 8, 9, 12]);
      const p = r() < 0.7 ? prism('p1', n, pick([6, 8, 12]), pick([10, 20]), center(), r() < 0.2 ? { rotate: [0, 0, pick([15, 30, 45])] } : {}) : wedge('p1', 12, 8, 6, center());
      feats.push(p);
      feats.push(shell('s1', 'p1', open('p1', pick([...WORDS, null])), pick([0.5, 1, 2, 3, 5, 7])));
      break;
    }
    case 3: { // closed hollows: box, cylinder, sphere, prism, after a move, a turn, a copy, followed by later features
      const c = center();
      const k = pick(['box', 'box', 'cyl', 'sphere', 'prism']);
      feats.push(k === 'box' ? box('b1', sz, c) : k === 'cyl' ? cyl('b1', 8, 20, c) : k === 'sphere' ? sphere('b1', 8, c) : prism('b1', pick([4, 5, 6]), 8, 12, c));
      let t = 'b1';
      if (r() < 0.4) { feats.push(move('m1', t, [pick([5, 0, -4]), 0, pick([3, 0])], r() < 0.15)); t = 'm1'; }
      if (r() < 0.2) { feats.push(rotate('r1', t, [0, 0, 30])); t = 'r1'; }
      feats.push(shell('s1', t, undefined, pick([0.5, 1, 2, 3, 5, 8, 9.5, 11])));
      const tail = pick([null, 'move', 'rotate', 'hole', 'shell', 'pocket', 'draft', 'mirror']);
      if (tail === 'move') feats.push(move('m2', 's1', [4, 0, 0], r() < 0.3));
      else if (tail === 'rotate') feats.push(rotate('r2', 's1', [0, 0, 20]));
      else if (tail === 'hole') feats.push(hole('h1', 's1', { diameter: 3, depth: 40 }));
      else if (tail === 'shell') feats.push(shell('s2', 's1', prim('b1', '+z'), 1));
      else if (tail === 'draft') feats.push(draft('d1', 's1', prim('b1', '+x'), 3));
      else if (tail === 'mirror') feats.push(mirror('mi1', 's1', 'yz'));
      else if (tail === 'pocket') feats.push(rect('sk9', 6, 6), pocket('pk1', 'sk9', 's1', 2));
      break;
    }
    case 4: { // L / notched / boss parts before the hollow
      const kind = pick(['extrude-L', 'join', 'cut', 'pocket', 'mirror', 'pattern', 'extrude-rect', 'extrude-circ']);
      let t;
      if (kind === 'extrude-L') { feats.push(polySketch('sk1', lPoly(pick([20, 30]), 10, pick([20, 30]))), extrude('e1', 'sk1', pick([10, 16]))); t = 'e1'; }
      else if (kind === 'extrude-rect') { feats.push(rect('sk1', 24, 16), extrude('e1', 'sk1', 12)); t = 'e1'; }
      else if (kind === 'extrude-circ') { feats.push(circ('sk1', 8, 10, 8), extrude('e1', 'sk1', 12)); t = 'e1'; }
      else if (kind === 'join') { feats.push(box('b1', [30, 30, 10]), box('b2', [10, 10, 10], pick([[10, 0, 10], [0, 0, 10], [10, 10, 0]])), combine('u1', 'union', ['b1', 'b2'])); t = 'u1'; }
      else if (kind === 'cut') { feats.push(box('b1', [30, 30, 20]), box('b2', [10, 10, 30], [10, 10, 0]), combine('u1', 'subtract', ['b1', 'b2'])); t = 'u1'; }
      else if (kind === 'pocket') { feats.push(box('b1', [30, 30, 20]), rect('sk1', 8, 8), pocket('pk1', 'sk1', 'b1', pick([2, 5]))); t = 'pk1'; }
      else if (kind === 'mirror') { feats.push(box('b1', [20, 20, 10], pick([[10, 0, 0], [0, 0, 0], [-10, 0, 0]])), mirror('mi1', 'b1', pick(['yz', 'xz']))); t = 'mi1'; }
      else { feats.push(box('b1', [10, 10, 10]), pattern('pa1', 'b1', { count: pick([2, 3]) })); t = 'pa1'; }
      const root = feats.find((f) => f.kind === 'box' || f.kind === 'extrude')?.id ?? 'b1';
      feats.push(shell('s1', t, prim(root, pick(WORDS)), pick([1, 2, 3])));
      break;
    }
    case 5: { // moves, turns, copies before a hollow of a box (G-PICK)
      const c = center();
      feats.push(box('b1', sz, c));
      let t = 'b1';
      const steps = 1 + Math.floor(r() * 2);
      for (let i = 0; i < steps; i++) {
        const k = pick(['move', 'move', 'move', 'rotate', 'copy']);
        const id = `m${i + 1}`;
        if (k === 'move') feats.push(move(id, t, [pick([0, 5, -6, sz[0]]), pick([0, 4]), pick([0, sz[2], -sz[2], 6])]));
        else if (k === 'rotate') feats.push(rotate(id, t, [0, 0, pick([90, 45, 30])]));
        else feats.push(move(id, t, [5, 0, 0], true));
        t = id;
      }
      feats.push(shell('s1', t, prim('b1', pick(WORDS)), pick([1, 2, 3])));
      break;
    }
    case 6: { // drafts of one face of a box: angle, sign, every face, pulls
      const c = center();
      feats.push(box('b1', sz, c));
      const pull = pick(['z', 'z', 'z', 'y', 'x']);
      const ai = 'xyz'.indexOf(pull);
      const lo = c[ai] - sz[ai] / 2, hi = c[ai] + sz[ai] / 2;
      feats.push(draft('d1', 'b1', prim('b1', pick(WORDS)), angle(), { pull, neutral: neutralOf(lo, hi) }));
      if (r() < 0.5) feats.push(draft('d2', 'd1', prim('b1', pick(WORDS)), angle(), { pull, neutral: neutralOf(lo, hi) }));
      if (r() < 0.2) feats.push(draft('d3', 'd2', prim('b1', pick(WORDS)), angle(), { pull, neutral: 0 }));
      break;
    }
    case 7: { // whole-shape drafts: box, prism, wedge, cylinder, extrude, cone, sphere, after other steps
      const c = center();
      const k = pick(['box', 'prism', 'wedge', 'cyl', 'extrude', 'cone', 'sphere', 'L']);
      let t = 'p1';
      if (k === 'box') feats.push(box('p1', sz, c, r() < 0.2 ? { rotate: [0, 0, 30] } : {}));
      else if (k === 'prism') feats.push(prism('p1', pick([3, 4, 5, 6, 8]), 8, 12, c));
      else if (k === 'wedge') feats.push(wedge('p1', 12, 8, 6, c));
      else if (k === 'cyl') feats.push(cyl('p1', 8, 20, c, r() < 0.2 ? { rotate: [90, 0, 0] } : {}));
      else if (k === 'cone') feats.push(cone('p1', 8, 12, c));
      else if (k === 'sphere') feats.push(sphere('p1', 8, c));
      else if (k === 'L') { feats.push(polySketch('sk1', lPoly()), extrude('p1', 'sk1', 12)); }
      else { feats.push(circ('sk1', 7, 7, 7), extrude('p1', 'sk1', 12)); }
      const pre = pick([null, null, 'move', 'shell', 'draft', 'round']);
      if (pre === 'move') { feats.push(move('m1', 'p1', [3, 0, 2])); t = 'm1'; }
      else if (pre === 'shell') { feats.push(shell('s0', 'p1', prim('p1', '+z'), 1)); t = 's0'; }
      else if (pre === 'draft') { feats.push(draft('d0', 'p1', prim('p1', '+x'), 3)); t = 'd0'; }
      feats.push(draft('d1', t, undefined, pick([1, 2, 5, 10, 30, 60, 89, 95, -5]), { whole: true, pull: pick(['z', 'z', 'z', 'x']), neutral: pick([0, 5, -3]) }));
      break;
    }
    case 8: { // drafts of compound parts (L extrude, join, cut): the reach and sweep guards
      const kind = pick(['L', 'join', 'cut', 'pocket']);
      let root = 'e1'; let t = 'e1'; let c0 = [0, 0, 0];
      if (kind === 'L') { feats.push(polySketch('sk1', lPoly(30, 10, 30)), extrude('e1', 'sk1', pick([10, 20]))); }
      else if (kind === 'join') { feats.push(box('b1', [30, 30, 10]), box('b2', [10, 10, 10], [10, 0, 10]), combine('u1', 'union', ['b1', 'b2'])); root = 'b1'; t = 'u1'; }
      else if (kind === 'cut') { feats.push(box('b1', [30, 30, 20]), box('b2', [10, 10, 30], [10, 10, 0]), combine('u1', 'subtract', ['b1', 'b2'])); root = 'b1'; t = 'u1'; }
      else { feats.push(box('b1', [30, 30, 20]), rect('sk1', 8, 8), pocket('pk1', 'sk1', 'b1', 4)); root = 'b1'; t = 'pk1'; }
      feats.push(draft('d1', t, prim(root, pick(WORDS)), pick([1, 3, 10, 30, 45, 60, 70, -10, -45]), { pull: 'z', neutral: pick([0, 5, 10]) }));
      if (r() < 0.3) feats.push(draft('d2', 'd1', prim(root, pick(WORDS)), pick([3, 10, 30]), { pull: 'z', neutral: 0 }));
      break;
    }
    case 9: { // draft then hollow, hollow then draft
      const c = center();
      feats.push(box('b1', sz, c));
      const order = pick(['draft-shell', 'shell-draft', 'draft-shell-draft', 'draft-whole-shell']);
      const w = () => pick(['+x', '-x', '+y', '-y']);
      if (order === 'draft-shell') { feats.push(draft('d1', 'b1', prim('b1', w()), pick([3, 5, 10]), { neutral: c[2] }), shell('s1', 'd1', prim('b1', pick(['+z', '-z', w()])), pick([1, 2, 3]))); }
      else if (order === 'shell-draft') { feats.push(shell('s1', 'b1', prim('b1', pick(['+z', '-z'])), 2), draft('d1', 's1', prim('b1', w()), pick([3, 10, 30]), { neutral: c[2] })); }
      else if (order === 'draft-shell-draft') { feats.push(draft('d1', 'b1', prim('b1', '+x'), 3, { neutral: c[2] }), shell('s1', 'd1', prim('b1', '+z'), 2), draft('d2', 's1', prim('b1', '-x'), 3, { neutral: c[2] })); }
      else { feats.push(draft('d1', 'b1', undefined, pick([3, 5]), { whole: true, neutral: c[2] - sz[2] / 2 }), shell('s1', 'd1', prim('b1', pick(['+z', '-z', '+x'])), 2)); }
      break;
    }
    case 10: { // hollows after holes and fillets
      const c = center();
      feats.push(box('b1', sz, c));
      let t = 'b1';
      const k = pick(['through', 'blind', 'two', 'offcentre', 'fillet', 'fillet-top', 'fillet-other', 'fillet-chamfer']);
      if (k === 'through') { feats.push(hole('h1', 'b1', { diameter: pick([2, 4, 6]), depth: sz[2] + 2, center: [0, 0, 0] })); t = 'h1'; }
      else if (k === 'blind') { feats.push(hole('h1', 'b1', { diameter: 4, depth: sz[2] / 2, center: [0, 0, sz[2] / 4] })); t = 'h1'; }
      else if (k === 'two') { feats.push(hole('h1', 'b1', { diameter: 3, depth: sz[2] + 2, center: [-5, 0, 0] }), hole('h2', 'h1', { diameter: 3, depth: sz[2] + 2, center: [5, 0, 0] })); t = 'h2'; }
      else if (k === 'offcentre') { feats.push(hole('h1', 'b1', { diameter: 6, depth: sz[2] + 2, center: [pick([14, 8, 2]), 0, 0] })); t = 'h1'; }
      else {
        const [a, b] = k === 'fillet-other' ? ['+x', '-y'] : ['+z', '+x'];
        feats.push(fillet('f1', 'b1', between('b1', prim('b1', a), prim('b1', b)), pick([0.5, 1, 2, 3]), k === 'fillet-chamfer' ? 'chamfer' : 'fillet')); t = 'f1';
      }
      feats.push(shell('s1', t, prim('b1', pick(['+z', '+z', '-z', '+x'])), pick([1, 2, 3])));
      break;
    }
    case 11: { // turned boxes and ties (even-sided prisms), words on turned parts
      const k = pick(['box45', 'box30', 'prism4', 'prism6', 'prism5', 'wedge']);
      if (k === 'box45') feats.push(box('b1', [20, 20, 10], [0, 0, 0], { rotate: [0, 0, 45] }));
      else if (k === 'box30') feats.push(box('b1', [20, 14, 10], [0, 0, 0], { rotate: [0, pick([30, 90]), 0] }));
      else if (k === 'wedge') feats.push(wedge('b1', 12, 8, 6));
      else feats.push(prism('b1', Number(k.slice(5)), 8, 12));
      if (r() < 0.5) feats.push(shell('s1', 'b1', prim('b1', pick(WORDS)), pick([1, 2])));
      else feats.push(draft('d1', 'b1', prim('b1', pick(['+x', '-x', '+y', '-y'])), pick([3, 5, 10]), { neutral: pick([0, 6]) }));
      break;
    }
    case 12: { // chains: several shells / drafts / moves on several bodies
      feats.push(box('b1', sz, center()), box('b2', [10, 10, 10], [40, 0, 0]));
      const n = 2 + Math.floor(r() * 3);
      let t = pick(['b1', 'b2']);
      for (let i = 0; i < n; i++) {
        const id = pick(['s', 'd', 'm']) + (i + 1);
        const root = t === 'b2' ? 'b2' : 'b1';
        if (id[0] === 's') feats.push(shell(id, t, prim(root, pick(WORDS)), pick([1, 2])));
        else if (id[0] === 'd') feats.push(draft(id, t, prim(root, pick(WORDS)), pick([3, 10]), { pull: pick(['z', 'x']), neutral: 0 }));
        else feats.push(move(id, t, [pick([2, -3]), 0, pick([0, 4])], r() < 0.1));
        t = id;
      }
      break;
    }
    default: { // malformed and dependent input
      const k = pick(['no-size', 'unknown-target', 'refused-dep', 'forward', 'two-bodies', 'ghost', 'no-open-feature', 'thickness-missing', 'not-a-face', 'name-of-sketch']);
      if (k === 'no-size') feats.push({ id: 'b1', kind: 'box' }, shell('s1', 'b1', prim('b1', '+z'), 2));
      else if (k === 'unknown-target') feats.push(box('b1', sz), shell('s1', 'nope', prim('b1', '+z'), 2), draft('d1', 'nope', prim('b1', '+x'), 5));
      else if (k === 'refused-dep') feats.push(box('b1', sz), shell('s1', 'b1', prim('b1', '+z'), 99), shell('s2', 's1', prim('b1', '-z'), 1), draft('d1', 's1', prim('b1', '+x'), 5));
      else if (k === 'forward') feats.push(box('b1', sz), shell('s1', 'b2', prim('b1', '+z'), 2), box('b2', sz));
      else if (k === 'two-bodies') feats.push(box('b1', sz), box('b2', sz, [50, 0, 0]), pattern('pa1', 'b1', { count: 3 }), shell('s1', 'pa1', prim('b1', '+z'), 2), draft('d1', 'pa1', prim('b1', '+x'), 5));
      else if (k === 'ghost') feats.push({ ...box('ghost1', sz), id: 'ghost1' }, shell('s1', 'ghost1', prim('ghost1', '+z'), 2));
      else if (k === 'no-open-feature') feats.push(box('b1', sz), shell('s1', 'b1', prim('zz', '+z'), 2), draft('d1', 'b1', prim('zz', '+x'), 5));
      else if (k === 'thickness-missing') feats.push(box('b1', sz), { id: 's1', kind: 'shell', target: 'b1', open: prim('b1', '+z') }, { id: 'd1', kind: 'draft', target: 'b1', face: prim('b1', '+x'), pull: 'z' });
      else if (k === 'not-a-face') feats.push(box('b1', sz), shell('s1', 'b1', prim('b1', 'side'), 2), draft('d1', 'b1', prim('b1', 'side'), 3), shell('s2', 'b1', prim('b1', 'weird'), 2));
      else feats.push(rect('sk1', 10, 10), shell('s1', 'sk1', undefined, 2), draft('d1', 'sk1', prim('sk1', '+x'), 5));
    }
  }
  return { features: feats };
}

/** which `draft(` calls used from:/neutral: (the original reads this from the script text): deterministic per seed, one entry per draft feature */
export function sdFromUsage(seed, doc) {
  const r = mulberry32(seed * 31 + 5);
  const n = doc.features.filter((f) => f.kind === 'draft').length;
  const mode = seed % 3;
  if (mode === 0) return undefined;
  return Array.from({ length: n }, () => ({ from: r() < 0.5 ? ['bottom', 'top', 'front', 'back', 'left', 'right'][Math.floor(r() * 6)] : null, neutral: r() < 0.3 }));
}
