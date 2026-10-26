// Generated ModelDocs for the patterns-mirror differential test: roots (box, cylinder, sphere, torus, cone, prism, wedge, an extruded L, a join, a moved or turned part, a
// plate with pockets or holes), then repeats and mirrors with the steps that matter to the group's guards (touching, overlapping, a hair apart, a sliver, aligned, an
// edge or a point in contact, a tiny shift, a zero step, counts 0 / 1 / many), circular patterns, repeated cuts that lie almost on each other or leave a thin wall,
// and what follows a refused pattern (so the dependency sentences run). Plain data, seeded, no engine.
import { box, cyl, sphere, cone, torus, prism, wedge, rect, circ, extrude, pocket, combine, mirror, pattern, hole, move, rotate, shell, fillet, prim, between, revolve, groove } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_THEMES = 10;

export function pmDoc(seed) {
  const r = mulberry32(seed * 6151 + 29);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const theme = seed % N_THEMES;
  const feats = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const AXES = ['x', 'y', 'z'];
  let cur = null; let ext = [10, 10, 10]; let curved = false; let isTorus = false;
  const scale = r() < 0.12 ? pick([0.01, 0.05, 20]) : 1;

  const root = (kinds) => {
    const k = pick(kinds); const i = id(k[0]);
    curved = false; isTorus = false;
    const at = pick([[0, 0, 0], [0, 0, 0], [8, -5, 3], [20, 0, 0], [0, 0, 7]]).map((v) => v * scale);
    let f;
    if (k === 'box') { const s = [pick([6, 8, 10, 12, 20]), pick([6, 8, 10, 16]), pick([4, 6, 10, 20])].map((v) => v * scale); f = box(i, s, at, r() < 0.08 ? { rotate: [0, 0, 90] } : r() < 0.06 ? { round: 1 * scale } : {}); ext = f.rotate ? [s[1], s[0], s[2]] : s; }
    else if (k === 'cylinder') { const rr = pick([3, 5, 6]) * scale; const h = pick([8, 12, 20]) * scale; f = cyl(i, rr, h, at); ext = [2 * rr, 2 * rr, h]; curved = true; }
    else if (k === 'sphere') { const rr = pick([3, 5, 8]) * scale; f = sphere(i, rr, at); ext = [2 * rr, 2 * rr, 2 * rr]; curved = true; }
    else if (k === 'torus') { const R = pick([8, 10, 12]) * scale; const t = pick([1, 2, 3]) * scale; f = torus(i, R, t, at); ext = [2 * (R + t), 2 * (R + t), 2 * t]; curved = true; isTorus = true; }
    else if (k === 'cone') { const rr = pick([4, 6]) * scale; const h = pick([8, 12]) * scale; f = cone(i, rr, h, at); ext = [2 * rr, 2 * rr, h]; curved = true; }
    else if (k === 'prism') { const rr = pick([5, 7]) * scale; f = prism(i, pick([3, 4, 6]), rr, pick([6, 10]) * scale, at); ext = [2 * rr, 2 * rr, f.height]; }
    else if (k === 'wedge') { f = wedge(i, pick([8, 12]) * scale, pick([6, 8]) * scale, pick([4, 6]) * scale, at); ext = [f.width, f.depth, f.height]; }
    else { f = box(i, [10, 10, 10], at); ext = [10, 10, 10]; }
    feats.push(f); cur = f.id; return f;
  };
  const lExtrude = () => {
    const s = id('sk'); const e = id('e'); const W = pick([16, 20, 24]) * scale; const H = pick([14, 20]) * scale;
    feats.push({ ...rect(s, W, H), points: [[0, 0], [W, 0], [W, H * 0.4], [W * 0.4, H * 0.4], [W * 0.4, H], [0, H]] });
    const h = pick([4, 6, 10]) * scale; feats.push(extrude(e, s, h)); cur = e; ext = [W, H, h]; curved = false; isTorus = false;
  };
  const plateWithCuts = () => {
    const b = id('b'); const W = pick([40, 60]) * scale; const D = pick([30, 40]) * scale; const T = pick([10, 12]) * scale;
    feats.push(box(b, [W, D, T], [0, 0, 0])); cur = b; ext = [W, D, T]; curved = false; isTorus = false;
    const nc = pick([1, 2, 2, 3]);
    let x0 = -W / 2 + 6 * scale;
    for (let k = 0; k < nc; k++) {
      const s = id('sk'); const pk = id('pk'); const w = pick([6, 8]) * scale; const h = pick([6, 8]) * scale;
      const gap = pick([6, 6, 0.0004, 0.05, 0.4, 1.5, 0, -0.2]) * scale; // gap to the previous cut: a hair, a thin wall, clear, touching, overlapping
      const kind = r();
      if (kind < 0.25) feats.push(circ(s, w / 2, x0 + w / 2, 0));
      else feats.push({ ...rect(s, w, h), points: [[x0, -h / 2], [x0 + w, -h / 2], [x0 + w, h / 2], [x0, h / 2]] });
      feats.push(pocket(pk, s, b, pick([2, 3, T * 0.4])));
      x0 += w + gap;
    }
  };
  const holesPlate = () => {
    const b = id('b'); const W = pick([30, 40]) * scale;
    feats.push(box(b, [W, 30 * scale, 10 * scale], [0, 0, 0])); cur = b; ext = [W, 30 * scale, 10 * scale]; curved = false; isTorus = false;
    const d = pick([4, 6]) * scale; let x = -10 * scale;
    for (let k = 0; k < pick([1, 2, 3]); k++) { feats.push(hole(id('h'), b, { diameter: d, depth: 30 * scale, center: [x, 0, 0] })); x += d + pick([0.0005, 0.05, 3, 6]) * scale; }
  };
  const joined = () => {
    const a = id('b'); const b2 = id('b'); const c = id('c');
    feats.push(box(a, [10, 10, 10], [0, 0, 0]), box(b2, [6, 6, 20], [8, 0, 0]), combine(c, 'union', [a, b2]));
    cur = c; ext = [14, 10, 20]; curved = false; isTorus = false;
  };
  const movedOrTurned = () => {
    root(['box', 'box', 'cylinder']);
    const m = id(r() < 0.5 ? 'm' : 'r');
    if (m[0] === 'm') feats.push(move(m, cur, [pick([3, 5]), pick([0, 4]), 0]));
    else { feats.push(rotate(m, cur, [0, 0, pick([30, 45, 90])])); if (!curved) ext = [ext[0], ext[1], ext[2]]; }
    cur = m;
  };
  const anyRoot = () => {
    const u = r();
    if (u < 0.40) root(['box', 'box', 'box', 'cylinder', 'prism', 'wedge']);
    else if (u < 0.55) root(['sphere', 'cone', 'cylinder']);
    else if (u < 0.65) root(['torus']);
    else if (u < 0.72) lExtrude();
    else if (u < 0.80) joined();
    else if (u < 0.87) movedOrTurned();
    else if (u < 0.94) plateWithCuts();
    else holesPlate();
  };

  /** a step vector for a linear repeat along an axis of the current part, picked from the cases the guards separate */
  const stepFor = () => {
    const a = pick([0, 1, 2]); const e = ext[a];
    const sgn = r() < 0.2 ? -1 : 1;
    const cases = [
      () => e * 1.6 + 2 * scale, () => e * 1.6 + 2 * scale, () => e * 0.6, () => e, () => e,
      () => e * 0.005, () => e * 0.012, () => e * 0.02, // the near-coincident shifts (1.5% of the smallest size is the guard)
      () => e - 3e-4, () => e - 1e-5, () => e - 4e-5, // slivers
      () => e + 1e-6, () => e + 1e-5, () => e + 5e-5, () => e + 5e-4, () => e + 0.3, // a hair apart
      () => 0,
    ];
    const s = [0, 0, 0]; s[a] = sgn * pick(cases)();
    const v = r();
    if (v < 0.15) { const b = (a + 1) % 3; s[b] = pick([ext[b], ext[b] * 0.5, ext[b] - 2e-4, 5]); if (r() < 0.5) s[a] = pick([e + 0.2, e, e - 2e-4]); } // diagonal: edge contact, aligned, overlap
    if (v > 0.93) { s[(a + 1) % 3] = ext[(a + 1) % 3]; s[(a + 2) % 3] = ext[(a + 2) % 3]; s[a] = e; } // a point
    return s;
  };
  const tail = (prev) => {
    // what follows: another repeat / mirror / move / hole / pocket on the result, so the dependency and bookkeeping paths run
    const u = r();
    if (u < 0.25) return;
    if (u < 0.40) { feats.push(move(id('m'), prev, [pick([2, 5]), 0, pick([0, 3])])); return; }
    if (u < 0.55) { feats.push(hole(id('h'), prev, { diameter: 2 * scale, depth: 40 * scale, center: [pick([0, 1]) * scale, 0, 0] })); return; }
    if (u < 0.65) { feats.push(mirror(id('x'), prev, pick(['yz', 'xz', 'xy']))); return; }
    if (u < 0.75) { feats.push(pattern(id('pa'), prev, { count: pick([2, 3]), step: stepFor() })); return; }
    if (u < 0.85) { feats.push(rotate(id('r'), prev, [0, 0, 90])); return; }
    if (u < 0.92) { const s = id('sk'); feats.push(rect(s, 3 * scale, 3 * scale)); feats.push(pocket(id('pk'), s, prev, 2 * scale)); return; }
    feats.push(combine(id('c'), 'union', [prev, cur === prev ? prev : cur]));
  };

  const doRepeat = () => {
    const p = id('pa'); const circular = r() < 0.3;
    const base = anyRootOrNothing();
    if (circular) {
      feats.push(pattern(p, cur, { mode: 'circular', count: pick([0, 1, 2, 3, 4, 6, 8, 12]), axis: pick(AXES), totalAngle: pick([360, 360, 360, 180, 90]) }));
    } else {
      feats.push(pattern(p, cur, { count: pick([0, 1, 2, 3, 3, 4, 5, 9]), step: stepFor() }));
    }
    void base;
    tail(p);
  };
  const doMirror = () => {
    const x = id('x'); feats.push(mirror(x, cur, pick(['yz', 'xz', 'xy'])));
    if (r() < 0.3) feats.push(mirror(id('x'), x, pick(['yz', 'xz', 'xy'])));
    else tail(x);
  };
  let rooted = false;
  const anyRootOrNothing = () => { if (!rooted) { anyRoot(); rooted = true; } return cur; };

  switch (theme) {
    case 0: case 1: case 2: anyRoot(); rooted = true; doRepeat(); break; // repeats on every kind of root
    case 3: anyRoot(); rooted = true; doMirror(); break; // mirrors
    case 4: root(['torus', 'torus', 'box']); rooted = true; if (r() < 0.5) doRepeat(); else doMirror(); break; // tori
    case 5: plateWithCuts(); rooted = true; if (r() < 0.5) doMirror(); break; // repeated cuts (snap / web) and what follows
    case 6: anyRoot(); rooted = true; feats.push(pattern(id('pa'), cur, { count: pick([2, 3]), step: [0, 0, 0] })); tail(feats[feats.length - 1].id); break; // refused pattern, then dependents
    case 7: anyRoot(); rooted = true; doRepeat(); if (r() < 0.6) { const last = feats[feats.length - 1].id; feats.push(mirror(id('x'), last, pick(['yz', 'xz', 'xy']))); } break; // pattern then mirror (several bodies)
    case 8: { anyRoot(); rooted = true; // malformed / odd: a pattern or mirror of something that is not a solid, a second root, a pocket after
      const bad = pick(['nope', cur]);
      feats.push(r() < 0.5 ? pattern(id('pa'), bad, { count: 3, step: [20, 0, 0] }) : mirror(id('x'), bad, 'yz'));
      if (r() < 0.5) { feats.push(r() < 0.5 ? shell(id('s'), cur, prim(cur, '+z'), 2) : fillet(id('f'), cur, between(cur, prim(cur, '+z'), prim(cur, '+x')), 1)); }
      break; }
    default: { anyRoot(); rooted = true; // revolve / groove / loft roots through the group's loop, then a repeat
      const s = id('sk'); feats.push(rect(s, 6 * scale, 14 * scale)); const rv = id('rv'); feats.push(revolve(rv, s, pick([360, 360, 180])));
      cur = rv; curved = true; ext = [12 * scale, 12 * scale, 14 * scale];
      if (r() < 0.4) { const s2 = id('sk'); feats.push(rect(s2, 2 * scale, 3 * scale)); feats.push(groove(id('g'), s2, rv, 360)); }
      if (r() < 0.5) doRepeat(); else doMirror(); break; }
  }
  return { version: 1, features: feats };
}
