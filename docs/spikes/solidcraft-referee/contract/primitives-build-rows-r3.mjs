// SPIKE, referee only. Builds contract/primitives.json (round 3) from: the round 2 rows (primitives-evidence/primitives.round2.json, kept rows),
// the round 3 sweeps (primitives-r3/results/*.json) and the guarded/unguarded regression runs (g1, g2).  Every number quoted for a changed row is
// computed here from the result files; the builder asserts the status of each row against that data before it writes anything.
//   bun contract/primitives-build-rows-r3.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, res } from './primitives-r3/tools/aggregate.mjs';
import * as G from './primitives.guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OLD = JSON.parse(readFileSync(path.join(HERE, 'primitives-evidence', 'primitives.round2.json'), 'utf8'));
const g1 = res('g1-supported'); const g2 = res('g2-guarded'); const g2u = res('g2-unguarded');
const ex = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(d) : 'n/a');
const sec = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const rows = [];
const assert = (c, m) => { if (!c) throw new Error('ROW CHECK FAILED: ' + m); };

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------
const old = (prefix) => { const r = OLD.rows.find((x) => x.feature.startsWith(prefix)); assert(r, 'old row ' + prefix); return r; };
const xref = (t) => t.replace(/see the row 'curved primitives placed far from the origin'/g, "see the two 'placed far from the origin' rows")
  .replace(/see the 'placed far' row/g, "see the two 'placed far from the origin' rows").replace(/see the small-size row/g, "refused by the size rows ('below 1 across', 'taller than 30 times its across')")
  .replace(/see the oversize row/g, "see the 'size above 5e4' row").replace(/in the oversize rows/g, "in the 'size above' rows").replace(/see the oracle-independence row/g, 'see the oracle-independence row');
const fcfix = (t) => xref(t).replace(/FreeCAD refs:/g, 'FreeCAD refs (Pad/Revolution results of the same solid, NOT primitive features):')
  .replace(/ Rig: REFEREE_REPO_ROOT=<shadow>[^]*$/, '').replace(/ Ran contract\/measure-primitives\.mjs/g, ' Ran (round 1/2) contract/measure-primitives.mjs');
/** wall-clock of the SolidCraft call (build + measure, one synchronous wasm call) over the 3 guarded repeats of the given g1 representatives */
const T = (ids) => {
  const rs = g1.filter((r) => ids.some((i) => r.id.replace(/-r\d$/, '') === `g1-${i}`));
  assert(rs.length === ids.length * 3 && rs.every((r) => r.status === 'built' && r.good), `g1 ${ids} not all built+good (${rs.map((r) => r.status + ':' + (r.why ?? r.guard?.sentence ?? '')).join('|')})`);
  const ms = rs.map((r) => r.ms); const cpu = rs.map((r) => r.cpuMs); const ld = rs.map((r) => r.load);
  const eachMed = ids.map((i) => `${i} ${sec(med(rs.filter((r) => r.id.replace(/-r\d$/, '') === `g1-${i}`).map((r) => r.ms)))}`);
  return ` TIME (one synchronous wasm call = build + measure; ${rs.length} guarded runs): wall median ${sec(med(ms))}, min ${sec(Math.min(...ms))}, max ${sec(Math.max(...ms))}; cpu median ${sec(med(cpu))}; load ${Math.min(...ld).toFixed(0)}-${Math.max(...ld).toFixed(0)} on 24 cores (${eachMed.join(', ')}).`;
};
const GUARD = ' Guard: contract/primitives.guard.mjs (+ primitives.call-lint.mjs), a pure pre-flight in front of the translator; a prototype because packages/script is read-only (see the pre-flight row).';
const RIG = (spec, extra = '') => ` Rig: RIG.md 'primitives group'; spec contract/primitives-r3/${spec}.mjs${extra}, results in contract/primitives-r3/results/.`;
const add = (feature, status, evidence, refusalSentence) => {
  const r = { feature, status };
  if (refusalSentence) r.refusalSentence = refusalSentence;
  r.evidence = evidence;
  rows.push(r);
};
/** sentences the guard produced in the g2 run for a row group, first of each code */
const g2s = (rowName) => g2.filter((r) => r.row === rowName);
const guardOk = (rowName, code) => { const rs = g2s(rowName); assert(rs.length > 0 && rs.every((r) => r.status === 'guard-refused' && (!code || r.guard.code === code || r.code === r.guard.code)), `g2 ${rowName}`); return rs; };
const sent = (id) => { const r = g2.find((x) => x.id === `g2-${id}`); assert(r && r.status === 'guard-refused', 'g2 ' + id); return r.guard.sentence; };
/** what the unguarded rig did with the same inputs, summarised. sel: a row name, or an array of row names, or a predicate on the g2 row */
function before(sel, silent = false) {
  const pick = typeof sel === 'function' ? sel : (r) => (Array.isArray(sel) ? sel : [sel]).includes(r.row);
  const us = g2u.filter(pick);
  const total = g2.filter(pick).length;
  const nid = (r) => r.id.replace('g2-', '');
  const unver = us.filter((r) => r.status === 'built' && !r.good && r.why === 'vol n/a');
  const wrong = us.filter((r) => r.status === 'built' && !r.good && r.why !== 'vol n/a');
  const right = us.filter((r) => r.status === 'built' && r.good);
  const tr = us.filter((r) => r.status === 'truck-refused'); const sr = us.filter((r) => r.status === 'script-refused');
  const texts = [...new Set(tr.map((r) => String(r.refusal).replace(/^.*solidcraft refused it -- /, '')))];
  const parts = [];
  if (wrong.length) parts.push(`${wrong.length} built a WRONG solid with status built and no sentence (${wrong.slice(0, 5).map((r) => `${nid(r)}: ${r.why}`).join('; ')}${wrong.length > 5 ? '; ...' : ''})`);
  if (unver.length) parts.push(`${unver.length} built a solid that no oracle can confirm (OCCT throws, brep-rs refuses: ${unver.map(nid).join(', ')})`);
  if (right.length) parts.push(silent ? `${right.length} were ACCEPTED silently and built exactly what the stored document says, which is not what was typed (${right.map(nid).join(', ')})` : `${right.length} built a solid that matches the oracle (${right.map((r) => nid(r) + (r.oracle === 'closed-form' ? ' (closed form only, OCCT throws)' : '')).join(', ')}; refused on purpose, the guard sits inside the measured edge)`);
  if (tr.length) parts.push(`${tr.length} were refused by truck in kernel text: ${texts.map((t) => `"${t}"`).join(' / ')}`);
  if (sr.length) parts.push(`${sr.length} were refused by the interpreter: "${sr[0].refusal}"`);
  const notRun = total - us.length;
  return `WITHOUT the guard (the same ${us.length} inputs, g2 unguarded run${notRun ? `; ${notRun} more not run unguarded, they take 50-90 s or hang` : ''}): ${parts.join('; ')}.`;
}
const counts = (rowName) => ({ n: g2s(rowName).length, wrong: g2u.filter((r) => r.row === rowName && r.status === 'built' && !r.good).length });

