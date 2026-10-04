// Wrong-solid sweep (docs/PLAN-next.md section 25, step 1). MEASURE ONLY: nothing here changes a kernel.
//
//   genScript(family, index, seed)  -> { code, tags, oracle? }   seeded, reproducible, pure
//   makeRunner({ occt })            -> runner.run(script)        brep-rs build + mesh + (OCCT) + oracles
//   classify(record)                -> AGREE | REFUSED | OCCT-REFUSED | WRONG-* | SCRIPT-ERROR ...
//
// A script is WRONG only when brep-rs built it (empty refusals map) and one of:
//   WRONG-VOLUME    brep volume differs from OpenCascade's by more than 1e-6 relative
//   WRONG-BBOX      a bbox coordinate differs from OpenCascade's by more than 1e-5
//   WRONG-MESH      the brep mesh is open / non-manifold / not translation-invariant / disagrees with the exact volume
//   WRONG-ANALYTIC  brep volume disagrees with a closed form (exact oracle: 1e-6; numeric grid oracle: 1.5%,
//                   re-checked on a finer grid before it counts). Flagged "occtAgrees" when OCCT shares the error.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exactPair, numericVolume, primVolume, voxelVolume } from './wrong-solid-sweep-oracle.mjs';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
export const REPO = path.resolve(HERE, '../../..');

// ---- seeded rng --------------------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (seed, i) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;
const R2 = (x) => Math.round(x * 100) / 100;

// ---- generator ---------------------------------------------------------------------------------
export const KINDS = ['box', 'cylinder', 'sphere', 'cone', 'ring', 'prism', 'wedge'];
export const OPS = ['holeT', 'holeB', 'holeCB', 'holeCS', 'round', 'chamfer', 'hollow', 'cut', 'join', 'keep', 'repeat', 'around', 'mirror', 'turn', 'move'];
const EXACT = new Set(['box', 'cylinder', 'sphere', 'cone']);
const CATS = ['overlap', 'contain', 'touch', 'flush', 'disjoint', 'tangent', 'equal'];

function mkPrim(r, kind, scale = 1) {
  const u = (lo, hi) => R2(lo + (hi - lo) * r());
  switch (kind) {
    case 'box': { const s = [u(16, 60), u(16, 60), u(10, 50)].map((v) => R2(v * scale)); return { kind, s, ext: s, call: (at) => `box(${s.join(', ')}${at})` }; }
    case 'cylinder': { const a = R2(u(12, 50) * scale), h = R2(u(10, 50) * scale); return { kind, r: a / 2, h, ext: [a, a, h], call: (at) => `cylinder(${a}, ${h}${at})` }; }
    case 'sphere': { const a = R2(u(12, 50) * scale); return { kind, r: a / 2, ext: [a, a, a], call: (at) => `sphere(${a}${at})` }; }
    case 'cone': { const a = R2(u(12, 50) * scale), h = R2(u(10, 50) * scale); return { kind, r: a / 2, h, ext: [a, a, h], call: (at) => `cone(${a}, ${h}${at})` }; }
    case 'ring': { const a = R2(u(30, 60) * scale), t = R2(u(6, 14) * scale); const R = (a - t) / 2; return { kind: 'torus', R, r: t / 2, ext: [a, a, t], call: (at) => `ring(${a}, ${t}${at})` }; }
    case 'prism': { const n = 3 + Math.floor(r() * 6), a = R2(u(15, 50) * scale), h = R2(u(8, 40) * scale); return { kind, n, R: a / 2, h, ext: [a, a, h], call: (at) => `prism(${n}, ${a}, ${h}${at})`, noMember: true }; }
    case 'wedge': { const s = [u(16, 50), u(16, 50), u(10, 40)].map((v) => R2(v * scale)); return { kind, s, ext: s, call: (at) => `wedge(${s.join(', ')}${at})`, noMember: true }; }
  }
}
const atOpt = (c) => `, { at: [${c.join(', ')}] }`; // always explicit: an omitted at is NOT the origin for a second shape
const node = (p, c) => (p.noMember ? null : { t: 'prim', kind: p.kind, c, s: p.s, r: p.r, h: p.h, R: p.R });

