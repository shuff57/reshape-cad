#!/usr/bin/env node
// SPIKE, not a gate. solidcraft (truck) compiled to wasm as a THIRD referee beside OCCT and brep-rs.
// Not part of npm test, not an EngineAdapter, never imported into the app origin.
//
//   SOLIDCRAFT_REFEREE_PKG=<dir with solidcraft_referee.js + _bg.wasm, wasm-bindgen --target nodejs> \
//     node docs/spikes/solidcraft-referee/run.mjs
//
// Needs `npm run build` first (reads packages/*/dist) and packages/brep-rs/pkg. Skips if the env is unset.
// OCCT is measured live, unrounded, the same way scripts/brep-parity-gate.mjs does. No hardcoded numbers.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.log('SOLIDCRAFT_REFEREE_PKG unset: skipping (this is a spike, not a gate)'); process.exit(0); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

// Each fixture: our ModelDoc feature (centred at origin) and the solidcraft commands for the same shape.
const FIX = [
  { id: 'box', f: { id: 'a', kind: 'box', size: [40, 30, 20], center: [0, 0, 0] },
    cmds: [{ command: 'solid.box', params: { length: 40, width: 30, height: 20, center: [0, 0, 0] } }], analytic: 40 * 30 * 20 },
  { id: 'cylinder', f: { id: 'a', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0] },
    cmds: [{ command: 'solid.cylinder', params: { radius: 12, height: 30, base: [0, 0, -15], axis: 'Z' } }], analytic: Math.PI * 144 * 30 },
  { id: 'sphere', f: { id: 'a', kind: 'sphere', radius: 15, center: [0, 0, 0] },
    cmds: [{ command: 'solid.sphere', params: { radius: 15, center: [0, 0, 0] } }], analytic: (4 / 3) * Math.PI * 15 ** 3 },
  { id: 'torus', f: { id: 'a', kind: 'torus', ringRadius: 14, tubeRadius: 4, center: [0, 0, 0] },
    cmds: [{ command: 'solid.torus', params: { major: 14, minor: 4, center: [0, 0, 0] } }], analytic: 2 * Math.PI ** 2 * 14 * 16 },
];

// Round 2: booleans, fillet, shell. Picks are by 3D point (solidcraft has no names).
const B = { id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] };
const BOX = { command: 'solid.box', params: { length: 40, width: 40, height: 20, center: [0, 0, 0] } };
const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const cylC = (r, h) => ({ command: 'solid.cylinder', params: { radius: r, height: h, base: [0, 0, -h / 2], axis: 'Z', operation: 'OP' } });
const withOp = (c, op) => ({ ...c, params: { ...c.params, operation: op } });
const R2 = [
  { id: 'boolean-cut', fs: [B, { id: 'c1', kind: 'cylinder', radius: 8, height: 40, center: [0, 0, 0] }, { id: 'op1', kind: 'combine', op: 'subtract', targets: ['b1', 'c1'] }],
    cmds: [BOX, withOp(cylC(8, 40), 'cut')] },
  { id: 'boolean-union', fs: [B, { id: 'c1', kind: 'cylinder', radius: 8, height: 40, center: [0, 0, 0] }, { id: 'op1', kind: 'combine', op: 'union', targets: ['b1', 'c1'] }],
    cmds: [BOX, withOp(cylC(8, 40), 'join')] },
  { id: 'boolean-intersect', fs: [B, { id: 'c1', kind: 'cylinder', radius: 15, height: 40, center: [0, 0, 0] }, { id: 'op1', kind: 'combine', op: 'intersect', targets: ['b1', 'c1'] }],
    cmds: [BOX, withOp(cylC(15, 40), 'intersect')] },
  { id: 'boolean-cut-x-axis-cylinder', fs: [B, { id: 'c', kind: 'cylinder', radius: 5, height: 60, center: [0, 0, 0], rotate: [0, 90, 0] }, { id: 'op1', kind: 'combine', op: 'subtract', targets: ['b1', 'c'] }],
    cmds: [BOX, { command: 'solid.cylinder', params: { radius: 5, height: 60, base: [-30, 0, 0], axis: 'X', operation: 'cut' } }] },
  { id: 'round-one-edge', tol: 'approx', fs: [B, { id: 'r1', kind: 'fillet', target: 'b1', size: 4, style: 'fillet',
      edge: { cause: 'between', feature: 'b1', kind: 'edge', of: [face('b1', '+z'), face('b1', '+x')] } }],
    cmds: [BOX, { command: 'solid.fillet', params: { edges: [[20, 0, 10]], radius: 4 } }] },
  { id: 'shell-open-top', fs: [B, { id: 'shell1', kind: 'shell', target: 'b1', thickness: 2, open: face('b1', '+z') }],
    cmds: [BOX, { command: 'solid.shell', params: { faces: [[0, 0, 10]], thickness: 2 } }] },
  { id: 'shell-closed', fs: [B, { id: 'shell1', kind: 'shell', target: 'b1', thickness: 2 }],
    cmds: [BOX, { command: 'solid.shell', params: { thickness: 2 } }] },
];