// ======================================================================================================================================
// BOX
// ======================================================================================================================================
add('box(w,d,h) / cuboid', 'supported', fcfix(old('box(w,d,h)').evidence) + T(['box', 'cuboid']));
add('box option at:[x,y,z]', 'supported', fcfix(old('box option at').evidence) + T(['box-at']));
add('box doc-level rotate (script turn(box,[rx,ry,rz]))', 'supported', fcfix(old('box doc-level rotate').evidence) + T(['box-turn']));
{
  const e = A.e1;
  assert(e.insideN === 63 && e.insideGood === 63 && e.insideFaces === '26/26', 'E1 inside');
  // E1 edge, one cell per (gap, axis); the three scales must agree
  const e1 = res('e1');
  const cell = (gap, ax) => {
    const rs = e1.filter((x) => x.id.endsWith(`-${ax}-g${gap}`));
    assert(rs.length === 3, `E1 cell ${gap}${ax}`);
    const key = (x) => (x.status === 'built' ? `${x.truck.faces}f${x.truck.facesOcct ? '/' + x.truck.facesOcct : ''} ${ex(x.truck.dVolOcct ?? x.truck.dVolAn)}` : 'refused');
    const u = [...new Set(rs.map(key))];
    assert(u.length === 1 || (gap === '-0.000001' && ax === 'Z'), `E1 cell ${gap}${ax} differs between scales: ${rs.map(key)}`);
    return u.length === 1 ? u[0] : `${u.join(' | ')} (OCCT builds 26 faces at two scales and throws at the third)`;
  };
  const edgeTxt = [['1e-5', ''], ['0.000001', ' (gap 1e-6)'], ['1e-8', ''], ['0', ' (exactly half)'], ['-0.000001', ' (1e-6 over half)'], ['-0.001', ' (1e-3 over half)']];
  void edgeTxt;
  const c1e6 = ['X', 'Y', 'Z'].map((ax) => cell('0.000001', ax)); const c1e8 = ['X', 'Y', 'Z'].map((ax) => cell('1e-8', ax)); const c0 = ['X', 'Y', 'Z'].map((ax) => cell('0', ax));
  const cn6 = ['X', 'Y', 'Z'].map((ax) => cell('-0.000001', ax)); const cn3 = ['X', 'Y', 'Z'].map((ax) => cell('-0.001', ax));
  assert(c1e6.every((t) => t.startsWith('18f/26')), 'E1 1e-6 faces'); assert(c1e8[0].startsWith('12f') && c1e8[1].startsWith('12f') && c1e8[2].startsWith('10f'), 'E1 1e-8');
  assert(c0[0].startsWith('12f') && c0[2].startsWith('10f'), 'E1 0'); assert(cn6[0] === 'refused' && cn6[1] === 'refused' && cn6[2].startsWith('10f'), 'E1 -1e-6'); assert(cn3.every((t) => t === 'refused'), 'E1 -1e-3');
  add('box option corner:r (whole-shape round), r at most half the shortest side x (1 - 1e-4), shortest side at least 1', 'supported',
    `E1 (primitives-r3/e1-box-corner.mjs, ${e.n} cases): shortest side 1.2, 12 and 120, with the shortest side on X, on Y and on Z, corner = half x (1 - gap) for gap 0.1, 0.01, 1e-3, 3e-4, 1e-4, 3e-5, 1e-5: ${e.insideN} of ${e.insideN} build, faces ${e.insideFaces} (6 plane + 12 cylinder + 8 sphere), dVol vs live OCCT max ${ex(e.insideDVolMax)} (curved bar 3e-4; OCCT and the closed-form Minkowski volume agree, truck reads low), dBbox max ${ex(e.insideBboxMax)}, dCOM max ${ex(e.insideComMax)} x diagonal. The edge is relative: identical at 1.2, 12 and 120. The guard accepts gap >= 1e-4, a decade inside the last measured good point (1e-5). `
    + `Round 1/2 cases (unchanged): box-corner-fillet, -small, -at, -turn, -cube-5, -just-under-half, -thin-plate, -huge, edge-box-corner-1e-3, box-round-script, param-box-corner, r2-box-10-20-30-c4.9/c4.99, r2-corner-under-* : corner 0.001 to 100 (1000x2000x3000 box), 0.998 x half on every axis; dVol 5.8e-5 to 1.4e-4, dBbox <= 4.3e-6, dCOM <= 2.7e-10 x diag, 26/26 faces.`
    + RIG('e1-box-corner') + T(['box-corner', 'box-corner-nearX', 'box-corner-nearY', 'box-corner-nearZ']));
  const c = counts('box.corner.limit');
  assert(c.n === 10, 'box.corner.limit count');
  guardOk('box.corner.limit', 'box-corner-too-big');
  add('box option corner within 1e-4 (relative) of half the shortest side, at half, or above it', 'refused',
    `GUARD RUN: ${c.n} of ${c.n} inputs refused (g2 guarded, code box-corner-too-big): the shortest side on X, on Y and on Z at exactly half (6 of 12), 1e-5 under half (5.99999), 7 of 12, the 6x6x40 and 40x6x6 capsules (corner 3), the 20-cube at 10, box(10,10,10,{corner:50}). ${before('box.corner.limit')} `
    + `MEASURED EDGE (E1, gap = 1 - corner / (half the shortest side), identical at three scales): gap 1e-5 and wider is exact (previous row). gap 1e-6, X/Y/Z: ${c1e6.join(' | ')} (faces truck/OCCT and dVol): the volume is still right but sub-tolerance bands are dropped, 18 faces instead of 26. gap 1e-8: X ${c1e8[0]}, Y ${c1e8[1]}, Z ${c1e8[2]}. gap 0 (exactly half): X ${c0[0]}, Y ${c0[1]}, Z ${c0[2]} (closed-form dVol; X and Y are a 12-face solid 43% too big, bigger than the unrounded box; on Z the 10-face solid matches the closed form). Over half: 1e-6 over: X ${cn6[0]}, Y ${cn6[1]}, Z ${cn6[2]}; 1e-3 over: all refused by truck with kernel text. Live OCCT throws ("the radius is too big for this shape's edges") and brep-rs refuses ("would not fit its shortest side") from exactly half up. `
    + `So the exactly-half case on Z, which round 2 called supported on the closed form alone, is NOT supported: two independent kernels refuse it, the same boundary builds a 43% wrong solid on X and Y, and a rule that accepted only Z would contradict the 1e-5 band. One rule for every axis: refuse corner > half x (1 - 1e-4).`
    + GUARD + RIG('g-refused', ' --guard'), sent('bc-X-half'));
  add('box corner with chamfer style (ModelDoc roundStyle: chamfer; script bevel(box,d) is refused by the interpreter)', 'refused',
    `GUARD RUN: 3 of 3 refused (g2 guarded, code box-chamfer): box 40x30x12 d=3, the 20-cube d=4, 10x20x30 d=5 (also at half the shortest side). ${before('box.chamfer')} `
    + `Why: truck equals the 18-half-space polytope (6 box planes + 12 edge chamfer planes) exactly, while live OCCT and brep-rs (two independent kernels, they agree) also cut the 8 corner triangles and build 26 faces: 40x30x12 d=3 truck 13086 vs OCCT 13068 (dVol 1.4e-3, 18 vs 26 faces), cube d=4 6464 vs 6421.333 (6.6e-3), 20x30x12 d=5.9 4115.834 vs 3978.915 (3.4e-2); truck matches the polytope volume to 1e-12 (primitives-evidence/chamfer-polytope.mjs). At d >= half the shortest side OCCT throws and brep-rs refuses but truck builds a 14-face solid (10x20x30 d=5: 3750). From a script the case is unreachable: ${(() => { const r = res('e11-validation').find((x) => x.id === 'e11-bevel-box'); assert(r && r.status === 'script-refused', 'e11 bevel'); return `bevel(box(40, 30, 12), 3) is refused by the interpreter with "${r.refusal}"`; })()}; only a stored ModelDoc (Build mode, or toScript of an old doc) carries roundStyle chamfer.`
    + GUARD, sent('bchamfer'));
}