// Place a partner relative to the base primitive's centre c0 and extents e, by category.
function placePartner(r, cat, base, c0, only) {
  const e = base.ext;
  const kinds = only ?? ['box', 'cylinder', 'sphere', 'cone', 'ring', 'prism'];
  let kind = kinds[Math.floor(r() * kinds.length)];
  if (cat === 'equal') kind = base.kind === 'torus' ? 'ring' : base.kind;
  if (cat === 'flush') kind = 'box';
  let p, c;
  const jit = (k, f) => R2((r() - 0.5) * 2 * f * e[k]);
  if (cat === 'equal') { p = base; c = [...c0]; }
  else if (cat === 'flush') {
    // same footprint, half the height, coplanar bottom or stacked exactly on top
    const h = R2(e[2] * (0.4 + 0.4 * r()));
    p = { kind: 'box', s: [e[0], e[1], h], ext: [e[0], e[1], h], call: (at) => `box(${e[0]}, ${e[1]}, ${h}${at})` };
    c = r() < 0.5 ? [c0[0], c0[1], R2(c0[2] - e[2] / 2 + h / 2)] : [c0[0], c0[1], R2(c0[2] + e[2] / 2 + h / 2)];
  } else {
    const scale = cat === 'contain' ? 0.3 + 0.2 * r() : 0.35 + 0.65 * r();
    p = mkPrim(r, kind, scale);
    const h = p.ext.map((v) => v / 2);
    if (cat === 'overlap') c = [R2(c0[0] + jit(0, 0.5)), R2(c0[1] + jit(1, 0.5)), R2(c0[2] + jit(2, 0.5))];
    else if (cat === 'contain') c = [R2(c0[0] + jit(0, 0.1)), R2(c0[1] + jit(1, 0.1)), R2(c0[2] + jit(2, 0.1))];
    else if (cat === 'touch') { const ax = Math.floor(r() * 3), sg = r() < 0.5 ? -1 : 1; c = [R2(c0[0] + jit(0, 0.2)), R2(c0[1] + jit(1, 0.2)), R2(c0[2] + jit(2, 0.2))]; c[ax] = R2(c0[ax] + sg * (e[ax] / 2 + h[ax])); }
    else if (cat === 'tangent') {
      // side of a round partner tangent to a face of the base (line contact), or sphere on a face (point contact)
      kind = ['cylinder', 'sphere', 'cylinder'][Math.floor(r() * 3)];
      p = mkPrim(r, kind, 0.4 + 0.5 * r());
      const hh = p.ext.map((v) => v / 2);
      const sg = r() < 0.5 ? -1 : 1, ax = Math.floor(r() * 2);
      c = [R2(c0[0] + jit(0, 0.2)), R2(c0[1] + jit(1, 0.2)), R2(c0[2] + jit(2, 0.2))];
      c[ax] = R2(c0[ax] + sg * (e[ax] / 2 + hh[ax]));
    } else { c = [R2(c0[0] + e[0] + p.ext[0] + 5), R2(c0[1] + jit(1, 0.3)), R2(c0[2] + jit(2, 0.3))]; } // disjoint
  }
  return { p, c };
}

/** Every ordered chain of 2 distinct ops, and every STRIDE-th ordered chain of 3, on each base kind. */
export function permList(stride3 = 7) {
  const out = []; let n3 = 0;
  for (const kind of KINDS) {
    for (const a of OPS) for (const b of OPS) if (a !== b) out.push({ kind, chain: [a, b] });
    for (const a of OPS) for (const b of OPS) for (const c of OPS)
      if (a !== b && b !== c && a !== c && n3++ % stride3 === 0) out.push({ kind, chain: [a, b, c] });
  }
  return out;
}
let PERMS = null;
/**
 * family:
 *   'matrix'  : base primitive + an ordered chain of 2 or 3 distinct ops from OPS (index enumerates (kind, chain) in order)
 *   'random'  : random base, 1-4 ops drawn with repetition
 *   'pair'    : two primitives from {box, cylinder, sphere, cone} + one of join/cut/keep, categories cycled (exact oracle)
 *   'hole'    : one primitive + a hole (through/blind/counterbore), exact oracle when the closed form exists
 */
// Closed form of a box hollowed, then one edge bevelled, the bevel wider than the wall or not. The part is the shell
// minus the half-space wedge, so the part of the wedge that was already cavity removes nothing:
//   V = V(shell) - (wedge section x length of the edge - the wedge's section inside the cavity x the cavity's length).
// Checked against a 3-million point membership test of that definition (docs/PLAN-next.md section 38): brep-rs, and
// this formula, agree with it to 0.1 mm^3; OpenCascade and brep-rs before the fix of section 38 both removed the
// whole wedge and left the cavity's own shell standing through the bevel face (a closed hollow only).
export function hollowBevelVolume(L, hollow, edge) {
  const AXIS = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
  const w = hollow.wall, c = edge.size, open = hollow.open;
  let cav = 1;
  for (let k = 0; k < 3; k++) { const nOpen = open && AXIS[open] === k ? 1 : 0; cav *= L[k] - w * (2 - nOpen); }
  const Vh = L[0] * L[1] * L[2] - cav;
  const a = 3 - AXIS[edge.first] - AXIS[edge.second]; // the edge's own axis
  const wA = open === edge.first ? 0 : w, wB = open === edge.second ? 0 : w;
  const nOpenA = open && AXIS[open] === a ? 1 : 0;
  const Lc = L[a] - w * (2 - nOpenA);
  const leg = Math.max(0, c - wA - wB);
  return Vh - ((c * c) / 2 * L[a] - (leg * leg) / 2 * Lc);
}

