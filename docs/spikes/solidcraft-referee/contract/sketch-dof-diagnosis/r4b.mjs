// ROUND 4 section B: the LEGACY script route. Reproduces the silent wrong solids, then runs the shipped-in-contract guard (legacy-guard.mjs) on the same scripts and on a fuzz.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/sketch-dof-diagnosis/make-logged-script.mjs     (once)
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/sketch-dof-diagnosis/r4b.mjs   (writes r4b.json; N=SEEDS/N env)
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
import { guardedLegacy, plainRule, isSimple, properShape, intendedRules } from './legacy-guard.mjs';
import { checkAll, polish } from './legacy-rules.mjs';
import { analyse } from './indep.mjs';
import { plainProblems } from './refusal-sentence.mjs';

const H = 10;
const e2 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toExponential(3) : String(x)) : x);
const shoelace = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sketchOf = (doc) => doc.features.find((f) => f.kind === 'sketch');
const rawStatus = (g) => {
  const f = sketchOf(g.rawDoc); const sk0 = g.run.doc.features.find((x) => x.kind === 'sketch');
  const log = g.run.ruleLog.filter((e) => e.sketchId === f.id);
  const intended = log.length ? intendedRules(log, log[0].existing) : sk0.constraints;
  const chk = checkAll(f.points, intended, sk0.points, 1e-6);
  return { area: shoelace(f.points), holds: chk.ok && properShape(f.points, sk0.points), worst: chk.worst.kind ? `${chk.worst.kind}${chk.worst.index + 1}:${e2(chk.worst.residual)}` : null, warnings: g.shipped.warnings ?? null };
};
function kernels(doc, last) {
  const o = L.occtMeasure(doc, last), b = L.brepBuild(doc), s = L.scTranslate(doc);
  return { occt: o.outcome === 'built' ? o.volume : o.refusal, brep: b.outcome === 'built' ? b.volume : b.refusal, sc: s.outcome === 'built' ? s.volume : s.refusal, scFaces: s.faces, occtFaces: o.faces, brepFaces: b.faces };
}
const OUT = { repro: [], fuzz: null };