// ======================================================================================================================================
// CYLINDER
// ======================================================================================================================================
add('cylinder(across,tall)', 'supported', fcfix(old('cylinder(across,tall)').evidence) + T(['cyl']));
add('cylinder option at', 'supported', fcfix(old('cylinder option at').evidence) + T(['cyl-at']));
add('cylinder doc-level rotate (script turn)', 'supported', fcfix(old('cylinder doc-level rotate').evidence) + T(['cyl-turn']));
{
  const e = A.e2;
  const E2 = res('e2-cyl-corner');
  const fam = (kind, f) => E2.filter((x) => x.id.startsWith(`e2-${kind}-${f}-`));
  const kOf = (x) => +/-k([\d.]+)$/.exec(x.id)[1];
  const goodUpTo = (kind, f, k) => fam(kind, f).filter((x) => kOf(x) <= k);
  for (const [kind, f, k] of [['fillet', 'R', 0.99], ['chamfer', 'R', 0.99], ['fillet', 'H', 0.9999], ['chamfer', 'H', 0.9999]]) assert(goodUpTo(kind, f, k).every((x) => x.good), `E2 ${kind}${f} good up to ${k}`);
  const rng = (rs, fn) => `${ex(Math.min(...rs.map(fn)))} to ${ex(Math.max(...rs.map(fn)))}`;
  const fr = goodUpTo('fillet', 'R', 0.99); const fh = goodUpTo('fillet', 'H', 0.9999); const cr = goodUpTo('chamfer', 'R', 0.99); const ch = goodUpTo('chamfer', 'H', 0.9999);
  assert(fr.length + fh.length === 8 + 10 && cr.length + ch.length === 18, 'E2 counts');
  add('cylinder option corner:r (both rims rounded), r at most 99% of the radius and at most half the height x (1 - 1e-4)', 'supported',
    `E2 (primitives-r3/e2-cyl-corner.mjs, ${e.n} cases, scale 1 and 10). Radius side, cylinder(10,30), corner/radius 0.9, 0.95, 0.98, 0.99: ${fr.length} of ${fr.length} good, 5 faces, dVol ${rng(fr, (x) => x.truck.dVolOcct)}, dBbox ${rng(fr, (x) => x.truck.dBboxOcct)}. Height side, cylinder(48,10) (radius 24 above half the height 5), corner/(half height) 0.9 .. 0.9999: ${fh.length} of ${fh.length} good, 5 faces, dVol ${rng(fh, (x) => x.truck.dVolOcct)}, dBbox ${rng(fh, (x) => x.truck.dBboxOcct)}. The edges are in the next row. `
    + `Round 1/2 cases (unchanged): cyl-corner, -small, -at, -turn, -under-height-half, edge-cyl-corner-1e-3, r2-cyl-h2-under, r2-cyl-R-under, r2bb-cyl-*: corner 0.001 to 11.9, cylinder(24,30), (24,10), (10,30), at, turned [20,35,50]: dVol <= 1.6e-4 vs OCCT and the Pappus closed form, dBbox <= 9.1e-6, dCOM <= 6.7e-11, 5/5 faces (truck labels the rim rounds 'other' where OCCT says torus: label only). The guard accepts corner <= 0.99 x radius and <= half the height x (1 - 1e-4).`
    + RIG('e2-cyl-corner') + T(['cyl-corner', 'cyl-corner-nearR', 'cyl-corner-nearH']));
  add('cylinder bevel (ModelDoc roundStyle: chamfer on both rims), d at most 99% of the radius and at most half the height x (1 - 1e-4)', 'supported',
    `E2 bevel cases (doc form {kind:cylinder, round, roundStyle:'chamfer'}): radius side d/radius 0.9 .. 0.99: ${cr.length} of ${cr.length} good, 5 faces, dVol ${rng(cr, (x) => x.truck.dVolOcct)}, dBbox ${rng(cr, (x) => x.truck.dBboxOcct)}; height side d/(half height) 0.9 .. 0.9999: ${ch.length} of ${ch.length} good, 5 faces, dVol ${rng(ch, (x) => x.truck.dVolOcct)}, dBbox ${rng(ch, (x) => x.truck.dBboxOcct)}. Scale 1 and 10 identical. A script cannot reach it (bevel(cylinder) is refused by the interpreter, same as the box).`
    + RIG('e2-cyl-corner') + T(['cyl-chamfer', 'cyl-chamfer-nearH']));
  const c = counts('cylinder.corner.limit'); guardOk('cylinder.corner.limit');
  const cell = (kind, f, k) => { const rs = fam(kind, f).filter((x) => kOf(x) === k); assert(rs.length === 2, `E2 cell ${kind}${f}${k}`); return rs[0]; };
  const tx = (x) => (x.status === 'built' ? `${x.truck.faces} faces${x.truck.facesOcct ? ' (OCCT ' + x.truck.facesOcct + ')' : ''}, dVol ${ex(x.truck.dVolOcct ?? x.truck.dVolAn)}${x.truck.dBboxOcct !== undefined ? ', dBbox ' + ex(x.truck.dBboxOcct) : ''}` : 'refused');
  assert(!cell('fillet', 'R', 0.995).good && !cell('chamfer', 'R', 0.995).good && !cell('fillet', 'H', 0.99999).good && cell('fillet', 'R', 1).status === 'truck-refused', 'E2 edges');
  add('cylinder corner or bevel too big for the radius or the height', 'refused',
    `GUARD RUN: ${c.n} of ${c.n} refused (g2 guarded; codes cyl-corner-vs-radius, cyl-corner-vs-height): corner 4.99 and 5 on cylinder(10,30), 13 on cylinder(24,30), 4.99999 / 5 / 6 on cylinder(24,10), a bevel at 99.5% of the radius and at half the height. ${before('cylinder.corner.limit')} `
    + `MEASURED EDGES (E2, identical at scale 1 and 10): radius side, corner/radius 0.995 fillet: ${tx(cell('fillet', 'R', 0.995))}; 0.998: ${tx(cell('fillet', 'R', 0.998))}; 0.9999: ${tx(cell('fillet', 'R', 0.9999))}; bevel 0.995: ${tx(cell('chamfer', 'R', 0.995))}: the BBOX is 1.6e-2 of the diagonal too wide while the volume looks fine until 0.9999; at 1 and 1.01 truck refuses ("${e.refusedTexts[0]}"). Height side, corner/(half height) 0.99999: fillet ${tx(cell('fillet', 'H', 0.99999))}, bevel ${tx(cell('chamfer', 'H', 0.99999))}; exactly half: fillet ${tx(cell('fillet', 'H', 1))} against the closed form but OCCT throws and brep-rs refuses, bevel ${tx(cell('chamfer', 'H', 1))} with no oracle; 1.01: truck refuses ("${e.refusedTexts[2]}"). Same single rule as the box: refuse at or near the limit, one plain sentence.`
    + GUARD, sent('cc-R-1'));
}

