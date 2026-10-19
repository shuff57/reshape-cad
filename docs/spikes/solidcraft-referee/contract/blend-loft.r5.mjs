// blend-loft ROUND 5 live measurements (critic round 3 fixes). Everything here is MEASURED live on the fe3717f pkg: truck (SolidCraft wasm through the spike
// translator), OCCT (ThruSections ruled, replicad-opencascadejs) and, for downstream features, the picks go through archive/brep-rs resolve exactly like phase0.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/blend-loft.r5.mjs --out=<file.json> [--only=A,B,C,...]
// Sections: A hand-typed polygons (old guard vs new guard vs raw), B cone/face-split ratio sweep (circle<->circle), C face-count artifacts (merged vs kernel faces),
// D downstream features on a blend result, E RAW headline cases (what the unguarded translator builds), F gap round trip, G script-layer sentences, H bbox padding,
// I sliver sweep (gap / size vs the translator's merged face count).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sk, circ, bl, rectPts, regPts, roundedRectDoc, full, occtMeasure, brepMeasure, truckMeasure, rel, G, GR, arc, mt, solveDoc, runScript, toScript, runSC, translateDoc, buildDoc, oc, brep, lcg, frustumVolume, REPO, CONTRACT } from './blend-loft.live-lib.mjs';
const G4 = await import(pathToFileURL(path.join(CONTRACT, 'blend-loft.guard-r4.mjs')).href);
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ONLY = arg('only', 'A,B,C,D,E,F,G,H,I,J,K').split(',');
const OUT = {}; const log = (s) => console.log(s);
const E = (x) => (typeof x === 'number' ? x.toExponential(2) : String(x));
const guardWith = (GM, doc) => { try { const m = GM.guardDoc(solveDoc(doc), { outlineOf: arc.outlineOf }); return [...m.values()][0] ?? null; } catch (e) { return { code: 'THREW', sentence: e.message }; } };
const D = (doc) => ({ version: 1, features: doc });

// truck with the phase0 pick resolver (brep-rs resolve), for downstream features
function truckFull(doc, id) {
  const d = solveDoc(doc);
  const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
  const tr = translateDoc(d, { arc, mt, runSC, resolveAt });
  const mf = tr.features.find((f) => f.id === id);
  if (!mf || mf.status !== 'built') return { refused: mf?.refusal ?? tr.features.find((f) => f.status === 'refused')?.refusal ?? 'not built' };
  const m = mf.measure; return { volume: m.volume, bbox: m.bbox, faces: m.faces, kernelFaces: m.kernelFaces, faceTypes: m.faceTypes };
}
const solvedFromScript = (src) => { const r = runScript(src); return { errors: r.errors.map((e) => e.message), doc: solveDoc({ version: 1, features: r.doc.features }), raw: r }; };

