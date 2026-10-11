// Cross-slice stress families for the S4 integration sweep (docs/PLAN-next.md, "Integration sweep of S4").
// MEASURE ONLY: nothing here changes a kernel.  Every slice of S4 (mirror of curved faces, overlapping pattern fold, hole on any
// solid, hollow with holes, perpendicular cylinder tee, coaxial sphere/cone, coincident/tangent/mirrored chamfer) was proved by
// its own suite; this file chains them in permuted order and asks one question of each script: is the solid brep-rs built right?
//
//   node wrong-solid-sweep-s4.mjs --n 900 --seed 1 --shards 8 --out DIR [--step-every 6] [--family K] [--timeout 90]
//   node wrong-solid-sweep-s4.mjs --report DIR [--wrong]
//   node wrong-solid-sweep-s4.mjs --one FAMILY INDEX SEED        (print the script and the verdict)
//
// Families (index % 9 picks the family): 0 mirror/hole/hollow permutations, 1 overlapping pattern + hole, 2 pattern + mirror,
// 3 coaxial sphere/cone/cylinder/slab join/cut/keep then hole/cut/mirror, 4 perpendicular cylinder tee then hole/mirror/pattern,
// 5 round/chamfer + mirror + hole, 6 hollow + mirror (+ hole), 7 identical operands inside chains, 8 free mix of every step.
//
// Referees, in order of trust: (1) a closed-form-by-membership oracle written here (a CSG tree with reflect / shift / rotate /
// rounded-box / half-space / shell nodes, midpoint-grid volume, re-measured on a grid twice as fine before a disagreement
// counts); (2) the watertight mesh at chord 0.05 and 0.5, translation invariant; (3) OpenCascade, trusted only where it is
// (it is blind on closed hollows of drilled boxes, counterbores and countersinks, tangent cylinder-box joins, hollow then a bevel
// wider than the wall, and ring chains); (4) a STEP round trip read back by OpenCascade on a sample of the built ones.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const R2 = (x) => Math.round(x * 100) / 100;
export const FAMILIES = ['mirror-hole-hollow', 'pattern-hole', 'pattern-mirror', 'coaxial', 'tee', 'round-mirror-hole', 'hollow-mirror', 'identical', 'free', 'compound'];

// ---- oracle: membership of a CSG tree with the node types this file needs ---------------------------------------------------
let oracleLib = null;
async function lib() { return (oracleLib ??= { oracle: await import('./wrong-solid-sweep-oracle.mjs'), sweep: await import('./wrong-solid-sweep-lib.mjs') }); }

function reflectP(p, ax, at) { const q = [...p]; q[ax] = 2 * at - q[ax]; return q; }
export function inside2(n, x, y, z, leaf) {
  switch (n.t) {
    case 'op': {
      const ia = inside2(n.a, x, y, z, leaf);
      if (n.op === 'subtract') return ia && !inside2(n.b, x, y, z, leaf);
      const ib = inside2(n.b, x, y, z, leaf);
      return n.op === 'union' ? ia || ib : ia && ib;
    }
    case 'refl': { const q = reflectP([x, y, z], n.ax, n.at); return inside2(n.a, q[0], q[1], q[2], leaf); }
    case 'shift': return inside2(n.a, x - n.d[0], y - n.d[1], z - n.d[2], leaf);
    case 'rot': { const c = Math.cos(n.th), s = Math.sin(n.th); return inside2(n.a, c * x + s * y, -s * x + c * y, z, leaf); } // rotate by +th
    case 'many': { for (const d of n.ds) if (inside2(n.a, x - d[0], y - d[1], z - d[2], leaf)) return true; return false; }
    case 'cutp': return inside2(n.a, x, y, z, leaf) && n.n[0] * x + n.n[1] * y + n.n[2] * z <= n.d + 1e-12;
    case 'edge': { // a box edge along axis `ax`, corner at (e1,e2) with inward signs (s1,s2): remove the chamfer wedge or the fillet corner
      if (!inside2(n.a, x, y, z, leaf)) return false;
      const p = [x, y, z];
      const a = (p[n.k1] - n.e1) * n.s1, b = (p[n.k2] - n.e2) * n.s2;
      if (a < 0 || b < 0 || a >= n.size || b >= n.size) return true;
      return n.round ? Math.hypot(n.size - a, n.size - b) <= n.size : a + b >= n.size;
    }
    case 'rbox': { // every edge and corner of a box rounded by r
      const d = [0, 1, 2].map((k) => Math.max(0, Math.abs([x, y, z][k] - n.c[k]) - (n.s[k] / 2 - n.r)));
      return Math.abs(x - n.c[0]) <= n.s[0] / 2 && Math.abs(y - n.c[1]) <= n.s[1] / 2 && Math.abs(z - n.c[2]) <= n.s[2] / 2 && d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= n.r * n.r;
    }
    case 'shell': { // a box (minus through bores) hollowed by `w`; the open side's wall is gone and the cavity runs flush to it
      const p = [x, y, z];
      if (n.cyl) { // a cylinder about its own z axis, at most one coaxial bore: outer wall w, the bore's tube w, flush to an open end
        const cx = (n.lo[0] + n.hi[0]) / 2, cy = (n.lo[1] + n.hi[1]) / 2, R = (n.hi[0] - n.lo[0]) / 2, rho = Math.hypot(x - cx, y - cy);
        if (rho > R || z < n.lo[2] || z > n.hi[2]) return false;
        const br = n.bores.length ? n.bores[0].r : 0;
        if (rho < br) return false;
        const zlo = n.lo[2] + (n.open === -3 ? 0 : n.w), zhi = n.hi[2] - (n.open === 3 ? 0 : n.w);
        return !(rho < R - n.w && rho > br + (br ? n.w : 0) && z > zlo && z < zhi);
      }
      for (let k = 0; k < 3; k++) if (p[k] < n.lo[k] || p[k] > n.hi[k]) return false;
      for (const b of n.bores) { const u = [0, 1, 2].filter((k) => k !== b.ax); if ((p[u[0]] - b.c[0]) ** 2 + (p[u[1]] - b.c[1]) ** 2 < b.r * b.r) return false; }
      // chamfer planes: keep a + b >= c (a, b the depths from the two faces); the cavity's copy of a plane moves in by w
      const depth = (q) => (p[q.k1] - q.e1) * q.s1 + (p[q.k2] - q.e2) * q.s2;
      for (const q of n.planes ?? []) if (depth(q) < q.c) return false;
      let cav = true;
      for (const q of n.planes ?? []) if (depth(q) <= q.c + n.w * Math.SQRT2) cav = false;
      for (let k = 0; k < 3; k++) {
        const lo = n.lo[k] + (n.open === -(k + 1) ? 0 : n.w), hi = n.hi[k] - (n.open === k + 1 ? 0 : n.w);
        if (p[k] <= lo || p[k] >= hi) cav = false;
      }
      if (cav) for (const b of n.bores) { const u = [0, 1, 2].filter((k) => k !== b.ax); if ((p[u[0]] - b.c[0]) ** 2 + (p[u[1]] - b.c[1]) ** 2 < (b.r + n.w) ** 2) cav = false; }
      return !cav;
    }
    default: return leaf(n, x, y, z);
  }
}
export function bounds2(n, nb) {
  switch (n.t) {
    case 'op': {
      if (n.op === 'subtract') return bounds2(n.a, nb);
      const a = bounds2(n.a, nb), b = bounds2(n.b, nb);
      if (n.op === 'intersect') return [[0, 1, 2].map((k) => Math.max(a[0][k], b[0][k])), [0, 1, 2].map((k) => Math.min(a[1][k], b[1][k]))];
      return [[0, 1, 2].map((k) => Math.min(a[0][k], b[0][k])), [0, 1, 2].map((k) => Math.max(a[1][k], b[1][k]))];
    }
    case 'refl': { const [lo, hi] = bounds2(n.a, nb); const l = [...lo], h = [...hi]; l[n.ax] = 2 * n.at - hi[n.ax]; h[n.ax] = 2 * n.at - lo[n.ax]; return [l, h]; }
    case 'shift': { const [lo, hi] = bounds2(n.a, nb); return [lo.map((v, k) => v + n.d[k]), hi.map((v, k) => v + n.d[k])]; }
    case 'many': { const [lo, hi] = bounds2(n.a, nb); return [[0, 1, 2].map((k) => Math.min(...n.ds.map((d) => lo[k] + d[k]))), [0, 1, 2].map((k) => Math.max(...n.ds.map((d) => hi[k] + d[k])))]; }
    case 'rot': {
      const [lo, hi] = bounds2(n.a, nb); const c = Math.cos(n.th), s = Math.sin(n.th);
      const xs = [], ys = [];
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) { xs.push(c * x - s * y); ys.push(s * x + c * y); }
      return [[Math.min(...xs), Math.min(...ys), lo[2]], [Math.max(...xs), Math.max(...ys), hi[2]]];
    }
    case 'cutp': case 'edge': return bounds2(n.a, nb);
    case 'rbox': return [[0, 1, 2].map((k) => n.c[k] - n.s[k] / 2), [0, 1, 2].map((k) => n.c[k] + n.s[k] / 2)];
    case 'shell': return [n.lo, n.hi];
    default: return nb(n);
  }
}