// ---------------- B1: the reproduced cases, raw pipeline vs guard ----------------
const CASES = [
  ['A  rect40x30 length(1,20) length(2,15)', "const s=sketch('top'); s.rect(40,30); s.length(1,20); s.length(2,15); extrude(s,10)", 20 * 15],
  ['B  rect100x100 length(1,40) length(2,40)', "const s=sketch('top'); s.rect(100,100); s.length(1,40); s.length(2,40); extrude(s,10)", 1600],
  ['C  rect40x30 length(1,12) length(2,12) equal(1,2)', "const s=sketch('top'); s.rect(40,30); s.length(1,12); s.length(2,12); s.equal(1,2); extrude(s,10)", 144],
  ['D  rect40x30 length(1,8)', "const s=sketch('top'); s.rect(40,30); s.length(1,8); extrude(s,10)", 8 * 30],
  ['E  rect40x30 length(2,6)', "const s=sketch('top'); s.rect(40,30); s.length(2,6); extrude(s,10)", 40 * 6],
  ['F  rect40x30 length(1,3)', "const s=sketch('top'); s.rect(40,30); s.length(1,3); extrude(s,10)", 3 * 30],
  ['G  param slider w=5 on length(1,w)', "const w=param('w',5,{min:1,max:100}); const s=sketch('top'); s.rect(40,30); s.length(1,w); extrude(s,10)", 5 * 30],
  ['H  rect40x20 length(1,40) then length(1,30) (same edge, two values)', "const s=sketch('top'); s.rect(40,20); s.length(1,40); s.length(1,30); extrude(s,10)", null],
  ['I  triangle three right angles (impossible)', "const s=sketch('top'); s.polygon([[0,0],[40,0],[20,30]]); s.perpendicular(1,2); s.perpendicular(2,3); s.perpendicular(1,3); extrude(s,10)", null],
  ['J  triangle two right angles (soup-route sliver case, legacy form)', "const s=sketch('top'); s.polygon([[0,0],[40,0],[10,25]]); s.perpendicular(1,2); s.perpendicular(2,3); extrude(s,10)", null],
  ['K  rect40x20 equal(1,2)', "const s=sketch('top'); s.rect(40,20); s.equal(1,2); extrude(s,10)", null],
  ['L  rect40x30 length(1,35) (grow; control)', "const s=sketch('top'); s.rect(40,30); s.length(1,35); extrude(s,10)", 35 * 30],
  ['M  rect40x30 distX(1,3,12) (shrink 40 to 12; control)', "const s=sketch('top'); s.rect(40,30); s.distX(1,3,12); extrude(s,10)", 12 * 30],
  ['N  rect40x30 pin(1) length(1,100) length(2,100) (control)', "const s=sketch('top'); s.rect(40,30); s.pin(1); s.length(1,100); s.length(2,100); extrude(s,10)", 10000],
  ['P  rect40x30 distX(3,1,12) (docs: corner 1 sits 12 to the RIGHT of corner 3)', "const s=sketch('top'); s.rect(40,30); s.distX(3,1,12); extrude(s,10)", null],
  ['Q  rect40x30 distX(3,1,-12) (docs: corner 1 sits 12 to the LEFT of corner 3 = a 12 wide rectangle)', "const s=sketch('top'); s.rect(40,30); s.distX(3,1,-12); extrude(s,10)", 12 * 30],
  ['O  rect40x30 length(1,20) length(2,15) length(1,10)', "const s=sketch('top'); s.rect(40,30); s.length(1,20); s.length(2,15); s.length(1,10); extrude(s,10)", 10 * 15],
];
for (const [name, src, wantArea] of CASES) {
  const g = guardedLegacy(src);
  const row = { case: name, src, wantVolume: wantArea ? wantArea * H : null };
  if (g.outcome === 'script-error') { row.error = g.errors; OUT.repro.push(row); console.log(name, 'SCRIPT ERROR', g.errors); continue; }
  const raw = rawStatus(g);
  row.raw = { volume: e2(raw.area * H), writtenRulesHold: raw.holds, firstViolation: raw.worst, warnings: raw.warnings, droppedByPipeline: g.sketches.flatMap((s) => s.droppedByPipeline) };
  row.rawKernels = kernels(g.rawDoc, g.rawDoc.features.at(-1).id);
  row.guard = { outcome: g.outcome, route: g.sketches.map((s) => s.route), sentence: g.sentence ?? null, sentenceProblems: g.sentence ? plainProblems(g.sentence) : null };
  if (g.outcome === 'built-ready') {
    const k = kernels(g.doc, g.last); row.guard.kernels = k;
    const sk = sketchOf(g.doc); row.guard.shoelaceVolume = e2(shoelace(sk.points) * H);
    row.guard.holdsIndependent = checkAll(sk.points, sk.constraints, g.run.doc.features.find((x) => x.kind === 'sketch').points, 1e-9).ok;
    if (row.wantVolume) row.guard.relErrVsClosedForm = { occt: e2(Math.abs(k.occt - row.wantVolume) / row.wantVolume), sc: e2(Math.abs(k.sc - row.wantVolume) / row.wantVolume), brep: e2(Math.abs(k.brep - row.wantVolume) / row.wantVolume) };
  }
  OUT.repro.push(row);
  console.log(name.padEnd(70), 'RAW vol', row.raw.volume, 'holds', row.raw.writtenRulesHold, 'warn', !!row.raw.warnings, '| GUARD', g.outcome, row.guard.route.join(','), row.guard.kernels ? `sc ${e2(row.guard.kernels.sc)} err ${JSON.stringify(row.guard.relErrVsClosedForm ?? null)}` : g.sentence);
}

