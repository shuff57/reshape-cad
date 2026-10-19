// BATCH: the same edges a script names one by one, handed to SolidCraft in ONE solid.fillet / solid.chamfer call, against
//   (a) OCCT BRepFilletAPI_MakeFillet / _MakeChamfer with all the edges added to ONE maker (simultaneous), built live here
//   (b) OCCT with the blends applied one after the other (what buildDoc does for the sequential doc)
//   (c) SolidCraft with the translator's one-feature-per-edge calls (what the rig emits today)
//   (d) the saved FreeCAD result where one covers the geometry
// Picks come from the same brep-rs resolve the rig uses (rig-only: the shipping resolver is exercised separately, see browser-run).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun batch.mjs [--only=prefix] [--out=batch-results.json]
import { writeFileSync } from 'node:fs';
import { runScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script.js';
import { translateDoc, oc, brep, arc, mt, solveDoc, buildDoc, runSC, occtMeasure, rel } from './base.mjs';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const outFile = (process.argv.find((a) => a.startsWith('--res=')) ?? '--res=batch-results.json').slice(6);
const PI = Math.PI;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const PL = "const sk1 = sketch('top')\nsk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\n";
const PL60 = "const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\n";
const rimOf = (sk, geo, depth, r, op = 'round') => `${sk}${geo}\nconst part = pocket(sk2, plate, ${depth})\n${op}(part.rim(sk2), ${r})`;
const CASES = [];
const add = (c) => CASES.push(c);
// FreeCAD baseline geometry: 40x30x10 plate, 10x10 pocket 4 deep at (20,15)
const FCB = (r, op = 'round') => `${PL}const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\n${op}(part.rim(sk2), ${r})`;
add({ id: 'bt-fcbaseline-rect10-r1', script: FCB(1), fc: { volume: 11591.03244517401, faces: 15, src: 'baseline/ref-fillet-after-pocket.json' } });
for (const r of [0.5, 2, 3.9]) add({ id: `bt-rect10-r${r}`, script: FCB(r) });
for (const d of [1, 2, 3.9]) add({ id: `bt-rect10-d${d}`, script: FCB(d, 'bevel') });
for (const r of [4, 4.5]) add({ id: `bt-rect10-r${r}-ge-depth`, script: FCB(r) });
const RECT = 'sk2.rect(20,10,{at:[0,0]})';
for (const r of [0.5, 1, 2.5, 3.9, 4, 5, 6]) add({ id: `bt-rect20x10-r${r}`, script: rimOf(PL60, RECT, 4, r) });
for (const d of [1, 3, 4, 5, 6]) add({ id: `bt-rect20x10-d${d}`, script: rimOf(PL60, RECT, 4, d, 'bevel') });
const HEX = 'sk2.polygon([[10,0],[5,8.66],[-5,8.66],[-10,0],[-5,-8.66],[5,-8.66]])';
add({ id: 'bt-hex-r1', script: rimOf(PL60, HEX, 4, 1) });
add({ id: 'bt-hex-d1', script: rimOf(PL60, HEX, 4, 1, 'bevel') });
const TRI = 'sk2.polygon([[-10,-8],[10,-8],[0,10]])';
add({ id: 'bt-tri-r1', script: rimOf(PL60, TRI, 4, 1) });
add({ id: 'bt-tri-d1', script: rimOf(PL60, TRI, 4, 1, 'bevel') });
const LSH = 'sk2.polygon([[0,0],[16,0],[16,6],[6,6],[6,14],[0,14]])';
add({ id: 'bt-L-r1', script: rimOf(PL60, LSH, 4, 1) });
add({ id: 'bt-L-d1', script: rimOf(PL60, LSH, 4, 1, 'bevel') });
add({ id: 'bt-through-rect-r1', script: rimOf(PL60, RECT, 12, 1) });
const CIRC = 'sk2.circle(20,{at:[0,0]})';
for (const r of [1, 2]) add({ id: `bt-circle-r${r}`, script: rimOf(PL60, CIRC, 4, r), circle: true });
for (const d of [1, 2]) add({ id: `bt-circle-d${d}`, script: rimOf(PL60, CIRC, 4, d, 'bevel'), circle: true });
// manual picks (brep-rs resolve returns nothing for a circle wall and for this L): the rim edges named by hand, 4 deep pocket in 60x40x12 (top at z=6)
const MAN = (geo, picks, r, op = 'round') => ({ script: rimOf(PL60, geo, 4, r, op), manualPicks: picks });
add({ id: 'bm-circle-r1', ...MAN(CIRC, [[10, 0, 6]], 1) });
add({ id: 'bm-circle-r2', ...MAN(CIRC, [[10, 0, 6]], 2) });
add({ id: 'bm-circle-d1', ...MAN(CIRC, [[10, 0, 6]], 1, 'bevel') });
add({ id: 'bm-circle-d2', ...MAN(CIRC, [[10, 0, 6]], 2, 'bevel') });
const LPK = [[8, 0, 6], [16, 3, 6], [11, 6, 6], [6, 10, 6], [3, 14, 6], [0, 7, 6]];
add({ id: 'bm-L-r1', ...MAN(LSH, LPK, 1) });
add({ id: 'bm-L-d1', ...MAN(LSH, LPK, 1, 'bevel') });
// the plate's own edges in one call
const PE = (names, r, op = 'round') => `${PL}${names.map(([a, b]) => `${op}(plate.edge('${a}','${b}'), ${r})`).join('\n')}`;
const TOP4 = [['top', 'front'], ['top', 'right'], ['top', 'back'], ['top', 'left']];
const ALL12 = [['top', 'front'], ['top', 'back'], ['top', 'left'], ['top', 'right'], ['bottom', 'front'], ['bottom', 'back'], ['bottom', 'left'], ['bottom', 'right'], ['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']];
add({ id: 'bt-ring4-top-r3', script: PE(TOP4, 3) });
add({ id: 'bt-ring4-top-d3', script: PE(TOP4, 3, 'bevel') });
add({ id: 'bt-ring4-top-r1', script: PE(TOP4, 1) });
add({ id: 'bt-all12-r2', script: PE(ALL12, 2) });
add({ id: 'bt-all12-d2', script: PE(ALL12, 2, 'bevel') });
add({ id: 'bt-all12-r4', script: PE(ALL12, 4) });
add({ id: 'bt-adj2-r3', script: PE([['top', 'front'], ['top', 'right']], 3) });
add({ id: 'bt-corner3-r2', script: PE([['top', 'front'], ['top', 'right'], ['front', 'right']], 2) });
add({ id: 'bt-vert4-r3', script: PE([['front', 'left'], ['front', 'right'], ['back', 'left'], ['back', 'right']], 3) });
// oversize batches (a correct system refuses these)
add({ id: 'bt-ring4-top-d16-oversize', script: PE(TOP4, 16, 'bevel') });
add({ id: 'bt-pair-d16-oversize', script: PE([['top', 'front'], ['top', 'back']], 16, 'bevel') });

const lines = [];
const res = [];
for (const c of CASES) {
  if (only.length && !only.some((o) => c.id.startsWith(o))) continue;
  const row = { id: c.id, script: c.script, fc: c.fc ?? null };
  try {
    const r = runScript(c.script);
    if (r.errors.length) { row.interp = r.errors.map((e) => e.message); res.push(row); console.log(c.id, 'SCRIPT-REFUSED', row.interp[0]); continue; }
    const feats = r.doc.features;
    const first = feats.findIndex((f) => f.kind === 'fillet');
    const prefix = feats.slice(0, first); const blends = feats.slice(first);
    if (!blends.every((f) => f.kind === 'fillet')) throw new Error('non-fillet feature after the first blend');
    const style = blends[0].style; const size = blends[0].size;
    row.n = c.manualPicks ? c.manualPicks.length : blends.length; row.style = style; row.size = size;
    const lastId = prefix[prefix.length - 1].id;
    // OCCT base shape and sequential result
    const baseDoc = { version: 1, features: prefix };
    const b0 = buildDoc(oc, baseDoc, arc);
    const base = b0.shapes.get(lastId);
    row.base = occtMeasure(base);
    try { const bs = buildDoc(oc, { version: 1, features: feats }, arc); const s = bs.shapes.get(blends[blends.length - 1].id); row.occtSeq = s ? (({ volume, faces }) => ({ volume, faces }))(occtMeasure(s)) : { refused: [...(bs.refusals ?? [])].join(' | ') }; } catch (e) { row.occtSeq = { refused: e.message.slice(0, 200) }; }
    // picks (brep-rs resolve, same as the rig); a closed circle gets the translator's own off-centre candidates
    const picks = [];
    if (c.manualPicks) for (const p of c.manualPicks) picks.push({ centroid: p, length: 0 });
    else for (let i = 0; i < blends.length; i++) {
      const pre = feats.slice(0, first + i);
      const rr = JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: pre }), JSON.stringify(blends[i].edge)));
      if (!rr || rr.kind !== 'edge') throw new Error(`pick ${i}: ${JSON.stringify(rr)}`);
      picks.push({ centroid: rr.centroid, length: rr.length });
    }
    row.picks = picks.map((p) => p.centroid.map((v) => +v.toFixed(4)));
    // SolidCraft: base commands from the translator, then ONE call
    const tr = translateDoc(solveDoc(baseDoc), { arc, mt, runSC, resolveAt: () => null });
    const built = tr.features.filter((f) => f.status === 'built').at(-1);
    const body = built.measure.bodies[0];
    const mk = (pts) => (style === 'chamfer' ? { command: 'solid.chamfer', params: { edges: pts, distance: size, body } } : { command: 'solid.fillet', params: { edges: pts, radius: size, body } });
    const variants = [picks.map((p) => p.centroid)];
    if (c.circle && !c.manualPicks) { const rad = picks[0].length / (2 * PI); variants.length = 0; for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) variants.push(picks.map((p) => add3(p.centroid, a.map((v) => v * rad)))); }
    row.sc = { variantsTried: 0 };
    for (const v of variants) {
      row.sc.variantsTried++;
      const t0 = Date.now();
      const rs = runSC([...tr.commands, mk(v)]);
      row.sc.ms = Date.now() - t0;
      if (rs.ok) { const bb = rs.measure.bodies.find((x) => x.name === body); row.sc.volume = bb.volume_mm3; row.sc.faces = bb.faces; row.sc.pick = v; delete row.sc.error; break; }
      row.sc.error = `${rs.failed?.command}: ${rs.failed?.error}`;
    }
    // OCCT simultaneous on the same picks
    const edgeAt = (pt) => {
      const exp = new oc.TopExp_Explorer(base, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      let best = null; let bd = Infinity;
      while (exp.More()) {
        const e = oc.TopoDS.Edge(exp.Current());
        const cur = new oc.BRepAdaptor_Curve(e);
        const u0 = cur.FirstParameter(); const u1 = cur.LastParameter();
        let m = Infinity;
        for (let i = 0; i <= 400; i++) { const p = cur.Value(u0 + (u1 - u0) * i / 400); m = Math.min(m, Math.hypot(p.X() - pt[0], p.Y() - pt[1], p.Z() - pt[2])); }
        if (m < bd) { bd = m; best = e.clone(); }
        exp.Next();
      }
      return { e: best, d: bd };
    };
    const occtPicks = (c.circle && !c.manualPicks) ? row.sc.pick ?? variants[0] : picks.map((p) => p.centroid);
    const eds = occtPicks.map(edgeAt);
    row.occtEdgeDist = Math.max(...eds.map((x) => x.d));
    const maker = style === 'chamfer' ? new oc.BRepFilletAPI_MakeChamfer(base) : new oc.BRepFilletAPI_MakeFillet(base, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    const uniq = [];
    for (const x of eds) if (!uniq.some((u) => u.IsSame(x.e))) uniq.push(x.e);
    for (const e of uniq) maker.Add(size, e);
    let done = false;
    try { maker.Build(new oc.Message_ProgressRange()); done = maker.IsDone(); } catch { done = false; }
    row.occtSim = done ? (({ volume, faces }) => ({ volume, faces, edges: uniq.length }))(occtMeasure(maker.Shape())) : { refused: 'BRepFilletAPI did not complete', edges: uniq.length };
    // SolidCraft one-by-one (what the rig emits today): translate the full doc
    const trSeq = translateDoc(solveDoc({ version: 1, features: feats }), { arc, mt, runSC, resolveAt: (pre, nm) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: pre }), JSON.stringify(nm))); } catch { return null; } } });
    const lastF = trSeq.features.at(-1);
    row.scSeq = lastF.status === 'built' ? { volume: lastF.measure.volume, faces: lastF.measure.faces } : { refused: lastF.refusal, firstRefusedAt: trSeq.features.findIndex((f) => f.status !== 'built') + 1 - first };
    // comparisons
    if (row.sc.volume !== undefined) {
      row.dBatchVsOcctSim = row.occtSim.volume !== undefined ? rel(row.sc.volume, row.occtSim.volume) : null;
      row.dBatchVsOcctSeq = row.occtSeq.volume !== undefined ? rel(row.sc.volume, row.occtSeq.volume) : null;
      row.dBatchVsFc = c.fc ? rel(row.sc.volume, c.fc.volume) : null;
    }
  } catch (e) { row.error = e.stack.slice(0, 500); }
  res.push(row); writeFileSync(outFile, JSON.stringify(res, null, 1));
  const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  const s = `${c.id.padEnd(30)} n=${row.n} batch ${row.sc?.volume?.toFixed(4) ?? 'REFUSED ' + (row.sc?.error ?? '').slice(0, 90)} f${row.sc?.faces ?? '-'} | occtSim ${row.occtSim?.volume?.toFixed(4) ?? row.occtSim?.refused} f${row.occtSim?.faces ?? '-'} | occtSeq ${row.occtSeq?.volume?.toFixed(4) ?? 'ref'} f${row.occtSeq?.faces ?? '-'} | scSeq ${row.scSeq?.volume?.toFixed(4) ?? 'REFUSED@' + row.scSeq?.firstRefusedAt} | d(batch,sim) ${ex(row.dBatchVsOcctSim)} d(batch,fc) ${ex(row.dBatchVsFc)} ${row.error ?? ''}`;
  console.log(s); lines.push(s);
}
writeFileSync(outFile, JSON.stringify(res, null, 1));