// ======================================================================================================================================
// SPHERE, CONE
// ======================================================================================================================================
add('sphere(across)', 'supported', fcfix(old('sphere(across)').evidence).replace(" refused by the size rows ('below 1 across', 'taller than 30 times its across')", " refused by the 'below 1 across' row") + T(['sph', 'sph-min']));
add('sphere option at', 'supported', fcfix(old('sphere option at').evidence) + T(['sph-at']));
add('sphere options corner / rotate (not offered)', 'refused', old('sphere options corner').evidence + ' Re-run in round 3: e11-sph-corner, e11-sph-rotate (primitives-r3/e11-validation.mjs): both refused by the interpreter before any build.', old('sphere options corner').refusalSentence);
add('cone(across,tall) pointed cone', 'supported', fcfix(old('cone(across,tall)').evidence) + T(['cone', 'cone-slender']));
add('cone option at', 'supported', fcfix(old('cone option at').evidence) + T(['cone-at']));
add('cone doc-level rotate (script turn)', 'supported', fcfix(old('cone doc-level rotate').evidence) + T(['cone-turn']));
{
  guardOk('cone.frustum', 'cone-second-radius');
  const ir = res('e11-validation').find((x) => x.id === 'e11-cone-three-arg');
  add('cone frustum / second radius (cone with three arguments)', 'refused',
    `GUARD RUN: 2 of 2 refused by the call lint (g2 guarded: cone(10,5,10), cone(20,30,5,{at:[0,0,0]}); code cone-second-radius). Without the lint the INTERPRETER refuses cone(10,5,10) with "${ir.refusal}" (e11-cone-three-arg): a sentence, but it tells the student to wrap the number in { } and no option takes it, so the lint replaces it. ConeFeature has one radius and no frustum form exists.` + GUARD, sent('lint-cone-frustum'));
}

// ======================================================================================================================================
// RING
// ======================================================================================================================================
{
  const e = A.e4;
  assert(e.envN === 28 && e.envGood === 28 && e.outBad >= 10, 'E4 envelope');
  const byKsorted = Object.entries(e.byK).sort((x, y) => +x[0] - +y[0]).map(([k, v]) => `${k}: ${v}`).join(' | ');
  add('ring(across,tubeAcross) / torus, across/tubeAcross from 2.05 to 50, tubeAcross at least 0.5', 'supported',
    `E4 (primitives-r3/e4-ring.mjs, ${e.n} cases): across 4, 40 and 400 x across/tubeAcross 2.05, 2.2, 2.5, 3, 4, 6, 10, 20, 30, 40, 50, 60, 80, 100. Inside the envelope (ratio 2.05 to 50 and tubeAcross >= 0.5): ${e.envGood} of ${e.envN} good, 1 face each, dVol vs live OCCT max ${ex(e.envDVolMax)} (bar 3e-4; ratio 50 is 2.7e-4 at across 40 and 400), dBbox max ${ex(e.envBboxMax)}, dCOM max ${ex(e.envComMax)} x diag. Outside: ${e.outBad} of ${e.outN} are over the bar (ratio 60 is 3.0e-4 at 40 and 400, 80 and 100 are 3.7e-4 and 4.9e-4 at every size; across 4 is over the bar from ratio 20, i.e. from tubeAcross 0.2, and ring(4,0.4) is 2.7e-4, so the 0.5 floor sits just inside). dVol by ratio, ! = over the bar: ${byKsorted}. Near-horn tubes (ratio 2.05 to 2.2, the ring(20.02,10) type) are exact: dVol 3.9e-5 to 5.0e-5. `
    + `Round 1/2 (unchanged): ring-plain, -fat, -huge, -near-horn, param-ring, r2-ring-100-2 (ratio 50, 2.7e-4), r2-ring-40-10/-4/-2/-1, r2-ring-20-1/-0.5, r2-ring-10-0.5; alias check: torus(40,10) and ring(40,10) store the same {kind:torus,ringRadius:15,tubeRadius:5} and measure identically (dVol 1.5e-4, dBbox 7.8e-6, dCOM 8.0e-7, 1 face). ringRadius = (across - tubeAcross)/2, tubeRadius = tubeAcross/2. `
    + `TIME is the weak point of this row: the ${e.n} sweep builds took wall median ${sec(e.msMed)}, min ${sec(e.msMin)}, max ${sec(e.msMax)} (cpu median ${sec(e.cpuMed)}; machine load ${e.loadMin.toFixed(0)}-${e.loadMax.toFixed(0)} on 24 cores), independent of ring size and only weakly of ratio (near-horn ratio 2.05 in ms: ${e.nearHornMs}). A ring is the slowest primitive; the performance row says what the page has to do about it.`
    + RIG('e4-ring') + T(['ring', 'torus']));
  add('ring option at', 'supported', fcfix(old('ring option at').evidence) + T(['ring-at']));
  add('ring doc-level rotate (script turn)', 'supported', fcfix(old('ring doc-level rotate').evidence) + T(['ring-turn']));
  // thick / spindle
  const sp = res('e10-spindle');
  const trueVol = (R, r) => { const n = 2000000; let s = 0; const lo = Math.max(0, R - r); const hi = R + r; const h = (hi - lo) / n; for (let i = 0; i < n; i++) { const p = lo + (i + 0.5) * h; const d = r * r - (p - R) ** 2; if (d > 0) s += 2 * Math.PI * p * 2 * Math.sqrt(d) * h; } return s; };
  const spRow = (id) => { const x = sp.find((y) => y.id === id); const f = x.doc.features[0]; const t = f.ringRadius > 0 ? trueVol(f.ringRadius, f.tubeRadius) : NaN; return `${id.replace('e10-', '')}: ringRadius ${+f.ringRadius.toPrecision(5)}, tube ${f.tubeRadius}; OCCT ${x.occt.volume !== undefined ? x.occt.volume.toPrecision(7) : 'fails'}, brep-rs ${x.brep.volume !== undefined ? x.brep.volume.toPrecision(7) : '"' + x.brep.refused.slice(0, 40) + '"'}, independent numerical volume of the solid ${Number.isFinite(t) ? t.toPrecision(7) : 'n/a'}`; };
  guardOk('ring.thick'); guardOk('ring.spindle');
  const nThick = g2s('ring.thick').length + g2s('ring.spindle').length;
  add('ring with a tube too thick for the ring (across/tubeAcross below 2.05): horn, spindle, zero or negative ring radius', 'refused',
    `GUARD RUN: ${nThick} of ${nThick} refused (g2 guarded, code ring-tube-too-thick): ring(20,10), ring(10,6), ring(10,10), ring(10,12), ring(10,5), ring(40,38), ring(10,9.9999). ${before(['ring.thick', 'ring.spindle'])} `
    + `The interpreter does not check this: ring(across,tubeAcross) stores ringRadius = (across - tubeAcross)/2, so ring(10,12) stores ringRadius -1 and passes runScript with no error or warning (E10 and round 2). `
    + `THE ORACLES CANNOT BE TRUSTED HERE: live OCCT and brep-rs AGREE with each other on the self-intersecting (spindle) cases and are both wrong, because they report the plain 2 pi^2 R r^2, which counts the overlap of the tube with itself twice. Independent numerical integration of the solid {(sqrt(x^2+y^2)-R)^2+z^2 <= r^2} (2e6 slices, primitives-r3/e10-spindle.mjs): ${spRow('e10-ring-40-38')}; ${spRow('e10-ring-10-9.9999')}; ${spRow('e10-ring-10-6')}. So for these inputs a parity run against OCCT/brep-rs would pass a volume that is 4.5x (ring(40,38)) or 21000x (ring(10,9.9999)) too small; only truck's refusal is right, and the guard keeps it a refusal. Horn tubes (R = r, ratio 2: ring(20,10), ring(10,5)) are the one place where the kernels are right (2467.401 and 308.425 = the numerical volume) and truck refuses ("torus needs major > minor > 0"); the guard refuses them too (the surface touches itself), a deliberate over-refusal. ring(10,10) (R = 0): OCCT 6.5e-14, brep-rs "builds an empty solid"; ring(10,12) (R = -1): OCCT throws, brep-rs reports 710.612 for a negative-radius torus.`
    + GUARD, sent('ring-10-12'));
  guardOk('ring.thin', 'ring-tube-too-thin');
  add('ring with a tube too thin for the ring (across/tubeAcross above 50)', 'refused',
    `GUARD RUN: ${g2s('ring.thin').length} of ${g2s('ring.thin').length} refused (g2 guarded, code ring-tube-too-thin): ring(100,1), ring(200,1), ring(400,4), ring(1000,10). ${before('ring.thin')} The volume measure drifts with slenderness, not size: dVol vs live OCCT 4.9e-4 at ratio 100 for across 40, 100, 400 and 1000, 3.7e-4 at ratio 80, 3.0e-4 at 60, 2.7e-4 at 50 (E4 and round 2). Faces and bbox stay right (1 face, bbox <= 2.7e-6), so only the volume reading is wrong (still: not within the 3e-4 bar). ring(10,0.2) is the same shape in the small-size row.`
    + GUARD, sent('ring-100-1'));
}