// Volume by a low-discrepancy (Roberts R3) point set over the solid bounds. A midpoint grid aliases on thin walls (a 4 mm shell on a
// 1 mm grid is 2% off); a quasi-random set does not, and its error falls like N^-(2/3) on a discontinuous indicator.
async function gridVolume(node, N) {
  const { oracle } = await lib();
  const leaf = (n, x, y, z) => oracle.inside(n, x, y, z);
  const [lo, hi] = bounds2(node, oracle.nodeBounds);
  const ext = [0, 1, 2].map((k) => hi[k] - lo[k]);
  if (ext.some((e) => !(e > 0))) return 0;
  const g = 1.2207440846057596, a = [1 / g, 1 / g ** 2, 1 / g ** 3];
  let cnt = 0;
  for (let i = 1; i <= N; i++) {
    const x = lo[0] + ext[0] * ((0.5 + a[0] * i) % 1), y = lo[1] + ext[1] * ((0.5 + a[1] * i) % 1), z = lo[2] + ext[2] * ((0.5 + a[2] * i) % 1);
    if (inside2(node, x, y, z, leaf)) cnt++;
  }
  return (cnt / N) * ext[0] * ext[1] * ext[2];
}

// ---- script generator -----------------------------------------------------------------------------------------------------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mix = (seed, i) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
const OPN = { join: 'union', cut: 'subtract', keep: 'intersect' };
const WORD = ['left-right', 'front-back', 'top-bottom'];
const OPENS = [['left', 0, -1], ['right', 0, 1], ['front', 1, -1], ['back', 1, 1], ['bottom', 2, -1], ['top', 2, 1]];

function mkBase(r, kind, c0, v) {
  const u = (lo, hi) => R2(lo + (hi - lo) * r());
  let call, node, ext, plain = null;
  if (kind === 'box') { const s = [u(16, 60), u(16, 60), u(10, 50)]; ext = s; call = `box(${s.join(', ')}, { at: [${c0.join(', ')}] })`; node = { t: 'prim', kind: 'box', c: c0, s }; plain = { lo: [0, 1, 2].map((k) => c0[k] - s[k] / 2), hi: [0, 1, 2].map((k) => c0[k] + s[k] / 2), bores: [] }; }
  else if (kind === 'cylinder') { const a = u(14, 50), h = u(10, 50); ext = [a, a, h]; call = `cylinder(${a}, ${h}, { at: [${c0.join(', ')}] })`; node = { t: 'prim', kind: 'cylinder', c: c0, r: a / 2, h };
    plain = { lo: [c0[0] - a / 2, c0[1] - a / 2, c0[2] - h / 2], hi: [c0[0] + a / 2, c0[1] + a / 2, c0[2] + h / 2], bores: [], cyl: true }; }
  else if (kind === 'sphere') { const a = u(14, 50); ext = [a, a, a]; call = `sphere(${a}, { at: [${c0.join(', ')}] })`; node = { t: 'prim', kind: 'sphere', c: c0, r: a / 2 }; }
  else if (kind === 'cone') { const a = u(14, 50), h = u(10, 50); ext = [a, a, h]; call = `cone(${a}, ${h}, { at: [${c0.join(', ')}] })`; node = { t: 'prim', kind: 'cone', c: c0, r: a / 2, h }; }
  const bb = [[0, 1, 2].map((k) => c0[k] - ext[k] / 2), [0, 1, 2].map((k) => c0[k] + ext[k] / 2)];
  return { call, node, bb, plain, kind, ext };
}

/** One generation state; steps mutate it. `v` is the variable the steps act on. */
function newState(v, lines) { return { v, lines, node: null, bb: null, plain: null, edgeOK: false, plainBox: false, chain: [], bbOK: true }; }
function setBase(S, b) { S.node = b.node; S.bb = b.bb; S.plain = b.plain; S.edgeOK = b.kind === 'box'; S.plainBox = b.kind === 'box'; S.ext0 = b.ext; S.kind = b.kind; }
function unmodel(S) { S.node = null; S.plain = null; S.edgeOK = false; S.plainBox = false; }
const ctr = (bb) => [0, 1, 2].map((k) => (bb[0][k] + bb[1][k]) / 2);
const extOf = (bb) => [0, 1, 2].map((k) => bb[1][k] - bb[0][k]);

