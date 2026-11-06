// Shared apparatus for the SolidCore (SolidCraft v0.40.0-rc.2) probe. Referee only; nothing here is imported by the layer.
//   SOLIDCRAFT_REFEREE_PKG  the rc.2 referee pkg (default ~/.cache/solidcraft-0.40.0-rc.2-rig/sc-referee-pkg)
//   BREP_PKG                brep-rs wasm pkg (archive/brep-rs/pkg of a checkout that has it built; read-only)
// Kernel runs happen in a child process (child.mjs) with a wall limit, so a hang is recorded as a hang, not a stuck probe.
// OCCT (replicad-opencascadejs, the referee apparatus) is driven DIRECTLY from the raw command list by occtFromCommands: an
// independent build of what the commands ask for, with the shell done as MakeThickSolidByJoin in both join conventions
// (Intersection = the plane-offset convention P; Arc = what occt-build.ts uses).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = (() => { let d = HERE; for (let i = 0; i < 8; i++) { if (existsSync(path.join(d, 'node_modules', 'replicad-opencascadejs'))) return d; d = path.dirname(d); } throw new Error('repo root not found'); })();
export const RIG = path.join(os.homedir(), '.cache/solidcraft-0.40.0-rc.2-rig');
export const PKG = process.env.SOLIDCRAFT_REFEREE_PKG || path.join(RIG, 'sc-referee-pkg');
export const TOPO = process.env.SOLIDCRAFT_TOPOLOGY_PKG || path.join(RIG, 'sc-referee-pkg-topology');
const require = createRequire(import.meta.url);
const ocDir = path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json', { paths: [REPO] })), 'dist');
const glue = await import(pathToFileURL(path.join(ocDir, 'replicad_single.js')).href);
export let oc = await glue.default({ locateFile: (f) => path.join(ocDir, f) });
export async function resetOcct() { oc = await glue.default({ locateFile: (f) => path.join(ocDir, f) }); }

const TMP = mkdtempSync(path.join(os.tmpdir(), 'sc040-'));
let seq = 0;
/** run a command list on the kernel in a child process; {ok, ms, wall, measure|failed, hang} */
export function kernelRun(cmds, { limitS = 300, pkg = PKG, glueName = 'solidcraft_referee.js' } = {}) {
  const f = path.join(TMP, `c${seq++}.json`); writeFileSync(f, JSON.stringify(cmds));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, 'child.mjs'), pkg, f, glueName], { encoding: 'utf8', timeout: limitS * 1000, maxBuffer: 1 << 28, killSignal: 'SIGKILL' });
  const wall = Date.now() - t0;
  if (r.error?.code === 'ETIMEDOUT' || (r.signal === 'SIGKILL' && wall >= limitS * 1000 - 50)) return { ok: false, hang: true, wall, limitS };
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('@@R@@'));
  if (!line) return { ok: false, crash: true, wall, status: r.status, signal: r.signal, stderr: (r.stderr ?? '').slice(-600) };
  return { ...JSON.parse(line.slice(5)), wall };
}
export const volOf = (res) => (res?.ok ? res.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0) : null);
export const rel = (a, b) => (a == null || b == null ? null : Math.abs(a - b) / Math.abs(b));

