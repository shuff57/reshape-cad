// Soup cases on the GUARDED route, stored geometry and one 3.5% rough start each, scored against: closed form, live brep-rs (script -> solveDoc -> build), live OCCT
// (replicad-opencascadejs building the brep-rs-solved geometry), and the saved FreeCAD refs (gauntlet bbox / dof). Same case table as round 1.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun stored-run.mjs [--out=out/stored.json]
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as lib from './lib.mjs';
import { CASES, H, roughen, plainRules, soupScript } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/stored.json').slice(6);
const OCCT_DIR = path.join(lib.REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await lib.imp(path.join(OCCT_DIR, 'replicad_single.js'));
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await lib.imp(path.join(lib.REPO, 'packages/brep-adapter/dist/occt-build.js'));
const R1 = (() => { try { return JSON.parse(readFileSync(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/contract/sketch-constraints-results.json'), 'utf8')).results; } catch { return []; } })();
function occtOf(doc, solvedGeoms) {
  try {
    const d = lib.clone(doc); const sk = d.features.find((f) => f.kind === 'sketch');
    if (solvedGeoms) { sk.geoms = lib.clone(solvedGeoms); sk.rules = (sk.rules ?? []).filter((r) => ![r.a, r.b, r.c].some((x) => typeof x === 'number' && x < 0)); delete sk.geom; }
    const ex = d.features.filter((f) => f.kind === 'extrude').at(-1);
    const b = buildDoc(oc, d, lib.arcMod); const shape = b.shapes.get(ex.id);
    if (!shape) return { refused: [...(b.refusals?.values?.() ?? [])].join(' | ') || 'no shape' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()] };
  } catch (e) { return { refused: String(e.message).slice(0, 160) }; }
}
const rel = lib.rel;
const bboxRel = (b, want) => Math.max(...want.map((w, i) => rel(b[i], w)));
const out = [];
for (const cs of CASES) {
  if (!cs.geoms || cs.legacy || cs.probe) continue;
  for (const mode of ['stored', 'rough']) {
    if (mode === 'rough' && !cs.modes.includes('rough')) continue;
    const start = mode === 'rough' ? roughen(cs.geoms, cs.rules, cs.id, 0.035) : lib.clone(cs.geoms);
    const rules = plainRules(cs.rules);
    const rec = { id: cs.id, mode, feats: cs.feats, expect: cs.expect, curved: !!cs.curved };
    const g = ladderSketch({ geoms: start, rules });
    if (!g.ok) { rec.sc = { refused: g.sentence, stage: g.stage }; }
    else {
      const c = classify(cs, g.body, start);
      rec.sc = { volume: g.body.volume, bodies: g.body.bodies, faces: g.body.faces, bbox: g.body.bbox, com: g.body.com, rung: g.rung, cls: c.cls, dv: c.dv, db: c.db, dof: g.report.dof, status: g.report.status };
      rec.want = { volume: cs.area * H, bbox: cs.bbox };
      // brep-rs on the same start through the script layer
      try {
        const run = lib.runScript(soupScript(start, rules));
        const doc = lib.modelCodegen.solveDoc(run.doc);
        const b = lib.brepBuild(doc);
        rec.brep = b.outcome === 'built' ? { volume: b.volume, faces: b.faces, bbox: b.bbox, vsSc: rel(g.body.volume, b.volume), bboxVsSc: bboxRel(g.body.bbox, b.bbox) } : { refused: b.refusal };
        const bs = lib.brepSolve(doc.features.find((f) => f.kind === 'sketch').geoms, doc.features.find((f) => f.kind === 'sketch').rules);
        rec.brepDof = bs.diag?.dof ?? null;
        const o = occtOf(doc, bs.geoms ?? null);
        rec.occt = o.refused ? { refused: o.refused } : { volume: o.volume, vsSc: rel(g.body.volume, o.volume), bboxVsSc: bboxRel(g.body.bbox, o.bbox) };
      } catch (e) { rec.brep = { error: String(e.message).slice(0, 100) }; }
      if (cs.fc?.bbox) { const fb = [cs.fc.bbox[0], cs.fc.bbox[1], 0, cs.fc.bbox[3], cs.fc.bbox[4], H]; rec.fc = { bboxVsSc: bboxRel(g.body.bbox, fb), dof: cs.fc.dof }; }
      const r1 = R1.find((x) => x.id === cs.id && x.mode === mode);
      if (r1?.sc && !r1.sc.refused && mode === 'stored') rec.round1 = { volume: r1.sc.volume, volumeDelta: rel(g.body.volume, r1.sc.volume) };
    }
    out.push(rec);
    console.log(`${cs.id.padEnd(56)} ${mode.padEnd(6)} ${rec.sc.refused ? 'REFUSED[' + rec.sc.stage + '] ' + rec.sc.refused.slice(0, 80) : `${rec.sc.cls} dv ${rec.sc.dv.toExponential(1)} db ${rec.sc.db.toExponential(1)} brep ${rec.brep?.vsSc?.toExponential(1) ?? rec.brep?.refused?.slice(0, 30)} occt ${rec.occt?.vsSc?.toExponential(1) ?? rec.occt?.refused?.slice(0, 30)} ${rec.fc ? 'fc ' + rec.fc.bboxVsSc.toExponential(1) : ''} r1Δ ${rec.round1?.volumeDelta?.toExponential(1) ?? '-'}`}`);
    writeFileSync(OUTF, JSON.stringify(out, null, 1));
  }
}
