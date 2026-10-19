// SPIKE, referee only. The independent side of the live runs: live OCCT (replicad-opencascadejs) and live brep-rs (archive/brep-rs/pkg), plus the rig's node solidcraft wasm.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun ...   (imports ../base.mjs, which loads OCCT, brep-rs and the rig wasm once)
// occtSim  : ALL the picked edges handed to ONE BRepFilletAPI_MakeFillet / _MakeChamfer (the simultaneous operation a rim or a loop is)
// occtSeq  : buildDoc of the whole doc = the blends one after the other (what the repo's occt-build does for one-feature-per-edge docs)
// brepSeq  : brep-rs measure_doc of the whole doc
// verdict  : truck number vs oracle number under the bars of this spike: planar 1e-9 relative, curved 3e-4 (truck volumes of curved solids are tessellation-derived), faces equal
import { oc, brep, arc, buildDoc, occtMeasure, solveDoc, runSC, rel } from '../base.mjs';

export { oc, brep, arc, solveDoc, runSC, rel, occtMeasure };
export const firstBlend = (doc) => doc.features.findIndex((f) => f.kind === 'fillet');

export function occtBase(doc) {
  const i = firstBlend(doc);
  const prefix = i < 0 ? doc.features : doc.features.slice(0, i);
  const b = buildDoc(oc, { version: 1, features: prefix }, arc);
  const id = prefix[prefix.length - 1].id;
  return { shape: b.shapes.get(id), id, prefix };
}

function edgeAt(base, pt) {
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
}

export function occtSim(doc, picks, size, style) { return occtSimSizes(doc, picks, picks.map(() => size), style); }
/** simultaneous maker with a size PER EDGE */
export function occtSimSizes(doc, picks, sizes, style) {
  let base;
  try { base = occtBase(doc); } catch (e) { return { refused: `OCCT base: ${e.message}` }; }
  if (!base.shape) return { refused: 'OCCT built no base shape' };
  const eds = picks.map((p) => edgeAt(base.shape, p));
  const worst = Math.max(...eds.map((x) => x.d));
  const maker = style === 'chamfer' ? new oc.BRepFilletAPI_MakeChamfer(base.shape) : new oc.BRepFilletAPI_MakeFillet(base.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const uniq = [];
  for (const x of eds) if (!uniq.some((u) => u.IsSame(x.e))) uniq.push(x.e);
  const added = [];
  eds.forEach((x, i) => { if (!added.some((u) => u.IsSame(x.e))) { added.push(x.e); maker.Add(sizes[i], x.e); } });
  let done = false; let why = '';
  try { maker.Build(new oc.Message_ProgressRange()); done = maker.IsDone(); } catch (e) { why = String(e?.message ?? e).slice(0, 120); }
  if (!done) return { refused: why || 'OCCT maker not done', edgeDist: worst };
  let shape; try { shape = maker.Shape(); } catch (e) { return { refused: 'OCCT Shape(): ' + String(e?.message ?? e).slice(0, 100) }; }
  const m = occtMeasure(shape);
  return { volume: m.volume, faces: m.faces, bbox: m.bbox, types: m.types, edgeDist: worst, distinctEdges: uniq.length };
}

export function occtSeq(doc) {
  try {
    const b = buildDoc(oc, doc, arc);
    const last = doc.features[doc.features.length - 1].id;
    const s = b.shapes.get(last);
    const refusals = b.refusals ? Object.fromEntries(b.refusals) : {};
    if (!s) return { refused: Object.values(refusals).join(' | ') || 'no shape' };
    const m = occtMeasure(s);
    // buildDoc keeps the shape WITHOUT a blend it refused and lists the reason: that is a refusal, not a result
    if (Object.keys(refusals).length) return { refused: Object.values(refusals).join(' | ').slice(0, 200), shapeWithout: { volume: m.volume, faces: m.faces } };
    return { volume: m.volume, faces: m.faces, bbox: m.bbox };
  } catch (e) { return { refused: String(e.message).slice(0, 160) }; }
}

export function brepSeq(doc) {
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const last = doc.features[doc.features.length - 1].id;
    const s = got.shapes?.[last];
    if (!s) return { refused: got.refusals?.[last] ?? 'no shape' };
    if (Object.keys(got.refusals ?? {}).length) return { refused: Object.values(got.refusals).join(' | ').slice(0, 200), shapeWithout: { volume: s.volume, faces: s.faces } };
    return { volume: s.volume, faces: s.faces, bbox: [...s.bbox[0], ...s.bbox[1]] };
  } catch (e) { return { refused: `brep-rs threw: ${e.message}` }; }
}

/** closed-form-free verdict of a truck number against an oracle number */
export function verdict(truck, oracle) {
  if (!truck || truck.refused) return 'truck-refused';
  if (!oracle) return 'no-oracle';
  if (oracle.refused) return 'oracle-refused';
  const curved = truck.faceTypes ? Object.keys(truck.faceTypes).some((k) => k !== 'plane') : false;
  const tol = curved ? 3e-4 : 1e-9;
  const dv = rel(truck.volume, oracle.volume);
  if (dv > tol) return `volume-differs ${dv.toExponential(1)}`;
  if (truck.faces !== oracle.faces) return `faces ${truck.faces} vs ${oracle.faces}`;
  return 'match';
}