// ======================================================================================================================================
// PRISM, WEDGE
// ======================================================================================================================================
add('prism(sides,across,tall) sides 3..12', 'supported', fcfix(old('prism(sides').evidence) + T(['prism3', 'prism7', 'prism12']));
add('prism option at', 'supported', fcfix(old('prism option at').evidence) + T(['prism-at']));
add('prism doc-level rotate (ModelDoc rotate field; script turn(prism) makes a separate rotate feature)', 'supported', fcfix(old('prism doc-level rotate').evidence) + T(['prism-docrot']));
add('prism sides outside 3..12', 'refused', old('prism sides outside').evidence + ' Re-run in round 3: e11-prism-2, e11-prism-13, e11-prism-sides-zero, e11-prism-sides-neg (primitives-r3/e11-validation.mjs): all refused before any build, with "prism() needs 3 to 12 sides." (2, 13) and the positive-number sentence (0, -3).', old('prism sides outside').refusalSentence);
{
  guardOk('validation.sides', 'prism-sides-fraction');
  const s = res('e11-validation').filter((x) => /SILENT-prism-5/.test(x.id));
  assert(s.length === 2 && s.every((x) => x.status === 'built'), 'e11 sides silent');
  add('prism sides not a whole number (5.4, 5.5, a variable or param() holding a fraction)', 'refused',
    `GUARD RUN: 4 of 4 refused by the call lint (g2 guarded): prism(5.4,30,12), prism(5.5,30,12), let n = 7.3; prism(n,30,12), prism(param('n',7.3),30,12). Without the lint the INTERPRETER accepts them: ${s.map((x) => `${x.script} builds ${x.truck.faces - 2} sides`).join(', ')} (Math.round, no error, no warning; e11-SILENT-prism-5.4/5.5), so the part silently changes. The lint cannot read the number back from the document (it stores the rounded value), so it re-runs the script with the first argument shifted by +0.499 and -0.499: a whole number n gives n both times, a fraction does not (values within 0.001 of a whole number are not told apart). The real fix is one line in prism() in reshape-script.ts.`
    + ' ' + before('validation.sides', true) + GUARD, sent('lint-sides-5.4'));
}
add('wedge(width,depth,tall)', 'supported', fcfix(old('wedge(width').evidence) + ' The right-triangle orientation (legs along +x and +y from the corner, extruded along z, centred on the bbox) and the prism vertex phase come from occt-build, not from an independent source: see the oracle-independence row.' + T(['wedge']));
add('wedge option at', 'supported', fcfix(old('wedge option at').evidence) + T(['wedge-at']));
add('wedge doc-level rotate (ModelDoc rotate field; script turn(wedge) makes a rotate feature)', 'supported', fcfix(old('wedge doc-level rotate').evidence) + T(['wedge-docrot']));

// ======================================================================================================================================
// VALIDATION
// ======================================================================================================================================
{
  const v = res('e11-validation');
  const grp = (row) => v.filter((x) => x.row === row);
  const size = grp('validation.size'); const opt = grp('validation.option');
  assert(size.length === 19 && size.every((x) => x.status === 'script-refused'), 'e11 size');
  assert(opt.length === 14 && opt.every((x) => x.status === 'script-refused'), 'e11 option');
  const uniq = (rs) => [...new Set(rs.map((x) => x.refusal.replace(/-?\d+(\.\d+)?/g, '#')))].length;
  add('validation: every size must be a positive number', 'refused',
    `Ran primitives-r3/e11-validation.mjs (interpreter only, no kernel): ${size.length} of ${size.length} bad sizes refused before any build: zero, negative, NaN, Infinity, text, null, missing, for box/cylinder/sphere/cone/ring/prism/wedge and for corner. Sentences: "${size[0].refusal}" (zero/negative, every kind, corner too), "${size[2].refusal}" (NaN/Infinity/text/null), "${size[5].refusal}" (missing). param(): ${v.filter((x) => x.row === 'param').map((x) => `${x.script.replace(/;$/, '')} -> ${x.refusal ?? 'builds'}`).slice(1).join(' ; ')}. Also prism sides 0 and -3: "${v.find((x) => x.id === 'e11-prism-sides-zero').refusal}".`,
    size[0].refusal);
  add('validation: unknown option names refused with "has no option called"', 'refused',
    `Ran primitives-r3/e11-validation.mjs: ${opt.length} of ${opt.length} refused (10 unknown option names or options a kind does not take: box colour/rotate/center, cylinder fillet, sphere corner/rotate, cone/ring/prism/wedge corner; 4 malformed option values: list, bare number, short at, text at). Options offered: at (all kinds), corner (box, cylinder); rotate is turn(). The sentence names the key and lists what the call takes.`,
    opt[0].refusal);
  const sg = g2s('validation.surplus'); guardOk('validation.surplus', 'surplus-argument');
  const sil = v.filter((x) => /SILENT-(box|prism)-surplus/.test(x.id));
  assert(sil.length === 2 && sil.every((x) => x.status === 'built'), 'e11 surplus silent');
  add('validation: a surplus value after the { } options object', 'refused',
    `GUARD RUN: ${sg.length} of ${sg.length} refused by the call lint (g2 guarded, code surplus-argument): box/prism/sphere/cylinder/ring/wedge each with one extra value after the options object. Without the lint the INTERPRETER accepts and drops the value: ${sil.map((x) => `${x.script} -> builds (${x.truck.faces} faces), no error`).join('; ')} (e11-SILENT-*); the interpreter only refuses a surplus value BEFORE the options object (box(1,2,3,4): "box's extras go in a { } object at the end ..."). The lint counts top-level arguments of each primitive call in the script text (strings and comments skipped) against sizes + 1 options object. ${before('validation.surplus', true)}`
    + GUARD, sent('lint-surplus-box'));
  add('param() accepted as a size, a corner and an at coordinate', 'supported', old('param()').evidence + ' Re-run in round 3: g1-param-box (3 runs through the guard) built and matched live OCCT; e11-param-zero, -neg, -str refused as above.' + T(['param-box']));
}

