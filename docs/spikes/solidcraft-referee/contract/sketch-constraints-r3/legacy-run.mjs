// Legacy panel rules, round 2. Route A = today's pipeline (our TS solver solves, SolidCraft extrudes the solved polygon) with an INDEPENDENT residual check;
// route B = the rules expressed as soup rows and solved by SolidCraft (legacy.mjs legacyToSoup) through the guarded ladder.
//   SOLIDCRAFT_REFEREE_PKG2=<p2 pkg> bun legacy-run.mjs [--out=out/legacy.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as lib from './lib.mjs';
import { CASES, H, soupScript } from './cases.mjs';
import { legacyResiduals, legacyViolations, legacyToSoup } from './legacy.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/legacy.json').slice(6);
// OCCT
const OCCT_DIR = path.join(lib.REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await lib.imp(path.join(OCCT_DIR, 'replicad_single.js'));
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await lib.imp(path.join(lib.REPO, 'packages/brep-adapter/dist/occt-build.js'));
function occtVolume(doc) {
  try {
    const ex = doc.features.filter((f) => f.kind === 'extrude').at(-1);
    const b = buildDoc(oc, lib.clone(doc), lib.arcMod);
    const shape = b.shapes.get(ex.id);
    if (!shape) return { refused: 'no shape' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()] };
  } catch (e) { return { refused: String(e.message).slice(0, 120) }; }
}
const area = (p) => Math.abs(p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]), 0) / 2);
const box = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
const rel = lib.rel;
const bboxErr = (b, want) => Math.max(...want.map((w, i) => rel(b[i], w)));
// polygon -> soup lines with joins only (what the translator hands SolidCraft for an already-solved polygon)
const polySoup = (pts) => ({ geoms: pts.map((p, i) => ({ k: 'line', id: i + 1, a: [...p], b: [...pts[(i + 1) % pts.length]] })), rules: pts.map((_, i) => ({ k: 'coincident', a: i + 1, aEnd: 'b', b: ((i + 1) % pts.length) + 1, bEnd: 'a' })) });
const CASEDEFS = CASES.filter((c) => c.legacy && c.script && !/edge-number/.test(c.id));
// extra: docs whose rules fight. runScript settles them the way the Rules panel does (the NEWEST rule wins, an older one is dropped, no warning); only a fight it cannot settle
// leaves a violated rule in the doc together with run.warnings.
const P4 = `sk.polygon([[0, 0], [30, 0], [30, 20], [0, 20]])`;
const extra = [
  { id: 'legacy-fight-length-35-with-pin', body: `${P4}\nsk.across(1); sk.up(2); sk.across(3); sk.up(4); sk.pin(1)\nsk.length(1, 30); sk.length(2, 20); sk.length(3, 35)`, conflict: true },
  { id: 'legacy-fight-lengths-30-20-35-20', body: `${P4}\nsk.across(1); sk.up(2); sk.across(3); sk.up(4)\nsk.length(1, 30); sk.length(2, 20); sk.length(3, 35); sk.length(4, 20)`, conflict: true },
  { id: 'legacy-fight-three-perpendicular', body: `sk.polygon([[0, 0], [30, 0], [15, 20]])\nsk.perpendicular(1, 2); sk.perpendicular(2, 3); sk.perpendicular(1, 3)`, conflict: true },
  { id: 'legacy-fight-parallel-adjacent-edges', body: `${P4}\nsk.across(1); sk.up(2); sk.parallel(1, 2)`, conflict: true },
  { id: 'legacy-fight-angle-60-on-rectangle', body: `${P4}\nsk.across(1); sk.up(2); sk.angle(1, 2, 60)`, conflict: true },
].map((e) => ({ ...e, script: `const sk = sketch('top')\n${e.body}\nconst part = extrude(sk, ${H})`, area: 0, bbox: null }));
const STMT = /\bsk\.(across|up|length|equal|parallel|perpendicular|pin|distX|distY|symmetric|angle)\(/g;
// the translator-side guard on route A: rules the TS solver could not hold (large residual) or that runScript warned about
const A_TOL = { mm: 1e-4, sin: 1e-5, cos: 1e-5, deg: 1e-3 };
const out = [];
for (const cs of [...CASEDEFS, ...extra]) {
  const rec = { id: cs.id, conflict: !!cs.conflict };
  const run = lib.runScript(cs.script);
  if (run.errors?.length) { rec.error = run.errors.map((e) => e.message).join(' | '); out.push(rec); console.log(cs.id, 'SCRIPT-ERROR', rec.error); continue; }
  const doc0 = run.doc, sk0 = doc0.features.find((f) => f.kind === 'sketch');
  rec.statements = (cs.script.match(STMT) ?? []).length; rec.keptConstraints = sk0.constraints?.length ?? null; rec.warnings = run.warnings ?? [];
  if (!sk0.points) { rec.error = 'not a polygon sketch'; out.push(rec); continue; }
  const doc = lib.modelCodegen.solveDoc(doc0), sk1 = doc.features.find((f) => f.kind === 'sketch');
  // ---- route A
  const viol = legacyViolations(sk1.points, sk1.constraints, sk0.points);
  const res = legacyResiduals(sk1.points, sk1.constraints, sk0.points);
  const worst = res.filter((x) => x.residual !== null).sort((a, b) => b.residual - a.residual)[0];
  rec.A = { worstKind: worst?.kind, worstResidual: worst?.residual, worstUnit: worst?.unit, violations1e9: viol.map((v) => `${v.kind}:${v.residual.toExponential(1)}${v.unit}`), area: area(sk1.points), bbox: box(sk1.points) };
  if (cs.area) { rec.A.areaRel = rel(rec.A.area, cs.area); rec.A.bboxRel = bboxErr(rec.A.bbox, cs.bbox); }
  const ps = polySoup(sk1.points);
  const a = lib.scSketch(ps.geoms, ps.rules);
  rec.A.scVolume = a.body?.volume; rec.A.scVsOwnPolygon = a.body ? rel(a.body.volume, rec.A.area * H) : null;
  const o = occtVolume(doc); rec.A.occt = o.refused ? { refused: o.refused } : { volume: o.volume, vsSc: a.body ? rel(a.body.volume, o.volume) : null };
  const b = lib.brepBuild(doc); rec.A.brep = b.outcome === 'built' ? { volume: b.volume, vsSc: a.body ? rel(a.body.volume, b.volume) : null } : { refused: b.refusal };
  const big = legacyViolations(sk1.points, sk1.constraints, sk0.points, A_TOL);
  rec.A.verdictToday = viol.length ? 'BUILT-DESPITE-VIOLATION' : 'rules met at 1e-9';
  rec.A.guard = big.length || rec.warnings.length ? { refuse: true, because: big.length ? `${big[0].kind} off by ${big[0].residual.toExponential(1)} ${big[0].unit}` : 'runScript warned: ' + rec.warnings[0] } : { refuse: false };
  // ---- route B
  const soup = legacyToSoup(sk0.points, sk0.constraints);
  if (!soup) { rec.B = { error: 'a constraint kind with no soup row' }; out.push(rec); continue; }
  const g = ladderSketch(soup);
  if (!g.ok) rec.B = { refused: g.sentence, stage: g.stage };
  else {
    const poly = soup.geoms.map((_, i) => g.solved[i].a);
    const v2 = legacyViolations(poly, sk0.constraints, sk0.points);
    rec.B = { volume: g.body.volume, bodies: g.body.bodies, bbox: g.body.bbox, rung: g.rung, legacyViolations: v2.map((v) => `${v.kind}:${v.residual.toExponential(1)}${v.unit}`) };
    if (cs.area) { rec.B.volRel = rel(g.body.volume, cs.area * H); rec.B.bboxRel = bboxErr([g.body.bbox[0], g.body.bbox[1], g.body.bbox[3], g.body.bbox[4]], cs.bbox); }
    const d2 = occtVolume({ ...doc, features: doc.features.map((f) => (f.kind === 'sketch' ? { ...f, points: poly } : f)) });
    rec.B.occtVsSc = d2.refused ? { refused: d2.refused } : rel(g.body.volume, d2.volume);
    // the solved polygon built by brep-rs
    const bb = lib.brepBuild({ ...doc, features: doc.features.map((f) => (f.kind === 'sketch' ? { ...f, points: poly } : f)) });
    rec.B.brepVsSc = bb.outcome === 'built' ? rel(g.body.volume, bb.volume) : { refused: bb.refusal };
  }
  out.push(rec);
  console.log(`${cs.id.padEnd(44)} A: worst ${rec.A.worstKind} ${rec.A.worstResidual?.toExponential(1)}${rec.A.worstUnit} viol@1e-9 ${rec.A.violations1e9.length} areaRel ${rec.A.areaRel?.toExponential(1)} bboxRel ${rec.A.bboxRel?.toExponential(1)} scVsOwn ${rec.A.scVsOwnPolygon?.toExponential(1)} occt ${rec.A.occt.vsSc?.toExponential(1) ?? rec.A.occt.refused} stmts ${rec.statements} kept ${rec.keptConstraints} warn ${rec.warnings.length} guardA ${rec.A.guard.refuse} | B: ${rec.B.refused ? 'REFUSED ' + rec.B.refused.slice(0, 90) : `volRel ${rec.B.volRel?.toExponential(1)} bboxRel ${rec.B.bboxRel?.toExponential(1)} legacyViol ${rec.B.legacyViolations.length} occt ${typeof rec.B.occtVsSc === 'number' ? rec.B.occtVsSc.toExponential(1) : 'n/a'}`}`);
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
