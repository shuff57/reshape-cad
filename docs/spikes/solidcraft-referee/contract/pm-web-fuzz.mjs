// SPIKE, referee only (round 6). Fuzz of the THIN-WALL guard ('web', see pm-translate.mjs) against an exact closed form (union of boxes, no OCCT in the loop). The older header follows.
// Fuzz of the repeat() guard layer against an EXACT closed form (no OCCT in the loop, so it is fast and cannot share a bug with the other kernels).
//
// A box a x b x c is repeated count (2..4) times with a random step; the union of axis-aligned boxes has an exact volume (coordinate compression). Steps are drawn
// from the families that matter for the join: 0, +-one box size (face contact), +-small fractions of the size (1e-4 .. 5%: the near-coincident family),
// +-(size -/+ a hair) (overlap / gap slivers), +-half sizes, +-1.3 sizes (apart). The result of translateDoc (the contract translator, run exactly as pm-run.mjs runs it) is
//   BUILT and equal to the closed form to 1e-9  -> ok
//   BUILT and different                          -> WRONG (a silently wrong solid: this is what the guard exists to prevent)
//   REFUSED                                      -> refused (the sentence is kept)
// PM_OFF=snap (round 4) or PM_OFF=sliver (round 5) switch a guard off (negative control); --mode=sliver draws overlap slivers, --mode=aligned draws copies apart along one axis and near-aligned along the other two. Usage:
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun pm-web-fuzz.mjs [--n=400] [--seed=1] [--out=file.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc } from './pm-translate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MODE = arg('mode', 'mixed'); // 'sliver': one axis overlaps by a log-uniform 1e-7 .. 2e-2 mm, the others by 10..90% (the family the sliver guard is about)
const N = Number(arg('n', 400)); let seed = Number(arg('seed', 1)); const OUT = arg('out', '');
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const ALL = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver', 'web'];
const PATCHES = new Set([...ALL.filter((p) => !(process.env.PM_OFF ?? '').split(',').includes(p)), '__explicit']);