// ---------------------------------------------------------------- A: hand-typed polygons
if (ONLY.includes('A')) {
  OUT.A = { named: [], sweep: [] };
  const rd = (P, dec) => P.map((p) => p.map((v) => +v.toFixed(dec)));
  const named = [
    ['hexagon r10 (8.66) -> hexagon r7 (6.06), the critic case', [[10, 0], [5, 8.66], [-5, 8.66], [-10, 0], [-5, -8.66], [5, -8.66]], [[7, 0], [3.5, 6.06], [-3.5, 6.06], [-7, 0], [-3.5, -6.06], [3.5, -6.06]], 20],
    ['pentagon r10 -> pentagon r6, 2 decimals', rd(regPts(5, 10, 0), 2), rd(regPts(5, 6, 0), 2), 20],
    ['triangle r10 -> triangle r5, 2 decimals', [[10, 0], [-5, 8.66], [-5, -8.66]], [[5, 0], [-2.5, 4.33], [-2.5, -4.33]], 20],
    ['hand-drawn triangle pair (1 decimal)', rd([[0, 0], [30, 0], [10, 20]], 1).map((p) => p), [[2, 2], [22, 2], [9.3, 14.7]], 15],
  ];
  const pair = (label, P, Q, h) => {
    const doc = D([sk('a', 'xy', 0, P), sk('b', 'xy', h, Q), bl('a', 'b')]);
    const r = full(doc); const old = guardWith(G4, doc); const warp = G.pairWarp(solveDoc(doc), arc.outlineOf);
    const row = { label, dVol: r.d, occt: r.occt.volume, truck: r.truck.volume, faces: [r.occt.faces, r.truck.faces], sinDev: warp, guardRound4: old?.code ?? 'PASS', guardRound5: r.guard?.code ?? 'PASS', sentence5: r.guard?.sentence ?? null };
    OUT.A.named.push(row); log(`A ${label.padEnd(54)} sinDev ${E(warp)} dVol ${E(r.d)} faces ${r.occt.faces}/${r.truck.faces} guard r4 ${row.guardRound4} -> r5 ${row.guardRound5}`);
  };
  for (const [l, P, Q, h] of named) pair(l, P, Q, h);
  const circPair = (label, P, rc, h, cf = false) => {
    const doc = D([cf ? circ('a', 0, 0, rc, 'xy', 0) : sk('a', 'xy', 0, P), cf ? sk('b', 'xy', h, P) : circ('b', 0, 0, rc, 'xy', h), bl('a', 'b')]);
    const r = full(doc); const old = guardWith(G4, doc);
    const row = { label, dVol: r.d, occt: r.occt.volume, truck: r.truck.volume, faces: [r.occt.faces, r.truck.faces], guardRound4: old?.code ?? 'PASS', guardRound5: r.guard?.code ?? 'PASS', sentence5: r.guard?.sentence ?? null };
    OUT.A.named.push(row); log(`A ${label.padEnd(54)} dVol ${E(r.d)} faces ${r.occt.faces}/${r.truck.faces} guard r4 ${row.guardRound4} -> r5 ${row.guardRound5}`);
  };
  circPair('typed hexagon r10 (8.66) -> circle(20), gap 25', [[10, 0], [5, 8.66], [-5, 8.66], [-10, 0], [-5, -8.66], [5, -8.66]], 10, 25);
  circPair('typed octagon r10 (7.07) -> circle(20), gap 25', [[10, 0], [7.07, 7.07], [0, 10], [-7.07, 7.07], [-10, 0], [-7.07, -7.07], [0, -10], [7.07, -7.07]], 10, 25);
  circPair('typed octagon r10 (7.07), circle first', [[10, 0], [7.07, 7.07], [0, 10], [-7.07, 7.07], [-10, 0], [-7.07, -7.07], [0, -10], [7.07, -7.07]], 10, 25, true);
  // typed sweep: regular polygon pairs and polygon<->circle, coordinates rounded to 2 or 1 decimals, sizes 3..40 mm
  const R = lcg(20261018); const U = (a, b) => a + (b - a) * R(); const LU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)));
  const tally = {};
  const add = (key, row) => { const t = (tally[key] ??= { n: 0, r4Pass: 0, r5Pass: 0, r5PassMaxD: 0, r5PassWrong: 0, r4RefusedExact: 0, r5RefusedExact: 0, maxRawD: 0, faceMismatch: 0 }); t.n++; if (!row.g4) t.r4Pass++; if (!row.g5) { t.r5Pass++; t.r5PassMaxD = Math.max(t.r5PassMaxD, row.d); if (row.d > row.bar || row.faceMis) t.r5PassWrong++; } else if (row.d <= row.bar && !row.faceMis) t.r5RefusedExact++; if (row.g4 && row.d <= row.bar) t.r4RefusedExact++; t.maxRawD = Math.max(t.maxRawD, row.d); if (row.faceMis) t.faceMismatch++; };
  for (let k = 0; k < 360; k++) {
    const n = [3, 4, 5, 6, 8][k % 5]; const dec = k % 3 === 0 ? 1 : 2; const r1 = LU(3, 40); const small = r1 < 10; const cls = k % 2 === 0 ? 'polygon->polygon' : 'polygon<->circle';
    const P = rd(regPts(n, r1, 0), dec);
    let doc;
    if (cls === 'polygon->polygon') doc = D([sk('a', 'xy', 0, P), sk('b', 'xy', LU(3, 80), rd(regPts(n, r1 * U(0.3, 0.9), 0), dec)), bl('a', 'b')]);
    else { if (n === 3) continue; const rc = r1 * U(0.5, 1.4); const cf = R() < 0.5; const h = LU(Math.max(1, 0.6 * r1), 100); doc = D([cf ? circ('a', 0, 0, rc, 'xy', 0) : sk('a', 'xy', 0, P), cf ? sk('b', 'xy', h, P) : circ('b', 0, 0, rc, 'xy', h), bl('a', 'b')]); }
    const r = full(doc); if (r.d === undefined) continue;
    const g4 = guardWith(G4, doc); const g5 = r.guard; const bar = cls === 'polygon->polygon' ? 3e-4 : 3e-4;
    add(`${cls} dec${dec} ${small ? 'r<10' : 'r>=10'}`, { g4, g5, d: r.d, bar, faceMis: cls === 'polygon->polygon' && r.faceMismatch });
  }
  OUT.A.sweep = tally;
  for (const [k, t] of Object.entries(tally)) log(`A sweep ${k.padEnd(34)} ${JSON.stringify(t)}`);
}