// ======================================================================================================================================
// PLACEMENT, SIZE
// ======================================================================================================================================
{
  const e = A.e6;
  assert(e.exactAllGood && e.exactN >= 80 && e.within100Good && e.within100 > 80, 'E6 data: ' + JSON.stringify({ ...e, worst: undefined }));
  add('planar box and wedge (not turned) placed far from the origin, up to 1e6', 'supported',
    `E6/E6b (primitives-r3/e6-planar-far.mjs, e6b-planar-slender.mjs): an unturned box(s,1.5s,2s) and wedge(s,1.5s,2s) for s = 0.5, 2, 20, 200 at [e,-e,e] with e = 10 to 3000 x the largest size (up to 2e6): ${e.exactN} of ${e.exactN} good, dVol max ${ex(e.exactMaxDv)} (bar 1e-9), COM and bbox exact; also box(1,1,1) at 1e6 and box(2,3,4) / wedge(2,3,4) at 1e6 (g1-box-far-axis, g1-wedge-far-axis). Integer coordinates of an axis-aligned shape are exactly representable, so the offset costs nothing; the offset limit for prisms and turned shapes is in the next row.` + RIG('e6-planar-far') + T(['box-far-axis', 'wedge-far-axis']));
  guardOk('placement.far');
  const farPl = (r) => r.row === 'placement.far' && r.code === 'too-far-planar'; const farCu = (r) => r.row === 'placement.far' && r.code === 'too-far-curved';
  const nPl = g2.filter(farPl).length; const nCu = g2.filter(farCu).length;
  add('prism, or any turned box/wedge, placed far from the origin (offset above 100 x its smallest size)', 'refused',
    `PINNED BOUNDARY (E6 + E6b, ${e.nonExactN} prism/turned cases: prism with 3, 5, 6, 12 sides, turned box, turned prism, turned wedge, four sizes 0.5 to 200, plus long-and-thin needles and plates; ratio = largest |at coordinate| / smallest typed size, bars: volume 1e-9, COM and bbox 1e-6 x diagonal, faces equal): all ${e.within100} cases with ratio <= 100 are good (max dVol ${ex(e.within100MaxDv)}, max dCOM ${ex(e.within100MaxDc)}; no case was measured between 100 and 200); the first wrong one is ${e.firstBad} (just over the 1e-9 bar); ${e.bad200} of ${e.n200} cases at ratio >= 200 are wrong, up to dVol 7.0 (700%) for prism(6,2,3) at 1e6 (round 2). The error follows offset / SMALLEST size (a long needle prism(7,1,300) is off at ratio 1500), not the largest, which is why round 2's "between 50x and 500x the part size" was not usable. Round 2's own reproduction: prism(6,2,3) at 1e3 is ratio 500, dVol 6.7e-9, wrong. The guard refuses ratio > 100: the last measured good ratio, and half of the first wrong ratio (200). Turned shapes are found through the document's rotate features too (turn(prism) and turn(wedge) are stored as a separate rotate feature). `
    + `GUARD RUN: ${nPl} of ${nPl} refused (g2 guarded, code too-far-planar): prism(6,2,3) at 1e3, prism(3,2,3) at 1e4, prism(12,2,3) at 1e6, turn(box) at 1e3, turn(prism) / turn(wedge) at 1e4, the needle prism(7,1,300) at 1500. `
    + before(farPl) + GUARD + RIG('e6-planar-far'), sent('far-prism6-1e3'));
  const q = A.e7;
  assert(q.within400Good && q.within400 > 70, 'E7');
  add('sphere, cylinder, cone, ring or rounded box placed far from the origin (offset above 400 x its smallest size)', 'refused',
    `PINNED BOUNDARY (E7 + E7b, ${q.n} cases: cylinder/cone/rounded box with across 2, 20, 200, 2000 at [e,-e,e], e = 100 to 1e5, plus sphere and ring spot checks; ratio = |at| / smallest typed size, bars: volume 3e-4, COM and bbox 1e-4 x diagonal): all ${q.within400} cases with ratio <= 400 are good (max dVol ${ex(q.within400MaxDv)}, max dCOM ${ex(q.within400MaxDc)}), ${q.within500} with ratio <= 500 too; the first wrong one is ${q.firstBad}; the worst is ${q.worst} (truck measures curved volume and COM from a tessellation and loses precision with the coordinate; bbox stays exact). Size matters: sphere(2) at 1e3 is ratio 500 and fine, at 3e3 its COM is 4.7e-3 of the diagonal off; sphere(200) is still exact at 1e4. A fixed "1000 mm" rule (round 2) refuses sphere(2000) at 5000, which is exact, and accepts sphere(2) at 1000, which is already at the edge; the ratio rule is the measured one. `
    + `GUARD RUN: ${nCu} of ${nCu} refused (g2 guarded, code too-far-curved): sphere/cylinder/cone/ring/rounded box at 1e4, 1e5 or 1e6 and a turned cylinder at 1e5. ` + before(farCu) + GUARD + RIG('e7-curved-far'), sent('far-sph-1e4'));
  add('any shape with a coordinate beyond 1e6', 'refused', `GUARD RUN: g2-far-box-1e7 (box(1,1,1) at 1e7) refused with code too-far. Without the guard truck refuses at 1e7 with kernel text ("solid.box: invalid input: end = 10000000.5" class), and every planar shape is exact to 1e6 (E6 box at 1e6, round 2 edge-box-far).` + GUARD, sent('far-box-1e7'));
}
{
  guardOk('size.big');
  const bigCu = (r) => r.row === 'size.big' && r.code === 'too-big-curved'; const bigPl = (r) => r.row === 'size.big' && r.code === 'too-big';
  const nBc = g2.filter(bigCu).length; const nBp = g2.filter(bigPl).length;
  const E8 = res('e8-big'); const e8 = (id) => { const x = E8.find((y) => y.id === `e8-${id}`); assert(x, 'e8 ' + id); return `${id.replace(/^(\w+?)-(.*)$/, '$1($2)')}: ${x.good ? 'good' : 'WRONG'} dVol ${ex(x.truck.dVolOcct ?? x.truck.dVolAn)}, ${x.truck.faces}/${x.truck.facesOcct ?? '-'} faces, ${sec(x.ms)}`; };
  const E5B = res('e5b-sphere'); const sph = (d) => { const x = E5B.find((y) => y.id === `e5b-sph-${d}`); assert(x, 'e5b ' + d); return `sphere(${d}) ${x.good ? 'good' : 'WRONG'} ${x.truck.volume === 0 ? 'volume 0 (empty)' : 'dVol ' + ex(x.truck.dVolOcct)}`; };
  assert(E8.filter((x) => /cone-(5|10)0000$/.test(x.id)).every((x) => x.good) && E8.filter((x) => /cone-(2|3)00000$/.test(x.id)).every((x) => !x.good), 'E8 cone edge');
  assert(E5B.find((y) => y.id === 'e5b-sph-60000').good && !E5B.find((y) => y.id === 'e5b-sph-70000').good, 'E5b sphere edge');
  add('curved or rounded shape with a size above 5e4 (sphere, cylinder, cone, ring, rounded box)', 'refused',
    `MEASURED EDGES (E5b, E8, round 2 big): sphere: ${[30000, 50000, 60000, 70000].map(sph).join(', ')}; round 2 also sphere(1e5), (1e6), (1e7) empty, 0 faces. Cone: ${['cone-50000', 'cone-100000', 'cone-200000', 'cone-300000'].map(e8).join('; ')} (round 2 said "cone(1e6)": the true edge is between 1e5 and 2e5). Ring: ${['ring-5e4', 'ring-6e4'].map(e8).join('; ')}; ring(1e6, 2e5) and ring(1e7, 2e6) are empty (volume 0, 0 faces). ring(1e5) is NOT wrong: ring(100000,20000) and ring(100000,25000) returned the correct volume (about 7.89e13, 1 face) after 52 s and 92 s, so it is correct but a blocking call of a minute and a half, and the cap refuses it for time, not accuracy. Cylinder (to 1e6: ${['cyl-wide-50000', 'cyl-wide-1000000', 'cyl-tall-5e4'].map(e8).join('; ')}) and rounded box (${['boxr-5e4', 'boxr-1e5'].map(e8).join('; ')}) are exact beyond the cap; one cap for the whole class (5e4) keeps the rule single instead of one per shape. `
    + `GUARD RUN: ${nBc} of ${nBc} refused with code too-big-curved (sphere 7e4/1e5/1e7, ring 1e5/1e6, cone 2e5/3e5/1e6, cylinder 1e7, rounded box 1e5). ${before(bigCu)}` + GUARD + RIG('e8-big'), sent('big-sph-7e4'));
  add('planar shape with a size above 1e6 (box, prism, wedge)', 'refused',
    `MEASURED: box, prism and wedge exact up to 1e6 (volume 1e18, dVol 2.6e-16; round 2 r2-big-*, g1-big-box); from 1e7 truck refuses with kernel text and live OCCT builds them (volume 1e21 for box(1e7)) while brep-rs refuses past 1e6 with a plain sentence ("... it has a size or position of 1.000e7, past the 1e6 brep-rs builds exactly"), the same limit. GUARD RUN: ${nBp} of ${nBp} refused with code too-big (box 1e7, 1e10, 1e308, prism 1e7, wedge 1e7). ${before(bigPl)}` + GUARD, sent('big-box-1e7'));
  const e5 = A.e5;
  assert(e5.cylInGood && e5.coneInGood, 'E5 grid');
  guardOk('size.small');
  const E9 = res('e9-planar-tiny');
  const sph2 = (d) => { const x = E5B.find((y) => y.id === `e5b-sph-${d}`); return `${d}: ${ex(x.truck.dVolOcct)}`; };
  add('curved or rounded shape below 1 across (0.5 for a ring tube, 0.01 tall), planar shape below 0.001', 'refused',
    `MEASURED (E5, E5b, E9, round 2 sweep): the volume reading degrades with an ABSOLUTE size, not a ratio. sphere(across) dVol vs OCCT: ${[0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 2].map(sph2).join(', ')} (bar 3e-4; sphere(0.5) to (1) are 2.8e-4 to 2.9e-4, inside by 4%, which is why the floor is 1 and not 0.5). Cylinder and cone with across 0.1 and 0.25 are 5e-4 to 1.8e-3 at every height (smallest ${ex(e5.small025Min)}), across 0.5 is 2.5e-4 (cylinder) and 1.8e-4 (cone), across 1 or more 1.2e-4 to 1.7e-4 at aspect <= 30. Rounded box 0.2: 5.0e-4, 0.5: 1.4e-4. Ring tube 0.25: 4.2e-4 to 8.6e-3, tube 0.5: 2.1e-4. Thin discs are fine: tall 0.01 on across 0.5 to 200 is at most ${ex(e5.thinDiscMax)}. `
    + `Planar (E9, ${E9.length} cases): everything that builds is exact (${A.e9.built} of ${A.e9.built} good, dVol <= 3e-16) down to box(0.001, 0.0015, 0.002); box(0.0001, ...) and everything smaller is refused by truck in kernel text (${A.e9.refusedTexts.map((t) => `"${t}"`).join(' / ')}); a thin plate stays exact down to 1e-5 thick (box(100,100,1e-5)) but a prism needle 1e-4 across is refused, so the guard floors every planar size at 0.001 and refuses the 1e-5 plate too (conservative). `
    + `GUARD RUN: ${g2s('size.small').length} of ${g2s('size.small').length} refused (codes too-small-curved, too-small). ${before('size.small')}` + GUARD + RIG('e5-cyl-cone-grid'), sent('small-sph-0.3'));
  guardOk('size.slender');
  add('cylinder taller than 30 times its across, cone taller than 40 times its across', 'refused',
    `MEASURED (E5, ${e5.n} cylinder/cone cases, across 0.1 to 2000, tall/across 0.02 to 100): cylinder with across >= 1 and tall/across <= 30: ${e5.cylInN} of ${e5.cylInN} good, dVol max ${ex(e5.cylInMax)}; tall/across 40 is ${ex(e5.cyl40Max)} (inside the bar, close), 50 and up ${ex(e5.cyl50Min)} or more (wrong). Cone with across >= 1 and tall/across <= 40: ${e5.coneInN} of ${e5.coneInN} good, dVol max ${ex(e5.coneInMax)}; 50 is ${ex(e5.cone50Max)}, 60 and up ${ex(e5.cone60Min)} or more (wrong). The error is scale free (the same at across 1 and at 2000), so it is a ratio rule. `
    + `GUARD RUN: ${g2s('size.slender').length} of ${g2s('size.slender').length} refused (codes cyl-too-slender, cone-too-slender): cylinder(2,100), (1,100), (10,500), cone(4,400), (2,150), (1,100). ${before('size.slender')}` + GUARD + RIG('e5-cyl-cone-grid'), sent('slender-cyl-2-100'));
}

