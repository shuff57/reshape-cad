// REAL-KERNEL proof for ctx.followMoves. Not part of `npm test`: needs the SolidCraft wasm rig AND a wasm built from wrapper2 (a wrapper that returns every
// command's output, so model.faces / model.edges can be read; see NOTES.md "Moved picks" and test/topology-upstream.mjs).
//
//   SOLIDCRAFT_REFEREE_PKG=<stock rig pkg> [SOLIDCRAFT_TOPOLOGY_PKG=<wrapper2 pkg>] \
//     systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 node packages/layer/test/live-moved-picks.mjs [--out=<file.json>] [--only=prefix] [--seed=N]
//
// For generated cases (box / cylinder / prism, moved by 0 to 2 plain moves, hollowed open on each side, and a box drafted on a side face; quarter turns on
// the base set; refused kinds) it runs the layer with followMoves ON and the upstream topology adapter, and scores every BUILT result against INDEPENDENT references
// that do not use the resolver:
//   1. a closed form computed here from the dimensions, the wall, the open face direction (hollow) or the angle, neutral plane and face (draft),
//   2. brep-rs measure_doc (archive/brep-rs/pkg) on the same ModelDoc, where it builds (a second oracle on volume and bounding box; no centre of mass).
// A case passes only if volume, bounding box AND centre of mass agree with the closed form (planar 1e-9, curved 3e-4) and the centre of mass separates the intended
// open face from every alternative (so a result that opened another face could not pass). Outcomes: built-and-right, refused (with its sentence; EXPECTED when the
// closed form says the layer must not build it, UNEXPECTED otherwise), built-and-WRONG (any is a stop), built-unverified (built where no closed form exists).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadUpstream } from './topology-upstream.mjs';
import { box, cyl, prism, move, rotate, shell, draft, prim, combine } from './docs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const OUT = path.resolve(arg('out') || path.join(HERE, 'evidence', 'live-moved-picks-0.21.0.json'));
const only = arg('only'); const SEED = Number(arg('seed') || 20261025);
mkdirSync(path.dirname(OUT), { recursive: true });
const imp = (p) => import(pathToFileURL(p).href);
const arc = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(REPO, 'packages/script/dist/model-types.js'));
const { createTranslator } = await imp(path.join(HERE, '../dist/index.js'));
const { mulberry32 } = await imp(path.join(HERE, 'ep-docs.mjs'));
const stock = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const up = loadUpstream();
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await imp(path.join(brepDir, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

// ---------------------------------------------------------------------------------------------------------------- closed forms
const PLANAR = 1e-9; const CURVED = 3e-4;
const SIGMA = -1; // SolidCraft's draft convention, measured by the group (shell-draft.ts SC_SIGMA): out(z) = SIGMA tan(angle) (z - neutral); out < 0 is into the part
const AXI = { '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1] };
const add3 = (a, b) => a.map((v, i) => v + b[i]);
const bboxOfCenter = (c, d) => [...c.map((v, i) => v - d[i] / 2), ...c.map((v, i) => v + d[i] / 2)];
/** a hollowed axis-aligned box: dims d, centre c, open toward axis k sign s, wall t */
function boxHollow(d, c, k, s, t) {
  const V0 = d[0] * d[1] * d[2]; const di = d.map((v, i) => (i === k ? v - t : v - 2 * t));
  const Vin = di[0] * di[1] * di[2]; const cc = c.slice(); cc[k] += s * t / 2;
  const V = V0 - Vin;
  return { volume: V, com: c.map((v, i) => (V0 * v - Vin * cc[i]) / V), bbox: bboxOfCenter(c, d), curved: false };
}
function cylHollow(r, h, c, s, t) {
  const V0 = Math.PI * r * r * h; const Vin = Math.PI * (r - t) ** 2 * (h - t); const V = V0 - Vin;
  const cc = c.slice(); cc[2] += s * t / 2;
  return { volume: V, com: c.map((v, i) => (V0 * v - Vin * cc[i]) / V), bbox: bboxOfCenter(c, [2 * r, 2 * r, h]), curved: true };
}
function prismHollow(n, R, h, c, s, t) {
  const area = (rr) => (n / 2) * rr * rr * Math.sin(2 * Math.PI / n);
  const a = R * Math.cos(Math.PI / n); const Rin = R * (a - t) / a;
  const V0 = area(R) * h; const Vin = area(Rin) * (h - t); const V = V0 - Vin;
  const cc = c.slice(); cc[2] += s * t / 2;
  const xs = Array.from({ length: n }, (_, i) => R * Math.cos(2 * Math.PI * i / n)); const ys = Array.from({ length: n }, (_, i) => R * Math.sin(2 * Math.PI * i / n));
  const bbox = [c[0] + Math.min(...xs), c[1] + Math.min(...ys), c[2] - h / 2, c[0] + Math.max(...xs), c[1] + Math.max(...ys), c[2] + h / 2];
  return { volume: V, com: c.map((v, i) => (V0 * v - Vin * cc[i]) / V), bbox, curved: false };
}
/** a box with ONE side face tilted: face word (axis a, outward sign sa), pull z, neutral n, angle (deg); out(z) = SIGMA tan(angle)(z - n) */
function boxDraft(d, c, word, angle, n, sigma = SIGMA) {
  const [a, sa] = AXI[word]; const b = [0, 1].find((i) => i !== a); const z0 = c[2] - d[2] / 2; const z1 = c[2] + d[2] / 2;
  const k = sigma * Math.tan(angle * Math.PI / 180); const P = c[a] + sa * d[a] / 2; const Lb = d[b];
  const u0 = z0 - n; const u1 = z1 - n;
  const I1 = (u1 ** 2 - u0 ** 2) / 2; const I2 = (u1 ** 3 - u0 ** 3) / 3;
  const dV = Lb * k * I1; const V0 = d[0] * d[1] * d[2]; const V = V0 + dV;
  const mom = c.map((v) => V0 * v);
  mom[b] += dV * c[b]; // the added (or removed) slab is centred on the box in the lateral direction
  mom[a] += Lb * (P * k * I1 + sa * k * k * I2 / 2);
  mom[2] += Lb * k * (I2 + n * I1);
  const bbox = bboxOfCenter(c, d); const ext = P + sa * Math.max(k * u0, k * u1);
  // the face is a plane tilted about a line, so its extreme along its own axis is at the z end where it sticks out furthest (it can also lie inside the old extent)
  if (sa > 0) bbox[a + 3] = ext; else bbox[a] = ext;
  return { volume: V, com: mom.map((m) => m / V), bbox, curved: false };
}

// ---------------------------------------------------------------------------------------------------------------- cases
const rng = mulberry32(SEED);
const pick = (a) => a[Math.floor(rng() * a.length)];
const num = (lo, hi, q = 0.5) => Math.round((lo + rng() * (hi - lo)) / q) * q;
const vec = () => [pick([0, num(-40, 40)]), pick([0, num(-40, 40)]), pick([0, num(-30, 30)])];
const CASES = [];
const addCase = (c) => { if (!only || c.id.startsWith(only)) CASES.push(c); };
const WORDS = ['+x', '-x', '+y', '-y', '+z', '-z'];

function movedChain(root, k) { // k plain moves after the primitive; returns {feats, last, total}
  const feats = []; let last = root; let total = [0, 0, 0];
  for (let i = 1; i <= k; i++) { const off = vec(); feats.push(move(`move${i}`, last, off)); last = `move${i}`; total = add3(total, off); }
  return { feats, last, total };
}
let n = 0;
// hollow of a box, every side, 0 to 2 moves, planner set alternating between the group's and the base
for (let i = 0; i < 78; i++) {
  const d = [num(10, 40), num(10, 40), num(10, 30)]; const c = pick([[0, 0, 0], [num(-20, 20), num(-20, 20), num(-10, 10)]]);
  const word = WORDS[i % 6]; const [k, s] = AXI[word];
  const t = num(0.5, Math.min(...d) / 3, 0.25) || 0.5;
  const { feats, last, total } = movedChain('box1', pick([0, 1, 1, 2, 2]));
  const doc = { features: [box('box1', d, c, { rotate: [0, 0, 0] }), ...feats, shell('shell1', last, prim('box1', word), t)] };
  const cc = add3(c, total);
  addCase({ id: `h-box-${++n}`, planners: i % 3 === 2 ? 'base' : 'shell-draft', doc, moves: feats.length, exp: boxHollow(d, cc, k, s, t), alts: WORDS.filter((w) => w !== word).map((w) => boxHollow(d, cc, AXI[w][0], AXI[w][1], t)) });
}
for (let i = 0; i < 24; i++) { // cylinder open +z / -z
  const r = num(4, 14); const h = num(8, 30); const c = pick([[0, 0, 0], [num(-20, 20), num(-20, 20), num(-10, 10)]]);
  const s = i % 2 ? 1 : -1; const word = s > 0 ? '+z' : '-z'; const t = num(0.5, Math.min(r, h) / 3, 0.25) || 0.5;
  const { feats, last, total } = movedChain('cyl1', pick([0, 1, 1, 2, 2]));
  const doc = { features: [cyl('cyl1', r, h, c, { rotate: [0, 0, 0] }), ...feats, shell('shell1', last, prim('cyl1', word), t)] };
  const cc = add3(c, total);
  addCase({ id: `h-cyl-${i + 1}`, planners: i % 4 === 3 ? 'base' : 'shell-draft', doc, moves: feats.length, exp: cylHollow(r, h, cc, s, t), alts: [cylHollow(r, h, cc, -s, t)] });
}
for (let i = 0; i < 24; i++) { // prism open +z / -z
  const sides = pick([3, 4, 5, 6, 8]); const R = num(5, 14); const h = num(8, 30); const c = pick([[0, 0, 0], [num(-20, 20), num(-20, 20), num(-10, 10)]]);
  const s = i % 2 ? 1 : -1; const word = s > 0 ? '+z' : '-z'; const a = R * Math.cos(Math.PI / sides); const t = num(0.5, Math.min(a, h) / 3, 0.25) || 0.5;
  const { feats, last, total } = movedChain('prism1', pick([0, 1, 1, 2, 2]));
  const doc = { features: [prism('prism1', sides, R, h, c, { rotate: [0, 0, 0] }), ...feats, shell('shell1', last, prim('prism1', word), t)] };
  const cc = add3(c, total);
  addCase({ id: `h-prism-${i + 1}`, planners: i % 4 === 3 ? 'base' : 'shell-draft', doc, moves: feats.length, exp: prismHollow(sides, R, h, cc, s, t), alts: [prismHollow(sides, R, h, cc, -s, t)] });
}
// draft of a box side face, 0 to 2 moves
for (let i = 0; i < 54; i++) {
  const d = [num(20, 40), num(20, 40), num(10, 30)]; const c = pick([[0, 0, 0], [num(-20, 20), num(-20, 20), num(-10, 10)]]);
  const word = ['+x', '-x', '+y', '-y'][i % 4]; const angle = pick([1, 2, 3, 5, 8, 10, -2, -5, -8]);
  const { feats, last, total } = movedChain('box1', pick([0, 1, 1, 2, 2]));
  const cc = add3(c, total); const z0 = cc[2] - d[2] / 2;
  const neutral = Math.round((z0 + pick([0, 0.5, 1]) * d[2]) * 2) / 2;
  const doc = { features: [box('box1', d, c, { rotate: [0, 0, 0] }), ...feats, draft('draft1', last, prim('box1', word), angle, { neutral })] };
  addCase({ id: `d-box-${i + 1}`, planners: i % 5 === 4 ? 'base' : 'shell-draft', doc, moves: feats.length, draftArgs: [d, cc, word, angle, neutral], exp: boxDraft(d, cc, word, angle, neutral), alts: ['+x', '-x', '+y', '-y'].filter((w) => w !== word).map((w) => boxDraft(d, cc, w, angle, neutral)) });
}
// quarter turns: the base set follows them; the shell-draft set keeps the group's refusal of a turn in the chain
for (let i = 0; i < 24; i++) {
  const d = [num(10, 36), num(10, 36), num(10, 30)]; const c = pick([[0, 0, 0], [num(-15, 15), num(-15, 15), num(-8, 8)]]);
  const word = WORDS[i % 6]; const ang = [pick([0, 90, 180, 270]), pick([0, 90, 180, 270]), pick([0, 90, 180, 270])];
  if (!ang.some((v) => v)) ang[2] = 90;
  const preMove = i % 2 ? move('move1', 'box1', vec()) : null; const t0 = preMove ? 'move1' : 'box1';
  const off = preMove ? preMove.offset : [0, 0, 0]; const cc = add3(c, off);
  const rot = rotate('turn1', t0, ang);
  const R = quarterMatrix(ang);
  const dims = [0, 1, 2].map((r) => Math.abs(R[r][0]) * d[0] + Math.abs(R[r][1]) * d[1] + Math.abs(R[r][2]) * d[2]);
  const v = AXI[word]; const dir0 = [0, 0, 0]; dir0[v[0]] = v[1];
  const dw = R.map((row) => Math.round(row[0] * dir0[0] + row[1] * dir0[1] + row[2] * dir0[2]));
  const k = dw.findIndex((x) => x); const s = dw[k];
  const t = num(0.5, Math.min(...dims) / 3, 0.25) || 0.5;
  const doc = { features: [box('box1', d, c, { rotate: [0, 0, 0] }), ...(preMove ? [preMove] : []), rot, shell('shell1', 'turn1', prim('box1', word), t)] };
  const base = i % 3 !== 2;
  addCase({ id: `r-box-${i + 1}`, planners: base ? 'base' : 'shell-draft', doc, moves: preMove ? 1 : 0, turn: true, mustRefuse: !base, exp: boxHollow(dims, cc, k, s, t), alts: [0, 1, 2].flatMap((a) => [1, -1].map((sg) => [a, sg])).filter(([a, sg]) => !(a === k && sg === s)).map(([a, sg]) => boxHollow(dims, cc, a, sg, t)) });
}
function quarterMatrix(ang) { // x, then y, then z, right-handed, each about the global axis (as the translator's solid.move calls)
  const q = (a) => ((Math.round(a / 90) % 4) + 4) % 4; const C = [1, 0, -1, 0]; const S = [0, 1, 0, -1];
  const Rx = (k) => [[1, 0, 0], [0, C[k], -S[k]], [0, S[k], C[k]]]; const Ry = (k) => [[C[k], 0, S[k]], [0, 1, 0], [-S[k], 0, C[k]]]; const Rz = (k) => [[C[k], -S[k], 0], [S[k], C[k], 0], [0, 0, 1]];
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul(Rz(q(ang[2])), mul(Ry(q(ang[1])), Rx(q(ang[0]))));
}
// primitives that carry their own quarter turn (`rotate`, about the origin, then placed at `center`): the face part is a LOCAL direction the turn carries along
const mulM = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const dirWorld = (R, v) => R.map((row) => Math.round(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
const dimsWorld = (R, d) => [0, 1, 2].map((r) => Math.abs(R[r][0]) * d[0] + Math.abs(R[r][1]) * d[1] + Math.abs(R[r][2]) * d[2]);
const wordOf = (w) => ['+x', '-x', '+y', '-y', '+z', '-z'][(w.findIndex((v) => v) * 2) + (w.find((v) => v) > 0 ? 0 : 1)];
function cylHollowAxis(r, h, c, k, s, t) {
  const V0 = Math.PI * r * r * h; const Vin = Math.PI * (r - t) ** 2 * (h - t); const V = V0 - Vin; const cc = c.slice(); cc[k] += s * t / 2;
  const dims = [2 * r, 2 * r, 2 * r]; dims[k] = h;
  return { volume: V, com: c.map((v, i) => (V0 * v - Vin * cc[i]) / V), bbox: bboxOfCenter(c, dims), curved: true };
}
for (let i = 0; i < 30; i++) {
  const ang = [pick([0, 90, 180, 270]), pick([0, 90, 180, 270]), pick([0, 90, 180, 270])]; if (!ang.some((v) => v)) ang[0] = 180;
  const R = quarterMatrix(ang); const kind = i % 3 === 2 ? 'cyl' : 'box'; const draftIt = i % 5 === 4 && kind === 'box';
  const nm = kind === 'box' ? 'box1' : 'cyl1';
  const c = pick([[0, 0, 0], [num(-20, 20), num(-20, 20), num(-10, 10)]]);
  const { feats, last, total } = movedChain(nm, pick([0, 1, 2]));
  const cc = add3(c, total);
  const planners = i % 4 === 3 ? 'shell-draft' : 'base';
  if (kind === 'box') {
    const d = [num(12, 36), num(12, 36), num(12, 30)]; const dw = dimsWorld(R, d);
    const word = draftIt ? ['+x', '-x', '+y', '-y'][i % 4] : WORDS[i % 6];
    const v = AXI[word]; const loc = [0, 0, 0]; loc[v[0]] = v[1]; const w = dirWorld(R, loc); const kk = w.findIndex((x) => x); const ss = w[kk];
    if (draftIt) {
      const angle = pick([2, 5, -3, 8]); const z0 = cc[2] - dw[2] / 2; const neutral = Math.round((z0 + pick([0, 0.5, 1]) * dw[2]) * 2) / 2;
      const doc = { features: [box(nm, d, c, { rotate: ang }), ...feats, draft('draft1', last, prim(nm, word), angle, { neutral })] };
      const ww = wordOf(w); const par = kk === 2;
      addCase({ id: `tp-box-draft-${i + 1}`, planners, doc, moves: feats.length, turn: true, mustRefuse: par, draftArgs: par ? undefined : [dw, cc, ww, angle, neutral], exp: par ? undefined : boxDraft(dw, cc, ww, angle, neutral), alts: par ? [] : ['+x', '-x', '+y', '-y'].filter((q) => q !== ww).map((q) => boxDraft(dw, cc, q, angle, neutral)) });
    } else {
      const t = num(0.5, Math.min(...dw) / 3, 0.25) || 0.5;
      const doc = { features: [box(nm, d, c, { rotate: ang }), ...feats, shell('shell1', last, prim(nm, word), t)] };
      addCase({ id: `tp-box-${i + 1}`, planners, doc, moves: feats.length, turn: true, exp: boxHollow(dw, cc, kk, ss, t), alts: [0, 1, 2].flatMap((a) => [1, -1].map((sg) => [a, sg])).filter(([a, sg]) => !(a === kk && sg === ss)).map(([a, sg]) => boxHollow(dw, cc, a, sg, t)) });
    }
  } else {
    const r = num(4, 12); const h = num(10, 28); const word = i % 2 ? '+z' : '-z'; const loc = [0, 0, word === '+z' ? 1 : -1]; const w = dirWorld(R, loc); const kk = w.findIndex((x) => x); const ss = w[kk];
    const t = num(0.5, Math.min(r, h) / 3, 0.25) || 0.5;
    const doc = { features: [cyl(nm, r, h, c, { rotate: ang }), ...feats, shell('shell1', last, prim(nm, word), t)] };
    addCase({ id: `tp-cyl-${i + 1}`, planners, doc, moves: feats.length, turn: true, exp: cylHollowAxis(r, h, cc, kk, ss, t), alts: [0, 1, 2].flatMap((a) => [1, -1].map((sg) => [a, sg])).filter(([a, sg]) => !(a === kk && sg === ss)).map(([a, sg]) => cylHollowAxis(r, h, cc, a, sg, t)) });
  }
}
// refused kinds (nothing to build: the layer must say so in a sentence)
const REF = (id, planners, doc) => addCase({ id: `x-${id}`, planners, doc, mustRefuse: true });
for (const planners of ['shell-draft', 'base']) {
  const b = box('box1', [20, 12, 8], [0, 0, 0], { rotate: [0, 0, 0] });
  REF(`turn45-${planners}`, planners, { features: [b, rotate('turn1', 'box1', [0, 0, 45]), shell('shell1', 'turn1', prim('box1', '+z'), 1)] });
  REF(`copy-${planners}`, planners, { features: [b, move('move1', 'box1', [30, 0, 0], true), shell('shell1', 'move1', prim('box1', '+z'), 1)] });
  REF(`mirror-${planners}`, planners, { features: [b, move('move1', 'box1', [30, 0, 0]), { id: 'mirror1', kind: 'mirror', target: 'move1', plane: 'yz' }, shell('shell1', 'mirror1', prim('box1', '+z'), 1)] });
  REF(`join-${planners}`, planners, { features: [b, box('box2', [6, 6, 6], [30, 0, 0], { rotate: [0, 0, 0] }), move('move1', 'box1', [5, 0, 0]), combine('join1', 'union', ['move1', 'box2']), shell('shell1', 'join1', prim('box1', '+z'), 1)] });
  REF(`cyl-side-${planners}`, planners, { features: [cyl('cyl1', 8, 20, [0, 0, 0], { rotate: [0, 0, 0] }), move('move1', 'cyl1', [10, 0, 0]), shell('shell1', 'move1', prim('cyl1', 'side'), 1)] });
  REF(`cyl-x-${planners}`, planners, { features: [cyl('cyl1', 8, 20, [0, 0, 0], { rotate: [0, 0, 0] }), move('move1', 'cyl1', [10, 0, 0]), shell('shell1', 'move1', prim('cyl1', '+x'), 1)] });
  REF(`draft-top-${planners}`, planners, { features: [b, move('move1', 'box1', [10, 0, 0]), draft('draft1', 'move1', prim('box1', '+z'), 5, { neutral: 0 })] });
  REF(`draft-cyl-top-${planners}`, planners, { features: [cyl('cyl1', 8, 20, [0, 0, 0], { rotate: [0, 0, 0] }), move('move1', 'cyl1', [10, 0, 0]), draft('draft1', 'move1', prim('cyl1', '+z'), 5, { neutral: 0 })] });
  // a box turned 90 about z (local +x is world +y), moved by 10 along x, hollowed open on its local +x face: world dims 12 x 20 x 8, centre (10,0,0), opens +y
  addCase({ id: `turned-prim-${planners}`, planners, doc: { features: [box('box1', [20, 12, 8], [0, 0, 0], { rotate: [0, 0, 90] }), move('move1', 'box1', [10, 0, 0]), shell('shell1', 'move1', prim('box1', '+x'), 1)] }, moves: 1, turn: true, exp: boxHollow([12, 20, 8], [10, 0, 0], 1, 1, 1), alts: [[0, 1], [0, -1], [1, -1], [2, 1], [2, -1]].map(([a, sg]) => boxHollow([12, 20, 8], [10, 0, 0], a, sg, 1)) });
  REF(`shell-wall-too-thick-${planners}`, planners, { features: [b, move('move1', 'box1', [10, 0, 0]), shell('shell1', 'move1', prim('box1', '+z'), 20)] });
}

// ---------------------------------------------------------------------------------------------------------------- run
const TR = { 'shell-draft': createTranslator({ planners: 'shell-draft' }), base: createTranslator({ planners: 'base' }) };
const relV = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
function score(m, exp) {
  const bar = exp.curved ? CURVED : PLANAR;
  const scale = Math.max(1, ...exp.bbox.map(Math.abs));
  const dV = relV(m.volume, exp.volume);
  const dB = Math.max(...m.bbox.map((v, i) => Math.abs(v - exp.bbox[i]))) / scale;
  const dC = Math.max(...m.com.map((v, i) => Math.abs(v - exp.com[i]))) / scale;
  return { dV, dB, dC, bar, ok: dV <= bar && dB <= bar && dC <= bar };
}
const comDist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const rows = []; const tally = { total: 0, right: 0, refusedExpected: 0, refusedUnexpected: 0, wrong: 0, builtUnverified: 0, undiscriminating: 0, byKind: {}, sentences: {}, brep: { agree: 0, disagree: 0, refused: 0, noShape: 0, oppositeSign: 0, notOppositeSign: 0, drawsNoTilt: 0 }, maxDev: { planar: { dV: 0, dB: 0, dC: 0 }, curved: { dV: 0, dB: 0, dC: 0 } }, offFlag: { cases: 0, refused: 0, built: 0 }, negControl: { checked: 0, passedWrongly: 0 } };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const t0 = Date.now();
for (const c of CASES) {
  tally.total++;
  const ctx = { arc, mt, runSC: up.runSC, topologyOf: up.topologyOf, soups: {}, followMoves: true };
  let tr; let threw = null;
  try { tr = await TR[c.planners].translateDoc(structuredClone(c.doc), ctx); } catch (e) { threw = e.message; }
  const lastF = c.doc.features.at(-1);
  const f = tr?.features.find((x) => x.id === lastF.id);
  const kind = c.id.split('-').slice(0, 2).join('-').replace(/-\d+$/, '');
  const row = { id: c.id, planners: c.planners, moves: c.moves ?? null, kind, status: threw ? 'threw' : f?.status, refusal: f?.refusal ?? null, guard: f?.guard ?? null };
  if (threw) { row.outcome = 'THREW'; row.error = threw; tally.wrong += 0; (tally.threw ??= []).push({ id: c.id, error: threw }); rows.push(row); continue; }
  if (f.status === 'built') {
    // measure the whole built command list again on the STOCK rig wrapper (the one the other replays use)
    const sres = JSON.parse(stock.run(JSON.stringify({ commands: tr.commands })));
    const bs = sres.ok ? sres.measure.bodies : [];
    const m = f.measure;
    row.measure = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, bodies: m.bodies };
    row.stockRig = sres.ok ? { volume: bs.reduce((s, b) => s + b.volume_mm3, 0), bodies: bs.length } : { error: sres.failed?.error };
    row.pick = f.pick;
    if (!c.exp || c.mustRefuse) { row.outcome = 'BUILT-UNVERIFIED'; tally.builtUnverified++; row.why = c.mustRefuse ? 'built where the layer should have refused, and no closed form exists' : 'no closed form'; }
    else {
      const sc = score(m, c.exp); row.score = sc;
      const bucket = c.exp.curved ? tally.maxDev.curved : tally.maxDev.planar;
      bucket.dV = Math.max(bucket.dV, sc.dV); bucket.dB = Math.max(bucket.dB, sc.dB); bucket.dC = Math.max(bucket.dC, sc.dC);
      const scale = Math.max(1, ...c.exp.bbox.map(Math.abs));
      const sep = Math.min(...c.alts.map((a) => comDist(a.com, c.exp.com))) / scale;
      row.comSeparation = sep;
      if (sep <= 10 * sc.bar) { row.undiscriminating = true; tally.undiscriminating++; }
      if (sres.ok && (bs.length !== 1 || relV(row.stockRig.volume, m.volume) > 1e-12)) { row.outcome = 'WRONG'; row.why = 'the stock rig disagrees with the topology rig on the same commands'; tally.wrong++; }
      else if (sc.ok && !row.undiscriminating) {
        row.outcome = 'RIGHT'; tally.right++;
        // negative control: the same built result scored against the closed form of ANOTHER open face / the opposite draft sign must FAIL, or the check proves nothing
        const nc = c.alts.map((a) => score(m, a).ok); tally.negControl.checked += nc.length; tally.negControl.passedWrongly += nc.filter(Boolean).length;
      }
      else if (sc.ok) { row.outcome = 'RIGHT-WEAK'; tally.right++; }
      else { row.outcome = 'WRONG'; row.why = `closed form: volume ${c.exp.volume}, com ${c.exp.com}, bbox ${c.exp.bbox}; built: volume ${m.volume}, com ${m.com}, bbox ${m.bbox}`; tally.wrong++; }
    }
    // second oracle: brep-rs on the same ModelDoc
    try {
      const got = JSON.parse(brep.measure_doc(JSON.stringify(c.doc))); const s = got.shapes?.[lastF.id];
      if (!s) { row.brep = { refused: got.refusals?.[lastF.id] ?? 'no shape' }; tally.brep.refused++; }
      else {
        const bb = [...s.bbox[0], ...s.bbox[1]]; const exp = c.exp ?? { volume: m.volume, bbox: m.bbox, curved: false };
        const bar = exp.curved ? CURVED : PLANAR; const scale = Math.max(1, ...bb.map(Math.abs));
        const dV = relV(s.volume, m.volume); const dB = Math.max(...bb.map((v, i) => Math.abs(v - m.bbox[i]))) / scale;
        row.brep = { volume: s.volume, bbox: bb, dVolVsBuilt: dV, dBboxVsBuilt: dB, agree: dV <= Math.max(bar, 1e-6) && dB <= Math.max(bar, 1e-6) };
        row.brep.agree ? tally.brep.agree++ : tally.brep.disagree++;
        if (!row.brep.agree && c.draftArgs) { // brep-rs may use the opposite draft sign: does it match the closed form with the sign flipped?
          const alt = boxDraft(...c.draftArgs, -SIGMA); const dv = relV(s.volume, alt.volume); const db = Math.max(...bb.map((v, i) => Math.abs(v - alt.bbox[i]))) / scale;
          row.brep.matchesOppositeDraftSign = dv <= 1e-9 && db <= 1e-9; row.brep.matchesOppositeDraftSign ? tally.brep.oppositeSign++ : tally.brep.notOppositeSign++;
          // brep-rs finds the tilted face in the primitive's own frame; probed by hand, a move along the face's axis leaves it no face to tilt and it draws NO draft at all (volume and
          // bounding box of the plain moved box). Is that what it returned?
          const [dd, cc2] = c.draftArgs; const plainBox = bboxOfCenter(cc2, dd);
          const noop = relV(s.volume, dd[0] * dd[1] * dd[2]) < 1e-9 && bb.every((v, i) => Math.abs(v - plainBox[i]) < 1e-9);
          row.brep.drawsNoTilt = noop; if (noop) tally.brep.drawsNoTilt++;
        }
      }
    } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; tally.brep.refused++; }
  } else {
    const sentenceCount = (f.refusal ?? '').split(/(?<=[.!?])\s+(?=[A-Z])/).length;
    row.oneSentence = sentenceCount === 1; bump(tally.sentences, f.refusal ?? '(none)');
    if (c.mustRefuse) { row.outcome = 'REFUSED-EXPECTED'; tally.refusedExpected++; }
    else { row.outcome = 'REFUSED-UNEXPECTED'; tally.refusedUnexpected++; row.why = 'the closed form says this is buildable'; }
  }
  bump(tally.byKind, `${kind}: ${row.outcome}`);
  // context: the same case with the flag OFF (not scored)
  if (c.moves || c.turn) {
    try { const tr0 = await TR[c.planners].translateDoc(structuredClone(c.doc), { arc, mt, runSC: up.runSC, topologyOf: up.topologyOf, soups: {} }); const f0 = tr0.features.find((x) => x.id === lastF.id); tally.offFlag.cases++; f0.status === 'built' ? tally.offFlag.built++ : tally.offFlag.refused++; row.flagOff = f0.status; } catch { /* context only */ }
  }
  rows.push(row);
  if (row.outcome === 'WRONG') console.log(`WRONG ${c.id}: ${row.why}`);
  if (tally.total % 20 === 0) console.log(`${tally.total}/${CASES.length} ${Math.round((Date.now() - t0) / 1000)} s right ${tally.right} refused ${tally.refusedExpected}+${tally.refusedUnexpected} wrong ${tally.wrong}`);
}
const summary = { target: 'SolidCraft v0.21.0 wasm rig; layer followMoves ON', cases: tally.total, builtAndRight: tally.right, refusedExpected: tally.refusedExpected, refusedUnexpected: tally.refusedUnexpected, builtAndWRONG: tally.wrong, builtUnverified: tally.builtUnverified, undiscriminating: tally.undiscriminating, threw: tally.threw?.length ?? 0, byKind: tally.byKind, brep: tally.brep, offFlag: tally.offFlag, negControl: tally.negControl, maxDeviationOfRight: tally.maxDev, bars: { planar: PLANAR, curved: CURVED } };
writeFileSync(OUT, JSON.stringify({ summary, sentences: tally.sentences, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(`wrote ${OUT}`);
process.exit(tally.wrong || tally.threw?.length ? 1 : 0);