const rel = (a, b) => (Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1) : Infinity);
const flat = (b) => [...b[0], ...b[1]];
const ALL = [...FIX.map((f) => ({ id: f.id, fs: [f.f], cmds: f.cmds })), ...R2];
const rows = [];
for (const fx of ALL) {
  const doc = { version: 1, features: fx.fs };
  const mid = fx.fs[fx.fs.length - 1].id;
  const built = buildDoc(oc, doc, arc);
  const shape = built.shapes.get(mid);
  if (!shape) { rows.push({ id: fx.id, occt: { volume: NaN, faces: 0 }, brep: { refused: 'OCCT built nothing' }, truck: {} }); continue; }
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(), hi = bx.CornerMax();
  const occt = { volume: g.Mass(), bbox: [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]], faces: facesOf(oc, shape).length };
  const br = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const bs = br.shapes?.[mid];
  const t0 = Date.now();
  let tr;
  try { tr = JSON.parse(sc.run(JSON.stringify({ commands: fx.cmds }))); } catch (e) { tr = { ok: false, error: `WASM TRAP: ${e.message}` }; }
  const ms = Date.now() - t0;
  const tb = tr.ok && tr.measure.body_count === 1 ? tr.measure.bodies[0] : null;
  if (tr.ok && !tb) tr.error = `solidcraft returned ${tr.measure.body_count} bodies`;
  const truck = tb ? { volume: tb.volume_mm3, bbox: [tb.bbox.min, tb.bbox.max], faces: tb.faces } : null;
  const bboxD = (m) => Math.max(...flat(occt.bbox).map((w, i) => rel(flat(m.bbox)[i], w)));
  rows.push({
    id: fx.id, occt,
    brep: bs ? { volume: bs.volume, faces: bs.faces, dVol: rel(bs.volume, occt.volume), dBbox: bboxD(bs) } : { refused: br.refusals?.[mid] ?? 'no shape' },
    truck: truck ? { ...truck, dVol: rel(truck.volume, occt.volume), dBbox: bboxD(truck), ms } : { refused: tr.failed ?? tr.error },
  });
}
console.log(JSON.stringify(rows, null, 1));
console.log('\nid         OCCT vol        brep dVol  truck dVol  truck dBbox  faces O/B/T');
for (const r of rows) {
  console.log(`${r.id.padEnd(10)} ${r.occt.volume.toFixed(6).padStart(12)}  ${(r.brep.dVol ?? NaN).toExponential(1).padStart(9)}  ${(r.truck.dVol ?? NaN).toExponential(1).padStart(10)}  ${(r.truck.dBbox ?? NaN).toExponential(1).padStart(10)}   ${r.occt.faces}/${r.brep.faces ?? '-'}/${r.truck.faces ?? '-'}`);
}