const STEPS = {
  mirror(S, r) {
    const ax = S.forceAx ?? Math.floor(r() * 3);
    S.lines.push(`${S.v} = mirror(${S.v}, '${WORD[ax]}')`); S.chain.push(`mirror:${WORD[ax]}`);
    if (!S.bb) { unmodel(S); return; }
    // the kernel mirrors across the face of the part that is nearer the world plane (the copy lands on the origin's side; a tie goes to the min face)
    const atLo = (S.bb[0][ax] + S.bb[1][ax]) / 2 >= 0, at = atLo ? S.bb[0][ax] : S.bb[1][ax];
    if (S.node) S.node = { t: 'op', op: 'union', a: S.node, b: { t: 'refl', a: S.node, ax, at } };
    // a chamfer plane that involves the mirror axis reflects into a DIFFERENT plane: the doubled part is no longer box + planes
    if (S.plain && (S.plain.planes ?? []).some((q) => q.k1 === ax || q.k2 === ax)) S.plain = null;
    if (S.plain?.cyl && ax !== 2) S.plain = null; // two round parts side by side are not one cylinder
    if (S.plain) {
      const p = S.plain, lo = [...p.lo], hi = [...p.hi];
      if (atLo) lo[ax] = 2 * at - p.hi[ax]; else hi[ax] = 2 * at - p.lo[ax];
      const bores = [...p.bores];
      for (const b of p.bores) {
        if (b.ax === ax) continue; // a bore along the mirror axis continues straight through the doubled box
        const c = [...b.c]; const u = [0, 1, 2].filter((k) => k !== b.ax); const i = u.indexOf(ax);
        c[i] = 2 * at - c[i]; if (Math.abs(c[i] - b.c[i]) > 1e-9) bores.push({ ax: b.ax, c, r: b.r });
      }
      S.plain = { lo, hi, bores, planes: p.planes };
    }
    const nlo = [...S.bb[0]], nhi = [...S.bb[1]];
    if (atLo) nlo[ax] = 2 * at - S.bb[1][ax]; else nhi[ax] = 2 * at - S.bb[0][ax];
    S.bb = [nlo, nhi]; (S.mAx ??= new Set()).add(ax);
    S.edgeOK = S.edgeOK && S.plainBox; S.mirrored = true;
  },
  hole(S, r, kind = 'T') {
    if (!S.bb) { S.lines.push(`hole(${S.v}, { across: 6 })`); S.chain.push('hole'); unmodel(S); return; }
    const ext = extOf(S.bb);
    const axis = S.forceAx ?? (r() < 0.7 ? 2 : r() < 0.5 ? 0 : 1);
    const inplane = [0, 1, 2].filter((k) => k !== axis);
    const across = R2((0.1 + 0.4 * r()) * Math.min(ext[inplane[0]], ext[inplane[1]]));
    const off = r() < 0.5 ? [0, 0] : [R2((r() - 0.5) * 0.4 * ext[inplane[0]]), R2((r() - 0.5) * 0.4 * ext[inplane[1]])];
    const parts = [`across: ${across}`];
    if (axis !== 2) parts.push(`along: '${'xyz'[axis]}'`);
    if (off[0] || off[1]) parts.push(`at: [${off[0]}, ${off[1]}]`);
    let deep = null, cb = null, cs = null;
    if (kind === 'B') { deep = R2((0.15 + 0.6 * r()) * ext[axis]); parts.push(`deep: ${deep}`); }
    if (kind === 'CB') { cb = { a: R2(across * (1.4 + 0.6 * r())), d: R2(1.5 + 3 * r()) }; parts.push(`counterbore: { across: ${cb.a}, deep: ${cb.d} }`); }
    if (kind === 'CS') { cs = R2(across * 1.8); parts.push(`countersink: { across: ${cs}, angle: 90 }`); }
    S.lines.push(`hole(${S.v}, { ${parts.join(', ')} })`); S.chain.push(`hole${kind}`);
    if (!S.node) return;
    const c = ctr(S.bb); c[inplane[0]] += off[0]; c[inplane[1]] += off[1];
    const top = S.bb[1][axis];
    const tc = [c[inplane[0]], c[inplane[1]]];
    // a blind hole drilled along the axis the part was mirrored on starts from the part's MIDDLE (the docs say so: the interpreter cannot know the top)
    const mid = deep != null && S.mAx?.has(axis);
    if (mid && kind !== 'B') { unmodel(S); return; }
    const tool = { t: 'tool', axis, c, r: across / 2, lo: deep == null ? -1e5 : mid ? c[axis] - deep / 2 : top - deep, hi: deep == null ? 1e5 : mid ? c[axis] + deep / 2 : top };
    S.node = { t: 'op', op: 'subtract', a: S.node, b: tool };
    if (cs != null) S.node = { t: 'op', op: 'subtract', a: S.node, b: { t: 'csink', axis, c, rb: across / 2, rm: cs / 2, top } };
    if (cb) S.node = { t: 'op', op: 'subtract', a: S.node, b: { t: 'tool', axis, c, r: cb.a / 2, lo: top - cb.d, hi: top } };
    // a round part hollows exactly only with ONE bore down its own axis (S4d's shell_cavity_cyl_bore)
    if (S.plain?.cyl && !(kind === 'T' && axis === 2 && off[0] === 0 && off[1] === 0 && S.plain.bores.length === 0)) S.plain = null;
    if (S.plain && kind === 'T') S.plain = { ...S.plain, bores: [...S.plain.bores, { ax: axis, c: tc, r: across / 2 }] }; else S.plain = null;
    S.plainBox = false; // a hole spoils the whole-round closed form
  },
  hollow(S, r) {
    const ext = S.bb ? extOf(S.bb) : S.ext0 ?? [20, 20, 20];
    const wall = R2((0.04 + 0.1 * r()) * Math.min(...ext));
    const open = r() < 0.4 ? null : OPENS[Math.floor(r() * 6)];
    S.lines.push(`hollow(${S.v}, { wall: ${wall}${open ? `, open: '${open[0]}'` : ''} })`); S.chain.push(`hollow${open ? ':' + open[0] : ''}`);
    if (S.plain && S.bb && !(S.plain.cyl && open && open[1] !== 2)) {
      const p = S.plain;
      S.node = { t: 'shell', lo: p.lo, hi: p.hi, w: wall, open: open ? (open[1] + 1) * open[2] : 0, bores: p.bores, planes: p.planes ?? [], cyl: !!p.cyl };
    } else unmodel(S);
    S.plain = null; S.edgeOK = false; S.plainBox = false; S.hollowed = true;
    // a bevel straight after the hollow of a plain box is the shell minus the bevel's half-space wedge (PLAN section 38): the
    // membership oracle models it, so the bevel-wider-than-the-wall class is judged by the oracle and not by OpenCascade
    S.edgeOK = !!(S.node && S.node.t === 'shell' && !S.node.cyl && !(S.node.bores && S.node.bores.length) && !(S.node.planes && S.node.planes.length));
  },
  repeat(S, r) {
    const count = 2 + Math.floor(r() * 2);
    const e = S.bb ? extOf(S.bb) : S.ext0;
    const step = [R2((0.3 + 0.65 * r()) * e[0]), r() < 0.5 ? 0 : R2((r() - 0.5) * e[1]), 0];
    S.lines.push(`repeat(${S.v}, { count: ${count}, step: [${step.join(', ')}] })`); S.chain.push('repeat');
    if (!S.bb || !S.node) { unmodel(S); return; }
    const ds = Array.from({ length: count }, (_, k) => [k * step[0], k * step[1], 0]);
    S.node = { t: 'many', a: S.node, ds };
    S.bb = [S.bb[0].map((v, k) => v + Math.min(0, ...ds.map((d) => d[k]))), S.bb[1].map((v, k) => v + Math.max(0, ...ds.map((d) => d[k])))];
    S.plain = null; S.edgeOK = false; S.plainBox = false;
  },
  around(S, r) {
    const count = 3 + Math.floor(r() * 3);
    S.lines.push(`repeatAround(${S.v}, { count: ${count}, axis: 'z' })`); S.chain.push('around');
    if (!S.node) { unmodel(S); return; }
    const copies = Array.from({ length: count }, (_, k) => ({ t: 'rot', a: S.node, th: (2 * Math.PI * k) / count }));
    S.node = copies.reduce((acc, c) => ({ t: 'op', op: 'union', a: acc, b: c }));
    S.bb = null; S.plain = null; S.edgeOK = false; S.plainBox = false; // exact bbox of rotated copies is not modelled: no more bbox-dependent steps
  },
  edge(S, r, round) {
    const size = R2((0.03 + 0.14 * r()) * Math.min(...(S.bb ? extOf(S.bb) : S.ext0)));
    const first = ['top', 'bottom'][Math.floor(r() * 2)], second = ['front', 'back', 'left', 'right'][Math.floor(r() * 4)];
    S.lines.push(`${round ? 'round' : 'bevel'}(${S.v}.edge('${first}', '${second}'), ${size})`); S.chain.push(`${round ? 'round' : 'bevel'}-edge`);
    if (!(S.node && S.bb && S.edgeOK)) { unmodel(S); return; }
    const k1 = 2, s1 = first === 'top' ? 1 : -1, e1 = first === 'top' ? S.bb[1][2] : S.bb[0][2];
    const k2 = second === 'front' || second === 'back' ? 1 : 0;
    const neg = second === 'front' || second === 'left';
    const e2 = neg ? S.bb[0][k2] : S.bb[1][k2];
    // inward sign: from the face into the part. For the top face inward is -z, so a = (e - p) when the face is at the max.
    S.node = { t: 'edge', a: S.node, k1, k2, e1, e2, s1: -s1, s2: neg ? 1 : -1, size, round };
    // a chamfer keeps the part a convex polyhedron (box + planes - bores), which `hollow` can still offset exactly; a round cannot
    S.plain = !round && S.plain ? { ...S.plain, planes: [...(S.plain.planes ?? []), { k1, k2, e1, e2, s1: -s1, s2: neg ? 1 : -1, c: size }] } : null;
    S.plainBox = false; S.edgeRounded = true;
  },
  wholeRound(S, r) {
    const size = R2((0.03 + 0.15 * r()) * Math.min(...S.ext0));
    S.lines.push(`round(${S.v}, ${size})`); S.chain.push('round-all');
    if (S.plainBox && S.node) { S.node = { t: 'rbox', c: S.node.c, s: S.node.s, r: size }; S.plain = null; S.plainBox = false; } else unmodel(S);
    S.edgeOK = false;
  },
};

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function permute(r, arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function runStep(S, r, name) {
  switch (name) {
    case 'holeT': return STEPS.hole(S, r, 'T');
    case 'holeB': return STEPS.hole(S, r, 'B');
    case 'holeCB': return STEPS.hole(S, r, 'CB');
    case 'holeCS': return STEPS.hole(S, r, 'CS');
    case 'round': return r() < 0.5 && S.plainBox ? STEPS.wholeRound(S, r) : STEPS.edge(S, r, true);
    case 'bevel': return STEPS.edge(S, r, false);
    default: return STEPS[name](S, r);
  }
}

// coaxial / tee partners ------------------------------------------------------------------------------------------------------
function addPartner(S, r, kind, op, opts = {}) {
  if (!S.bb) return; // the bbox of a cut or kept part is not known exactly: no more bbox-placed partners
  const e = extOf(S.bb);
  const u = (lo, hi) => R2(lo + (hi - lo) * r());
  const z0 = (S.bb[0][2] + S.bb[1][2]) / 2, cx = ctr(S.bb)[0], cy = ctr(S.bb)[1];
  const pn = `p${S.pseq = (S.pseq ?? 0) + 1}`;
  let call, node, pb, turnLine = null;
  const place = (hp) => { // z-centre of the partner by category: overlap, contain, flush-on-top, touching, disjoint
    const cat = pick(r, ['overlap', 'overlap', 'overlap', 'top', 'bottom', 'mid', 'flush']);
    const hb = e[2] / 2;
    switch (cat) { case 'top': return R2(S.bb[1][2] + hp - u(0, 0.6) * hp); case 'bottom': return R2(S.bb[0][2] - hp + u(0, 0.6) * hp); case 'mid': return R2(z0 + (r() - 0.5) * hb); case 'flush': return R2(S.bb[1][2] + hp); default: return R2(z0 + (r() - 0.5) * 1.6 * (hb + hp)); }
  };
  if (kind === 'sphere') { const a = u(14, 50), cz = place(a / 2); call = `sphere(${a}, { at: [${R2(cx)}, ${R2(cy)}, ${cz}] })`; node = { t: 'prim', kind: 'sphere', c: [R2(cx), R2(cy), cz], r: a / 2 }; pb = [[cx - a / 2, cy - a / 2, cz - a / 2], [cx + a / 2, cy + a / 2, cz + a / 2]]; }
  else if (kind === 'cone' || kind === 'coneDown') { const a = u(14, 50), h = u(8, 40), cz = place(h / 2); const c = [R2(cx), R2(cy), cz]; call = `cone(${a}, ${h}, { at: [${c.join(', ')}] })`; node = { t: 'prim', kind: 'cone', c, r: a / 2, h }; pb = [[c[0] - a / 2, c[1] - a / 2, cz - h / 2], [c[0] + a / 2, c[1] + a / 2, cz + h / 2]]; if (kind === 'coneDown') { turnLine = `turn(${pn}, [180, 0, 0])`; node = { t: 'refl', a: node, ax: 2, at: cz }; } }
  else if (kind === 'cylinder') { const a = u(10, 50), h = u(6, 40), cz = place(h / 2); const c = [R2(cx), R2(cy), cz]; call = `cylinder(${a}, ${h}, { at: [${c.join(', ')}] })`; node = { t: 'prim', kind: 'cylinder', c, r: a / 2, h }; pb = [[c[0] - a / 2, c[1] - a / 2, cz - h / 2], [c[0] + a / 2, c[1] + a / 2, cz + h / 2]]; }
  else if (kind === 'slab') { const w = u(20, 70), h = u(4, 30), cz = place(h / 2); const c = [R2(cx), R2(cy), cz]; call = `box(${w}, ${w}, ${h}, { at: [${c.join(', ')}] })`; node = { t: 'prim', kind: 'box', c, s: [w, w, h] }; pb = [[c[0] - w / 2, c[1] - w / 2, cz - h / 2], [c[0] + w / 2, c[1] + w / 2, cz + h / 2]]; }
  else if (kind === 'tee') { // a cylinder turned onto x or y, through the base's axis
    const R = S.R0 ?? S.node.r ?? Math.min(e[0], e[1]) / 2, H = e[2];
    const ax = r() < 0.5 ? 0 : 1;
    const rr = R2(Math.max(1.5, u(0.3, 0.92) * Math.min(R, H / 2 - 1.5)));
    const dz = R2((r() - 0.5) * 2 * Math.max(0, H / 2 - rr - 0.5) * 0.8);
    const inner = Math.sqrt(Math.max(0, R * R - rr * rr)), mode = r();
    let xa, xb; // the two ends along the small axis, from the big axis: each clears the wall (x >= R) or stops inside (|x| <= sqrt(R^2 - r^2)); at least one clears
    if (mode < 0.65) { xa = -R2(R * u(1.0, 1.6)); xb = R2(R * u(1.0, 1.6)); }
    else { xa = R2(inner * u(0.1, 0.9) * (r() < 0.5 ? -1 : 1)); xb = R2(R * u(1.0, 1.6)); if (r() < 0.5) { xa = -xa; xb = -xb; } if (xa > xb) [xa, xb] = [xb, xa]; }
    const len = R2(xb - xa), mid = R2((xa + xb) / 2);
    const c = [R2(cx), R2(cy), R2(z0 + dz)]; c[ax] = R2(c[ax] + mid);
    call = `cylinder(${rr * 2}, ${len}, { at: [${c.join(', ')}] })`;
    turnLine = `turn(${pn}, [${ax === 1 ? '90, 0, 0' : '0, 90, 0'}])`;
    const tool = { t: 'tool', axis: ax, c, r: rr, lo: c[ax] - len / 2, hi: c[ax] + len / 2 };
    node = tool; pb = [[0, 1, 2].map((k) => k === ax ? c[k] - len / 2 : c[k] - rr), [0, 1, 2].map((k) => k === ax ? c[k] + len / 2 : c[k] + rr)];
  }
  S.lines.push(`const ${pn} = ${call}`);
  if (turnLine) S.lines.push(turnLine);
  S.lines.push(`${S.v} = ${op}(${S.v}, ${pn})`); S.chain.push(`${op}:${kind}`);
  if (S.node) {
    S.node = { t: 'op', op: OPN[op], a: S.node, b: node };
    if (op === 'join') S.bb = [[0, 1, 2].map((k) => Math.min(S.bb[0][k], pb[0][k])), [0, 1, 2].map((k) => Math.max(S.bb[1][k], pb[1][k]))];
    else if (op === 'cut') { // the bbox is unchanged only when the tool cannot touch an extreme: strictly inside it, or apart from it on some axis
      const inner = [0, 1, 2].every((k) => pb[0][k] > S.bb[0][k] + 1e-6 && pb[1][k] < S.bb[1][k] - 1e-6);
      const apart = [0, 1, 2].some((k) => pb[1][k] < S.bb[0][k] - 1e-6 || pb[0][k] > S.bb[1][k] + 1e-6);
      if (!inner && !apart) S.bb = null;
    } else S.bb = null; // keep
  } else S.bb = null;
  S.plain = null; S.edgeOK = false; S.plainBox = false; S.joined = true;
  if (!S.bb) { S.bbOK = false; }
}

/** Two COMPOUND parts (each a box with pockets, steps, a hollow or a cup, all on an integer grid) combined by join, cut or keep: concave
 *  against concave, with an exact voxel oracle. The single-shell and the sealed-cavity forms both appear. */
function genCompound(index, seed) {
  const r = rng(mix(seed, index * 8 + 9 + 31));
  const ib = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  const lines = [];
  const mkPart = (name, c0, twin = null) => {
    const big = r() < 0.5; // half the parts are the size of a student's block (thin walls against a large cavity: the probes' worst case)
    const s = twin ? twin.s : (big ? [ib(30, 60), ib(24, 40), ib(8, 14)] : [ib(6, 14), ib(6, 14), ib(4, 10)]).map((v) => v + (v % 2)); // even sizes: the wall of a hollow stays on the grid
    const c = twin ? c0 : c0.map((v) => v + ib(-4, 4));
    lines.push(`let ${name} = box(${s.join(', ')}, { at: [${c.join(', ')}] })`);
    let node = { t: 'prim', kind: 'box', s, c };
    const kind = twin ? twin.kind : ib(0, 3);
    const steps = twin ? ib(0, 1) : ib(1, 2);
    mkPart.last = { s, kind };
    const shape = [];
    if (kind <= 1) { // hollow (closed or open on one side)
      const w = 1, open = kind === 0 ? null : OPENS[ib(0, 5)];
      lines.push(`hollow(${name}, { wall: ${w}${open ? `, open: '${open[0]}'` : ''} })`);
      const inner = s.map((v) => v - 2 * w), ic = [...c], isz = [...inner];
      if (open) { const ax = open[1]; isz[ax] += w; ic[ax] += (open[2] * w) / 2; }
      node = { t: 'op', op: 'subtract', a: node, b: { t: 'prim', kind: 'box', s: isz, c: ic } };
      shape.push(open ? 'cup' : 'cavity');
    }
    for (let k = 0; k < steps; k++) { // pockets and steps
      const ts = [ib(2, 8), ib(2, 8), ib(2, 8)], tc = c.map((v, i) => v + ib(-Math.floor(s[i] / 2), Math.floor(s[i] / 2)));
      const op = r() < 0.7 ? 'cut' : 'join';
      lines.push(`const ${name}t${k} = box(${ts.join(', ')}, { at: [${tc.join(', ')}] })`, `${name} = ${op}(${name}, ${name}t${k})`);
      node = { t: 'op', op: op === 'cut' ? 'subtract' : 'union', a: node, b: { t: 'prim', kind: 'box', s: ts, c: tc } };
      shape.push(op);
    }
    return { node, shape };
  };
  const A = mkPart('a', [0, 0, 0]);
  let B;
  if (r() < 0.45) { // a twin of the same size and kind, shifted most of its width along one axis: each one's walls cross the other's cavity
    const { s, kind } = mkPart.last;
    // half-grid offsets on the other axes keep the two parts' walls out of each other's planes (general position, which is where the
    // integer grid's coincident planes would hide a defect); 0.5 is still exact for the voxel oracle
    const ax = ib(0, 2), off = [ib(-3, 3) * 0.5, ib(-3, 3) * 0.5, ib(-2, 2) * 0.5];
    off[ax] = Math.round(s[ax] * (0.6 + 0.3 * r())) * (r() < 0.5 ? 1 : -1);
    const cA = lines[0].match(/at: \[(.*)\]/)[1].split(', ').map(Number); // A's own centre
    B = mkPart('b', cA.map((v, k) => v + off[k]), { s, kind });
  } else B = mkPart('b', [ib(-6, 6), ib(-6, 6), ib(-3, 3)]);
  const op = ['join', 'cut', 'keep'][ib(0, 2)];
  lines.push(`let r = ${op}(a, b)`);
  const node = { t: 'op', op: op === 'cut' ? 'subtract' : op === 'join' ? 'union' : 'intersect', a: A.node, b: B.node };
  return { code: lines.join('\n'), tags: { family: 'compound', fam: 9, index, seed, chain: `${A.shape.join('+')} ${op} ${B.shape.join('+')}` }, oracle: { node, voxel: true } };
}

export function genS4(index, seed = 1, famOverride = null) {
  const fam = famOverride ?? index % FAMILIES.length;
  if (fam === 9) return genCompound(index, seed);
  const r = rng(mix(seed, index * 8 + fam + 17));
  const lines = []; const S = newState('v', lines);
  const c0 = r() < 0.7 ? [0, 0, 0] : [R2((r() - 0.5) * 20), R2((r() - 0.5) * 20), R2((r() - 0.5) * 20)];
  const base = (kind) => { const b = mkBase(r, kind, c0, 'v'); lines.push(`let v = ${b.call}`); setBase(S, b); S.chain.push(kind); return b; };
  const apply = (names) => { for (const n of names) { if (S.bbOK === false && ['hole', 'holeT', 'holeB', 'holeCB', 'holeCS', 'mirror', 'hollow', 'repeat'].includes(n) && !S.node) { /* bbox unknown: kernel still decides */ } runStep(S, r, n); } };
  switch (fam) {
    case 0: { base(r() < 0.8 ? 'box' : 'cylinder'); apply(permute(r, ['mirror', pick(r, ['holeT', 'holeT', 'holeB']), 'hollow']).slice(0, 2 + Math.floor(r() * 2))); break; }
    case 1: { base(pick(r, ['box', 'box', 'cylinder'])); apply(permute(r, ['repeat', pick(r, ['holeT', 'holeB'])])); if (r() < 0.3) apply([pick(r, ['mirror', 'holeT'])]); break; }
    case 2: { base(pick(r, ['box', 'cylinder', 'box'])); const a = permute(r, ['repeat', 'mirror']); if (r() < 0.35) a.splice(Math.floor(r() * 3), 0, 'holeT'); apply(a); break; }
    case 3: {
      const bk = pick(r, ['sphere', 'cone', 'cylinder', 'box']); base(bk);
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) addPartner(S, r, pick(r, ['sphere', 'cone', 'coneDown', 'cylinder', 'slab']), pick(r, ['join', 'join', 'cut', 'keep']));
      if (S.bb) apply([pick(r, ['holeT', 'holeB', 'mirror', 'holeT'])]);
      break;
    }
    case 4: {
      base('cylinder'); S.R0 = S.node.r;
      if (r() < 0.5) { // the other order: drill or mirror (along the axis) the shaft first, then cross it
        S.forceAx = 2; if (r() < 0.5) STEPS.hole(S, r, 'T'); else STEPS.mirror(S, r); S.forceAx = null;
      }
      addPartner(S, r, 'tee', pick(r, ['join', 'join', 'keep', 'cut']));
      if (S.bb) apply(permute(r, ['mirror', 'holeT', 'repeat']).slice(0, 1 + Math.floor(r() * 2)));
      break;
    }
    case 5: { base('box'); const t = [pick(r, ['round', 'bevel']), 'mirror', pick(r, ['holeT', 'holeB'])]; apply(permute(r, t)); break; }
    case 6: { base(pick(r, ['box', 'box', 'cylinder'])); const t = permute(r, ['hollow', 'mirror', ...(r() < 0.5 ? ['holeT'] : []), ...(r() < 0.3 ? ['bevel'] : [])]); apply(t); break; }
    case 7: {
      // two identical bodies built by the same recipe, then joined or intersected, then more
      const seedR = Math.floor(r() * 1e9);
      const build = (v) => { const rr = rng(seedR); const L = []; const T = newState(v, L); const b = mkBase(rr, pick(rr, ['box', 'box', 'cylinder', 'sphere', 'cone']), c0, v); L.push(`let ${v} = ${b.call}`); setBase(T, b);
        const k = Math.floor(rr() * 3); const pool = ['holeT', 'holeB', 'mirror', 'round', 'bevel', 'hollow']; for (let i = 0; i < k; i++) runStep(T, rr, pick(rr, pool)); return T; };
      const A = build('v'), B = build('w');
      lines.push(...A.lines, ...B.lines);
      const op = pick(r, ['join', 'join', 'keep', 'cut']);
      lines.push(`v = ${op}(v, w)`);
      S.chain = [...A.chain, `${op}:identical`];
      S.node = op === 'cut' ? { t: 'op', op: 'subtract', a: A.node ?? { t: 'prim', kind: 'box', c: [0, 0, 0], s: [0, 0, 0] }, b: A.node } : A.node; if (!A.node) S.node = null;
      S.bb = A.bb; S.plain = null; S.edgeOK = false; S.ext0 = A.ext0;
      if (op !== 'cut' && S.bb && r() < 0.6) apply(permute(r, ['holeT', 'mirror', 'repeat']).slice(0, 1 + Math.floor(r() * 2)));
      break;
    }
    default: { // free mix
      base(pick(r, ['box', 'box', 'cylinder', 'sphere', 'cone']));
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const k = pick(r, ['mirror', 'holeT', 'holeB', 'hollow', 'repeat', 'bevel', 'round', 'tee', 'coax', 'around', 'holeCB', 'holeCS']);
        if (k === 'tee') { if (S.bb && S.node && S.kind === 'cylinder' && !S.mirrored && !S.joined) addPartner(S, r, 'tee', pick(r, ['join', 'keep'])); }
        else if (k === 'coax') { if (S.bb && S.node) addPartner(S, r, pick(r, ['sphere', 'cone', 'cylinder', 'slab']), pick(r, ['join', 'cut', 'keep'])); }
        else runStep(S, r, k);
      }
    }
  }
  const tags = { family: FAMILIES[fam], fam, index, seed, chain: S.chain.join(' > ') };
  return { code: lines.join('\n'), tags, oracle: { node: S.node } };
}