// ---------------- B2: fuzz. random bases and random rule sequences ----------------
const SEEDS = (process.env.SEEDS ?? '11,12').split(',').map(Number); const N = +(process.env.N ?? 300);
const BASES = {
  rect: () => { const w = [30, 40, 50, 60][Math.floor(rnd() * 4)], h = [20, 25, 30][Math.floor(rnd() * 3)]; return { head: `s.rect(${w},${h})`, pts: [[0, 0], [w, 0], [w, h], [0, h]], hv: true }; },
  tri: () => ({ head: 's.polygon([[0,0],[40,0],[12,26]])', pts: [[0, 0], [40, 0], [12, 26]], hv: false }),
  quad: () => ({ head: 's.polygon([[0,0],[48,3],[41,30],[4,27]])', pts: [[0, 0], [48, 3], [41, 30], [4, 27]], hv: false }),
  L: () => ({ head: 's.polygon([[0,0],[40,0],[40,10],[15,10],[15,30],[0,30]])', pts: [[0, 0], [40, 0], [40, 10], [15, 10], [15, 30], [0, 30]], hv: false }),
};
let rnd = mulberry(1);
const elen = (p, e) => Math.hypot(p[(e + 1) % p.length][0] - p[e][0], p[(e + 1) % p.length][1] - p[e][1]);
function genScript(base) {
  const n = base.pts.length; const k = 1 + Math.floor(rnd() * 4); const calls = [];
  for (let i = 0; i < k; i++) {
    const t = rnd(); const e = Math.floor(rnd() * n); let o = Math.floor(rnd() * n); if (o === e) o = (e + 1) % n;
    if (t < 0.34) { const f = [0.2, 0.3, 0.5, 0.75, 1.25, 1.6][Math.floor(rnd() * 6)]; calls.push(`s.length(${e + 1}, ${Math.round(elen(base.pts, e) * f * 2) / 2})`); }
    else if (t < 0.46) calls.push(`s.across(${e + 1})`); else if (t < 0.58) calls.push(`s.up(${e + 1})`);
    else if (t < 0.68) calls.push(`s.equal(${e + 1}, ${o + 1})`); else if (t < 0.76) calls.push(`s.parallel(${e + 1}, ${o + 1})`); else if (t < 0.84) calls.push(`s.perpendicular(${e + 1}, ${o + 1})`);
    else if (t < 0.92) { const a = e, b = o; calls.push(`s.distX(${a + 1}, ${b + 1}, ${Math.round((base.pts[b][0] - base.pts[a][0]) * [0.4, 0.8, 1, 1.5][Math.floor(rnd() * 4)] * 2) / 2})`); }
    else calls.push(`s.pin(${e + 1})`);
  }
  return calls;
}
// legacy -> soup rules (independent truth): polygon corners i -> line i from p[i] to p[i+1]; angle rules are not generated here
function toSoup(pts, intended) {
  const n = pts.length; const geoms = pts.map((p, i) => ({ k: 'line', id: i + 1, a: [...p], b: [...pts[(i + 1) % n]] }));
  const rules = []; for (let i = 0; i < n; i++) rules.push({ k: 'coincident', a: i + 1, aEnd: 'b', b: ((i + 1) % n) + 1, bEnd: 'a' });
  for (const c of intended) {
    switch (c.kind) {
      case 'horizontal': rules.push({ k: 'horizontal', a: c.edge + 1 }); break;
      case 'vertical': rules.push({ k: 'vertical', a: c.edge + 1 }); break;
      case 'length': rules.push({ k: 'distance', a: c.edge + 1, aEnd: 'a', b: c.edge + 1, bEnd: 'b', value: c.value }); break;
      case 'equal': rules.push({ k: 'equal', a: c.edge + 1, b: c.other + 1 }); break;
      case 'parallel': rules.push({ k: 'parallel', a: c.edge + 1, b: c.other + 1 }); break;
      case 'perpendicular': rules.push({ k: 'perpendicular', a: c.edge + 1, b: c.other + 1 }); break;
      case 'distanceX': rules.push({ k: 'distanceX', a: c.a + 1, aEnd: 'a', b: c.b + 1, bEnd: 'a', value: c.value }); break;
      case 'lock': rules.push({ k: 'lock', a: c.corner + 1, aEnd: 'a' }); break;
      default: return null;
    }
  }
  return { geoms, rules };
}
function indepFeasible(pts, intended) {
  const sp = toSoup(pts, intended); if (!sp) return { unsupported: true };
  const rr = mulberry(99); const d = Math.hypot(...[0, 1].map((ax) => Math.max(...pts.map((p) => p[ax])) - Math.min(...pts.map((p) => p[ax]))));
  for (let t = 0; t < 40; t++) {
    const j = (p) => (t === 0 ? [...p] : [p[0] + (rr() - 0.5) * 0.4 * d, p[1] + (rr() - 0.5) * 0.4 * d]);
    const geoms = sp.geoms.map((g) => ({ ...g, a: j(g.a), b: j(g.b) }));
    // lock needs the DRAWN position: indep's lock uses geoms as given, so keep locked corners unjittered
    const locked = new Set(sp.rules.filter((r) => r.k === 'lock').map((r) => r.a));
    geoms.forEach((g, i) => { if (locked.has(g.id)) g.a = [...sp.geoms[i].a]; });
    let a; try { a = analyse(geoms, sp.rules); } catch { continue; }
    if (a.unsupported) return { unsupported: true };
    if (a.consistent) {
      // proper simple, same-orientation shape?
      const poly = a.solved.map((g) => g.a);
      if (properShape(poly, pts)) return { feasible: true, dof: a.dof };
    }
  }
  return { feasible: false };
}
const rows = [];
for (const seed of SEEDS) {
  rnd = mulberry(seed);
  for (let t = 0; t < N; t++) {
    const bname = ['rect', 'rect', 'tri', 'quad', 'L'][Math.floor(rnd() * 5)]; const base = BASES[bname]();
    const calls = genScript(base);
    const src = `const s=sketch('top'); ${base.head}; ${calls.join('; ')}; extrude(s,10)`;
    const g = guardedLegacy(src);
    if (g.outcome === 'script-error') { rows.push({ seed, t, src, scriptError: g.errors }); continue; }
    const raw = rawStatus(g);
    const sk0 = g.run.doc.features.find((x) => x.kind === 'sketch'); const log = g.run.ruleLog.filter((e) => e.sketchId === sk0.id);
    const intended = log.length ? intendedRules(log, log[0].existing) : sk0.constraints;
    const row = { seed, t, base: bname, src, calls, nWritten: intended.length, raw: { holds: raw.holds, silent: !raw.holds && !raw.warnings, warned: !!raw.warnings, dropped: g.sketches.flatMap((s) => s.droppedByPipeline).length, area: raw.area }, guard: { outcome: g.outcome, route: g.sketches.map((s) => s.route).join(','), sentence: g.sentence ?? null } };
    row.indep = indepFeasible(sk0.points, intended);
    if (g.outcome === 'built-ready') {
      const sk = sketchOf(g.doc);
      row.guard.holdsTS = L.solve.residualOf(sk.points, intended) <= 1e-6;       // second, independent checker (TS residualOf)
      row.guard.holdsSigned = checkAll(sk.points, intended, sk0.points, 1e-9).ok;
      row.guard.area = shoelace(sk.points);
    }
    rows.push(row);
  }
}
// ---- kernel builds for a sample of guard-built docs (OCCT vs SC vs brep-rs vs shoelace*H)
const built = rows.filter((r) => r.guard?.outcome === 'built-ready');
const sample = built.filter((_, i) => i % Math.max(1, Math.floor(built.length / 40)) === 0).slice(0, 40);
for (const r of sample) {
  const g = guardedLegacy(r.src); const k = kernels(g.doc, g.last); const want = shoelace(sketchOf(g.doc).points) * H;
  const pts = sketchOf(g.doc).points; const nn = pts.length; let minSin = 1;
  for (let i = 0; i < nn; i++) { const a = pts[i], b2 = pts[(i + 1) % nn], c = pts[(i + 2) % nn]; const u = [b2[0] - a[0], b2[1] - a[1]], v = [c[0] - b2[0], c[1] - b2[1]]; minSin = Math.min(minSin, Math.abs(u[0] * v[1] - u[1] * v[0]) / Math.hypot(...u) / Math.hypot(...v)); }
  r.kernel = { flatVertex: minSin < 1e-9, scFaces: k.scFaces, occtFaces: k.occtFaces, brepFaces: k.brepFaces, occtRel: e2(Math.abs(k.occt - want) / want), scRel: e2(Math.abs(k.sc - want) / want), brepRel: e2(Math.abs(k.brep - want) / want), scVsOcct: e2(Math.abs(k.sc - k.occt) / want), facesEqual: k.scFaces === k.occtFaces && k.occtFaces === k.brepFaces };
}
const C = (f) => rows.filter((r) => !r.scriptError && f(r)).length;
const S = {
  scripts: rows.length, scriptErrors: rows.filter((r) => r.scriptError).length,
  rawBuiltViolatingWrittenRules: C((r) => !r.raw.holds), rawSilent: C((r) => r.raw.silent), rawWarned: C((r) => !r.raw.holds && r.raw.warned), rawWithDroppedRule: C((r) => r.raw.dropped > 0),
  rawWrongAndIndepFeasible: C((r) => !r.raw.holds && r.indep.feasible),
  guardBuilt: C((r) => r.guard.outcome === 'built-ready'), guardRefused: C((r) => r.guard.outcome === 'refused'),
  guardBuiltButRuleNotHeldByIndependentCheckers: C((r) => r.guard.outcome === 'built-ready' && !(r.guard.holdsTS && r.guard.holdsSigned)),
  guardBuiltAndIndepSaysInfeasible: C((r) => r.guard.outcome === 'built-ready' && r.indep.feasible === false),
  guardRefusedAndIndepFeasible_falseRefusals: C((r) => r.guard.outcome === 'refused' && r.indep.feasible === true),
  guardRefusedAndIndepInfeasible: C((r) => r.guard.outcome === 'refused' && r.indep.feasible === false),
  indepUnsupported: C((r) => r.indep.unsupported),
  guardRoutes: Object.fromEntries([...new Set(rows.filter((r) => r.guard).map((r) => r.guard.route))].map((k) => [k, C((r) => r.guard.route === k)])),
  refusalSentencesNotPlain: rows.filter((r) => r.guard?.sentence && plainProblems(r.guard.sentence).length).length,
  falseDrops: C((r) => r.raw.dropped > 0 && r.guard.outcome === 'built-ready'), necessaryDrops: C((r) => r.raw.dropped > 0 && r.guard.outcome === 'refused'),
  rawDroppedRuleAndWarned: C((r) => r.raw.dropped > 0 && r.raw.warned), rawDroppedRuleNoWarning: C((r) => r.raw.dropped > 0 && !r.raw.warned),
  kernelSample: { n: sample.length, maxOcctRel: e2(Math.max(...sample.map((r) => +r.kernel.occtRel))), maxScRel: e2(Math.max(...sample.map((r) => +r.kernel.scRel))), maxBrepRel: e2(Math.max(...sample.map((r) => +r.kernel.brepRel))), allFacesEqual: sample.every((r) => r.kernel.facesEqual), facesDiffer: sample.filter((r) => !r.kernel.facesEqual).length, facesDifferWithFlatVertex: sample.filter((r) => !r.kernel.facesEqual && r.kernel.flatVertex).length, facesDifferExamples: sample.filter((r) => !r.kernel.facesEqual).map((r) => ({ src: r.src.replace("const s=sketch('top'); ", ''), faces: [r.kernel.occtFaces, r.kernel.brepFaces, r.kernel.scFaces] })), planarBar: 1e-9 },
};
OUT.rowsDump = rows; OUT.fuzz = { seeds: SEEDS, perSeed: N, summary: S, examplesRawWrongSilent: rows.filter((r) => r.raw?.silent).slice(0, 6).map((r) => ({ src: r.src, rawArea: r.raw.area, guard: r.guard.outcome, guardArea: r.guard.area })), falseRefusals: rows.filter((r) => r.guard?.outcome === 'refused' && r.indep.feasible).slice(0, 8).map((r) => ({ src: r.src, sentence: r.guard.sentence })) };
console.log(JSON.stringify(S, null, 1));
writeFileSync(new URL('./r4b.json', import.meta.url), JSON.stringify(OUT, null, 1));
