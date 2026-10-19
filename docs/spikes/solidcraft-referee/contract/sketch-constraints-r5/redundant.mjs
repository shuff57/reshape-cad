// Redundant (consistent) and conflicting rule sets: the saved FreeCAD fixtures sk-conflict__* and sk-circle-arc-tangent__slot-extra-radius, stored + rough starts + shuffled row orders.
//   FreeCAD refs: redundant [..] with dof 0 = FreeCAD calls the sketch Invalid (solve -2, no bbox), conflicting [..] = Invalid (solve -4). brep-rs: live diagnose + build. Closed form: area x height.
//   bun redundant.mjs [--out=out/redundant.json]
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { H, soupScript, roughen, plainRules, mulberry, seedOf, slotArea, CASES } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/redundant.json').slice(6);
const { gauntletFixtures } = await import(pathToFileURL(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs')).href);
const REF = (id) => JSON.parse(readFileSync(path.join(lib.REPO, 'docs/replica/freecad/gauntlet/variants/refs', `ref-${id}.json`), 'utf8'));
const anchored = CASES.find((c) => c.id === 'gauntlet:sk-circle-arc-tangent__slot-r6-L30-anchored');
const rect = { area: 600, bbox: [0, 0, 30, 20], curved: false };
const slotBox = anchored.bbox;
const WANT = {
  'sk-conflict__clean-30x20': { ...rect, expect: 'build' },
  'sk-conflict__redundant-width': { ...rect, expect: 'build' }, 'sk-conflict__redundant-height': { ...rect, expect: 'build' }, 'sk-conflict__redundant-perpendicular': { ...rect, expect: 'build' },
  'sk-circle-arc-tangent__slot-extra-radius': { area: slotArea(30, 6), bbox: slotBox, curved: true, expect: 'build' },
  'sk-circle-arc-tangent__slot-r6-L30-floating': { area: slotArea(30, 6), size: [42, 12], curved: true, expect: 'build' },
  'sk-circle-arc-tangent__line-circle-tangent': { area: Math.PI * 25, bbox: [15, 0, 25, 10], curved: true, expect: 'build' },
  'sk-circle-arc-tangent__arc-centre-radius': { expect: 'refuse' },
  'sk-conflict__width-30-vs-35': { ...rect, expect: 'refuse' }, 'sk-conflict__radius-vs-diameter': { expect: 'refuse' }, 'sk-conflict__equal-vs-two-radii': { expect: 'refuse' }, 'sk-conflict__horizontal-and-vertical': { expect: 'refuse' },
};
const fixtures = gauntletFixtures().filter((g) => WANT[g.id]);
const add = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const shuffle = (arr, rnd) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const bboxMax = (a, b) => Math.max(...b.map((v, i) => Math.abs(a[i] - v)));
const out = [];
function judge(w, g) { // 'built-right' | 'built-wrong' | 'refused'
  if (!g.ok) return 'refused';
  if (!w.area) return 'built-wrong';
  const tol = w.curved ? 3e-4 : 1e-9, btol = w.curved ? 2e-3 : 1e-6;
  if (w.size) { const b = g.body.bbox; return lib.rel(g.body.volume, w.area * H) <= tol && Math.abs(b[3] - b[0] - w.size[0]) <= btol && Math.abs(b[4] - b[1] - w.size[1]) <= btol ? 'built-right' : 'built-wrong'; }
  return lib.rel(g.body.volume, w.area * H) <= tol && bboxMax(g.body.bbox, [w.bbox[0], w.bbox[1], 0, w.bbox[2], w.bbox[3], H]) <= btol ? 'built-right' : 'built-wrong';
}
for (const fx of fixtures) {
  const w = WANT[fx.id], fc = REF(fx.id), rules = plainRules(fx.rules);
  const rec = { id: fx.id, expect: w.expect, freecad: { solve: fc.solve, dof: fc.dof, redundant: fc.redundant, conflicting: fc.conflicting, state: fc.state, bbox: fc.bbox } };
  const bs = lib.brepSolve(fx.geoms, rules);
  rec.brepDiag = { open: bs.open ?? null, solved: bs.solved ?? null, lastError: bs.lastError ?? null, dof: bs.diag?.dof, redundant: bs.diag?.redundant, conflicting: bs.diag?.conflicting };
  const rb = refsOfScript(soupScript(fx.geoms, rules));
  rec.brepBuild = rb.brep ?? { error: rb.error ?? rb.scriptError };
  const u = lib.scSketch(fx.geoms, rules);
  rec.shipped = { stored: u.mapperRefused ?? (u.firstRefusal ? 'refused: ' + u.firstRefusal.error : u.extrudeError ? 'refused: ' + u.extrudeError : u.body ? 'built vol ' + u.body.volume.toFixed(4) : 'no body'), report: u.report };
  const g = ladderSketch({ geoms: fx.geoms, rules });
  rec.guardedStored = g.ok ? { volume: g.body.volume, bbox: g.body.bbox, faces: g.body.faces, demoted: g.demoted, rung: g.rung, judged: judge(w, g) } : { refused: g.sentence, stage: g.stage, judged: 'refused' };
  // 12 rough starts at 3.5%
  const rough = { guarded: {}, shipped: {}, sentences: {} };
  for (let k = 0; k < 12; k++) {
    const st = roughen(fx.geoms, fx.rules, `${fx.id}#red-rough#${k}`, 0.035);
    const gg = ladderSketch({ geoms: st, rules });
    add(rough.guarded, judge(w, gg)); if (!gg.ok) rough.sentences[gg.sentence] = (rough.sentences[gg.sentence] ?? 0) + 1;
    const uu = lib.scSketch(st, rules);
    add(rough.shipped, uu.mapperRefused || uu.firstRefusal || uu.extrudeError || !uu.body ? 'refused' : judge(w, { ok: true, body: uu.body }));
  }
  rec.rough = rough; console.error(fx.id, 'rough done', new Date().toISOString());
  // 16 shuffled row orders of the stored start
  const perm = { guarded: {}, shipped: {}, sentences: {}, demotedRows: {} };
  for (let k = 0; k < 16; k++) {
    const rnd = mulberry(seedOf(`${fx.id}#red-perm#${k}`));
    const sh = shuffle(rules, rnd);
    const gg = ladderSketch({ geoms: fx.geoms, rules: sh });
    add(perm.guarded, judge(w, gg)); if (!gg.ok) perm.sentences[gg.sentence.replace(/Row \d+/, 'Row N')] = (perm.sentences[gg.sentence.replace(/Row \d+/, 'Row N')] ?? 0) + 1; else add(perm.demotedRows, String((gg.demoted ?? []).length));
    const uu = lib.scSketch(fx.geoms, sh);
    add(perm.shipped, uu.mapperRefused || uu.firstRefusal || uu.extrudeError || !uu.body ? 'refused' : judge(w, { ok: true, body: uu.body }));
  }
  rec.perm = perm; console.error(fx.id, 'perm done', new Date().toISOString());
  out.push(rec);
  console.log(`${fx.id.padEnd(46)} FC solve ${fc.solve} dof ${fc.dof} red ${JSON.stringify(fc.redundant)} conf ${JSON.stringify(fc.conflicting)} | brep-rs diag dof ${rec.brepDiag.dof} red ${JSON.stringify(rec.brepDiag.redundant)} conf ${JSON.stringify(rec.brepDiag.conflicting)} open ${rec.brepDiag.open} build ${rec.brepBuild.volume !== undefined ? 'built ' + rec.brepBuild.volume.toFixed(3) : 'REFUSED ' + String(rec.brepBuild.refused ?? rec.brepBuild.error).slice(0, 60)}\n    stored: ${g.ok ? 'BUILT ' + rec.guardedStored.judged + ' demoted ' + JSON.stringify(g.demoted) : 'REFUSED[' + g.stage + '] ' + g.sentence} | rough12 ${JSON.stringify(rough.guarded)} (shipped ${JSON.stringify(rough.shipped)}) | shuffled16 ${JSON.stringify(perm.guarded)} (shipped ${JSON.stringify(perm.shipped)})`);
}
// the two round-2 stored rectangles too
writeFileSync(OUTF, JSON.stringify(out, null, 1));