// ---------------------------------------------------------------- B: circle<->circle, cone face split vs top/base ratio
if (ONLY.includes('B')) {
  OUT.B = [];
  for (const [r1, r2, h, lat] of [[20, 10, 30, 0], [20, 5, 30, 0], [20, 3, 30, 0], [20, 2.2, 30, 0], [20, 2.0, 30, 0], [20, 1.9, 30, 0], [20, 1, 30, 0], [20, 0.5, 30, 0], [20, 0.2, 30, 0], [20, 0.05, 30, 0], [20, 0.01, 30, 0], [2, 20, 30, 0], [0.5, 5, 10, 0], [20, 1, 30, 3], [10, 1, 20, 0], [10, 1.1, 20, 0], [10, 0.9, 20, 0]]) {
    const doc = D([circ('a', 0, 0, r1, 'xy', 0), circ('b', lat, 0, r2, 'xy', h), bl('a', 'b')]);
    const r = full(doc); const exact = frustumVolume(r1, r2, h);
    // face-type breakdown: truck from the translator measure, OCCT from topo
    const tf = truckFull(doc, 'bl1');
    const built = buildDoc(oc, solveDoc(doc), arc); const shape = built.shapes.get('bl1');
    const types = {}; try { const { facesOf } = await import(pathToFileURL(path.join(REPO, 'packages/brep-adapter/dist/topo-resolve.js')).href); for (const f of facesOf(oc, shape)) { const t = f.surfaceType ?? f.type ?? f.kind ?? '?'; types[t] = (types[t] ?? 0) + 1; } } catch (e) { types.err = e.message; }
    const row = { r1, r2, h, lateral: lat, ratio: r2 / r1, occtVol: r.occt.volume, truckVol: r.truck.volume, closedForm: exact, dTruckOcct: r.d, dTruckClosed: rel(r.truck.volume, exact), occtFaces: r.occt.faces, truckFacesMerged: r.truck.faces, truckKernelFaces: r.truck.kernelFaces, truckFaceTypes: tf.faceTypes, occtFaceTypes: types, guard: r.guard?.code ?? 'PASS' };
    OUT.B.push(row);
    log(`B r${r1}->r${r2} h${h} lat${lat} ratio ${(r2 / r1).toFixed(3)} dVol ${E(r.d)} dClosed ${E(row.dTruckClosed)} faces OCCT ${r.occt.faces} truck ${r.truck.faces}(kernel ${r.truck.kernelFaces}) truckTypes ${JSON.stringify(tf.faceTypes)} occtTypes ${JSON.stringify(types)} guard ${row.guard}`);
  }
}

// ---------------------------------------------------------------- C: merged vs kernel face counts
if (ONLY.includes('C')) {
  OUT.C = [];
  const one = (label, doc) => {
    const o = occtMeasure(doc); const t = truckFull(doc, 'bl1'); const g = guardWith(G, doc);
    const row = { label, occtFaces: o.faces, truckFacesMerged: t.faces, truckKernelFaces: t.kernelFaces, truckFaceTypes: t.faceTypes, dVol: o.volume && t.volume ? rel(t.volume, o.volume) : null, guard: g?.code ?? 'PASS' };
    OUT.C.push(row); log(`C ${label.padEnd(50)} OCCT ${o.faces} truck merged ${t.faces} kernel ${t.kernelFaces} types ${JSON.stringify(t.faceTypes)} dVol ${E(row.dVol)} guard ${row.guard}`);
  };
  one('rounded square 30 r6 -> circle d20 gap 30', D([roundedRectDoc('a', 'xy', 0, 30, 30, 6), circ('b', 0, 0, 10, 'xy', 30), bl('a', 'b')]));
  one('circle d20 -> rounded square 30 r6 gap 30', D([circ('a', 0, 0, 10, 'xy', 0), roundedRectDoc('b', 'xy', 30, 30, 30, 6), bl('a', 'b')]));
  one('rect 40x30 -> circle d20 gap 40', D([sk('a', 'xy', 0, rectPts(0, 0, 40, 30)), circ('b', 0, 0, 10, 'xy', 40), bl('a', 'b')]));
  one('rect40 + midpoint (5), -> rect20 + midpoint (5) same side', D([sk('a', 'xy', 0, [[-20, -20], [0, -20], [20, -20], [20, 20], [-20, 20]]), sk('b', 'xy', 30, [[-10, -10], [0, -10], [10, -10], [10, 10], [-10, 10]]), bl('a', 'b')]));
  one('plain rect 40 -> rect 20 (control)', D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), sk('b', 'xy', 30, rectPts(0, 0, 20, 20)), bl('a', 'b')]));
  one('regular hexagon r20 -> circle d40 gap 25', D([sk('a', 'xy', 0, regPts(6, 20, 0)), circ('b', 0, 0, 20, 'xy', 25), bl('a', 'b')]));
  one('circle d40 -> circle d20 gap 30 (control)', D([circ('a', 0, 0, 20, 'xy', 0), circ('b', 0, 0, 10, 'xy', 30), bl('a', 'b')]));
}

