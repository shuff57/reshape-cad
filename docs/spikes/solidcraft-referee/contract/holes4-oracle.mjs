// ROUND 4. A RECESS-AWARE OCCT ORACLE for the holes group. SPIKE, referee only.
//
// Why it exists: the repo's OCCT referee (packages/brep-adapter/src/occt-build.ts, read-only) builds a hole as a plain bore and IGNORES `counterbore` /
// `countersink`, so for every recess row the only oracles were brep-rs (which refuses breakouts and tangent rims) and a numeric closed form (a 1400 x 1400 grid,
// about 1 mm3 off in the breakout rows). This file is a second, exact, independent oracle: the whole tool (bore + counterbore cylinder, or bore + countersink
// frustum) is ONE solid of revolution built in OCCT from its profile polygon (BRepPrimAPI_MakeRevol, the same way occt-build.ts builds a cone: MakeCone is not bound
// in this OCCT build), placed on the hole's axis, fused with the other centres of a holes() call, and cut from the host that OCCT built for the hole's target.
// It reads only the HoleFeature fields (diameter, depth, center, axis, corners, counterbore, countersink); it shares no code with the translator's guards.
//
//   occtChain(oc, built, doc, lastHoleId) -> { shape, hosts }   shape = the host with every hole of the chain cut, in order
import { measureShape } from '../../../../packages/brep-adapter/dist/occt-build.js';

const AXI = { x: 0, y: 1, z: 2 };

/** the tool's profile in (rho, z) for one centre; z is the ABSOLUTE coordinate along the drill axis. top/lo = host extent along the axis. */
export function toolProfile(f, top, lo, c0z) {
  const r = f.diameter / 2;
  const through = c0z - f.depth / 2 <= lo + 1e-9 && c0z + f.depth / 2 >= top - 1e-9;
  const ext = 1; // the tool runs 1 mm past the host so no face is coplanar with a host face
  const zb0 = through ? lo - ext : c0z - f.depth / 2;
  const zb1 = through ? top + ext : c0z + f.depth / 2;
  if (!f.counterbore && !f.countersink) return [[0, zb0], [r, zb0], [r, zb1], [0, zb1]];
  if (f.counterbore) {
    const R = f.counterbore.diameter / 2; const zc = top - f.counterbore.depth;
    return [[0, zb0], [r, zb0], [r, zc], [R, zc], [R, top + ext], [0, top + ext]];
  }
  const R = f.countersink.diameter / 2; const tn = Math.tan((f.countersink.angleDeg * Math.PI) / 360);
  const dc = (R - r) / tn; const zc = top - dc;
  const pts = [[0, zb0]];
  if (zc >= zb0) pts.push([r, zb0], [r, zc]); else pts.push([R - (top - zb0) * tn, zb0]); // the cone leaves through the bottom of the bore
  pts.push([R, top], [R + ext * tn, top + ext], [0, top + ext]);
  return pts;
}

function revolved(oc, prof) {
  const p = (rho, z) => new oc.gp_Pnt(rho, 0, z);
  const wire = new oc.BRepBuilderAPI_MakeWire();
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i]; const b = prof[(i + 1) % prof.length];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) continue;
    wire.Add(new oc.BRepBuilderAPI_MakeEdge(p(a[0], a[1]), p(b[0], b[1])).Edge());
  }
  const face = new oc.BRepBuilderAPI_MakeFace(wire.Wire(), false).Face();
  const axis = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));
  return new oc.BRepPrimAPI_MakeRevol(face, axis, 2 * Math.PI, true).Shape();
}
function trsf(oc, shape, build) { const t = new oc.gp_Trsf(); build(t); return new oc.BRepBuilderAPI_Transform(shape, t, false).Shape(); }
function placed(oc, tool, axis, perp) {
  let s = tool;
  if (axis === 'x') s = trsf(oc, s, (t) => t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 1, 0)), Math.PI / 2)); // z -> x
  if (axis === 'y') s = trsf(oc, s, (t) => t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(1, 0, 0)), -Math.PI / 2)); // z -> y
  return trsf(oc, s, (t) => t.SetTranslation(new oc.gp_Vec(perp[0], perp[1], perp[2])));
}

/** cut hole `f` (a HoleFeature) from `host` (an OCCT shape) the way the layer defines it. Returns the new shape. */
export function cutHole(oc, host, f) {
  const { bbox } = measureShape(oc, host);
  const ctr = [0, 1, 2].map((i) => (bbox[0][i] + bbox[1][i]) / 2 + f.center[i]);
  const ai = AXI[f.axis ?? 'z']; const axis = f.axis ?? 'z';
  const lo = bbox[0][ai]; const top = bbox[1][ai];
  const profile = toolProfile(f, top, lo, ctr[ai]);
  const base = revolved(oc, profile);
  const c0 = ctr.slice();
  const centres = f.corners
    ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [c0[0] + sx * f.corners.dx, c0[1] + sy * f.corners.dy, c0[2]])
    : [c0];
  let tool = null;
  for (const c of centres) {
    const perp = [0, 0, 0]; for (let i = 0; i < 3; i++) if (i !== ai) perp[i] = c[i];
    const t = placed(oc, base, axis, perp);
    if (!tool) tool = t; else { const u = new oc.BRepAlgoAPI_Fuse(tool, t); u.Build(new oc.Message_ProgressRange()); tool = u.Shape(); }
  }
  const cut = new oc.BRepAlgoAPI_Cut(host, tool);
  cut.Build(new oc.Message_ProgressRange());
  return cut.Shape();
}

/** the chain of holes ending at `lastId` (oldest first) and the id of the feature the first one drills */
export function chainOf(doc, lastId) {
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const chain = []; let cur = byId.get(lastId);
  while (cur && cur.kind === 'hole') { chain.unshift(cur); cur = byId.get(cur.target); }
  return { chain, root: cur ?? null };
}

/** OCCT shape of the whole hole chain ending at lastId, starting from the shape `built` holds for the first hole's target. null if not a hole chain. */
export function occtChain(oc, built, doc, lastId) {
  const { chain, root } = chainOf(doc, lastId);
  if (!chain.length || !root) return null;
  let shape = built.shapes.get(root.id);
  if (!shape) return null;
  for (const h of chain) shape = cutHole(oc, shape, h);
  return { shape, chain: chain.map((h) => h.id), hasRecess: chain.some((h) => h.counterbore || h.countersink) };
}
