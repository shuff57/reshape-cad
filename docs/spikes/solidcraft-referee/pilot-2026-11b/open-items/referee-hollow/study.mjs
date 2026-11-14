// A hollow answered by ONE join of OCCT (the other fails) has nothing to confirm it. This tries a check that needs no second kernel: sample points of the
// source part, and for each one that MUST be wall (nearer than 0.9 t to a closed face) or MUST be hollow (further than 1.8 t from every face: a mitred
// corner reaches t*sqrt(3)), ask whether the answer has material there.   node study.mjs <everyNthSame> <rig case dir> <corpus> <out.json>   (study.sh runs it, one process a corpus)
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const WT = process.env.WT || new URL('../../../../../../', import.meta.url).pathname; const imp = (p) => import(pathToFileURL(p).href);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const { resolveNameAsUsedBy } = await imp(path.join(WT, 'packages/brep-adapter/dist/topo-resolve.js'));
const oc = C.oc; const R = process.env.HOME + '/.cache/solidcraft-0.30.1-rig'; const NTH = +(process.argv[2] ?? 10);
const vol = (s) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, g, 1e-7, false, false); return g.Mass(); };
const subs = (s, kind) => { const out = []; const e = new oc.TopExp_Explorer(s, oc.TopAbs_ShapeEnum[kind], oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while (e.More()) { out.push(e.Current().clone()); e.Next(); } return out; };
const dist = (v, s) => { const d = new oc.BRepExtrema_DistShapeShape(v, s, 1e-7); const ok = d.IsDone(); const val = ok ? d.Value() : NaN; d.delete?.(); return val; };
const inside = (v, solids) => solids.some((s) => dist(v, s) < 1e-9);
function hollow(src, open, t, join) {
  try { const op = new oc.BRepOffsetAPI_MakeThickSolid(); const faces = new oc.NCollection_List_TopoDS_Shape(); if (open) faces.Append(open);
    op.MakeThickSolidByJoin(src, faces, -t, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType[join], false);
    op.Build(new oc.Message_ProgressRange()); if (!op.IsDone()) return null;
    let shape = op.Shape();
    if (!open) { const c = new oc.BRepAlgoAPI_Cut(src, shape, new oc.Message_ProgressRange()); if (!c.IsDone()) return null; shape = c.Shape(); }
    const v = vol(shape); return Number.isFinite(v) && v > 0 && v < vol(src) ? { shape, v } : null; } catch { return null; }
}
/** { wall: [n asked, n wrong], cav: [n asked, n wrong], ms }. One distance object per shape, loaded once and asked for every point; every kernel object made here is deleted here. */
export function probe(src, open, t, ans, N = 6) {
  const t0 = performance.now(); const box = new oc.Bnd_Box(); oc.BRepBndLib.Add(src, box, true); const lo = box.CornerMin(), hi = box.CornerMax();
  const L = [lo.X(), lo.Y(), lo.Z()], H = [hi.X(), hi.Y(), hi.Z()]; lo.delete(); hi.delete(); box.delete();
  const made = []; const ext = (s) => { const d = new oc.BRepExtrema_DistShapeShape(); d.SetDeflection(1e-7); d.LoadS2(s); made.push(d); return d; };
  const sS = subs(src, 'TopAbs_SOLID'), sA = subs(ans, 'TopAbs_SOLID'), shells = subs(src, 'TopAbs_SHELL');
  const eS = sS.map(ext), eA = sA.map(ext), eB = shells.map(ext), eO = open ? ext(open) : null;
  const r = { wall: [0, 0], cav: [0, 0], ms: 0, bad: [], solids: sA.length };
  const at = (p, f) => { const g = new oc.gp_Pnt(p[0], p[1], p[2]); const mk = new oc.BRepBuilderAPI_MakeVertex(g); const v = mk.Vertex(); try { return f(v); } finally { v.delete(); mk.delete(); g.delete(); } };
  /** distance from the point to the shape of this distance object, and the nearest point of the shape */
  const near = (v, d) => { d.LoadS1(v); const pr = new oc.Message_ProgressRange(); try { if (!d.Perform(pr) || d.NbSolution() < 1) return { d: NaN, q: null }; const g = d.PointOnShape2(1); const q = [g.X(), g.Y(), g.Z()]; g.delete(); return { d: d.Value(), q }; } finally { pr.delete(); } };
  const inside = (v, es) => es.some((d) => near(v, d).d < 1e-9);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    // not the middle of a cell: a part's planes of symmetry would put every point on a face of the hollow
    const p = [L[0] + (i + 0.37) / N * (H[0] - L[0]), L[1] + (j + 0.41) / N * (H[1] - L[1]), L[2] + (k + 0.43) / N * (H[2] - L[2])];
    const got = at(p, (v) => { if (!inside(v, eS)) return null; let best = { d: Infinity, q: null }; for (const d of eB) { const n = near(v, d); if (n.d < best.d) best = n; } return { best, inA: inside(v, eA) }; });
    if (!got || !(got.best.d > 0.05 * t) || !got.best.q) continue; const { d: dB, q } = got.best;
    // further than 1.8 t from every face: hollow, whichever join (a mitred corner reaches t * sqrt(3))
    if (dB > 1.8 * t) { r.cav[0]++; if (got.inA) { r.cav[1]++; r.bad.push(['hollow', p, dB]); } }
    // half a wall in from the nearest point of the boundary, on the way to p: its nearest boundary point is the same one, so it is 0.5 t deep. Wall, unless
    // that nearest face is the open one.
    if (dB >= 0.5 * t) { const w = q.map((c, x) => c + (p[x] - c) * (0.5 * t / dB));
      const res = at(w, (v) => ((eO && near(v, eO).d < 0.55 * t) ? null : inside(v, eA)));
      if (res !== null) { r.wall[0]++; if (!res) { r.wall[1]++; r.bad.push(['wall', w, 0.5 * t]); } } }
  }
  for (const d of made) d.delete(); for (const s of [...sS, ...sA, ...shells]) s.delete();
  r.ms = performance.now() - t0; return r;
}
if (process.argv[1].endsWith('/study.mjs')) {
  const sets = [[process.argv[3], [process.argv[4]]]]; const OUTF = process.argv[5];
  const out = []; let nSame = 0; const tally = {};
  for (const [d, cs] of sets) for (const c of cs) for (const cse of JSON.parse(fs.readFileSync(`${R}/${d}/${c}.json`, 'utf8'))) {
    let raw; if (typeof cse.script === 'string') { const r = C.runScript(cse.script); if (r.errors.length) continue; raw = r.doc; } else raw = cse.doc;
    if (!raw.features.some((f) => f.kind === 'shell')) continue;
    let doc, built; try { doc = C.solveDoc(structuredClone(raw)); built = buildDoc(oc, doc, C.arc); } catch { continue; }
    for (const f of doc.features) { if (f.kind !== 'shell' || !(f.thickness > 0)) continue;
      const src = built.shapes.get(f.target); if (!src) continue;
      let open = null; if (f.open) { try { open = resolveNameAsUsedBy(oc, f.open, built, f.target); } catch { open = null; } if (!open) continue; }
      const a = hollow(src, open, f.thickness, 'GeomAbs_Arc'), m = hollow(src, open, f.thickness, 'GeomAbs_Intersection');
      let cls; if (!a && !m) continue; else if (!m) cls = 'arc only'; else if (!a) cls = 'mitre only'; else if (Math.abs(a.v - m.v) <= 1e-7 * Math.max(a.v, m.v)) cls = 'same'; else cls = 'differ';
      if (cls === 'same' && (nSame++ % NTH)) continue;
      const row = { where: `${c}:${cse.id.replace(/^[^#]+#\d+ /, '')} ${f.id}`, cls, t: f.thickness };
      for (const [nm, x] of [['arc', a], ['mitre', m]]) { if (!x) continue; let pr; try { pr = probe(src, open, f.thickness, x.shape); } catch (e) { pr = { threw: String(e).slice(0, 80) }; }
        row[nm] = { v: x.v, ...pr }; const fail = pr.threw ? 'threw' : (pr.wall[1] + pr.cav[1] > 0 ? 'FAILS' : (pr.wall[0] + pr.cav[0] === 0 ? 'no points' : 'passes')); const k = `${cls} | ${nm} ${fail}`; tally[k] = (tally[k] ?? 0) + 1; row[nm].verdict = fail; }
      out.push(row);
    }
  }
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
  for (const k of Object.keys(tally).sort()) console.log(String(tally[k]).padStart(6), k);
  const ms = out.flatMap((r) => [r.arc?.ms, r.mitre?.ms]).filter((x) => x > 0).sort((a, b) => a - b); console.log('probe ms: median', ms[ms.length >> 1]?.toFixed(0), 'max', ms.at(-1)?.toFixed(0));
}