export function genScript(family, index, seed = 1) {
  const r = rng(mix(seed, index * 8 + family.length));
  const lines = [];
  const tags = { family, index, seed };
  let v = 'v';
  let abs = null; // numeric-oracle CSG node, or null once an op we cannot model has been applied
  let bb = null; // exact bbox of the current solid while the oracle can follow it
  let isPrimitive = true;
  const needExact = {};

  const kindOf = (i) => KINDS[i % KINDS.length];
  let chain;
  let baseKind;
  if (family === 'matrix') {
    // enumerate: kind-major, then every ordered chain of length 2 (all) then 3 (sampled by index)
    baseKind = kindOf(index);
    const len = 2 + (Math.floor(index / KINDS.length) % 2);
    chain = [];
    const pool = [...OPS];
    for (let k = 0; k < len; k++) chain.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  } else if (family === 'perm') {
    PERMS ??= permList(7);
    const e = PERMS[index % PERMS.length];
    baseKind = e.kind; chain = e.chain;
  } else if (family === 'holes') {
    const W = ['box', 'box', 'box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone', 'prism', 'wedge', 'ring'];
    baseKind = W[Math.floor(r() * W.length)];
    const n = 2 + Math.floor(r() * 3);
    chain = Array.from({ length: n }, () => ['holeT', 'holeB', 'holeB', 'holeCB', 'holeCS'][Math.floor(r() * 5)]);
  } else if (family === 'csg') {
    baseKind = ['box', 'box', 'box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone'][Math.floor(r() * 8)];
    const n = 2 + Math.floor(r() * 3);
    chain = Array.from({ length: n }, () => ['cut', 'join', 'keep', 'cut', 'join', 'holeT', 'holeB'][Math.floor(r() * 7)]);
  } else if (family === 'grid') {
    // integer boxes on an integer grid: flush, edge-touching, coincident, nested, disjoint all happen constantly; exact voxel oracle
    const ib = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    const mkb = () => ({ s: [ib(2, 10), ib(2, 10), ib(2, 10)], c: [ib(-4, 4), ib(-4, 4), ib(-4, 4)] });
    const b0 = mkb();
    const gl = [`let v = box(${b0.s.join(', ')}, { at: [${b0.c.join(', ')}] })`];
    let node0 = { t: 'prim', kind: 'box', s: b0.s, c: b0.c };
    const nops = 1 + Math.floor(r() * 4);
    const names = [];
    for (let k = 0; k < nops; k++) {
      const b = mkb(); const op = ['join', 'cut', 'keep', 'join', 'cut'][Math.floor(r() * 5)];
      gl.push(`const p${k + 1} = box(${b.s.join(', ')}, { at: [${b.c.join(', ')}] })`, `v = ${op}(v, p${k + 1})`);
      node0 = { t: 'op', op: op === 'cut' ? 'subtract' : op === 'join' ? 'union' : 'intersect', a: node0, b: { t: 'prim', kind: 'box', s: b.s, c: b.c } };
      names.push(op);
    }
    return { code: gl.join('\n'), tags: { family, index, seed, chain: ['box', ...names].join(' > ') }, oracle: { node: node0, voxel: true } };
  } else if (family === 'ringpair') {
    baseKind = 'ring';
    chain = [['join', 'cut', 'keep'][Math.floor(r() * 3)]];
  } else if (family === 'census') {
    // the census matrix (student-census.test.mjs) with random sizes/positions/edges/open faces: every ordered pair of hole/round/chamfer/hollow
    const o4 = ['holeT', 'round', 'chamfer', 'hollow'], pairs = [];
    for (const a of o4) for (const b of o4) if (a !== b) pairs.push([a, b]);
    chain = pairs[index % pairs.length];
    baseKind = Math.floor(index / pairs.length) % 3 === 2 ? 'cylinder' : 'box';
  } else if (family === 'random') {
    baseKind = KINDS[Math.floor(r() * KINDS.length)];
    const n = 1 + Math.floor(r() * 4);
    chain = Array.from({ length: n }, () => OPS[Math.floor(r() * OPS.length)]);
  } else if (family === 'pair') {
    baseKind = ['box', 'cylinder', 'sphere', 'cone'][Math.floor(r() * 4)];
    chain = [['join', 'cut', 'keep'][Math.floor(r() * 3)]];
  } else if (family === 'hole') {
    baseKind = ['box', 'cylinder', 'sphere', 'cone', 'prism', 'ring'][Math.floor(r() * 6)];
    chain = [['holeT', 'holeB', 'holeCB'][Math.floor(r() * 3)]];
  } else throw new Error(`unknown family ${family}`);

  // ---- base ----
  const base = mkPrim(r, baseKind, 1);
  const c0 = r() < 0.65 ? [0, 0, 0] : [R2((r() - 0.5) * 20), R2((r() - 0.5) * 20), R2((r() - 0.5) * 20)];
  if (baseKind === 'ring' && base.kind === 'torus') base.kind = 'torus';
  lines.push(`let ${v} = ${base.call(atOpt(c0))}`);
  const ext = base.ext;
  const minXY = Math.min(ext[0], ext[1]);
  const minAll = Math.min(...ext);
  abs = node(base, c0);
  bb = base.noMember ? null : [[c0[0] - ext[0] / 2, c0[1] - ext[1] / 2, c0[2] - ext[2] / 2], [c0[0] + ext[0] / 2, c0[1] + ext[1] / 2, c0[2] + ext[2] / 2]];
  if (baseKind === 'prism' || baseKind === 'wedge') bb = null;
  let partnerSeq = 0, lastHollow = null, lastEdge = null, prefix = null, lastRepeat = null;
  const trail = [];

  for (const op of chain) {
    trail.push(op);
    switch (op) {
      case 'holeT': case 'holeB': case 'holeCB': case 'holeCS': {
        const axis = r() < 0.7 ? 2 : r() < 0.5 ? 0 : 1;
        const along = ['x', 'y', 'z'][axis];
        const inplane = [0, 1, 2].filter((k) => k !== axis);
        const across = R2((0.1 + 0.55 * r()) * Math.min(ext[inplane[0]], ext[inplane[1]]));
        const off = r() < 0.5 ? [0, 0] : [R2((r() - 0.5) * 0.5 * ext[inplane[0]]), R2((r() - 0.5) * 0.5 * ext[inplane[1]])];
        const parts = [`across: ${across}`];
        if (along !== 'z') parts.push(`along: '${along}'`);
        if (off[0] || off[1]) parts.push(`at: [${off[0]}, ${off[1]}]`);
        let deep = null;
        if (op === 'holeB') { deep = R2((0.15 + 0.7 * r()) * ext[axis]); parts.push(`deep: ${deep}`); }
        let cbR = null, cbD = null;
        if (op === 'holeCB') { const cb = R2(across * (1.4 + 0.8 * r())); cbD = R2(1.5 + 4 * r()); cbR = cb / 2; parts.push(`counterbore: { across: ${cb}, deep: ${cbD} }`); }
        if (op === 'holeCS') parts.push(`countersink: { across: ${R2(across * 1.8)}, angle: 90 }`);
        lines.push(`hole(${v}, { ${parts.join(', ')} })`);
        if (abs && bb) {
          const ctr = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, (bb[0][2] + bb[1][2]) / 2];
          const tc = [...ctr]; tc[inplane[0]] += off[0]; tc[inplane[1]] += off[1];
          const top = bb[1][axis];
          const tool = { t: 'tool', axis, c: tc, r: across / 2, lo: deep == null ? -1e5 : top - deep, hi: deep == null ? 1e5 : top };
          if (chain.length === 1 && axis === 2 && abs.t === 'prim' && EXACT.has(abs.kind) && cbR == null && op !== 'holeCS') {
            const lo = deep == null ? top - ext[2] - 4 : top - deep, hi = deep == null ? top + 4 : top;
            tags.pair = { op: 'subtract', a: abs, b: { t: 'prim', kind: 'cylinder', c: [tc[0], tc[1], (lo + hi) / 2], r: across / 2, h: hi - lo } };
          }
          abs = { t: 'op', op: 'subtract', a: abs, b: tool };
          if (op === 'holeCS') { const rm = R2(across * 1.8) / 2; abs = { t: 'op', op: 'subtract', a: abs, b: { t: 'csink', axis, c: tc, rb: across / 2, rm, top } }; }
          if (cbR != null) abs = { t: 'op', op: 'subtract', a: abs, b: { t: 'tool', axis, c: tc, r: cbR, lo: top - cbD, hi: top } };
        } else abs = null;
        break;
      }
      case 'round': case 'chamfer': {
        const size = R2((0.03 + 0.17 * r()) * minAll);
        const whole = op === 'round' && (baseKind === 'box' || baseKind === 'cylinder') && r() < 0.25;
        if (whole) lines.push(`round(${v}, ${size})`);
        else {
          const second = baseKind === 'cylinder' ? 'side' : ['front', 'back', 'left', 'right'][Math.floor(r() * 4)];
          const first = ['top', 'bottom'][Math.floor(r() * 2)];
          lines.push(`${op === 'round' ? 'round' : 'bevel'}(${v}.edge('${first}', '${second}'), ${size})`);
          lastEdge = { first, second, size, op };
          if (op === 'chamfer' && baseKind === 'box' && trail.length === 2 && trail[0] === 'hollow' && lastHollow) prefix = { lines: lines.length, volume: hollowBevelVolume(ext, lastHollow, lastEdge) };
        }
        abs = null; bb = null; break;
      }
      case 'hollow': {
        const wall = R2((0.04 + 0.11 * r()) * minAll);
        const open = r() < 0.3 ? '' : `, open: '${['top', 'bottom', 'front', 'left'][Math.floor(r() * 4)]}'`;
        lines.push(`hollow(${v}, { wall: ${wall}${open} })`);
        lastHollow = { wall, open: (/'(\w+)'/.exec(open) ?? [])[1] ?? null };
        abs = null; bb = null; break;
      }
      case 'cut': case 'join': case 'keep': {
        const cat = family === 'pair' ? CATS[index % CATS.length] : CATS[Math.floor(r() * CATS.length)];
        tags.cat = cat;
        const { p, c } = placePartner(r, cat, base, c0, family === 'pair' ? ['box', 'cylinder', 'sphere', 'cone'] : family === 'ringpair' ? ['box', 'cylinder', 'sphere', 'cone', 'ring'] : family === 'csg' ? ['box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone', 'prism'] : undefined);
        const pn = `p${++partnerSeq}`;
        lines.push(`const ${pn} = ${p.call(atOpt(c))}`);
        lines.push(`${v} = ${op}(${v}, ${pn})`);
        const pnode = node(p, c);
        const opn = op === 'cut' ? 'subtract' : op === 'join' ? 'union' : 'intersect';
        if (abs && pnode) {
          abs = { t: 'op', op: opn, a: abs, b: pnode };
          const pb = [[0, 1, 2].map((k) => c[k] - p.ext[k] / 2), [0, 1, 2].map((k) => c[k] + p.ext[k] / 2)];
          if (op === 'join' && bb) bb = [[0, 1, 2].map((k) => Math.min(bb[0][k], pb[0][k])), [0, 1, 2].map((k) => Math.max(bb[1][k], pb[1][k]))];
          else bb = null;
          if (chain.length === 1 && EXACT.has(base.kind) && EXACT.has(p.kind)) tags.pair = { op: opn, a: node(base, c0), b: pnode };
        } else { abs = null; bb = null; }
        isPrimitive = false;
        break;
      }
      case 'repeat': {
        const count = 2 + Math.floor(r() * 2);
        const step = [R2((0.5 + r()) * ext[0]), r() < 0.5 ? 0 : R2((r() - 0.5) * ext[1]), 0];
        lines.push(`repeat(${v}, { count: ${count}, step: [${step.join(', ')}] })`);
        lastRepeat = { count, step };
        abs = null; bb = null; break;
      }
      case 'around': {
        const count = 3 + Math.floor(r() * 3);
        lines.push(`repeatAround(${v}, { count: ${count}, axis: 'z' })`);
        abs = null; bb = null; break;
      }
      case 'mirror': {
        lines.push(`${v} = mirror(${v}, '${['left-right', 'front-back', 'top-bottom'][Math.floor(r() * 3)]}')`);
        abs = null; bb = null; break;
      }
      case 'turn': {
        const a = [0, 30, 45, 90];
        lines.push(`turn(${v}, [${a[Math.floor(r() * 4)]}, ${a[Math.floor(r() * 4)]}, ${a[Math.floor(r() * 4)]}])`);
        abs = null; bb = null; break;
      }
      case 'move': {
        lines.push(`move(${v}, [${R2((r() - 0.5) * 30)}, ${R2((r() - 0.5) * 30)}, ${R2((r() - 0.5) * 30)}])`);
        abs = null; bb = null; break;
      }
    }
  }
  tags.chain = [baseKind, ...trail].join(' > ');
  const code = lines.join('\n');
  const oracle = { node: abs, bare: chain.length === 0 ? base : null, gridN: family === 'holes' || family === 'csg' ? 100 : 64 };
  if (trail.length === 0) oracle.bareVolume = primVolume(base);
  if (tags.pair) oracle.pair = tags.pair;
  // closed form for a box hollowed, then one edge chamfered (the chamfer may be thicker than the wall)
  if (baseKind === 'box' && trail.length === 2 && trail[0] === 'hollow' && trail[1] === 'chamfer' && lastHollow && lastEdge) {
    oracle.exactVolume = hollowBevelVolume(ext, lastHollow, lastEdge);
  }
  // a hollow box repeated into disjoint copies along x, then one end edge bevelled: the bevel lands on the outermost copy
  // (the rightmost for 'right', the first for 'left'), the other copies stay as hollowed
  if (baseKind === 'box' && trail.length === 3 && trail[0] === 'hollow' && trail[1] === 'repeat' && trail[2] === 'chamfer' && lastHollow && lastEdge && lastRepeat
      && lastRepeat.step[0] >= ext[0] + 1e-6 && ['left', 'right'].includes(lastEdge.second) && ['top', 'bottom'].includes(lastEdge.first)) {
    const plain = hollowBevelVolume(ext, lastHollow, { ...lastEdge, size: 0 });
    oracle.exactVolume = lastRepeat.count * plain - (plain - hollowBevelVolume(ext, lastHollow, lastEdge));
  }
  // the same closed form settles the part after a closed hollow and its bevel even when more steps follow: the run
  // builds the prefix on its own so the later disagreement with the referee can be attributed (see `classify`)
  if (prefix && trail.length > 2) oracle.prefix = prefix;
  if (family === 'hole' && !tags.pair && trail.length === 1) { /* numeric oracle only */ }
  return { code, tags, oracle };
}