// ---------------------------------------------------------------- D: downstream features on a blend result
if (ONLY.includes('D')) {
  OUT.D = [];
  const pre = (sa, sb) => `const a = sketch('top'); ${sa} const b = sketch('top'); ${sb} const f = loft(a, b, 30);\n`;
  const FR = pre('a.rect(40, 40);', 'b.rect(20, 20);'); const CC = pre('a.circle(40);', 'b.circle(20);');
  const cases = [
    ['frustum + join cuboid on top', FR + "const c = cuboid(10, 10, 10); move(c, [0, 0, 40]); join(f, c);", 'planar'],
    ['frustum - cut cuboid through (10x10x60)', FR + 'const c = cuboid(10, 10, 60); cut(f, c);', 'planar'],
    ['frustum moved [5,6,7]', FR + 'move(f, [5, 6, 7]);', 'planar'],
    ['frustum mirrored left-right', FR + "mirror(f, 'left-right');", 'planar'],
    ['frustum turned [10,20,30]', FR + 'turn(f, [10, 20, 30]);', 'planar'],
    ['frustum round top-left edge r1', FR + "round(f.edge('top', 'left'), 1);", 'curved'],
    ['frustum bevel top-right edge 1', FR + "bevel(f.edge('top', 'right'), 1);", 'curved'],
    ['frustum hollow (shell wall 2)', FR + 'shell(f, { wall: 2 });', 'curved'],
    ['cone frustum (circle d40->d20) moved', CC + 'move(f, [5, 6, 7]);', 'curved'],
    ['cone frustum mirrored', CC + "mirror(f, 'left-right');", 'curved'],
    ['cone frustum + join cuboid on top', CC + "const c = cuboid(10, 10, 10); move(c, [0, 0, 40]); join(f, c);", 'curved'],
    ['cone frustum - cut cuboid (10x10x60)', CC + 'const c = cuboid(10, 10, 60); cut(f, c);', 'curved'],
    ['cone frustum rim round (script edge name)', CC + "round(f.edge('top', 'side'), 1);", 'curved'],
    ['cone frustum hollow (shell wall 2)', CC + 'shell(f, { wall: 2 });', 'curved'],
  ];
  for (const [label, src, kind] of cases) {
    const s = solvedFromScript(src); const feats = s.doc.features; const last = feats[feats.length - 1];
    const g = [...G.guardDoc(s.doc, { outlineOf: arc.outlineOf }).values()][0] ?? null;
    const row = { label, src, scriptErrors: s.errors, features: feats.map((f) => `${f.id}:${f.kind}`).join(','), measureId: last?.id, guard: g?.code ?? 'PASS' };
    if (s.errors.length) { OUT.D.push(row); log(`D ${label.padEnd(46)} SCRIPT ERROR: ${s.errors.join(' | ')}`); continue; }
    const o = occtMeasure(s.doc, last.id); const b = brepMeasure(s.doc, last.id); let t; try { t = truckFull(s.doc, last.id); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
    Object.assign(row, { occt: o.volume, occtFaces: o.faces, occtRefused: o.refused, brep: b.volume, brepRefused: b.refused, truck: t.volume, truckFaces: t.faces, truckRefused: t.refused });
    if (o.volume !== undefined && t.volume !== undefined) row.dVol = rel(t.volume, o.volume);
    if (o.bbox && t.bbox) row.dBbox = Math.max(...o.bbox.map((v, i) => Math.abs(v - t.bbox[i]))) ;
    row.kind = kind; row.bar = kind === 'planar' ? 1e-9 : 3e-4;
    OUT.D.push(row); log(`D ${label.padEnd(46)} guard ${row.guard} OCCT ${o.volume?.toFixed?.(4) ?? 'REF[' + (o.refused ?? '').slice(0, 40) + ']'} truck ${t.volume?.toFixed?.(4) ?? 'REF[' + (t.refused ?? '').slice(0, 90) + ']'} dVol ${E(row.dVol)} bar ${row.bar} faces ${o.faces}/${t.faces}`);
  }
}

// ---------------------------------------------------------------- E: RAW headline cases (unguarded translator) with the round-5 guard sentences
if (ONLY.includes('E')) {
  OUT.E = [];
  const pre = (pl, sa, sb) => `const a = sketch('${pl[0]}'); ${sa} const b = sketch('${pl[1]}'); ${sb} `;
  const hexAt = (n, r, ph = 0) => JSON.stringify(regPts(n, r, ph).map((p) => p.map((v) => +v.toFixed(10))));
  const cases = [
    ['row2/28: top vs side planes', pre(['top', 'side'], 'a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30);'],
    ['row28: top vs front planes', pre(['top', 'front'], 'a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30);'],
    ['row22/23: 5-corner square -> 4-corner rect', pre(['top', 'top'], 'a.polygon([[-20,-20],[0,-20],[20,-20],[20,20],[-20,20]]);', 'b.rect(20, 20);') + 'loft(a, b, 30);'],
    ['row22: triangle -> square', pre(['top', 'top'], 'a.polygon([[0,0],[40,0],[20,30]]);', 'b.rect(10, 10);') + 'loft(a, b, 20);'],
    ['row20: square 40 -> square 20 twisted 20 deg', pre(['top', 'top'], 'a.rect(40, 40);', 'b.polygon([[-10,-10],[10,-10],[10,10],[-10,10]].map(([x,y]) => [x*Math.cos(0.349066)-y*Math.sin(0.349066), x*Math.sin(0.349066)+y*Math.cos(0.349066)]));') + 'loft(a, b, 30);'],
    ['row20: square 40 -> square 40 twisted 2 deg', pre(['top', 'top'], 'a.rect(40, 40);', 'b.polygon([[-20,-20],[20,-20],[20,20],[-20,20]].map(([x,y]) => [x*Math.cos(0.0349066)-y*Math.sin(0.0349066), x*Math.sin(0.0349066)+y*Math.cos(0.0349066)]));') + 'loft(a, b, 30);'],
    ['row11: regular triangle r20 -> circle(40)', pre(['top', 'top'], `a.polygon(${hexAt(3, 20)});`, 'b.circle(40);') + 'loft(a, b, 25);'],
    ['row24: hexagon turned 0.3 rad -> circle(40)', pre(['top', 'top'], `a.polygon(${hexAt(6, 20, 0.3)});`, 'b.circle(40);') + 'loft(a, b, 25);'],
    ['row8: tiny circles r0.05 gap 300', pre(['top', 'top'], 'a.circle(0.1);', 'b.circle(0.1);') + 'loft(a, b, 300);'],
    ['row8: circles r0.5 gap 100', pre(['top', 'top'], 'a.circle(1);', 'b.circle(1);') + 'loft(a, b, 100);'],
    ['row26: gap 0', pre(['top', 'top'], 'a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 0);'],
    ['row27: loft(a, a, 30)', pre(['top', 'top'], 'a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, 30);'],
    ['row29: frame-placed sketches, gap ignored', "const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,5], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); loft(a, b, 30);"],
    ['row30: datum height contradicts the gap', "const a = sketch(plane('top', 0)); a.rect(40, 40); const b = sketch(plane('top', 30)); b.rect(20, 20); loft(a, b, 10);"],
    ['row35: undrawn second sketch', "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); loft(a, b, 30);"],
    ['row19: parallel-sided pair, kernel re-pairs corners', pre(['top', 'top'], 'a.polygon([[0,0],[40,0],[40,30],[0,30]]);', 'b.polygon([[20,15],[0,15],[0,0],[20,0]]);') + 'loft(a, b, 20);'],
  ];
  for (const [label, src] of cases) {
    const g = GR.guardedRun(src, { runScript, solveDoc, arc });
    for (const [id, v] of g.verdicts) {
      const o = occtMeasure(g.doc, id); let t; try { t = truckMeasure(g.doc, id); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
      const row = { label, src, id, scriptErrors: g.scriptErrors, occt: o.volume, occtFaces: o.faces, occtRefused: o.refused, truck: t.volume, truckFaces: t.faces, truckRefused: t.refused, dVol: o.volume !== undefined && t.volume !== undefined ? rel(t.volume, o.volume) : null, signed: o.volume ? (t.volume - o.volume) / o.volume : null, guardWired: v?.code ?? 'PASS', sentence: v?.sentence ?? null };
      OUT.E.push(row); log(`E ${label.padEnd(50)} OCCT ${o.volume?.toFixed?.(3) ?? 'REF[' + (o.refused ?? '').slice(0, 30) + ']'} truck ${t.volume?.toFixed?.(3) ?? 'REF[' + (t.refused ?? '').slice(0, 60) + ']'} dVol ${E(row.dVol)} guard-if-wired ${row.guardWired}`);
    }
  }
}

// ---------------------------------------------------------------- F: round trip of small gaps (raw build of the original and of the re-emitted script)
if (ONLY.includes('F')) {
  OUT.F = [];
  const pre = (a, b) => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} `;
  for (const gap of [30, 30.1234567, 1e-3, 1e-6, 5e-7, 1e-7]) {
    const src = pre('a.rect(40, 40);', 'b.rect(10, 10);') + `loft(a, b, ${gap});`;
    const r1 = runScript(src); const back = toScript({ version: 1, features: r1.doc.features }); const r2 = runScript(back);
    const d1 = solveDoc({ version: 1, features: r1.doc.features }); const d2 = solveDoc({ version: 1, features: r2.doc.features });
    const t1 = truckMeasure(d1, 'bl1'); const t2 = truckMeasure(d2, 'bl1'); const exact = (1600 + 400 + 100) / 3 * gap;
    const g1 = [...G.guardDoc(d1, { outlineOf: arc.outlineOf }).values()][0]; const g2 = [...G.guardDoc(d2, { outlineOf: arc.outlineOf }).values()][0];
    const row = { gap, emitted: back.split('\n').filter((l) => /loft/.test(l)).join(' ; '), offsets1: r1.doc.features.filter((f) => f.kind === 'sketch').map((f) => f.offset), offsets2: r2.doc.features.filter((f) => f.kind === 'sketch').map((f) => f.offset), exactVolume: exact, truck1: t1.volume, truck2: t2.volume, guard1: g1?.code ?? 'PASS', guard2: g2?.code ?? 'PASS' };
    OUT.F.push(row); log(`F gap ${gap}: emitted [${row.emitted}] offsets ${JSON.stringify(row.offsets1)} -> ${JSON.stringify(row.offsets2)} exact ${exact} truck ${t1.volume} -> ${t2.volume} guard ${row.guard1} -> ${row.guard2}`);
  }
}

// ---------------------------------------------------------------- G: script-layer sentences for extra arguments (rows 3 and 42)
if (ONLY.includes('G')) {
  OUT.G = [];
  const pre = (a, b) => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} const c = sketch('top'); c.rect(5, 5); `;
  for (const [label, call] of [['blend(a, b, c, 30)', 'blend(a, b, c, 30)'], ['loft(a, b, c, 30)', 'loft(a, b, c, 30)'], ['blend(a, b, 30, 5)', 'blend(a, b, 30, 5)'], ['loft(a, b, 30, 5)', 'loft(a, b, 30, 5)'], ['loft(a, b, 30, "x")', 'loft(a, b, 30, "x")'], ['loft(a, b)', 'loft(a, b)'], ['loft(a)', 'loft(a)'], ['loft()', 'loft()'], ['loft(a, b, "tall")', 'loft(a, b, "tall")'], ['blend(a, b, 30) then cuboid(5,5,5) (control)', 'blend(a, b, 30); cuboid(5, 5, 5)']]) {
    const r = runScript(pre('a.rect(40, 40);', 'b.rect(10, 10);') + call + ';');
    const row = { call: label, errors: r.errors.map((e) => e.message), blendInDoc: r.doc.features.some((f) => f.kind === 'blend'), kinds: r.doc.features.map((f) => f.kind).join(',') };
    OUT.G.push(row); log(`G ${label.padEnd(44)} errors=${JSON.stringify(row.errors)} blendInDoc=${row.blendInDoc}`);
  }
}

// ---------------------------------------------------------------- H: OCCT bbox padding is not blend-specific
if (ONLY.includes('H')) {
  OUT.H = [];
  const viaScript = (src) => { const r = runScript(src); return { doc: solveDoc({ version: 1, features: r.doc.features }), last: r.doc.features[r.doc.features.length - 1].id, errors: r.errors.map((e) => e.message) }; };
  const pl = viaScript("const a = sketch('top'); a.rect(40, 30); pull(a, 10);");
  const bf = viaScript("const a = sketch('top'); a.rect(40, 30); const b = sketch('top'); b.rect(20, 15); loft(a, b, 10);");
  console.log('H scripts', JSON.stringify([pl.errors, pl.last, bf.errors, bf.last]));
  const docs = [['plain pull of rect 40x30, height 10 (no blend)', pl.doc, pl.last, [-20, -15, 0, 20, 15, 10]], ['blend rect 40x30 -> rect 20x15 gap 10', bf.doc, bf.last, [-20, -15, 0, 20, 15, 10]]];
  for (const [label, doc, id, exact] of docs) {
    const o = occtMeasure(doc, id); let t = null; try { t = truckMeasure(doc, id); } catch { /* */ }
    const row = { label, exactExtent: exact, occtBbox: o.bbox ?? null, occtRefused: o.refused ?? null, truckBbox: t?.bbox ?? null, occtPad: o.bbox ? Math.max(...o.bbox.map((v, i) => Math.abs(v - exact[i]))) : null, truckPad: t?.bbox ? Math.max(...t.bbox.map((v, i) => Math.abs(v - exact[i]))) : null };
    OUT.H.push(row); log(`H ${label}: OCCT bbox ${JSON.stringify(o.bbox)} (max off exact ${E(row.occtPad)}) truck ${JSON.stringify(t?.bbox)} (${E(row.truckPad)})`);
  }
}

// ---------------------------------------------------------------- I: slivers (gap / size) against the translator's merged face count
if (ONLY.includes('I')) {
  OUT.I = [];
  for (const sc of [0.5, 4, 40, 400]) for (const relGap of [1e-7, 1e-6, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 1e-2]) {
    const g = sc * relGap; const doc = D([sk('a', 'xy', 0, rectPts(0, 0, sc, sc)), sk('b', 'xy', g, rectPts(0, 0, sc / 4, sc / 4)), bl('a', 'b')]);
    const r = full(doc); const exact = (sc * sc + (sc / 4) * (sc / 4) + sc * sc / 4) / 3 * g;
    const row = { size: sc, relGap, gap: g, exact, truck: r.truck.volume, dExact: rel(r.truck.volume, exact), occtFaces: r.occt.faces, truckFacesMerged: r.truck.faces, truckKernelFaces: r.truck.kernelFaces, guard: r.guard?.code ?? 'PASS' };
    OUT.I.push(row); log(`I size ${sc} gap/size ${relGap}: dExact ${E(row.dExact)} faces OCCT ${r.occt.faces} truck merged ${r.truck.faces} kernel ${r.truck.kernelFaces} guard ${row.guard}`);
  }
}


// ---------------------------------------------------------------- J: RAW (as shipped) behaviour of the script-level and ModelDoc-level refusal classes
if (ONLY.includes('J')) {
  OUT.J = [];
  const pre = (a, b, c = '') => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} ${c}`;
  const cases = [
    ['chained lofts loft(a,b,30); loft(b,c,30)', pre('a.rect(40, 40);', 'b.rect(20, 20);', "const c = sketch('top'); c.rect(10, 10);") + 'loft(a, b, 30); loft(b, c, 30);', ['bl1', 'bl2']],
    ['shared sketch: pull(b,10) before loft(a,b,30)', pre('a.rect(40, 40);', 'b.rect(20, 20);') + 'const p = pull(b, 10); loft(a, b, 30);', ['bl1', 'ex1']],
    ['no area: b.polygon three collinear points', pre('a.rect(20, 20);', 'b.polygon([[0,0],[10,0],[20,0]]);') + 'loft(a, b, 20);', ['bl1']],
    ['bowtie second section', pre('a.rect(20, 20);', 'b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]);') + 'loft(a, b, 20);', ['bl1']],
    ['slot second section', pre('a.rect(40, 40);', 'b.slot([0,0],[20,0],5);') + 'loft(a, b, 20);', ['bl1']],
    ['undrawn second sketch', "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); loft(a, b, 30);", ['bl1']],
  ];
  for (const [label, src, ids] of cases) {
    const run = runScript(src); const doc = solveDoc({ version: 1, features: run.doc.features }); const kinds = doc.features.map((f) => `${f.id}:${f.kind}${f.offset !== undefined ? '@' + f.offset : ''}`).join(',');
    const per = ids.map((id) => { if (!doc.features.some((f) => f.id === id)) return { id, absent: true }; const o = occtMeasure(doc, id); let t; try { t = truckMeasure(doc, id); } catch (e) { t = { refused: 'harness threw ' + e.message }; } return { id, occt: o.volume, occtFaces: o.faces, occtRefused: o.refused, truck: t.volume, truckFaces: t.faces, truckRefused: t.refused, dVol: o.volume !== undefined && t.volume !== undefined ? rel(t.volume, o.volume) : null }; });
    const g = GR.guardedRun(src, { runScript, solveDoc, arc }); const verdict = [...g.verdicts.values()].map((v) => v?.code ?? 'PASS').join(',');
    const row = { label, src, scriptErrors: run.errors.map((e) => e.message), kinds, per, guardWired: verdict };
    OUT.J.push(row); log(`J ${label}: errors ${JSON.stringify(row.scriptErrors)} doc ${kinds} guard-if-wired ${verdict}\n    ` + per.map((x) => (x.absent ? `${x.id} absent` : `${x.id} OCCT ${x.occt?.toFixed?.(3) ?? 'REF[' + (x.occtRefused ?? '').slice(0, 50) + ']'} truck ${x.truck?.toFixed?.(3) ?? 'REF[' + (x.truckRefused ?? '').slice(0, 120) + ']'} dVol ${E(x.dVol)}`)).join('\n    '));
  }
  for (const [label, targets] of [['ModelDoc blend with 3 targets', ['a', 'b', 'c']], ['ModelDoc blend with 1 target', ['a']], ['ModelDoc blend with 0 targets', []]]) {
    const doc = D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), sk('b', 'xy', 20, rectPts(0, 0, 20, 20)), sk('c', 'xy', 40, rectPts(0, 0, 10, 10)), bl(...targets)]);
    const o = occtMeasure(doc); let t; try { t = truckMeasure(doc); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
    const g = guardWith(G, doc);
    const row = { label, occt: o.volume, occtRefused: o.refused, truck: t.volume, truckRefused: t.refused, guardWired: g?.code ?? 'PASS' };
    OUT.J.push(row); log(`J ${label}: OCCT ${o.volume?.toFixed?.(3) ?? 'REF[' + (o.refused ?? '').slice(0, 60) + ']'} truck ${t.volume?.toFixed?.(3) ?? 'REF[' + (t.refused ?? '').slice(0, 120) + ']'} guard-if-wired ${row.guardWired}`);
  }
}

// ---------------------------------------------------------------- K: rim round / edge picks on a circle<->circle loft (cone frustum), what a student actually types
if (ONLY.includes('K')) {
  OUT.K = [];
  const CC = "const a = sketch('top'); a.circle(40); const b = sketch('top'); b.circle(20); const f = loft(a, b, 30);\n";
  const FR = "const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); b.rect(20, 20); const f = loft(a, b, 30);\n";
  const tries = [['frustum round top-left (control)', FR + "round(f.edge('top', 'left'), 1);"], ['cone: round(f.edge(top,bottom),1)', CC + "round(f.edge('top', 'bottom'), 1);"], ['cone: round(f.edge(top,left),1)', CC + "round(f.edge('top', 'left'), 1);"], ['cone: round(f.edge(top,side),1)', CC + "round(f.edge('top', 'side'), 1);"], ['cone: round(f.edge(bottom,side),1)', CC + "round(f.edge('bottom', 'side'), 1);"], ['cone: bevel(f.edge(top,left),1)', CC + "bevel(f.edge('top', 'left'), 1);"], ['cone: round(f, 1) whole shape', CC + 'round(f, 1);'], ['cone: shell(f, {wall:2})', CC + 'shell(f, { wall: 2 });'], ['frustum: shell(f, {wall:2})', FR + 'shell(f, { wall: 2 });']];
  for (const [label, src] of tries) {
    const run = runScript(src); const errs = run.errors.map((e) => e.message);
    const row = { label, src, scriptErrors: errs };
    if (!errs.length) { const doc = solveDoc({ version: 1, features: run.doc.features }); const last = doc.features[doc.features.length - 1]; row.kinds = doc.features.map((f) => `${f.id}:${f.kind}`).join(','); const o = occtMeasure(doc, last.id); let t; try { t = truckFull(doc, last.id); } catch (e) { t = { refused: 'harness threw ' + e.message }; } Object.assign(row, { occt: o.volume, occtRefused: o.refused, truck: t.volume, truckRefused: t.refused, dVol: o.volume !== undefined && t.volume !== undefined ? rel(t.volume, o.volume) : null }); }
    OUT.K.push(row); log(`K ${label}: ${errs.length ? 'SCRIPT ERROR ' + JSON.stringify(errs) : `doc ${row.kinds} OCCT ${row.occt?.toFixed?.(4) ?? 'REF[' + (row.occtRefused ?? '').slice(0, 60) + ']'} truck ${row.truck?.toFixed?.(4) ?? 'REF[' + (row.truckRefused ?? '').slice(0, 160) + ']'} dVol ${E(row.dVol)}`}`);
  }
}

if (arg('out')) writeFileSync(arg('out'), JSON.stringify(OUT, null, 1));