// ---- running one script -------------------------------------------------------------------------------------------------------
function meshAt(run, json, id, exact, defl) {
  let m;
  try { m = JSON.parse(run.brep.mesh_feature(json, id, defl)); } catch (e) { return { error: String(e).slice(0, 160) }; }
  const P = m.positions, I = m.indices;
  if (!P || !I || !I.length) return { error: 'empty mesh' };
  const W = 1e-6, ids = new Map(), canon = new Array(P.length / 3);
  for (let i = 0; i < P.length / 3; i++) { const key = `${Math.round(P[3 * i] / W)},${Math.round(P[3 * i + 1] / W)},${Math.round(P[3 * i + 2] / W)}`; if (!ids.has(key)) ids.set(key, ids.size); canon[i] = ids.get(key); }
  const vol = (ox, oy, oz) => { let v = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; const ax = P[a] - ox, ay = P[a + 1] - oy, az = P[a + 2] - oz, bx = P[b] - ox, by = P[b + 1] - oy, bz = P[b + 2] - oz, cx = P[c] - ox, cy = P[c + 1] - oy, cz = P[c + 2] - oz; v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6; } return v; };
  const dir = new Map();
  for (let t = 0; t < I.length; t += 3) { const ci = [canon[I[t]], canon[I[t + 1]], canon[I[t + 2]]]; if (ci[0] === ci[1] || ci[1] === ci[2] || ci[0] === ci[2]) continue; for (let e = 0; e < 3; e++) { const k = `${ci[e]}>${ci[(e + 1) % 3]}`; dir.set(k, (dir.get(k) ?? 0) + 1); } }
  let open = 0, unbalanced = 0;
  for (const [k, n] of dir) { const [u, w] = k.split('>'); const back = dir.get(`${w}>${u}`) ?? 0; if (back === 0) open++; else if (back !== n) unbalanced++; }
  const v0 = vol(0, 0, 0), v1 = vol(1000, -777, 555);
  let area = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); }
  return { defl, open, unbalanced, meshVolume: v0, translationDelta: Math.abs(v0 - v1), tris: I.length / 3, area };
}

