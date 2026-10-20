// SPIKE, referee only (round 6). Where does the kernel start losing a thin wall of material between two cuts (or between a cut and the side of the part), and does the
// 'web' guard refuse every such case? Every case is built TWICE through the contract translator: guard OFF (PM_OFF=web equivalent: the measurement) and guard ON (the verdict).
// Oracle: closed form (union of boxes / polygon areas) for flat-sided cuts; for circles and holes a DIFFERENTIAL (the same model with the wall widened to 3 mm,
// where the kernel is exact) because the kernel's curved volume is tessellated and cannot be compared to pi r^2 at 1e-9. A case is LOST when OFF differs from the oracle by more than 1e-9 relative.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 timeout 900 bun pm-web-probe.mjs [--out=pm-web-probe.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translateDoc, WEB_REL } from './pm-translate.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const OUT = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
const ALL = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver', 'web'];
const SETS = { off: new Set([...ALL.filter((p) => p !== 'web'), '__explicit']), on: new Set([...ALL, '__explicit']) };
const build = (src, set) => {
  const run = runScript(src); if (run.errors?.length) return { status: 'script-refused', msg: run.errors[0].message };
  const doc = solveDoc(run.doc);
  const tr = translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, patches: SETS[set], inProcess: true });
  const bad = tr.features.find((f) => f.status === 'refused'); if (bad) return { status: 'refused', sentence: bad.student };
  return { status: 'built', volume: tr.features.at(-1).measure.volume };
};
const unionVol = (boxes) => {
  const cuts = [0, 1, 2].map((i) => [...new Set(boxes.flatMap((b) => [b.lo[i], b.hi[i]]))].sort((x, y) => x - y));
  let v = 0;
  for (let i = 0; i + 1 < cuts[0].length; i++) for (let j = 0; j + 1 < cuts[1].length; j++) for (let k = 0; k + 1 < cuts[2].length; k++) {
    const m = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
    if (boxes.some((b) => m.every((x, d) => x > b.lo[d] && x < b.hi[d]))) v += (cuts[0][i + 1] - cuts[0][i]) * (cuts[1][j + 1] - cuts[1][j]) * (cuts[2][k + 1] - cuts[2][k]);
  }
  return v;
};
const q = (v) => +v.toPrecision(10);
const PLATE = (PW, PH, T) => `const s1 = sketch('top'); s1.polygon([[0,0],[${PW},0],[${PW},${PH}],[0,${PH}]]); const plate = extrude(s1, ${T}); const p1 = sketch('top', ${T});`;
const cases = []; // {id, family, web, diag, src, exact?, ref?: {src} (a widened-wall twin)}
const rb = (cx, cy, w, h, T, d) => ({ lo: [cx - w / 2, cy - h / 2, T - d], hi: [cx + w / 2, cy + h / 2, T] });
// A. rectangle pockets, repeat x2, 3 pocket sizes, walls from 0.002 to 3 mm
for (const [w, h, d, PW, T] of [[2, 1.2, 0.8, 60, 10], [10, 6, 4, 60, 10], [30, 18, 6, 130, 15]]) {
  const diag = Math.hypot(PW, 40, T);
  for (const web of [0.002, 0.01, 0.05, 0.1, 0.15, 0.17, 0.2, 0.3, 0.45, 0.6, 0.9, 1.5, 3]) {
    const x0 = PW / 2 - w - web / 2;
    cases.push({ id: `A-rect${w}x${h}-repeat-wall${web}`, family: 'repeat(pocket) rectangle', web, diag, src: `${PLATE(PW, 40, T)} p1.rect(${w}, ${h}, { at: [${x0}, 20] }); const pk = pocket(p1, plate, ${d}); repeat(pk, { count: 2, step: [${q(w + web)}, 0, 0] });`, exact: PW * 40 * T - unionVol([rb(x0, 20, w, h, T, d), rb(x0 + w + web, 20, w, h, T, d)]) });
  }
}
// B. six plates, wall = fraction of the diagonal, locates the threshold relative to the part
for (const [PW, PH, T] of [[30, 20, 10], [60, 40, 10], [60, 40, 30], [200, 40, 10], [100, 100, 10], [40, 40, 40]]) {
  const diag = Math.hypot(PW, PH, T);
  for (const f of [0.0005, 0.001, 0.002, 0.0024, 0.0026, 0.0028, 0.003, 0.004, 0.005, 0.0075, 0.0099, 0.0101, 0.015, 0.03]) {
    const web = q(f * diag); const x0 = PW / 2 - 5 - web / 2;
    cases.push({ id: `B-plate${PW}x${PH}x${T}-frac${f}`, family: 'plate size, wall as fraction of diagonal', web, diag, src: `${PLATE(PW, PH, T)} p1.rect(10, 6, { at: [${q(x0)}, ${PH / 2}] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [${q(10 + web)}, 0, 0] });`, exact: PW * PH * T - unionVol([rb(x0, PH / 2, 10, 6, T, 4), rb(x0 + 10 + web, PH / 2, 10, 6, T, 4)]) });
  }
}
const P60 = PLATE(60, 40, 10); const D60 = Math.hypot(60, 40, 10);
for (const web of [0.05, 0.15, 0.3, 0.6, 1]) {
  // C. repeat count 3, mirror at an offset, two-axis repeat, hand-written pockets of other size / depth, plate edge, diagonal step, triangle
  cases.push({ id: `C-repeat-count3-wall${web}`, family: 'repeat(pocket) count 3', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 3, step: [${q(10 + web)}, 0, 0] });`, exact: 24000 - unionVol([0, 1, 2].map((i) => rb(15 + (10 + web) * i, 20, 10, 6, 10, 4))) });
  cases.push({ id: `C-mirror-at-wall${web}`, family: 'mirror(pocket,{at})', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [15, 20] }); const pk = pocket(p1, plate, 4); mirror(pk, 'left-right', { at: ${q(20 + web / 2)} });`, exact: 24000 - unionVol([rb(15, 20, 10, 6, 10, 4), rb(q(2 * (20 + web / 2) - 15), 20, 10, 6, 10, 4)]) });
  cases.push({ id: `C-two-axis-wall${web}`, family: 'repeat along x and y', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [15, 10] }); const pk = pocket(p1, plate, 4); const r1 = repeat(pk, { count: 2, step: [${q(10 + web)}, 0, 0] }); repeat(r1, { count: 2, step: [0, ${q(6 + web)}, 0] });`, exact: 24000 - unionVol([rb(15, 10, 10, 6, 10, 4), rb(15 + 10 + web, 10, 10, 6, 10, 4), rb(15, 10 + 6 + web, 10, 6, 10, 4)]) });
  cases.push({ id: `C-diagonal-step-wall${web}`, family: 'repeat(pocket) diagonal step (corner to corner)', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [20, 15] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [${q(10 + web)}, ${q(6 + web)}, 0] });`, exact: 24000 - 480 });
  cases.push({ id: `C-hand-mixed-wall${web}`, family: 'hand-written pockets of different size', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [15, 20] }); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.rect(4, 3, { at: [${q(20 + web + 2)}, 20] }); pocket(p2, a, 4);`, exact: 24000 - 240 - 48 });
  cases.push({ id: `C-hand-depth-wall${web}`, family: 'hand-written pockets of different depth', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [15, 20] }); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.rect(10, 6, { at: [${q(25 + web)}, 20] }); pocket(p2, a, 2);`, exact: 24000 - 240 - 120 });
  cases.push({ id: `C-triangle-wall${web}`, family: 'triangle pockets (slanted wall)', web, diag: D60, src: `${P60} p1.polygon([[10,10],[20,10],[10,20]]); const a = pocket(p1, plate, 4); const p2 = sketch('top', 10); p2.polygon([[${q(20 + web * 1.4142)},${q(10 + web * 1.4142)}],[${q(20 + web * 1.4142)},${q(20 + web * 1.4142)}],[${q(10 + web * 1.4142)},${q(20 + web * 1.4142)}]]); pocket(p2, a, 4);`, exact: 24000 - 400 });
  cases.push({ id: `C-plate-edge-wall${web}`, family: 'pocket near the side of the part', web, diag: D60, src: `${P60} p1.rect(10, 6, { at: [${q(5 + web)}, 20] }); pocket(p1, plate, 4);`, exact: 24000 - 240 });
  // D. circles and holes: no loss expected; differential against the same model with a 3 mm wall
  cases.push({ id: `D-circle-pocket-wall${web}`, family: 'repeat(pocket) circle', web, diag: D60, src: `${P60} p1.circle(8, { at: [15, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [${q(8 + web)}, 0, 0] });`, ref: `${P60} p1.circle(8, { at: [15, 20] }); const pk = pocket(p1, plate, 4); repeat(pk, { count: 2, step: [11, 0, 0] });` });
  cases.push({ id: `D-hole-wall${web}`, family: 'repeat(hole)', web, diag: D60, src: `const b=box(60,40,10); const h=hole(b,{across:6,deep:10,at:[-3,0]}); repeat(h,{count:2,step:[${q(6 + web)},0,0]});`, ref: `const b=box(60,40,10); const h=hole(b,{across:6,deep:10,at:[-3,0]}); repeat(h,{count:2,step:[9,0,0]});` });
  cases.push({ id: `D-circle-edge-wall${web}`, family: 'circle pocket near the side of the part', web, diag: D60, src: `${P60} p1.circle(8, { at: [${q(4 + web)}, 20] }); pocket(p1, plate, 4);`, ref: `${P60} p1.circle(8, { at: [7, 20] }); pocket(p1, plate, 4);` });
}
const rows = [];
for (const c of cases) {
  const off = build(c.src, 'off'); const on = build(c.src, 'on');
  const ref = c.ref ? build(c.ref, 'off') : null;
  const exact = c.exact ?? ref?.volume;
  const rel = off.status === 'built' && exact ? Math.abs(off.volume - exact) / exact : null;
  const lost = rel !== null && rel > 1e-9;
  const onRel = on.status === 'built' && exact ? Math.abs(on.volume - exact) / exact : null;
  rows.push({ id: c.id, family: c.family, wall: c.web, wallOverDiag: q(c.web / c.diag), oracle: c.exact !== undefined ? 'closed form' : 'differential (3 mm wall)', exact, offStatus: off.status, offRel: rel, lost, onStatus: on.status, onRel, onSentence: on.sentence ?? null, src: c.src });
  console.log(c.id.padEnd(46), 'OFF', off.status.padEnd(7), rel === null ? '' : rel.toExponential(1), lost ? 'LOST' : 'ok', '| ON', on.status, on.status === 'built' && onRel > 1e-9 ? `WRONG ${onRel.toExponential(1)}` : '');
}
const lost = rows.filter((r) => r.lost);
const lostOn = lost.filter((r) => r.onStatus === 'built');
const summary = {
  webRel: WEB_REL, cases: rows.length, lostWithGuardOff: lost.length, lostAndStillBuiltWithGuardOn: lostOn.length,
  largestLostWallOverDiag: Math.max(0, ...lost.map((r) => r.wallOverDiag)), smallestKeptWallOverDiag: Math.min(...rows.filter((r) => !r.lost && r.family !== 'repeat(pocket) circle' && !/circle|hole|diagonal/.test(r.family)).map((r) => r.wallOverDiag).filter((v) => v > Math.max(0, ...lost.map((r) => r.wallOverDiag)))),
  wrongWithGuardOn: rows.filter((r) => r.onStatus === 'built' && r.onRel > 1e-9).length,
  lostFamilies: [...new Set(lost.map((r) => r.family))], notLostFamilies: [...new Set(rows.filter((r) => !r.lost).map((r) => r.family))].filter((f) => !lost.some((l) => l.family === f)),
};
console.log(JSON.stringify(summary, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