const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const unionVol = (boxes) => {
  const cuts = [0, 1, 2].map((i) => [...new Set(boxes.flatMap((b) => [b.lo[i], b.hi[i]]))].sort((x, y) => x - y));
  let v = 0;
  for (let i = 0; i + 1 < cuts[0].length; i++) for (let j = 0; j + 1 < cuts[1].length; j++) for (let k = 0; k + 1 < cuts[2].length; k++) {
    const m = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
    if (boxes.some((b) => m.every((x, d) => x > b.lo[d] && x < b.hi[d]))) v += (cuts[0][i + 1] - cuts[0][i]) * (cuts[1][j + 1] - cuts[1][j]) * (cuts[2][k + 1] - cuts[2][k]);
  }
  return v;
};
const r4 = (v) => +v.toPrecision(10);
// Each trial: a plate PW x PH x T (top face z = T) and rectangular pockets of random size cut from the top, built one of five ways:
//   repeat   : repeat(pocket, {count 2..3, step})      step along x or y, or diagonal, wall = step - size
//   mirror   : mirror(pocket, 'left-right'|'front-back', {at})
//   hand     : two hand-written pockets of different sizes / depths
//   edge     : one pocket whose side is `wall` from a side of the plate
//   two-axis : repeat along x then along y
// `wallOverDiag` is the THINNEST wall of the built part (design wall, or the distance of a cut to a plate side) over the plate's bounding-box diagonal. The design wall is log-uniform from 1e-4 to 3% of the plate's bounding-box diagonal (the guard refuses up to 1%), plus a share of fixed walls on the measured edge (0.15, 0.2 mm on 60x40x10).
const MODEF = MODE === 'mixed' ? null : MODE;
const res = []; const tally = { ok: 0, WRONG: 0, refused: 0, 'script-refused': 0 };
for (let t = 0; t < N; t++) {
  const PW = pick([30, 40, 60, 80, 120, 200]), PH = pick([20, 30, 40, 60]), T = pick([6, 10, 20, 30]);
  const diag = Math.hypot(PW, PH, T);
  const wall = rnd() < 0.15 ? pick([0.15, 0.2, 0.25]) : Math.pow(10, -4 + rnd() * (Math.log10(0.03 * diag) + 4));
  const w = Math.round((2 + rnd() * 10) * 4) / 4, h = Math.round((2 + rnd() * 8) * 4) / 4, d = Math.round((1 + rnd() * (T - 2)) * 4) / 4;
  const mode = MODEF ?? pick(['repeat', 'repeat', 'mirror', 'hand', 'edge', 'two-axis']);
  const axis = pick(['x', 'y', 'diag']);
  const x0 = PW / 2 - w / 2 - 0.5 * (w + wall) * (rnd() < 0.5 ? 1 : 0), y0 = PH / 2;
  const PLATE = `const s1 = sketch('top'); s1.polygon([[0,0],[${PW},0],[${PW},${PH}],[0,${PH}]]); const plate = extrude(s1, ${T}); const p1 = sketch('top', ${T});`;
  const rect = (cx, cy) => ({ lo: [cx - w / 2, cy - h / 2, T - d], hi: [cx + w / 2, cy + h / 2, T] });
  let src, cutsB;
  const cx0 = Math.round((PW / 2 - w) * 4) / 4, cy0 = Math.round(y0 * 4) / 4;
  if (mode === 'repeat') {
    const count = 2 + Math.floor(rnd() * 2); const st = axis === 'x' ? [w + wall, 0, 0] : axis === 'y' ? [0, h + wall, 0] : [w + wall, h + wall, 0];
    src = `${PLATE} p1.rect(${w}, ${h}, { at: [${cx0}, ${cy0}] }); const pk = pocket(p1, plate, ${d}); repeat(pk, { count: ${count}, step: [${st.map(r4).join(', ')}, ] });`.replace(', ]', ']');
    cutsB = Array.from({ length: count }, (_, i) => rect(cx0 + st[0] * i, cy0 + st[1] * i));
  } else if (mode === 'mirror') {
    const at = cx0 + w / 2 + wall / 2;
    src = `${PLATE} p1.rect(${w}, ${h}, { at: [${cx0}, ${cy0}] }); const pk = pocket(p1, plate, ${d}); mirror(pk, 'left-right', { at: ${r4(at)} });`;
    cutsB = [rect(cx0, cy0), rect(2 * at - cx0, cy0)];
  } else if (mode === 'hand') {
    const w2 = Math.round((1 + rnd() * 6) * 4) / 4, h2 = Math.round((1 + rnd() * 6) * 4) / 4, d2 = Math.round((1 + rnd() * (T - 2)) * 4) / 4;
    const cx2 = cx0 + w / 2 + wall + w2 / 2;
    src = `${PLATE} p1.rect(${w}, ${h}, { at: [${cx0}, ${cy0}] }); const a = pocket(p1, plate, ${d}); const p2 = sketch('top', ${T}); p2.rect(${w2}, ${h2}, { at: [${r4(cx2)}, ${cy0}] }); pocket(p2, a, ${d2});`;
    cutsB = [rect(cx0, cy0), { lo: [cx2 - w2 / 2, cy0 - h2 / 2, T - d2], hi: [cx2 + w2 / 2, cy0 + h2 / 2, T] }];
  } else if (mode === 'edge') {
    const cx = w / 2 + wall; src = `${PLATE} p1.rect(${w}, ${h}, { at: [${r4(cx)}, ${cy0}] }); pocket(p1, plate, ${d});`;
    cutsB = [rect(cx, cy0)];
  } else { // two-axis
    const sx = w + wall, sy = h + wall; const cy1 = Math.round((PH / 2 - h) * 4) / 4;
    src = `${PLATE} p1.rect(${w}, ${h}, { at: [${cx0}, ${cy1}] }); const pk = pocket(p1, plate, ${d}); const r1 = repeat(pk, { count: 2, step: [${r4(sx)}, 0, 0] }); repeat(pk, { count: 2, step: [0, ${r4(sy)}, 0] });`;
    cutsB = [rect(cx0, cy1), rect(cx0 + sx, cy1), rect(cx0, cy1 + sy)];
  }
  // the thinnest flat wall of the built part: between two cuts that face each other along one axis (the other two axes overlap), or between a cut and a side of the plate, or the corner-to-corner distance of two cuts that only meet diagonally
  const minWall = (() => {
    let mw = Infinity; const lo0 = [0, 0], hi0 = [PW, PH];
    for (const b of cutsB) for (const i of [0, 1]) { for (const g of [b.lo[i] - lo0[i], hi0[i] - b.hi[i]]) if (g > 1e-9) mw = Math.min(mw, g); }
    for (let a = 0; a < cutsB.length; a++) for (let c = a + 1; c < cutsB.length; c++) {
      const A = cutsB[a], B = cutsB[c]; const g = [0, 1, 2].map((i) => Math.max(A.lo[i] - B.hi[i], B.lo[i] - A.hi[i]));
      const apart = g.filter((v) => v > 1e-9);
      if (apart.length >= 1) mw = Math.min(mw, Math.hypot(...apart)); // one axis: a flat wall; two axes: the corner-to-corner distance of two rectangles
    }
    return mw;
  })();
  const rec = { t, mode, PW, PH, T, designWall: r4(wall), minWall: r4(minWall), wallOverDiag: r4(minWall / diag), src };
  const run = runScript(src);
  if (run.errors?.length) { rec.verdict = 'script-refused'; tally['script-refused']++; res.push(rec); continue; }
  const lo0 = [0, 0, 0], hi0 = [PW, PH, T];
  const clip = cutsB.map((b) => ({ lo: b.lo.map((v, i) => Math.max(v, lo0[i])), hi: b.hi.map((v, i) => Math.min(v, hi0[i])) })).filter((b) => b.lo.every((v, i) => v < b.hi[i]));
  rec.exact = PW * PH * T - unionVol(clip);
  const doc = solveDoc(run.doc);
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, patches: PATCHES, inProcess: true });
  const last = tr.features.at(-1);
  rec.lastStatus = last.status;
  if (tr.features.some((f) => f.status === 'refused')) { rec.verdict = 'refused'; rec.student = tr.features.find((f) => f.status === 'refused').student; tally.refused++; res.push(rec); continue; }
  rec.truck = last.measure.volume; rec.rel = Math.abs(rec.truck - rec.exact) / rec.exact;
  rec.verdict = rec.rel <= 1e-9 ? 'ok' : 'WRONG'; tally[rec.verdict]++; res.push(rec);
  if (t % 25 === 24 && OUT) writeFileSync(OUT, JSON.stringify({ partial: true, tally, trials: res }, null, 1));
}
const wrong = res.filter((r) => r.verdict === 'WRONG');
const summary = { mode: MODE, seed: Number(arg('seed', 1)), n: N, guards: [...PATCHES].filter((p) => p !== '__explicit'), tally, wrongSmallestWallOverDiag: wrong.length ? Math.min(...wrong.map((r) => r.wallOverDiag)) : null, wrongLargestWallOverDiag: wrong.length ? Math.max(...wrong.map((r) => r.wallOverDiag)) : null,
  refusedWallOverDiagMax: Math.max(0, ...res.filter((r) => r.verdict === 'refused').map((r) => r.wallOverDiag)), okWallOverDiagMin: Math.min(...res.filter((r) => r.verdict === 'ok').map((r) => r.wallOverDiag), Infinity) };
console.log(JSON.stringify(summary));
for (const r of wrong.slice(0, 10)) console.log('WRONG', r.mode, r.minWall, r.wallOverDiag, r.exact, r.truck, r.src.slice(0, 200));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, trials: res }, null, 1));