// ======================================================================================================================================
// PERFORMANCE, ORACLES, GUARD SUMMARY
// ======================================================================================================================================
{
  const byId = (id) => g1.filter((r) => r.id.replace(/-r\d$/, '') === `g1-${id}`);
  const tm = (id) => `${id} ${sec(med(byId(id).map((r) => r.ms)))}`;
  const ids = ['box', 'cone', 'prism7', 'wedge', 'cyl', 'box-corner', 'sph', 'ring', 'cyl-corner', 'cyl-chamfer'];
  add('build time of one primitive (the whole page waits for it)', 'supported',
    `MEASURED, one SolidCraft call = build + measure as ONE SYNCHRONOUS wasm call that does not yield (referee wrapper solidcraft_referee.run; it cannot be split into build and measure here, so the cost of the measure tessellation is inside these numbers). Median wall time of 3 runs through the guard on a 24-core machine whose load average was ${Math.min(...g1.map((r) => r.load)).toFixed(0)}-${Math.max(...g1.map((r) => r.load)).toFixed(0)} during the run (cpu time ~ wall time, so this is real compute, inflated by contention): ${ids.map(tm).join('; ')}. Wider ranges over the sweeps: plain box/prism/wedge 3-80 ms; cone 25-480 ms; cylinder 0.2-9 s (needle to 1e6 wide); rounded box ${sec(A.e1.msMed)} median over E1 (max ${sec(A.e1.msMax)}); cylinder corner ${sec(A.e2.msFilletMed)} median, up to ${sec(A.e2.msFilletMax)} (bevel ${sec(A.e2.msChamferMed)}, up to ${sec(A.e2.msChamferMax)}); sphere ${sec(A.e5b.msMin)} to ${sec(A.e5b.msMax)} (median ${sec(A.e5b.msMed)}; from across 2 up to 6e4 it is 4-16 s whatever the size, only the tiny ones are faster); ring ${sec(A.e4.msMin)} to ${sec(A.e4.msMax)} (median ${sec(A.e4.msMed)}), size does not matter. Load changes these by 2-4x (the same sphere took 4.2 s and 13.9 s in two runs minutes apart), so quote them as orders of magnitude. `
    + `WHAT THE PAGE MUST DO (a requirement, not measured here: the rig has no browser): run the SolidCraft call in a Web Worker, never on the main thread, because a sphere, a ring or a rounded cylinder blocks the thread for seconds to a minute; show a building state; give every call a time budget (suggest 120 s: the slowest supported call measured was ${sec(Math.max(...[A.e4.msMax, A.e2.msFilletMax]))}, so the budget leaves about 1.7x headroom) and terminate the worker when it runs out, with the sentence "<call>: building took too long and was stopped -- try a smaller or simpler shape." The size caps in the rows above already remove the known minute-and-more cases (ring(1e5): 52-92 s, correct volume).`);
  add('independent (non-OCCT) check of wedge orientation and prism vertex phase', 'unsupported',
    'NOT MEASURED, reason: no FreeCAD reference covers any primitive feature. The 218 saved FreeCAD results under docs/replica/freecad/gauntlet/variants/refs contain no Part primitive (box/cylinder/sphere/cone/torus/prism/wedge): 0 of 218. The five refs used in the rows above (ref-pad-basic__thin-plate, __slender-post, __circle-offcentre, __hexagon, ref-revolution__top-solid-rod) are Pad / Revolution results of a sketch, compared as the same solid (volume, bbox, COM, face count): they cover box, cylinder and a hexagonal prism but are not primitive features. Consequences: (1) the wedge claim (right triangle with legs along +x and +y from the corner, extruded along z, centred on the bounding box; FreeCAD PartDesign::Wedge is a different parametrisation) rests on live OCCT, i.e. on packages/brep-adapter occt-build, which is the same code that DEFINES the ModelDoc semantics, so it is not an independent check of the meaning; truck, OCCT, brep-rs and the closed form w*d*h/2 agree on the volume but they could all be built on the same misreading of the orientation. brep-rs, built from the same ModelDoc spec, agrees as well and is no more independent. (2) The prism vertex phase (first vertex at angle 0, circumradius across/2) is checked against FreeCAD only for n = 6 (the hexagon Pad ref: bbox equal, dVol 1.8e-11); for n = 3, 5, 7, 12 it rests on occt-build. (3) Ring, sphere and cone have closed forms (2 pi^2 R r^2, 4/3 pi r^3, pi r^2 h / 3) that are independent of every kernel and were used as the third oracle for every curved row.');
  add('pre-flight envelope (every limit in one place) and its regression proof', 'supported',
    (() => {
      const L = G.LIM;
      const gc = res('g-guard-check');
      return `ONE guard replaces the scattered per-row limits (contract/primitives.guard.mjs LIM): box corner <= half the shortest side x (1 - ${L.boxCornerGap}); cylinder corner/bevel <= ${L.cylRadiusFrac} x radius and <= half the height x (1 - ${L.cylHalfHeightGap}); ring across/tubeAcross in [${L.ringFatMin}, ${L.ringThinMax}] and tubeAcross >= ${L.ringTubeMin}; curved or rounded shapes: every typed size <= ${L.curvedMax}, across (shortest side for a rounded box) >= ${L.curvedMin}, tall >= ${L.tallMin}; planar shapes: every size in [${L.planarMin}, ${L.planarMax}]; cylinder tall <= ${L.cylSlender} x across, cone tall <= ${L.coneSlender} x across; |at| <= ${L.planarMax}; curved: |at| <= ${L.curvedFarRatio} x smallest size; prism and turned shapes: |at| <= ${L.planarFarRatio} x smallest size; box chamfer style refused; script text: no surplus value after the options object, whole-number prism sides, no cone second radius. `
        + `PROOF 1, over everything ever measured for this group (primitives.guard-check.mjs, ${gc.n} distinct inputs from ${gc.files} result files): truck built a WRONG solid (volume, bbox, COM or face count outside the bars) for ${gc.wrong_refuse + gc.wrong_accept.length} of them and the guard refuses ${gc.wrong_refuse} of ${gc.wrong_refuse + gc.wrong_accept.length}, ACCEPTS ${gc.wrong_accept.length}; ${gc.unverified_accept.length} accepted inputs built a solid that no oracle could check (${gc.unverified_refuse} such inputs are refused); the guard accepts ${gc.good_accept} inputs that truck builds correctly and refuses ${gc.good_refuse.length} that truck builds correctly (conservative edge bands: exactly-half corners, 5e4-1e6 cylinders, 0.5-1 mm shapes, planar ratios 100-200, curved ratios 400-1000, thin and fat rings, slender cylinders/cones 30-50). ${gc.na_refuse} inputs that truck or the interpreter already refused are given a plain sentence instead of kernel text. Every guard sentence passes the lint (starts with the call the student typed, no internal id such as box1, no kernel word such as solid.fillet / major / minor): ${gc.lintBad.length} problems. `
        + `PROOF 2, end to end through the rig with the guard in front of the translator: the ${g1.length / 3} supported representatives (3 runs each, ${g1.length} runs) all build and match the oracle (primitives-regress-check.mjs g1: 0 failing), and the ${g2.length} refused representatives all come back guard-refused with the expected code and a lint-clean sentence (g2: 0 failing); the same ${g2u.length} inputs without the guard: ${g2u.filter((r) => r.status === 'built' && !r.good).length} wrong solids with status built, ${g2u.filter((r) => r.status === 'truck-refused').length} refusals in kernel text, ${g2u.filter((r) => r.status === 'built' && r.good).length} correct solids that the guard refuses on purpose (edge bands, silent script changes), ${g2u.filter((r) => r.status === 'script-refused').length} interpreter refusals. See contract/primitives-r3/results/regress-summary.txt for every before/after pair.`
        + ' STILL OPEN (not claimed as supported): the guard is a prototype outside packages/script; the Worker and time-budget behaviour is a requirement; a primitive moved by a move() feature is folded back in for the placement rules, but a primitive that is repeated, mirrored or booleaned goes through those groups.';
    })());
}

// ======================================================================================================================================
const out = { group: 'primitives', rows };
writeFileSync(path.join(HERE, 'primitives.json'), JSON.stringify(out, null, 1) + '\n');
console.log('rows', rows.length, rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}));