function stepRoundTrip(run, json, id, volume) {
  let f;
  try { f = JSON.parse(run.brep.export_step(json, id)); } catch (e) { return { state: 'throw', detail: String(e).slice(0, 160) }; }
  if (!f.step) return { state: 'refused', detail: JSON.stringify(f).slice(0, 200) };
  const oc = run.oc;
  try {
    oc.FS.writeFile('/in.step', f.step);
    const reader = new oc.STEPControl_Reader();
    reader.ReadFile('/in.step'); reader.TransferRoots(new oc.Message_ProgressRange());
    const shape = reader.OneShape();
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const an = new oc.BRepCheck_Analyzer(shape, true, false, false);
    let solids = 0; for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) solids++;
    const rel = Math.abs(g.Mass() - volume) / Math.max(1, volume);
    const valid = an.IsValid_2 ? an.IsValid_2() : an.IsValid();
    return rel > 1e-6 ? { state: 'WRONG', detail: `STEP reads back ${g.Mass()} vs ${volume} (rel ${rel.toExponential(2)}), ${solids} solids, valid ${valid}` } : valid ? { state: 'ok', solids } : { state: 'WRONG', detail: `STEP reads back invalid (${solids} solids) at the right volume` };
  } catch (e) { return { state: 'readback-throw', detail: String(e).slice(0, 160) }; }
}


