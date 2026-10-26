// Generated ModelDocs for the revolve-groove differential and the unified test: spins of every profile (a rectangle, a triangle, a pentagon, a circle, a rounded or chamfered corner, a repeated corner, a
// bow-tie, a profile that crosses the axis, the undrawn starter rectangle, a constrained sketch) on the three named planes, on a datum offset and on an explicit frame, at angles from nothing to two full
// turns; grooves into posts, boxes, spun frustums and stepped plates, rings that sit inside, touch, graze (0.01 to 0.3 mm), miss, cover or split the part, at a part turn and a full turn; a refused groove
// and what follows it on the same part (another groove, a pocket, a hole, a shell, a move, a combine, a pattern); a spin as the operand of another group's kind; malformed and dependent features.
// Plain data, seeded, no engine.
import { box, cyl, sphere, cone, torus, rect, circ, extrude, pocket, revolve, groove, combine, mirror, pattern, hole, shell, move, rotate, fillet, soup, line } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_THEMES = 12;

export function rgDoc(seed) {
  const r = mulberry32(seed * 6151 + 59);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const q = (lo, hi, k = 4) => Math.round((lo + r() * (hi - lo)) * k) / k;
  const theme = seed % N_THEMES;
  const feats = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const PLANES = ['xy', 'xz', 'yz'];
  const sk = (points, extra = {}) => { const s = { id: id('sk'), kind: 'sketch', plane: pick(PLANES), offset: pick([0, 0, 0, q(-6, 6)]), points, ...extra }; feats.push(s); return s; };
  const R = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const ANG = () => pick([360, 360, 180, 90, 270, 45, 200, 1, 0.5, 359.5]);
  const SANG = () => pick([360, 360, 180, 90, -90, 270, -200, 45, 720, -720, 400, 0, 0.5, 1, -1]);
  const spin = (s, a) => { const v = revolve(id('v'), s.id, a); feats.push(v); return v; };
  const grv = (s, into, a) => { const g = groove(id('g'), s.id, into, a); feats.push(g); return g; };
  const post = (rad = pick([10, 20, 15]), h = pick([20, 30, 40])) => { const c = r() < 0.5 ? cyl(id('c'), rad, h, [0, 0, 0]) : null; if (c) { feats.push(c); return c; } const s = circ(id('sk'), rad, 0, 0); feats.push(s); const e = extrude(id('e'), s.id, h); feats.push(e); return e; };
  const slab = () => { const b = box(id('b'), [pick([40, 60, 30]), pick([40, 60, 30]), pick([20, 40, 10])], [0, 0, pick([0, 0, 3])]); feats.push(b); return b; };

  if (theme === 0) { // a spin of a plain profile: sides, planes, angles
    const k = pick(['rect', 'rect', 'tri', 'pent', 'circle', 'rounded', 'chamfer']);
    const side = r() < 0.25 ? -1 : 1;
    const u0 = q(0.5, 25); const w = q(1, 15); const v0 = q(-5, 20); const h = q(1.5, 25);
    let s;
    if (k === 'rect') s = sk(R(side * u0, side * (u0 + w), v0, v0 + h));
    else if (k === 'tri') s = sk([[side * u0, v0], [side * (u0 + w), v0], [side * u0, v0 + h]]);
    else if (k === 'pent') s = sk([[side * u0, v0], [side * (u0 + w), v0], [side * (u0 + w * 1.4), v0 + h / 2], [side * (u0 + w), v0 + h], [side * u0, v0 + h]]);
    else if (k === 'circle') s = sk([[side * (u0 + w) - w / 2, v0], [side * (u0 + w) + w / 2, v0]], { shape: 'circle' });
    else if (k === 'rounded') s = sk(R(side * u0, side * (u0 + w), v0, v0 + h), { rounds: { 1: Math.min(w, h) / 3 } });
    else s = sk(R(side * u0, side * (u0 + w), v0, v0 + h), { chamfers: { 2: Math.min(w, h) / 3 } });
    spin(s, SANG());
  } else if (theme === 1) { // profiles the guard refuses before the engine runs
    const k = pick(['starter', 'bowtie', 'dup', 'line', 'cross', 'touch', 'soup', 'two', 'nonsketch', 'axis']);
    if (k === 'starter') sk([[0, 0], [40, 0], [40, 25], [0, 25]], { constraints: [{}, {}, {}, {}] });
    else if (k === 'bowtie') sk([[5, 0], [15, 10], [15, 0], [5, 10]]);
    else if (k === 'dup') sk([[5, 0], [5, 0], [15, 10], [5, 10]]);
    else if (k === 'line') sk([[5, 0], [10, 5], [15, 10]]);
    else if (k === 'cross') sk(R(-5, 8, 0, 10));
    else if (k === 'touch') sk([[5, 0], [15, 0], [15, 10], [10, 10], [10, 0.00005], [5, 10]]);
    else if (k === 'soup') { const s = soup(id('sk'), [line(1, [0, 0], [10, 0]), line(2, [10, 0], [10, 8]), line(3, [10, 8], [0, 8]), line(4, [0, 8], [0, 0])], []); feats.push(s); }
    else if (k === 'two') sk([[8, 0], [8.0000000001, 0], [12, 10], [8, 10]]);
    else if (k === 'axis') sk(R(0, 10, 0, 20));
    else feats.push({ id: id('b'), kind: 'box', size: [10, 10, 10], center: [0, 0, 0] });
    const target = feats[feats.length - 1].id;
    if (k === 'nonsketch') { feats.push(revolve(id('v'), target, 90)); }
    else { const s = feats[feats.length - 1]; spin(s, pick([360, 90, -90])); }
  } else if (theme === 2) { // a groove into a post: the ring inside, at the wall, grazing, short of an end, split, full / part turn
    const P = post(); const rad = P.radius ?? 15; const h = P.height ?? 30;
    const kind = pick(['clear', 'clear', 'graze', 'wall', 'sealed', 'end', 'miss', 'all', 'split']);
    const g = pick([0.01, 0.1, 0.2, 0.25, 0.3, 0.5]);
    let u0; let u1; let v0; let v1;
    if (kind === 'clear') { u0 = rad - 4; u1 = rad - 1; v0 = h * 0.3; v1 = h * 0.6; }
    else if (kind === 'graze') { u0 = rad - 4; u1 = rad - g; v0 = h * 0.3; v1 = h * 0.6; }
    else if (kind === 'wall') { u0 = rad - 4; u1 = rad + 2; v0 = h * 0.3; v1 = h * 0.6; }
    else if (kind === 'sealed') { u0 = rad * 0.3; u1 = rad * 0.6; v0 = h * 0.3; v1 = h * 0.6; }
    else if (kind === 'end') { u0 = rad - 4; u1 = rad - 1; v0 = h - 3 - g; v1 = h - g; }
    else if (kind === 'miss') { u0 = rad + 3; u1 = rad + 8; v0 = 0; v1 = h; }
    else if (kind === 'all') { u0 = 0.0001; u1 = rad + 5; v0 = -2; v1 = h + 2; }
    else { u0 = rad * 0.4; u1 = rad * 0.7; v0 = -1; v1 = h + 1; }
    // the post's own height runs 0..h on a top sketch (the primitives are centred: the sketch plane's offset makes the ring land inside or outside)
    const s = sk(R(u0, u1, v0 - h / 2, v1 - h / 2), { plane: pick(['xy', 'xy', 'xz', 'yz']) });
    grv(s, P.id, ANG());
    if (r() < 0.3) { const s2 = sk(R(rad - 6, rad - 5, h * 0.1 - h / 2, h * 0.2 - h / 2), { plane: 'xy' }); grv(s2, P.id, pick([360, 90])); }
  } else if (theme === 3) { // a groove into a box: planes, offsets, the profile plane on a flat face, corners, part and full turns
    const B = slab();
    const plane = pick(['xy', 'xz', 'yz']);
    const off = pick([0, 0, 0, 1, 3, 5.5]);
    const side = r() < 0.2 ? -1 : 1;
    const u0 = q(2, 20); const w = q(1, 10); const v0 = q(-15, 5); const h = q(2, 15);
    const s = sk(R(side * u0, side * (u0 + w), v0, v0 + h), { plane, offset: off });
    grv(s, B.id, pick([360, 180, 90, 270, 45]));
    if (r() < 0.4) { const s2 = sk(R(u0 + 12, u0 + 15, v0, v0 + 3), { plane }); grv(s2, B.id, pick([360, 90])); }
  } else if (theme === 4) { // a groove into a spun part: a frustum, a stepped plate, a ball; a cone tool, a round tool
    const kind = pick(['frustum', 'step', 'tube', 'cyl']);
    const body = kind === 'frustum' ? sk([[0, 0], [30, 0], [29, 30], [0, 30]], { plane: 'xz' }) : kind === 'step' ? sk([[0, 0], [30, 0], [30, 6], [18, 6], [18, 20], [0, 20]], { plane: 'xz' }) : kind === 'tube' ? sk([[10, 0], [30, 0], [30, 25], [10, 25]], { plane: 'xz' }) : sk(R(0, 25, 0, 30), { plane: 'xz' });
    const v = spin(body, 360);
    const tool = pick(['rect', 'rect', 'tri', 'circle', 'rect']);
    const u0 = q(8, 22); const w = q(1, 6); const v0 = q(2, 18); const h = q(2, 8);
    const s = tool === 'tri' ? sk([[u0, v0], [u0 + w, v0], [u0, v0 + h]], { plane: 'xz' }) : tool === 'circle' ? sk([[u0, v0], [u0 + w, v0]], { plane: 'xz', shape: 'circle' }) : sk(R(u0, u0 + w, v0, v0 + h), { plane: 'xz' });
    grv(s, v.id, pick([360, 90, 200, 180]));
  } else if (theme === 5) { // a refused groove and what follows it on the same part (the chain)
    const P = r() < 0.5 ? post() : slab();
    const bad = pick(['starter', 'angle0', 'big', 'miss']);
    let s;
    if (bad === 'starter') s = sk([[0, 0], [40, 0], [40, 25], [0, 25]], { plane: 'xy', constraints: [{}, {}, {}, {}] });
    else if (bad === 'miss') s = sk(R(200, 210, 0, 5), { plane: 'xy' });
    else s = sk(R(4, 7, 2, 6), { plane: 'xy' });
    const g1 = grv(s, P.id, bad === 'angle0' ? 0 : bad === 'big' ? 400 : 360);
    const after = pick(['groove', 'pocket', 'hole', 'move', 'shell', 'combine', 'pattern', 'mirror', 'rotate', 'fillet', 'spin']);
    if (after === 'groove') { const s2 = sk(R(4, 7, 2, 6), { plane: 'xy' }); grv(s2, P.id, 360); }
    else if (after === 'pocket') { const s2 = id('sk'); feats.push(rect(s2, 5, 5), pocket(id('pk'), s2, P.id, 3)); }
    else if (after === 'hole') feats.push(hole(id('h'), P.id, {}));
    else if (after === 'move') feats.push(move(id('m'), P.id, [5, 0, 0]));
    else if (after === 'shell') feats.push(shell(id('s'), P.id, undefined, 2));
    else if (after === 'combine') { const t = box(id('b'), [10, 10, 10], [6, 0, 0]); feats.push(t, combine(id('c'), pick(['union', 'subtract']), [P.id, t.id])); }
    else if (after === 'pattern') feats.push(pattern(id('p'), P.id, { count: 2, step: [60, 0, 0] }));
    else if (after === 'mirror') feats.push(mirror(id('x'), P.id, 'yz'));
    else if (after === 'rotate') feats.push(rotate(id('r'), P.id, [0, 0, 90]));
    else if (after === 'fillet') feats.push(fillet(id('f'), P.id, { cause: 'between', feature: P.id, kind: 'edge', of: ['+z', '+x'] }, 1));
    else { const s2 = sk(R(5, 9, 0, 10)); spin(s2, 90); }
    void g1;
  } else if (theme === 6) { // two grooves in a row; a groove that splits the part and a groove into the pieces
    const P = r() < 0.5 ? post(15, 30) : slab();
    const split = sk(P.kind === 'box' ? R(3, 6, -30, 30) : R(5, 8, -20, 20), { plane: pick(['xy', 'xy', 'xz']) });
    grv(split, P.id, 360);
    const s2 = sk(R(12, 14, -5, 5), { plane: 'xy' });
    grv(s2, P.id, pick([360, 90]));
    if (r() < 0.3) feats.push(move(id('m'), P.id, [3, 0, 0]));
  } else if (theme === 7) { // a spin as the operand of another group's kind
    const s = sk(pick([R(3, 8, 0, 12), R(0, 6, 0, 12), [[0, 0], [8, 0], [8, 3], [3, 3], [3, 12], [0, 12]]]), { plane: 'xz' });
    const v = spin(s, pick([360, 360, 180, 90]));
    const w = pick(['hole', 'shell', 'pattern', 'mirror', 'combine', 'pocket', 'fillet', 'move', 'rotate', 'groove']);
    if (w === 'hole') feats.push(hole(id('h'), v.id, { diameter: 2, depth: 20 }));
    else if (w === 'shell') feats.push(shell(id('s'), v.id, undefined, 1));
    else if (w === 'pattern') feats.push(pattern(id('p'), v.id, { count: 3, step: [30, 0, 0] }));
    else if (w === 'mirror') feats.push(mirror(id('x'), v.id, 'xz'));
    else if (w === 'combine') { const t = box(id('b'), [20, 20, 10], [0, 0, 6]); feats.push(t, combine(id('c'), pick(['union', 'subtract', 'intersect']), [t.id, v.id])); }
    else if (w === 'pocket') { const s2 = id('sk'); feats.push(rect(s2, 3, 3), pocket(id('pk'), s2, v.id, 2)); }
    else if (w === 'fillet') feats.push(fillet(id('f'), v.id, { cause: 'between', feature: v.id, kind: 'edge', of: ['+z', '+x'] }, 1));
    else if (w === 'move') feats.push(move(id('m'), v.id, [4, 0, 0]));
    else if (w === 'rotate') feats.push(rotate(id('r'), v.id, [0, 0, 90]));
    else { const s2 = sk(R(5.2, 7, 3, 6), { plane: 'xz' }); grv(s2, v.id, 360); }
  } else if (theme === 8) { // other groups' kinds BEFORE the groove: a pocket, a hole, a hollow, a join, a move into the part the groove cuts
    const P = slab();
    const pre = pick(['pocket', 'hole', 'shell', 'combine', 'move', 'pattern', 'none']);
    if (pre === 'pocket') { const s2 = id('sk'); feats.push(rect(s2, 6, 6), pocket(id('pk'), s2, P.id, 4)); }
    else if (pre === 'hole') feats.push(hole(id('h'), P.id, { diameter: 4, depth: 30 }));
    else if (pre === 'shell') feats.push(shell(id('s'), P.id, undefined, 2));
    else if (pre === 'combine') { const t = box(id('b'), [8, 8, 8], [12, 0, 0]); feats.push(t, combine(id('c'), 'union', [P.id, t.id])); }
    else if (pre === 'move') feats.push(move(id('m'), P.id, [4, 0, 0]));
    else if (pre === 'pattern') feats.push(pattern(id('p'), P.id, { count: 2, step: [70, 0, 0] }));
    const s = sk(R(q(4, 12), q(13, 18), q(-8, 0), q(1, 8)), { plane: 'xy' });
    grv(s, P.id, pick([360, 90, 180]));
    if (r() < 0.3) { const s3 = id('sk'); feats.push(rect(s3, 3, 3), pocket(id('pk'), s3, P.id, 2)); }
  } else if (theme === 9) { // frames and datums: a tilted frame, an axis-aligned frame off the origin, a sketch on a datum
    const frames = [
      { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] }, { origin: [2, 3, 4], u: [0, 1, 0], v: [0, 0, 1] }, { origin: [0, 0, 0], u: [0.7071067811865476, 0.7071067811865476, 0], v: [0, 0, 1] },
      { origin: [5, 0, 0], u: [0, 0, 1], v: [1, 0, 0] }, { origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] },
    ];
    const P = r() < 0.5 ? post() : slab();
    const s = sk(R(q(5, 14), q(15, 19), q(-10, 2), q(3, 10)), { frame: pick(frames), plane: 'xy' });
    if (r() < 0.5) spin(s, ANG()); else grv(s, P.id, pick([360, 90, 180]));
  } else if (theme === 10) { // the engine's side: a groove the fake ignores, a groove that removes everything, a body the engine does not return, a failing bridge
    const P = r() < 0.5 ? post(10, 20) : box(id('b'), [20, 20, 10], [0, 0, 0]);
    if (P.kind === 'box') feats.push(P);
    const s = sk(pick([R(0.0001, 40, -30, 30), R(6, 8, 30, 40), R(8, 9, 2, 3), R(2, 4, -3, 3)]), { plane: pick(['xy', 'xz']) });
    const g = grv(s, P.id, pick([360, 90, 180, 270, 30]));
    const w = pick(['groove', 'spin', 'none', 'ghost']);
    if (w === 'groove') grv(sk(R(3, 5, -2, 2), { plane: 'xy' }), P.id, 360);
    else if (w === 'spin') spin(sk(R(4, 9, 0, 10), { plane: 'xz' }), pick([360, 120]));
    else if (w === 'ghost') feats.push(box('ghost1', [10, 10, 10], [0, 0, 0]), groove(id('g'), s.id, 'ghost1', 360));
    void g;
  } else { // dependency and malformed: a groove of a missing sketch, into a missing part, into a sketch; an angle that is a string; a spin of a refused sketch
    const P = slab();
    const k = pick(['nosketch', 'nointo', 'intosketch', 'strangle', 'norefs', 'malformed']);
    const s = sk(R(5, 9, -4, 4), { plane: 'xy' });
    if (k === 'nosketch') feats.push(groove(id('g'), 'nope', P.id, 360));
    else if (k === 'nointo') feats.push(groove(id('g'), s.id, 'nope', 360));
    else if (k === 'intosketch') feats.push(groove(id('g'), s.id, s.id, 360));
    else if (k === 'strangle') { feats.push(groove(id('g'), s.id, P.id, '90')); feats.push(revolve(id('v'), s.id, '90')); }
    else if (k === 'norefs') { feats.push({ id: id('g'), kind: 'groove', angle: 90 }); feats.push({ id: id('v'), kind: 'revolve' }); }
    else { feats.push({ id: id('v'), kind: 'revolve', target: s.id }); feats.push({ id: id('g'), kind: 'groove', target: s.id, into: P.id }); }
  }
  return { version: 1, features: feats };
}