// ---- measure + mesh + referee ------------------------------------------------------------------
export async function makeRunner({ occt = true } = {}) {
  const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
  const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
  brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
  const { runScript } = await import('@shuff57/reshape-script/reshape-script');
  let oc = null, buildDoc = null, arc = null;
  if (occt) {
    const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
    const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
    oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
    ({ buildDoc } = await import(pathToFileURL(path.join(REPO, 'packages/kernel/dist/occt-build.js')).href));
    arc = await import(pathToFileURL(path.join(REPO, 'packages/sketch/dist/sketch-arc.js')).href);
  }
  const occtMeasure = (shape) => {
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.AddOptimal(shape, box, false, false);
    const lo = box.CornerMin(), hi = box.CornerMax();
    return { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]] };
  };

  /** mesh closure of the final feature: open edges, unbalanced (non-manifold / flipped) edges,
   *  signed volume about the origin and about a far point (translation invariance), tris. */
  function meshCheck(json, id, exact) {
    const diag = Math.hypot(...[0, 1, 2].map((k) => exact.bbox[1][k] - exact.bbox[0][k]));
    const defl = Math.max(0.01, 0.003 * diag);
    let m;
    try { m = JSON.parse(brep.mesh_feature(json, id, defl)); } catch (e) { return { error: String(e).slice(0, 200) }; }
    const P = m.positions, I = m.indices;
    if (!P || !I || !I.length) return { error: 'empty mesh' };
    const W = 1e-6;
    const ids = new Map(); const canon = new Array(P.length / 3);
    for (let i = 0; i < P.length / 3; i++) {
      const key = `${Math.round(P[3 * i] / W)},${Math.round(P[3 * i + 1] / W)},${Math.round(P[3 * i + 2] / W)}`;
      if (!ids.has(key)) ids.set(key, ids.size);
      canon[i] = ids.get(key);
    }
    const dir = new Map();
    const volAbout = (ox, oy, oz) => {
      let v = 0;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ax = P[a] - ox, ay = P[a + 1] - oy, az = P[a + 2] - oz;
        const bx = P[b] - ox, by = P[b + 1] - oy, bz = P[b + 2] - oz;
        const cx = P[c] - ox, cy = P[c + 1] - oy, cz = P[c + 2] - oz;
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      return v;
    };
    let degenerate = 0;
    for (let t = 0; t < I.length; t += 3) {
      const ci = [canon[I[t]], canon[I[t + 1]], canon[I[t + 2]]];
      if (ci[0] === ci[1] || ci[1] === ci[2] || ci[0] === ci[2]) { degenerate++; continue; }
      for (let e = 0; e < 3; e++) { const k = `${ci[e]}>${ci[(e + 1) % 3]}`; dir.set(k, (dir.get(k) ?? 0) + 1); }
    }
    let open = 0, unbalanced = 0;
    for (const [k, n] of dir) {
      const [u, w] = k.split('>');
      const back = dir.get(`${w}>${u}`) ?? 0;
      if (back === 0) open++; else if (back !== n) unbalanced++;
    }
    const v0 = volAbout(0, 0, 0), v1 = volAbout(1000, -777, 555);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    return { tris: I.length / 3, open, unbalanced, degenerate, meshVolume: v0, translationDelta: Math.abs(v0 - v1), defl, bbox: [lo, hi] };
  }

  function run(script, opts = {}) {
    const rec = { code: script.code, tags: script.tags };
    let r;
    try { r = runScript(script.code); } catch (e) { rec.scriptError = String(e).slice(0, 200); return rec; }
    if (r.errors?.length) { rec.scriptError = (r.errors[0].message ?? JSON.stringify(r.errors[0])).slice(0, 300); return rec; }
    const features = r.doc.features;
    const id = features.at(-1).id;
    const json = JSON.stringify({ version: 1, features });
    let t = performance.now();
    let out;
    try { out = JSON.parse(brep.build_doc_json(json)); } catch (e) { rec.brepThrow = String(e).slice(0, 300); return rec; }
    rec.refusals = out.refusals ?? {};
    let meas = null;
    try { meas = JSON.parse(brep.measure_doc(json)).shapes?.[id] ?? null; } catch (e) { rec.measureThrow = String(e).slice(0, 200); }
    rec.brepMs = Math.round(performance.now() - t);
    if (meas) rec.brep = { volume: meas.volume, bbox: meas.bbox, faces: meas.faces, edges: meas.edges };
    const refused = Object.keys(rec.refusals).length > 0;
    if (!refused && meas) {
      rec.mesh = meshCheck(json, id, meas);
    }
    // oracles (computed for built solids only)
    if (!refused && meas) {
      const o = script.oracle ?? {};
      if (o.bareVolume != null) rec.analytic = { kind: 'bare', volume: o.bareVolume };
      else if (o.pair) rec.analytic = { kind: 'pair', volume: exactPair(o.pair.op, o.pair.a, o.pair.b) };
      else if (o.exactVolume != null) rec.analytic = { kind: 'closed', volume: o.exactVolume };
      else if (o.node && o.voxel) rec.analytic = { kind: 'voxel', volume: voxelVolume(o.node) };
      else if (o.node) {
        let v = numericVolume(o.node, o.gridN ?? 64);
        // a disagreement is re-measured on a much finer grid before it is believed (thin slivers fool a coarse one)
        if (Math.abs(v - meas.volume) > TOL.grid * Math.max(1, Math.abs(v))) v = numericVolume(o.node, 170);
        rec.analytic = { kind: 'grid', volume: v };
      }
    }
    if (opts.occt !== false && oc) {
      t = performance.now();
      rec.occtPending = true; // cleared below; a hang/abort leaves it set for the driver to see
      opts.onBrepDone?.(rec);
      try {
        const res = buildDoc(oc, { version: 1, features }, arc);
        const shape = res.shapes.get(id);
        rec.occtRefusals = res.refusals instanceof Map ? Object.fromEntries(res.refusals) : (res.refusals ?? {});
        if (shape) rec.occt = occtMeasure(shape);
      } catch (e) { rec.occtThrow = String(e?.message ?? e).slice(0, 200); }
      rec.occtMs = Math.round(performance.now() - t);
      delete rec.occtPending;
      // A script that starts with a closed form (hollow, bevel) and carries on: when the final volumes differ, build the
      // settled prefix by itself on both kernels, so the disagreement can be attributed (`classify`).
      const pre = script.oracle?.prefix;
      if (pre && rec.brep && rec.occt && Math.abs(rec.brep.volume - rec.occt.volume) > TOL.vol * Math.max(1, Math.abs(rec.occt.volume))) {
        try {
          const code = script.code.split('\n').slice(0, pre.lines).join('\n');
          const pr = runScript(code);
          const pid = pr.doc.features.at(-1).id, pj = JSON.stringify({ version: 1, features: pr.doc.features });
          const pout = JSON.parse(brep.build_doc_json(pj));
          const pm = JSON.parse(brep.measure_doc(pj)).shapes?.[pid];
          const po = buildDoc(oc, { version: 1, features: pr.doc.features }, arc).shapes.get(pid);
          rec.prefix = { exact: pre.volume, brep: Object.keys(pout.refusals ?? {}).length ? null : pm?.volume ?? null, occt: po ? occtMeasure(po).volume : null };
        } catch (e) { rec.prefix = { exact: pre.volume, error: String(e?.message ?? e).slice(0, 120) }; }
      }
    }
    return rec;
  }
  return { run, brep, oc };
}