export async function makeS4Runner() {
  const { sweep } = await lib();
  const run = await sweep.makeRunner({ occt: true });
  const { runScript } = await import('@shuff57/reshape-script/reshape-script');
  const jsonOf = (code) => { const r = runScript(code); const features = r.doc.features; return { json: JSON.stringify({ version: 1, features }), id: features.at(-1).id }; };
  async function runOne(script, { stepRT = false, onBrepDone } = {}) {
    const rec = run.run({ code: script.code, tags: script.tags, oracle: {} }, { onBrepDone }); // (the oracle tree here is not the lib's node language) brep build, measure, mesh (one chord), OCCT
    const refused = rec.refusals && Object.keys(rec.refusals).length > 0;
    const extra = {};
    if (!rec.scriptError && !rec.brepThrow && !refused && rec.brep) {
      const { json, id } = jsonOf(script.code);
      extra.mesh = [0.05, 0.5].map((d) => meshAt(run, json, id, rec.brep, d));
      const vol = rec.brep.volume;
      const node = script.oracle?.node;
      if (node && script.oracle.voxel) {
        rec.analytic = { kind: 'voxel', volume: (await lib()).oracle.voxelVolume(node, 0.5) }; // integer grid: exact
      } else if (node) {
        let v = await gridVolume(node, 400000);
        if (Math.abs(v - vol) > 0.004 * Math.max(1, v)) v = await gridVolume(node, 3000000);
        const [blo, bhi] = bounds2(node, (await lib()).oracle.nodeBounds);
        rec.analytic = { kind: 'grid', volume: v, bvol: (bhi[0] - blo[0]) * (bhi[1] - blo[1]) * (bhi[2] - blo[2]) };
      }
      if (stepRT) extra.step = stepRoundTrip(run, json, id, vol);
    }
    return { rec, extra };
  }
  return { run, runOne };
}