// ---------------- OCCT, direct from the command list ----------------
const P3 = (p) => new oc.gp_Pnt(p[0], p[1], p[2]);
function moved(shape, trsf) { return new oc.BRepBuilderAPI_Transform(shape, trsf, true).Shape(); }
function translate(shape, v) { const t = new oc.gp_Trsf(); t.SetTranslation(new oc.gp_Vec(v[0], v[1], v[2])); return moved(shape, t); }
function zTo(shape, a) { // rotate +z onto unit axis a
  const n = Math.hypot(...a); const u = a.map((x) => x / n);
  const c = u[2]; if (c > 1 - 1e-12) return shape;
  const t = new oc.gp_Trsf();
  if (c < -1 + 1e-12) { t.SetRotation(new oc.gp_Ax1(P3([0, 0, 0]), new oc.gp_Dir(1, 0, 0)), Math.PI); return moved(shape, t); }
  const ax = [-u[1], u[0], 0]; // z x u
  t.SetRotation(new oc.gp_Ax1(P3([0, 0, 0]), new oc.gp_Dir(ax[0], ax[1], ax[2])), Math.acos(c)); return moved(shape, t);
}
export function shapesOf(s, type) { const out = []; const exp = new oc.TopExp_Explorer(s, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while (exp.More()) { const e = exp.Current(); if (!out.some((x) => x.IsSame(e))) out.push(e); exp.Next(); } return out; }
function distTo(shape, p) {
  const v = new oc.BRepBuilderAPI_MakeVertex(P3(p)).Vertex();
  const d = new oc.BRepExtrema_DistShapeShape(v, shape); // the 2-argument overload (this build exports no Extrema_ExtFlag)
  return d.IsDone() ? d.Value() : Infinity;
}
function nearest(list, p) { let best = null, bd = Infinity; for (const s of list) { const d = distTo(s, p); if (d < bd) { bd = d; best = s; } } return { shape: best, d: bd }; }
export function occtVolume(shape) { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false); return g.Mass(); }
function boolOp(kind, a, b) {
  const op = kind === 'cut' ? new oc.BRepAlgoAPI_Cut(a, b) : kind === 'join' ? new oc.BRepAlgoAPI_Fuse(a, b) : new oc.BRepAlgoAPI_Common(a, b);
  op.Build(new oc.Message_ProgressRange()); if (!op.IsDone()) throw new Error(`OCCT ${kind} not done`);
  let out = op.Shape();
  if (kind === 'join') { const u = new oc.ShapeUpgrade_UnifySameDomain(out, true, true, false); u.Build(); out = u.Shape(); }
  const solids = shapesOf(out, oc.TopAbs_ShapeEnum.TopAbs_SOLID); // a boolean returns a compound; the offset wants the solid itself
  return solids.length === 1 ? oc.TopoDS.Solid(solids[0]) : out;
}
/** Build the raw command list in OCCT. join = 'intersection' | 'arc'. Returns {volume, pre, faces} or {error}. */
export function occtFromCommands(cmds, join = 'intersection') {
  const bodies = new Map(); const picks = [];
  for (const c of cmds) {
    const p = c.params;
    switch (c.command) {
      case 'solid.box': {
        let s = new oc.BRepPrimAPI_MakeBox(p.length, p.width, p.height).Shape();
        const lo = p.center ? [p.center[0] - p.length / 2, p.center[1] - p.width / 2, p.center[2] - p.height / 2] : (p.corner ?? [0, 0, 0]);
        bodies.set(p.body_name, translate(s, lo)); break;
      }
      case 'solid.cylinder': {
        let s = new oc.BRepPrimAPI_MakeCylinder(p.radius, p.height).Shape();
        s = zTo(s, p.axis ?? [0, 0, 1]); bodies.set(p.body_name, translate(s, p.base)); break;
      }
      case 'solid.combine': {
        let t = bodies.get(p.target); for (const n of p.tools) { t = boolOp(p.operation, t, bodies.get(n)); bodies.delete(n); }
        bodies.set(p.target, t); break;
      }
      case 'solid.fillet': case 'solid.chamfer': {
        const b = bodies.get(p.body); const edges = shapesOf(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
        const mk = c.command === 'solid.fillet' ? new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational) : new oc.BRepFilletAPI_MakeChamfer(b);
        for (const q of p.edges) { const n = nearest(edges, q); picks.push(n.d); mk.Add(p.radius ?? p.distance, oc.TopoDS.Edge(n.shape)); }
        mk.Build(new oc.Message_ProgressRange()); if (!mk.IsDone()) throw new Error('OCCT fillet/chamfer not done');
        bodies.set(p.body, mk.Shape()); break;
      }
      case 'solid.shell': {
        const b = bodies.get(p.body); const faces = shapesOf(b, oc.TopAbs_ShapeEnum.TopAbs_FACE);
        const closing = new oc.NCollection_List_TopoDS_Shape();
        for (const q of p.faces ?? []) { const n = nearest(faces, q); picks.push(n.d); closing.Append(n.shape); }
        const pre = occtVolume(b);
        const op = new oc.BRepOffsetAPI_MakeThickSolid();
        op.MakeThickSolidByJoin(b, closing, -p.thickness, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, join === 'intersection', false,
          join === 'intersection' ? oc.GeomAbs_JoinType.GeomAbs_Intersection : oc.GeomAbs_JoinType.GeomAbs_Arc, false);
        op.Build(new oc.Message_ProgressRange()); if (!op.IsDone()) return { error: `thick solid (${join}) not done`, pre };
        const after = occtVolume(op.Shape());
        // sanity, not tuning: OCCT's thick solid on a boolean-joined part can report done and return the part (or most of it) un-hollowed.
        // Its number is used as an oracle only when the result is a valid solid (BRepCheck) that removed at least 10% of the part.
        const valid = new oc.BRepCheck_Analyzer(op.Shape(), true, false).IsValid();
        if (!(after > 0) || !valid || after > 0.9 * pre) return { error: `thick solid (${join}) not usable: valid=${valid}, ${after.toFixed(4)} of ${pre.toFixed(4)} kept`, raw: after, pre };
        bodies.set(p.body, op.Shape()); bodies.__pre = pre; break;
      }
      default: return { error: `OCCT direct: ${c.command} not modelled` };
    }
  }
  let v = 0; for (const s of bodies.values()) v += occtVolume(s);
  return { volume: v, pre: bodies.__pre ?? null, maxPickDist: Math.max(0, ...picks) };
}
export function occtSafe(cmds, join) { try { return occtFromCommands(cmds, join); } catch (e) { return { error: String(e?.message ?? e).slice(0, 200) }; } }