// ---- classification ------------------------------------------------------------------------------
export const TOL = { vol: 1e-6, bbox: 1e-6, grid: 0.015 };
// OpenCascade's `shell` takes a slab off the cavity of a turned part when a chamfer at the CLOSED end is smaller than the wall's own
// corner already clears (c < w (2 - sqrt2): the chamfer's offset plane then lies outside the cavity and changes nothing). S4f found
// it against an independent distance-field oracle (cylinder(33.34, 35.75), bevel top 1.09, bevel bottom 3.09, wall 3.47, open
// bottom: OpenCascade 16143.7, brep-rs 13763.3, the oracle 13701.3 less the open-chamfer sliver), and in every one of 7 random cases the condition names. The referee is
// blind there, exactly as it is for a counterbore, so the class is AGREE-ANALYTIC-ONLY, never a WRONG for brep-rs.
export function occtShellBlind(code) {
  const w = /(?:hollow|shell)\([^)]*wall:\s*([0-9.]+)/.exec(code);
  if (!w || !/cylinder\(/.test(code)) return false;
  const open = /open:\s*'(top|bottom)'/.exec(code)?.[1];
  for (const m of code.matchAll(/(?:bevel|chamfer)\(\w+\.edge\('(top|bottom)',\s*'side'\),\s*([0-9.]+)\)/g))
    if (m[1] !== open && +m[2] < +w[1] * (2 - Math.SQRT2) - 1e-9) return true;
  return false;
}

export function classify(rec) {
  if (rec.scriptError) return { cls: 'SCRIPT-ERROR' };
  if (rec.brepThrow) return { cls: 'BREP-THROW', detail: rec.brepThrow };
  if (rec.occtPending) return { cls: 'OCCT-HANG-OR-ABORT' };
  const refused = rec.refusals && Object.keys(rec.refusals).length > 0;
  if (refused) return { cls: 'REFUSED', sentence: Object.values(rec.refusals).join(' | ') };
  if (!rec.brep) return { cls: 'NO-SHAPE', detail: rec.measureThrow };
  const wrong = [];
  const m = rec.mesh;
  rec.diag = rec.brep ? Math.hypot(...[0, 1, 2].map((k) => rec.brep.bbox[1][k] - rec.brep.bbox[0][k])) : 1;
  if (m?.error) wrong.push(`WRONG-MESH:${m.error}`);
  else if (m) {
    const scale = Math.max(1, Math.abs(rec.brep.volume));
    if (m.open) wrong.push(`WRONG-MESH:${m.open} open edges`);
    if (m.unbalanced) wrong.push(`WRONG-MESH:${m.unbalanced} non-manifold/flipped edges`);
    if (m.translationDelta > 1e-6 * scale) wrong.push(`WRONG-MESH:translation delta ${m.translationDelta.toExponential(2)}`);
    // chordal error bound: a mesh under-fills a curved solid by at most ~defl*area; use a generous 2% / 0.05 absolute-by-diag
    if (Math.abs(m.meshVolume - rec.brep.volume) > 0.02 * scale + 4 * m.defl * Math.cbrt(scale) ** 2 * 6) wrong.push(`WRONG-MESH:mesh volume ${m.meshVolume.toFixed(3)} vs exact ${rec.brep.volume.toFixed(3)}`);
  }
  const a = rec.analytic;
  let analyticBad = null, suspect = null;
  if (a) {
    const d = Math.abs(rec.brep.volume - a.volume) / Math.max(1, Math.abs(a.volume));
    if (a.kind === 'grid') { if (d > TOL.grid) suspect = { brep: rec.brep.volume, grid: a.volume, rel: d }; }
    else if (d > 1e-6) analyticBad = { kind: a.kind, brep: rec.brep.volume, analytic: a.volume, rel: d };
  }
  // bbox truth: the mesh. A bbox is tight when it is within ~1.5 chord deflections of the mesh's own box and the mesh never leaves it.
  const bboxVsMesh = (bx) => {
    if (!m || m.error) return null;
    const tolL = 1.5 * m.defl + 1e-6, tolS = 1e-6 * Math.max(1, rec.diag);
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) {
      const out = i === 0 ? bx[0][k] - m.bbox[0][k] : m.bbox[1][k] - bx[1][k]; // > 0: mesh pokes outside the box
      if (out > tolS) return `box too small on axis ${k} (${i ? 'max' : 'min'}): ${bx[i][k]} but the mesh reaches ${m.bbox[i][k]}`;
      if (-out > tolL) return `box loose on axis ${k} (${i ? 'max' : 'min'}): ${bx[i][k]} but the mesh stops at ${m.bbox[i][k]}`;
    }
    return null;
  };
  let occtState, bboxOnly = null, occtWrong = null, nearMiss = null, refereeOffPrefix = null;
  const recess = /counterbore|countersink/.test(rec.code) || occtShellBlind(rec.code);
  const occtRefused = rec.occtRefusals && Object.keys(rec.occtRefusals).length > 0;
  if (rec.occt && occtRefused) { occtState = 'occt-refused'; }
  else if (rec.occt && recess) { rec.occtBlind = true; occtState = 'referee-blind'; }
  else if (rec.occt) {
    const rv = Math.abs(rec.brep.volume - rec.occt.volume) / Math.max(1, Math.abs(rec.occt.volume));
    let bboxDiff = null;
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) {
      const d = Math.abs(rec.brep.bbox[i][k] - rec.occt.bbox[i][k]);
      if (d > TOL.bbox * Math.max(1, rec.diag) && !bboxDiff) bboxDiff = `bbox[${i}][${k}] ${rec.brep.bbox[i][k]} vs OCCT ${rec.occt.bbox[i][k]}`;
    }
    if (rv > TOL.vol) {
      const exactOk = a && a.kind !== 'grid' && Math.abs(rec.brep.volume - a.volume) / Math.max(1, Math.abs(a.volume)) <= 1e-6;
      const gridSide = a && a.kind === 'grid' && Math.abs(rec.brep.volume - a.volume) <= TOL.grid * Math.max(1, a.volume) && Math.abs(rec.occt.volume - a.volume) > 0.05 * Math.max(1, a.volume);
      if (exactOk) occtWrong = `brep ${rec.brep.volume} matches the closed form ${a.volume}; OCCT ${rec.occt.volume} does not (rel ${(Math.abs(rec.occt.volume - a.volume) / a.volume).toExponential(2)})`;
      else if (gridSide) occtWrong = `brep ${rec.brep.volume} is within ${(TOL.grid * 100).toFixed(1)}% of the grid oracle ${a.volume.toFixed(2)}; OCCT ${rec.occt.volume} is not (negative or >5% off)`;
      else if (rec.occt.volume <= 0 && rec.brep.volume > 0) occtWrong = `OCCT reports volume ${rec.occt.volume} (negative or zero) for a solid brep-rs measures at ${rec.brep.volume}`;
      else if (rec.prefix?.brep != null && rec.prefix.occt != null && Math.abs(rec.prefix.brep - rec.prefix.exact) <= 1e-6 * rec.prefix.exact && Math.abs(rec.prefix.occt - rec.prefix.exact) > 1e-6 * rec.prefix.exact) {
        // the hollow and its bevel are settled by the closed form (docs section 38): brep-rs is on it, OpenCascade is off it, so the two
        // kernels carry on from different parts and the later steps cannot be compared; no referee, not a wrong solid
        refereeOffPrefix = `the part after its hollow and bevel is ${rec.prefix.exact.toFixed(3)} by the closed form: brep-rs ${rec.prefix.brep.toFixed(3)}, OpenCascade ${rec.prefix.occt.toFixed(3)}`;
      }
      else if (rv <= 1e-4) nearMiss = `brep ${rec.brep.volume} vs OCCT ${rec.occt.volume} (rel ${rv.toExponential(2)})`;
      else wrong.push(`WRONG-VOLUME:brep ${rec.brep.volume} vs OCCT ${rec.occt.volume} (rel ${rv.toExponential(2)})`);
    }
    if (bboxDiff) {
      const bm = bboxVsMesh(rec.brep.bbox), om = bboxVsMesh(rec.occt.bbox);
      if (bm) bboxOnly = `${bboxDiff}; arbitrated by the mesh: brep ${bm}${om ? `; OCCT ${om}` : ''}`;
      else rec.occtBboxLoose = `${bboxDiff}; brep matches the mesh, OCCT ${om ?? 'matches too'}`;
    }
    occtState = wrong.some((w) => w.startsWith('WRONG-VOLUME')) || occtWrong || nearMiss ? 'differ' : refereeOffPrefix ? 'referee-blind' : 'agree';
  } else if (rec.occtThrow || occtRefused || 'occtMs' in rec) occtState = 'occt-refused';
  else occtState = 'no-occt';
  if (!bboxOnly && !rec.occt) { const bm = bboxVsMesh(rec.brep.bbox); if (bm) bboxOnly = `no OCCT shape; ${bm}`; }
  if (analyticBad) {
    const occtShares = rec.occt && Math.abs(rec.occt.volume - analyticBad.analytic) / Math.max(1, Math.abs(analyticBad.analytic)) > 1e-6;
    wrong.push(`WRONG-ANALYTIC:${analyticBad.kind} brep ${analyticBad.brep} vs closed form ${analyticBad.analytic} (rel ${analyticBad.rel.toExponential(2)})${rec.occt && !recess ? (occtShares ? ' [OCCT also off the closed form]' : ' [OCCT matches the closed form]') : ''}`);
  } else if (rec.occt && a && a.kind !== 'grid' && !recess) {
    const d = Math.abs(rec.occt.volume - a.volume) / Math.max(1, Math.abs(a.volume));
    if (d > 1e-6) rec.occtOffClosedForm = d;
  }
  if (!wrong.length && occtWrong && !bboxOnly) return { cls: 'OCCT-WRONG', wrong: [occtWrong], occtState };
  if (!wrong.length && nearMiss && !bboxOnly && !suspect) return { cls: 'NEAR-MISS', wrong: [nearMiss], occtState };
  if (!wrong.length && bboxOnly) return { cls: 'WRONG-BBOX-ONLY', wrong: [`WRONG-BBOX:${bboxOnly}`], occtState };
  if (!wrong.length && suspect) return { cls: 'SUSPECT-GRID', wrong: [`grid oracle ${suspect.grid.toFixed(3)} vs brep ${suspect.brep.toFixed(3)} (rel ${suspect.rel.toExponential(2)}), OCCT ${rec.occt ? rec.occt.volume.toFixed(3) : 'n/a'}`], occtState };
  if (bboxOnly) wrong.push(`WRONG-BBOX:${bboxOnly}`);
  if (wrong.length) return { cls: 'WRONG', wrong, occtState };
  if (occtState === 'occt-refused') return { cls: 'OCCT-REFUSED', detail: rec.occtThrow ?? JSON.stringify(rec.occtRefusals) };
  return { cls: occtState === 'agree' ? 'AGREE' : occtState === 'referee-blind' ? 'AGREE-ANALYTIC-ONLY' : 'BUILT-NO-REFEREE' };
}