/** AGREE / REFUSED / WRONG (+ the sub-classes the triage needs). */
export async function judge(rec, extra) {
  const { sweep } = await lib();
  const c = sweep.classify(rec);
  const wrong = (c.cls ?? '').startsWith('WRONG') ? [...(c.wrong ?? [])] : [];
  let cls = c.cls;
  if (cls === 'REFUSED' || cls === 'SCRIPT-ERROR' || cls === 'BREP-THROW' || cls === 'NO-SHAPE') return { cls, sentence: c.sentence, detail: c.detail };
  const scale = Math.max(1, Math.abs(rec.brep.volume));
  for (const m of extra.mesh ?? []) {
    if (m.error) wrong.push(`WRONG-MESH@${m.defl}:${m.error}`);
    else {
      if (m.open) wrong.push(`WRONG-MESH@${m.defl}:${m.open} open edges`);
      if (m.unbalanced) wrong.push(`WRONG-MESH@${m.defl}:${m.unbalanced} non-manifold/flipped edges`);
      if (m.translationDelta > 1e-6 * scale) wrong.push(`WRONG-MESH@${m.defl}:translation delta ${m.translationDelta.toExponential(2)}`);
      // an inscribed mesh under-fills a curved solid by at most (surface area x chord deflection); a thin shell is mostly that
      if (Math.abs(m.meshVolume - rec.brep.volume) > 0.01 * scale + 1.2 * m.defl * m.area) wrong.push(`WRONG-MESH@${m.defl}:mesh volume ${m.meshVolume.toFixed(2)} vs exact ${rec.brep.volume.toFixed(2)}`);
    }
  }
  if (extra.step?.state === 'WRONG') wrong.push(`WRONG-STEP:${extra.step.detail}`);
  const a = rec.analytic;
  const oracleOk = a && Math.abs(a.volume - rec.brep.volume) <= 0.006 * Math.max(1, a.volume) + 4e-4 * (a.bvol ?? 0);
  const occtAgrees = rec.occt && Math.abs(rec.occt.volume - rec.brep.volume) <= 1e-6 * Math.max(1, rec.brep.volume);
  if (a && !oracleOk && !occtAgrees) wrong.push(`WRONG-ANALYTIC:oracle ${a.volume.toFixed(3)} vs brep ${rec.brep.volume.toFixed(3)} (rel ${(Math.abs(a.volume - rec.brep.volume) / Math.max(1, a.volume)).toExponential(2)}), OCCT ${rec.occt?.volume ?? 'n/a'}`);
  const oracleSuspect = a && !oracleOk && occtAgrees;
  const realWrong = wrong.filter((w) => !(w.startsWith('WRONG-VOLUME') && oracleOk));
  if (realWrong.length) {
    // an OCCT-only disagreement the independent oracle settles in brep-rs's favour is OCCT's problem
    return { cls: 'WRONG', wrong: realWrong, oracle: a?.volume, occt: rec.occt?.volume };
  }
  if (wrong.length) return { cls: 'OCCT-DIFF', wrong, oracle: a?.volume, occt: rec.occt?.volume };
  if (cls === 'SUSPECT-GRID' || oracleSuspect) return { cls: 'ORACLE-SUSPECT', wrong: c.wrong, oracle: a?.volume, occt: rec.occt?.volume };
  if (cls === 'OCCT-WRONG') return { cls: 'OCCT-DIFF', wrong: c.wrong, oracle: a?.volume, occt: rec.occt?.volume };
  if (cls === 'NEAR-MISS') return { cls: 'NEAR-MISS', wrong: c.wrong };
  if (cls === 'OCCT-REFUSED') return { cls: oracleOk ? 'AGREE-ORACLE-ONLY' : 'UNVERIFIED', detail: c.detail };
  if (cls === 'AGREE-ANALYTIC-ONLY' || cls === 'BUILT-NO-REFEREE') return { cls: oracleOk ? 'AGREE-ORACLE-ONLY' : 'UNVERIFIED' };
  return { cls: oracleOk || !a ? 'AGREE' : 'AGREE' };
}

// ---- sharded driver / worker / report ---------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : d; };

async function workerMain() {
  const [lo, hi, seed, out, stepEvery, famOnly] = [+opt('lo'), +opt('hi'), +opt('seed', 1), opt('out'), +opt('step-every', 6), opt('family', null)];
  const R = await makeS4Runner();
  const prog = (o) => appendFileSync(`${out}.prog`, JSON.stringify(o) + '\n');
  for (let i = lo; i < hi; i++) {
    const idx = famOnly == null ? i : i * FAMILIES.length + +famOnly;
    const script = genS4(idx, seed);
    prog({ i, phase: 'brep' });
    // "occt" is written once brep-rs has answered, so a stall in OpenCascade is not called a brep-rs hang
    const { rec, extra } = await R.runOne(script, { stepRT: stepEvery > 0 && i % stepEvery === 0, onBrepDone: () => prog({ i, phase: 'occt' }) });
    const v = await judge(rec, extra);
    appendFileSync(out, JSON.stringify({ i, idx, seed, code: script.code, tags: script.tags, ...v, refusals: rec.refusals, brep: rec.brep, occt: rec.occt, occtThrow: rec.occtThrow, occtRefusals: rec.occtRefusals, hasOracle: !!script.oracle.node, mesh: extra.mesh, step: extra.step, scriptError: rec.scriptError }) + '\n');
    prog({ i, phase: 'done' });
  }
}

async function driverMain() {
  const n = +opt('n', 900), seed = +opt('seed', 1), shards = +opt('shards', 8), out = opt('out'), timeout = +opt('timeout', 90) * 1000, stepEvery = opt('step-every', '6'), fam = opt('family', null);
  mkdirSync(out, { recursive: true });
  const lastLine = (f) => { try { const t = readFileSync(f, 'utf8').trimEnd().split('\n'); return t.length ? JSON.parse(t.at(-1)) : null; } catch { return null; } };
  async function shard(k) {
    const lo = Math.floor((n * k) / shards), hi = Math.floor((n * (k + 1)) / shards);
    const file = path.join(out, `s4-${seed}-${k}.jsonl`);
    if (!existsSync(file)) writeFileSync(file, '');
    let cur = lo;
    while (cur < hi) {
      const stop = Math.min(hi, cur + 150);
      writeFileSync(`${file}.prog`, '');
      const wargs = [SELF, '--worker', '--lo', String(cur), '--hi', String(stop), '--seed', String(seed), '--out', file, '--step-every', stepEvery, ...(fam != null ? ['--family', fam] : [])];
      const child = spawn(process.execPath, wargs, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; child.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
      const v = await new Promise((resolve) => {
        let killed = false;
        const tick = setInterval(() => { try { if (Date.now() - statSync(`${file}.prog`).mtimeMs > timeout && statSync(`${file}.prog`).size > 0) { killed = true; child.kill('SIGKILL'); } } catch { /* */ } }, 2000);
        child.on('exit', (code) => { clearInterval(tick); resolve({ code, killed }); });
      });
      const p = lastLine(`${file}.prog`);
      if (p && p.phase !== 'done') {
        const idx = fam == null ? p.i : p.i * FAMILIES.length + +fam;
        const s = genS4(idx, seed);
        appendFileSync(file, JSON.stringify({ i: p.i, idx, seed, code: s.code, tags: s.tags, cls: p.phase === 'brep' ? (v.killed ? 'BREP-HANG' : 'BREP-CRASH') : (v.killed ? 'OCCT-HANG' : 'OCCT-CRASH'), detail: `worker exit ${v.code}: ${err.slice(-200)}` }) + '\n');
        cur = p.i + 1;
      } else if (v.code && p && p.i + 1 < stop) { // the worker threw between scripts (a generator or oracle bug): say so, never skip silently
        appendFileSync(file, JSON.stringify({ i: p.i + 1, seed, cls: 'HARNESS-CRASH', detail: `worker exit ${v.code}: ${err.slice(-300)}`, tags: {} }) + '\n');
        cur = p.i + 2;
      } else cur = stop;
      if (v.code && !p) { console.error(`shard ${k} failed to start: ${err.slice(-400)}`); break; }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: shards }, (_, k) => shard(k)));
  console.log(`s4 sweep seed ${seed}: ${n} scripts, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
}

function reportMain() {
  const dir = opt('report');
  const recs = [];
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : f.endsWith('.jsonl') ? [path.join(d, f)] : []));
  for (const f of walk(dir)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
  const by = {};
  for (const r of recs) { const k = r.tags?.family ?? '?'; ((by[k] ??= {})[r.cls] = (by[k][r.cls] ?? 0) + 1); }
  console.log('scripts', recs.length);
  for (const [k, c] of Object.entries(by)) console.log(k.padEnd(20), JSON.stringify(c));
  const tot = {}; for (const r of recs) tot[r.cls] = (tot[r.cls] ?? 0) + 1;
  console.log('TOTAL'.padEnd(20), JSON.stringify(tot));
  const steps = recs.filter((r) => r.step); const st = {}; for (const r of steps) st[r.step.state] = (st[r.step.state] ?? 0) + 1;
  console.log('STEP round trips', JSON.stringify(st));
  const norm = (s) => s.replace(/-?\d+(\.\d+)?/g, '#').replace(/\b(box|cyl|cylinder|sphere|cone|hole|round|bevel|hollow|mirror|pattern|rep|combine)\d+\b/g, '<id>');
  const freq = new Map(); for (const r of recs) if (r.cls === 'REFUSED') { const s = norm(Object.values(r.refusals ?? {}).join(' | ')); freq.set(s, (freq.get(s) ?? 0) + 1); }
  console.log('\nREFUSAL SENTENCES'); for (const [s, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(n).padStart(6), s.slice(0, 200));
  const bad = recs.filter((r) => /^(WRONG|BREP-|OCCT-HANG|OCCT-CRASH|NO-SHAPE|ORACLE-SUSPECT|UNVERIFIED)/.test(r.cls));
  console.log('\nNON-CLEAN', bad.length, JSON.stringify(bad.reduce((a, r) => ((a[r.cls] = (a[r.cls] ?? 0) + 1), a), {})));
  if (args.includes('--wrong')) for (const r of bad) {
    if (!/^WRONG|BREP-|OCCT-/.test(r.cls) && !args.includes('--all')) continue;
    console.log(`\n[${r.cls}] idx ${r.idx} seed ${r.seed} ${r.tags?.chain}`); console.log(r.code.split('\n').map((l) => '    ' + l).join('\n'));
    for (const w of r.wrong ?? [r.detail]) console.log('  -> ' + w);
    if (r.brep) console.log(`  brep ${r.brep.volume} oracle ${r.oracle} occt ${r.occt?.volume}`);
  }
}

if (process.argv[1] === SELF) {
  if (args.includes('--worker')) await workerMain();
  else if (args.includes('--report')) reportMain();
  else if (args.includes('--one')) {
    const i = args.indexOf('--one'); const fam = +args[i + 1], idx = +args[i + 2], seed = +(args[i + 3] ?? 1);
    const s = genS4(idx * FAMILIES.length + fam, seed); console.log(s.code); console.log(JSON.stringify(s.tags));
    const R = await makeS4Runner(); const { rec, extra } = await R.runOne(s, { stepRT: true });
    console.log(JSON.stringify(await judge(rec, extra), null, 1)); console.log('scriptError', rec.scriptError, 'brep', JSON.stringify(rec.brep), 'occt', JSON.stringify(rec.occt), 'refusals', JSON.stringify(rec.refusals), 'analytic', rec.analytic?.volume);
  } else if (args.includes('--out')) await driverMain();
  else console.log('usage: see the header of this file');
}
