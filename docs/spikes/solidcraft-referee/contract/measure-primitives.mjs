#!/usr/bin/env node
// SPIKE, referee only. Contract measurement for feature group 'primitives'.
// reSHape Script (or a raw ModelDoc) -> runScript -> solveDoc -> { live OCCT, brep-rs wasm, analytic formula, SolidCraft rig }.
//
//   REFEREE_REPO_ROOT=<shadow root>  SOLIDCRAFT_REFEREE_PKG=<pkg>  bun contract/measure-primitives.mjs --out=<dir> [--only=id,id]
//
// REFEREE_REPO_ROOT is a repo root whose packages/*/dist, node_modules and packages/brep-rs/pkg resolve (see RIG.md; brep-rs now
// lives in archive/). The translator is imported from phase0 (read only). Nothing here is part of npm test.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REFEREE_REPO_ROOT ?? path.join(HERE, '..', '..', '..', '..');
const REAL = path.join(HERE, '..', '..', '..', '..');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const prefix = arg('prefix');
const OUT = path.resolve(arg('out') || '.');
mkdirSync(OUT, { recursive: true });
const { translateDoc } = await import(pathToFileURL(path.join(REAL, 'docs/spikes/solidcraft-referee/phase0/translate.mjs')).href);
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
const relv = (a, b) => (typeof a === 'number' && Number.isFinite(a) ? Math.abs(a - b) / Math.max(Math.abs(b), 1e-300) : Infinity);
const flat = (b) => [...b[0], ...b[1]];

// ---- OCCT measure (volume, bbox, COM, per-type face counts) ----------------------------------------------------------
function typeCounts(fs) {
  const T = oc.GeomAbs_SurfaceType; const out = {};
  for (const f of fs) {
    const t = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).GetType();
    const k = t === T.GeomAbs_Plane ? 'plane' : t === T.GeomAbs_Cylinder ? 'cylinder' : t === T.GeomAbs_Cone ? 'cone' : t === T.GeomAbs_Sphere ? 'sphere' : t === T.GeomAbs_Torus ? 'torus' : 'other';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
function occtMeasure(shape) {
  const g = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const c = g.CentreOfMass();
  const bx = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(); const hi = bx.CornerMax();
  const fs = facesOf(oc, shape);
  return { volume: g.Mass(), com: [c.X(), c.Y(), c.Z()], bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], faces: fs.length, types: typeCounts(fs) };
}

// ---- analytic volume (third oracle, no kernel) -----------------------------------------------------------------------
function analyticVolume(f) {
  switch (f.kind) {
    case 'box': return f.round ? null : f.size[0] * f.size[1] * f.size[2];
    case 'cylinder': return f.round ? null : Math.PI * f.radius ** 2 * f.height;
    case 'sphere': return 4 / 3 * Math.PI * f.radius ** 3;
    case 'cone': return Math.PI * f.radius ** 2 * f.height / 3;
    case 'torus': return 2 * Math.PI ** 2 * f.ringRadius * f.tubeRadius ** 2;
    case 'prism': { const n = f.sides; return 0.5 * n * f.radius ** 2 * Math.sin(2 * Math.PI / n) * f.height; }
    case 'wedge': return f.width * f.depth * f.height / 2;
    default: return null;
  }
}
// Exact closed forms for a whole-shape fillet (independent of every kernel).
function analyticRounded(f) {
  if (!f.round || (f.roundStyle ?? 'fillet') !== 'fillet') return null;
  const r = f.round;
  if (f.kind === 'box') {
    const [a, b, c] = f.size.map((v) => v - 2 * r);
    if (a < 0 || b < 0 || c < 0) return null;
    return a * b * c + 2 * r * (a * b + b * c + a * c) + Math.PI * r * r * (a + b + c) + 4 / 3 * Math.PI * r ** 3;
  }
  if (f.kind === 'cylinder') {
    const R = f.radius; const h = f.height;
    if (r > R || 2 * r > h) return null;
    return Math.PI * R * R * (h - 2 * r) + 2 * (Math.PI * (R - r) ** 2 * r + Math.PI ** 2 * r * r * (R - r) / 2 + 2 * Math.PI * r ** 3 / 3);
  }
  return null;
}

// ---- compare one doc -------------------------------------------------------------------------------------------------
const TOL = { planar: 1e-9, curved: 3e-4 };
function measureCase(c) {
  const row = { id: c.id, feature: c.feature, note: c.note ?? '' };
  let doc; let source = c.script ?? null;
  if (c.script !== undefined) {
    const r = runScript(c.script);
    row.script = c.script;
    if (r.errors.length) { row.scriptRefusal = r.errors.map((e) => e.message ?? String(e)); row.status = 'refused-by-script'; return row; }
    doc = r.doc; row.warnings = r.warnings ?? [];
  } else doc = c.doc;
  if (c.mutate) doc = c.mutate(doc);
  row.doc = doc;
  const measureId = c.measure ?? doc.features[doc.features.length - 1].id;
  const f = doc.features.find((x) => x.id === measureId);
  row.kind = f.kind;
  row.analytic = analyticVolume(f) ?? analyticRounded(f);
  const planar = !!c.planar;
  // OCCT
  try {
    const built = buildDoc(oc, doc, arc);
    const shape = built.shapes.get(measureId);
    if (!shape) throw new Error(built.refusals?.get?.(measureId) ?? 'OCCT built nothing');
    row.occt = occtMeasure(shape);
  } catch (e) { row.occt = { refused: e.message }; }
  // brep-rs
  try {
    const got = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const s = got.shapes?.[measureId];
    row.brep = s ? { volume: s.volume, bbox: flat(s.bbox), faces: s.faces } : { refused: got.refusals?.[measureId] ?? 'no shape' };
    if (s && row.occt.volume !== undefined) { row.brep.dVol = relv(s.volume, row.occt.volume); row.brep.dBbox = Math.max(...row.occt.bbox.map((w, i) => Math.abs(row.brep.bbox[i] - w))) / Math.max(Math.hypot(...[0, 1, 2].map((i) => row.occt.bbox[i + 3] - row.occt.bbox[i])), 1e-300); }
  } catch (e) { row.brep = { refused: `brep-rs threw: ${e.message}` }; }
  // SolidCraft
  const solved = solveDoc(doc);
  const tr = translateDoc(solved, { arc, mt, runSC, resolveAt: () => null });
  const mf = tr.features.find((x) => x.id === measureId);
  row.commands = tr.commands;
  if (!mf || mf.status !== 'built') { row.truck = { refused: mf?.refusal ?? 'not built' }; row.status = 'refused-by-solidcraft'; return row; }
  const m = mf.measure;
  const diag = row.occt.bbox ? Math.max(Math.hypot(...[0, 1, 2].map((i) => row.occt.bbox[i + 3] - row.occt.bbox[i])), 1e-300) : Math.max(Math.hypot(...[0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i])), 1e-300);
  const ref = row.occt.volume !== undefined ? row.occt : null;
  const t = { volume: m.volume, bbox: m.bbox, com: m.com, faces: m.faces, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies.length };
  if (ref) {
    t.dVolOcct = relv(m.volume, ref.volume);
    t.dBboxOcct = Math.max(...ref.bbox.map((w, i) => Math.abs(m.bbox[i] - w))) / diag;
    t.dComOcct = Math.max(...m.com.map((v, i) => Math.abs(v - ref.com[i]))) / diag;
    t.facesOcct = ref.faces; t.typesOcct = ref.types;
  }
  if (row.analytic != null) t.dVolAnalytic = relv(m.volume, row.analytic);
  if (row.brep?.volume !== undefined) t.dVolBrep = relv(m.volume, row.brep.volume);
  t.tol = m.curved ? TOL.curved : TOL.planar;
  if (c.fc) {
    const FC = JSON.parse(readFileSync(path.join(REAL, 'docs/replica/freecad/gauntlet/variants/refs', `${c.fc}.json`), 'utf8'));
    const fd = Math.max(Math.hypot(FC.bbox[3] - FC.bbox[0], FC.bbox[4] - FC.bbox[1], FC.bbox[5] - FC.bbox[2]), 1e-300);
    t.freecad = { ref: c.fc, volume: FC.volume, faces: FC.faces, bbox: FC.bbox, com: FC.com,
      dVol: relv(m.volume, FC.volume), dBbox: Math.max(...FC.bbox.map((w, i) => Math.abs(m.bbox[i] - w))) / fd,
      dCom: Math.max(...m.com.map((v, i) => Math.abs(v - FC.com[i]))) / fd, facesEqual: m.faces === FC.faces };
  }
  row.truck = t;
  row.planar = planar;
  return row;
}

// ---- cases -----------------------------------------------------------------------------------------------------------
const feat = (kind, o) => ({ id: 'x1', kind, center: [0, 0, 0], ...o });
const docOf = (...fs) => ({ version: 1, features: fs });
const cases = [];
const add = (id, feature, script, extra = {}) => cases.push({ id, feature, script, ...extra });
const addDoc = (id, feature, doc, extra = {}) => cases.push({ id, feature, doc, ...extra });

// box
add('box-plain', 'box', 'box(40, 30, 12);', { planar: true });
add('box-cube', 'box', 'box(20, 20, 20);', { planar: true });
add('box-at', 'box.at', 'box(40, 30, 12, { at: [15, -7, 3] });', { planar: true });
add('box-at-neg', 'box.at', 'box(5, 6, 7, { at: [-100, 200, -300] });', { planar: true });
add('box-tiny', 'box', 'box(0.01, 0.02, 0.03);', { planar: true });
add('box-huge', 'box', 'box(1000, 2000, 3000, { at: [500, -400, 90] });', { planar: true });
add('box-thin', 'box', 'box(100, 100, 0.01);', { planar: true });
add('box-turn-x30', 'box.rotate', 'turn(box(40, 30, 12), [30, 0, 0]);', { planar: true });
add('box-turn-y45', 'box.rotate', 'turn(box(40, 30, 12), [0, 45, 0]);', { planar: true });
add('box-turn-z20', 'box.rotate', 'turn(box(40, 30, 12), [0, 0, 20]);', { planar: true });
add('box-turn-xyz', 'box.rotate', 'turn(box(40, 30, 12, { at: [10, 20, 30] }), [20, 35, 50]);', { planar: true });
add('box-turn-neg', 'box.rotate', 'turn(box(40, 30, 12, { at: [10, -20, 5] }), [-25, 70, -110]);', { planar: true });
add('box-turn-360', 'box.rotate', 'turn(box(40, 30, 12, { at: [10, 20, 30] }), [360, 0, 0]);', { planar: true });
add('box-turn-90s', 'box.rotate', 'turn(box(40, 30, 12, { at: [10, 20, 30] }), [90, 90, 90]);', { planar: true });
add('box-corner-fillet', 'box.corner', 'box(40, 30, 12, { corner: 3 });');
add('box-corner-fillet-small', 'box.corner', 'box(40, 30, 12, { corner: 0.5 });');
add('box-corner-fillet-at', 'box.corner', 'box(40, 30, 12, { corner: 3, at: [15, -7, 3] });');
add('box-corner-fillet-turn', 'box.corner', 'turn(box(40, 30, 12, { corner: 3, at: [15, -7, 3] }), [20, 35, 50]);');
add('box-corner-cube-5', 'box.corner', 'box(20, 20, 20, { corner: 5 });');
add('box-corner-just-under-half', 'box.corner', 'box(20, 30, 12, { corner: 5.9 });');
add('box-corner-half', 'box.corner', 'box(20, 30, 12, { corner: 6 });');
add('box-corner-over-half', 'box.corner', 'box(20, 30, 12, { corner: 7 });');
add('box-corner-way-over', 'box.corner', 'box(10, 10, 10, { corner: 50 });');
add('box-corner-cube-half', 'box.corner', 'box(20, 20, 20, { corner: 10 });');
add('box-corner-thin-plate', 'box.corner', 'box(100, 100, 2, { corner: 0.9 });');
add('box-corner-huge', 'box.corner', 'box(1000, 2000, 3000, { corner: 100 });');
addDoc('box-chamfer', 'box.corner.chamfer', docOf(feat('box', { size: [40, 30, 12], round: 3, roundStyle: 'chamfer' })));
addDoc('box-chamfer-cube', 'box.corner.chamfer', docOf(feat('box', { size: [20, 20, 20], round: 4, roundStyle: 'chamfer' })));
add('box-bevel-script', 'box.corner.chamfer', 'bevel(box(40, 30, 12), 3);');
add('box-bevel-script-small', 'box.corner.chamfer', 'bevel(box(40, 30, 12), 0.5);');
add('box-round-script', 'box.corner', 'round(box(40, 30, 12), 3);');

// cylinder
add('cyl-plain', 'cylinder', 'cylinder(24, 30);');
add('cyl-at', 'cylinder.at', 'cylinder(24, 30, { at: [5, 3, 2] });');
add('cyl-tiny', 'cylinder', 'cylinder(0.02, 0.05);');
add('cyl-huge', 'cylinder', 'cylinder(2000, 3000, { at: [500, -400, 90] });');
add('cyl-disc', 'cylinder', 'cylinder(100, 0.2);');
add('cyl-needle', 'cylinder', 'cylinder(0.5, 100);');
add('cyl-turn-x90', 'cylinder.rotate', 'turn(cylinder(24, 30), [90, 0, 0]);');
add('cyl-turn-y90', 'cylinder.rotate', 'turn(cylinder(24, 30, { at: [5, 3, 2] }), [0, 90, 0]);');
add('cyl-turn-y30', 'cylinder.rotate', 'turn(cylinder(24, 30, { at: [5, 3, 2] }), [0, 30, 0]);');
add('cyl-turn-xyz', 'cylinder.rotate', 'turn(cylinder(24, 30, { at: [10, 20, 30] }), [20, 35, 50]);');
add('cyl-corner', 'cylinder.corner', 'cylinder(24, 30, { corner: 3 });');
add('cyl-corner-small', 'cylinder.corner', 'cylinder(24, 30, { corner: 0.5 });');
add('cyl-corner-at', 'cylinder.corner', 'cylinder(24, 30, { corner: 3, at: [5, 3, 2] });');
add('cyl-corner-turn', 'cylinder.corner', 'turn(cylinder(24, 30, { corner: 3, at: [5, 3, 2] }), [20, 35, 50]);');
add('cyl-corner-under-height-half', 'cylinder.corner', 'cylinder(24, 10, { corner: 4.9 });');
add('cyl-corner-height-half', 'cylinder.corner', 'cylinder(24, 10, { corner: 5 });');
add('cyl-corner-over-height-half', 'cylinder.corner', 'cylinder(24, 10, { corner: 6 });');
add('cyl-corner-radius', 'cylinder.corner', 'cylinder(24, 30, { corner: 12 });');
add('cyl-corner-over-radius', 'cylinder.corner', 'cylinder(24, 30, { corner: 13 });');
add('cyl-corner-way-over', 'cylinder.corner', 'cylinder(10, 10, { corner: 50 });');
addDoc('cyl-chamfer', 'cylinder.corner.chamfer', docOf(feat('cylinder', { radius: 12, height: 30, round: 3, roundStyle: 'chamfer' })));
add('cyl-bevel-script', 'cylinder.corner.chamfer', 'bevel(cylinder(24, 30), 3);');

// sphere
add('sph-plain', 'sphere', 'sphere(20);');
add('sph-at', 'sphere.at', 'sphere(20, { at: [5, -3, 7] });');
add('sph-tiny', 'sphere', 'sphere(0.02);');
add('sph-huge', 'sphere', 'sphere(5000, { at: [100, 100, 100] });');
add('sph-turn', 'sphere.rotate', 'turn(sphere(20, { at: [5, -3, 7] }), [30, 40, 50]);');

// cone
add('cone-plain', 'cone', 'cone(20, 30);');
add('cone-at', 'cone.at', 'cone(20, 30, { at: [5, -3, 7] });');
add('cone-flat', 'cone', 'cone(100, 2);');
add('cone-spire', 'cone', 'cone(2, 100);');
add('cone-tiny', 'cone', 'cone(0.02, 0.03);');
add('cone-huge', 'cone', 'cone(2000, 3000, { at: [100, 100, 100] });');
add('cone-turn-x90', 'cone.rotate', 'turn(cone(20, 30), [90, 0, 0]);');
add('cone-turn-xyz', 'cone.rotate', 'turn(cone(20, 30, { at: [10, 20, 30] }), [20, 35, 50]);');
add('cone-turn-y180', 'cone.rotate', 'turn(cone(20, 30, { at: [10, 20, 30] }), [0, 180, 0]);');

// ring / torus
add('ring-plain', 'ring', 'ring(40, 10);');
add('ring-at', 'ring.at', 'ring(40, 10, { at: [5, -3, 7] });');
add('ring-thin', 'ring', 'ring(100, 2);');
add('ring-fat', 'ring', 'ring(40, 18);');
add('ring-tiny', 'ring', 'ring(0.04, 0.01);');
add('ring-huge', 'ring', 'ring(4000, 800, { at: [100, 100, 100] });');
add('ring-turn-x90', 'ring.rotate', 'turn(ring(40, 10), [90, 0, 0]);');
add('ring-turn-xyz', 'ring.rotate', 'turn(ring(40, 10, { at: [10, 20, 30] }), [20, 35, 50]);');
add('ring-horn', 'ring.degenerate', 'ring(20, 10);', { note: 'ringRadius == tubeRadius (horn torus)' });
add('ring-spindle', 'ring.degenerate', 'ring(20, 14);', { note: 'ringRadius 3 < tubeRadius 7 (self-intersecting spindle torus)' });
add('ring-spindle-mild', 'ring.degenerate', 'ring(10, 6);', { note: 'ringRadius 2 < tubeRadius 3' });
add('ring-zero-major', 'ring.degenerate', 'ring(10, 10);', { note: 'ringRadius 0' });
add('ring-negative-major', 'ring.degenerate', 'ring(10, 14);', { note: 'ringRadius -2' });
add('ring-near-horn', 'ring.degenerate', 'ring(20.02, 10);', { note: 'ringRadius just above tubeRadius' });

// prism
for (let n = 3; n <= 12; n++) add(`prism-${n}`, 'prism', `prism(${n}, 30, 12);`, { planar: true });
add('prism-at', 'prism.at', 'prism(5, 30, 12, { at: [5, -3, 7] });', { planar: true });
add('prism-tiny', 'prism', 'prism(6, 0.03, 0.01);', { planar: true });
add('prism-huge', 'prism', 'prism(7, 3000, 5000, { at: [100, 100, 100] });', { planar: true });
add('prism-thin', 'prism', 'prism(8, 100, 0.01);', { planar: true });
add('prism-turn-script', 'prism.rotate', 'turn(prism(5, 30, 12, { at: [5, -3, 7] }), [20, 35, 50]);', { planar: true });
addDoc('prism-docrotate-x90', 'prism.rotate', docOf(feat('prism', { sides: 5, radius: 15, height: 12, rotate: [90, 0, 0] })), { planar: true });
addDoc('prism-docrotate-xyz-at', 'prism.rotate', docOf(feat('prism', { sides: 5, radius: 15, height: 12, center: [5, -3, 7], rotate: [20, 35, 50] })), { planar: true });
add('prism-frac-5.4', 'prism.sides-validation', 'prism(5.4, 30, 12);', { planar: true, note: 'sides 5.4 is rounded to 5 by the script' });
add('prism-frac-5.5', 'prism.sides-validation', 'prism(5.5, 30, 12);', { planar: true, note: 'sides 5.5 is rounded to 6 by the script' });
add('prism-2', 'prism.sides-validation', 'prism(2, 30, 12);');
add('prism-13', 'prism.sides-validation', 'prism(13, 30, 12);');

// wedge
add('wedge-plain', 'wedge', 'wedge(40, 30, 12);', { planar: true });
add('wedge-at', 'wedge.at', 'wedge(40, 30, 12, { at: [5, -3, 7] });', { planar: true });
add('wedge-tiny', 'wedge', 'wedge(0.03, 0.02, 0.01);', { planar: true });
add('wedge-huge', 'wedge', 'wedge(3000, 2000, 5000, { at: [100, 100, 100] });', { planar: true });
add('wedge-thin', 'wedge', 'wedge(100, 1, 0.01);', { planar: true });
add('wedge-turn-script', 'wedge.rotate', 'turn(wedge(40, 30, 12, { at: [5, -3, 7] }), [20, 35, 50]);', { planar: true });
addDoc('wedge-docrotate-x90', 'wedge.rotate', docOf(feat('wedge', { width: 40, depth: 30, height: 12, rotate: [90, 0, 0] })), { planar: true });
addDoc('wedge-docrotate-xyz-at', 'wedge.rotate', docOf(feat('wedge', { width: 40, depth: 30, height: 12, center: [5, -3, 7], rotate: [20, 35, 50] })), { planar: true });

// FreeCAD saved refs: a Pad of the same outline is the same solid as the primitive (volume, bbox, COM, face count)
add('fc-box-thin-plate', 'box', 'box(200, 120, 1.5, { at: [0, 0, 0.75] });', { planar: true, fc: 'ref-pad-basic__thin-plate' });
add('fc-box-slender-post', 'box', 'box(4, 4, 120, { at: [5, -6, 60] });', { planar: true, fc: 'ref-pad-basic__slender-post' });
add('fc-cyl-offcentre', 'cylinder', 'cylinder(18, 25, { at: [10, -20, 12.5] });', { fc: 'ref-pad-basic__circle-offcentre' });
add('fc-cyl-rod', 'cylinder', 'cylinder(24, 30, { at: [0, 0, 15] });', { fc: 'ref-revolution__top-solid-rod' });
add('fc-prism-hexagon', 'prism', 'prism(6, 20, 7, { at: [0, 0, 3.5] });', { planar: true, fc: 'ref-pad-basic__hexagon' });

// scale sweep: is the curved volume error relative, or an absolute tessellation tolerance?
for (const d of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]) {
  add(`sweep-sph-${d}`, 'sweep', `sphere(${d});`);
  add(`sweep-cyl-${d}`, 'sweep', `cylinder(${d}, ${d});`);
  add(`sweep-cone-${d}`, 'sweep', `cone(${d}, ${d});`);
  add(`sweep-ring-${d}`, 'sweep', `ring(${d}, ${d / 4});`);
  add(`sweep-boxr-${d}`, 'sweep', `box(${d}, ${d}, ${d}, { corner: ${d / 5} });`);
}

// extra edge cases: far placement, tiny angles, very small rounds
add('edge-box-far', 'box.at', 'box(1, 1, 1, { at: [1000000, 1000000, 1000000] });', { planar: true });
add('edge-sph-far', 'sphere.at', 'sphere(2, { at: [1000000, -1000000, 1000000] });');
add('edge-cyl-far-turn', 'cylinder.rotate', 'turn(cylinder(2, 3, { at: [100000, 0, 0] }), [30, 40, 50]);');
add('edge-box-turn-tiny', 'box.rotate', 'turn(box(40, 30, 12), [0.001, 0, 0]);', { planar: true });
add('edge-box-turn-180', 'box.rotate', 'turn(box(40, 30, 12, { at: [3, 4, 5] }), [180, 0, 0]);', { planar: true });
add('edge-box-turn-270z', 'box.rotate', 'turn(box(40, 30, 12, { at: [3, 4, 5] }), [0, 0, 270]);', { planar: true });
add('edge-box-corner-1e-3', 'box.corner', 'box(40, 30, 12, { corner: 0.001 });');
add('edge-box-corner-1e-6', 'box.corner', 'box(40, 30, 12, { corner: 0.000001 });');
add('edge-cyl-corner-1e-3', 'cylinder.corner', 'cylinder(24, 30, { corner: 0.001 });');
addDoc('edge-wedge-docrotate-180y', 'wedge.rotate', docOf(feat('wedge', { width: 40, depth: 30, height: 12, center: [3, 4, 5], rotate: [0, 180, 0] })), { planar: true });

// placement sweep: a unit-ish curved primitive moved far from the origin (truck measures curved volume from a tessellation)
for (const e of [1e2, 1e3, 1e4, 1e5, 1e6]) {
  const a = `[${e}, ${-e}, ${e}]`;
  add(`far-sph-${e}`, 'far', `sphere(2, { at: ${a} });`);
  add(`far-cyl-${e}`, 'far', `cylinder(2, 3, { at: ${a} });`);
  add(`far-cone-${e}`, 'far', `cone(2, 3, { at: ${a} });`);
  add(`far-ring-${e}`, 'far', `ring(4, 1, { at: ${a} });`);
  add(`far-boxr-${e}`, 'far', `box(2, 2, 2, { corner: 0.3, at: ${a} });`);
}

// ---- round 2 (critic) ----------------------------------------------------------------------------------------------
// box corner at / just under / just over half the shortest side, shortest side on each axis
const permsOf = (a, b, c) => [[a, b, c], [b, a, c], [b, c, a]]; // shortest on X, Y, Z
for (const [lbl, k, big1, big2] of [['r2a', 6, 20, 30], ['r2b', 5, 20, 30], ['r2c', 2.5, 20, 30]]) {
  const s = 2 * k;
  [[s, big1, big2], [big1, s, big2], [big1, big2, s]].forEach((sz, i) => {
    const ax = 'XYZ'[i];
    add(`r2-corner-half-${lbl}-${ax}`, 'box.corner.half', `box(${sz.join(', ')}, { corner: ${k} });`);
    add(`r2-corner-under-${lbl}-${ax}`, 'box.corner.under', `box(${sz.join(', ')}, { corner: ${k * 0.998} });`);
    add(`r2-corner-over-${lbl}-${ax}`, 'box.corner.over', `box(${sz.join(', ')}, { corner: ${k * 1.1} });`);
  });
}
add('r2-capsule-40-6-6', 'box.corner.half', 'box(40, 6, 6, { corner: 3 });');
add('r2-capsule-6-40-6', 'box.corner.half', 'box(6, 40, 6, { corner: 3 });');
add('r2-capsule-6-6-40', 'box.corner.half', 'box(6, 6, 40, { corner: 3 });');
add('r2-cube-half', 'box.corner.half', 'box(20, 20, 20, { corner: 10 });');
add('r2-box-12-20-30-c6', 'box.corner.half', 'box(12, 20, 30, { corner: 6 });');
add('r2-box-10-20-30-c5', 'box.corner.half', 'box(10, 20, 30, { corner: 5 });');
add('r2-box-5-20-30-c2.5', 'box.corner.half', 'box(5, 20, 30, { corner: 2.5 });');
add('r2-box-20-30-12-c6', 'box.corner.half', 'box(20, 30, 12, { corner: 6 });');
add('r2-box-10-20-30-c4.99', 'box.corner.under', 'box(10, 20, 30, { corner: 4.99 });');
add('r2-box-10-20-30-c4.9', 'box.corner.under', 'box(10, 20, 30, { corner: 4.9 });');
add('r2-box-10-20-30-c5.1', 'box.corner.over', 'box(10, 20, 30, { corner: 5.1 });');
add('r2-box-10-20-30-c7', 'box.corner.over', 'box(10, 20, 30, { corner: 7 });');
add('r2-box-12-30-20-c7', 'box.corner.over', 'box(12, 30, 20, { corner: 7 });');
add('r2-box-20-30-12-c7', 'box.corner.over', 'box(20, 30, 12, { corner: 7 });');
add('r2-box-30-12-20-c7', 'box.corner.over', 'box(30, 12, 20, { corner: 7 });');
add('r2-box-30-20-12-c7', 'box.corner.over', 'box(30, 20, 12, { corner: 7 });');
// cylinder
add('r2-cyl-h2-flat', 'cyl.corner.half', 'cylinder(48, 10, { corner: 5 });');
add('r2-cyl-h2-tall', 'cyl.corner.half', 'cylinder(24, 10, { corner: 5 });');
add('r2-cyl-R-eq-h2', 'cyl.corner.half', 'cylinder(10, 10, { corner: 5 });');
add('r2-cyl-R-eq-h2b', 'cyl.corner.half', 'cylinder(10, 30, { corner: 5 });');
add('r2-cyl-R-under', 'cyl.corner.under', 'cylinder(10, 30, { corner: 4.99 });');
add('r2-cyl-h2-under', 'cyl.corner.under', 'cylinder(48, 10, { corner: 4.99 });');
add('r2-cyl-R-over', 'cyl.corner.over', 'cylinder(10, 30, { corner: 5.5 });');
add('r2-cyl-h2-over', 'cyl.corner.over', 'cylinder(48, 10, { corner: 5.5 });');
// cylinder chamfer around the radius
for (const [id, R, h, d] of [['r2-cyl-chamfer-R-0.1', 12, 30, 11.9], ['r2-cyl-chamfer-R', 12, 30, 12], ['r2-cyl-chamfer-R+1', 12, 30, 13], ['r2-cyl-chamfer-h2', 12, 10, 5], ['r2-cyl-chamfer-h2+', 12, 10, 6], ['r2-cyl-chamfer-3', 12, 30, 3], ['r2-cyl-chamfer-9', 12, 30, 9]])
  addDoc(id, 'cyl.chamfer.limit', docOf(feat('cylinder', { radius: R, height: h, round: d, roundStyle: 'chamfer' })));
// box chamfer near the limit
for (const [id, sz, d] of [['r2-box-chamfer-4.9', [10, 20, 30], 4.9], ['r2-box-chamfer-5', [10, 20, 30], 5], ['r2-box-chamfer-5.5', [10, 20, 30], 5.5], ['r2-box-chamfer-2', [10, 20, 30], 2], ['r2-box-chamfer-1', [40, 30, 12], 1], ['r2-box-chamfer-5.9', [20, 30, 12], 5.9], ['r2-box-chamfer-6', [20, 30, 12], 6]])
  addDoc(id, 'box.chamfer.limit', docOf(feat('box', { size: sz, round: d, roundStyle: 'chamfer' })));
// planar solids far from the origin
for (const e of [1e2, 1e3, 1e4, 1e5, 1e6]) {
  const a = `[${e}, ${-e}, ${e}]`;
  add(`r2-farp-prism6-${e}`, 'far.planar', `prism(6, 2, 3, { at: ${a} });`, { planar: true });
  add(`r2-farp-prism3-${e}`, 'far.planar', `prism(3, 2, 3, { at: ${a} });`, { planar: true });
  add(`r2-farp-prism12-${e}`, 'far.planar', `prism(12, 2, 3, { at: ${a} });`, { planar: true });
  add(`r2-farp-wedge-${e}`, 'far.planar', `wedge(2, 3, 4, { at: ${a} });`, { planar: true });
  add(`r2-farp-box-${e}`, 'far.planar', `box(2, 3, 4, { at: ${a} });`, { planar: true });
  add(`r2-farp-boxturn-${e}`, 'far.planar', `turn(box(2, 3, 4, { at: ${a} }), [20, 35, 50]);`, { planar: true });
  add(`r2-farp-prism6turn-${e}`, 'far.planar', `turn(prism(6, 2, 3, { at: ${a} }), [20, 35, 50]);`, { planar: true });
}
for (const e of [1e2, 1e3, 1e4]) {
  const a = `[${e}, ${-e}, ${e}]`;
  add(`r2-farp-prism6big-${e}`, 'far.planar', `prism(6, 200, 300, { at: ${a} });`, { planar: true });
}
// thin tubes on a large ring (size-dependent tolerance)
for (const [A, T] of [[100, 2], [100, 1], [200, 1], [100, 0.5], [100, 0.25], [40, 10], [40, 4], [40, 2], [40, 1], [20, 1], [20, 0.5], [10, 0.5], [10, 0.2], [400, 4], [400, 2], [1000, 10], [1000, 4]])
  add(`r2-ring-${A}-${T}`, 'ring.thin', `ring(${A}, ${T});`);
// other thin/needle curved shapes
add('r2-cone-spire-2-100', 'cone.thin', 'cone(2, 100);');
add('r2-cone-spire-1-100', 'cone.thin', 'cone(1, 100);');
add('r2-cone-spire-4-400', 'cone.thin', 'cone(4, 400);');
add('r2-cone-flat-100-2', 'cone.thin', 'cone(100, 2);');
add('r2-cyl-needle-1-100', 'cyl.thin', 'cylinder(1, 100);');
add('r2-cyl-needle-2-100', 'cyl.thin', 'cylinder(2, 100);');
add('r2-cyl-needle-0.5-100', 'cyl.thin', 'cylinder(0.5, 100);');
add('r2-cyl-disc-100-0.2', 'cyl.thin', 'cylinder(100, 0.2);');
// oversize
for (const n of [1e4, 2e4, 5e4, 1e5, 1e6, 1e7]) {
  add(`r2-big-sph-${n}`, 'oversize', `sphere(${n});`);
  add(`r2-big-cyl-${n}`, 'oversize', `cylinder(${n}, ${n});`);
  add(`r2-big-cone-${n}`, 'oversize', `cone(${n}, ${n});`);
  add(`r2-big-ring-${n}`, 'oversize', `ring(${n}, ${n / 5});`);
  add(`r2-big-box-${n}`, 'oversize', `box(${n}, ${n}, ${n});`, { planar: true });
  add(`r2-big-prism-${n}`, 'oversize', `prism(6, ${n}, ${n});`, { planar: true });
  add(`r2-big-wedge-${n}`, 'oversize', `wedge(${n}, ${n}, ${n});`, { planar: true });
}
add('r2-big-box-1e308', 'oversize', 'box(1e308, 1e308, 1e308);', { planar: true });
add('r2-big-box-1e10', 'oversize', 'box(1e10, 1e10, 1e10);', { planar: true });
add('r2-big-ring-1e6-2e5', 'oversize', 'ring(1e6, 2e5);');
add('r2-big-cone-1e6-1e6', 'oversize', 'cone(1e6, 1e6);');
add('r2-big-sph-3e4', 'oversize', 'sphere(30000);');
add('r2-big-sph-7e4', 'oversize', 'sphere(70000);');
// ring dimension edge cases through the interpreter
add('r2-ring-10-12', 'ring.degenerate', 'ring(10, 12);', { note: 'tubeAcross > across' });
add('r2-ring-10-10', 'ring.degenerate', 'ring(10, 10);', { note: 'ringRadius 0' });
add('r2-ring-10-5', 'ring.degenerate', 'ring(10, 5);', { note: 'across = 2*tubeAcross exactly, horn' });
// aliases
add('r2-alias-cuboid', 'alias', 'cuboid(40, 30, 12);', { planar: true });
add('r2-alias-cuboid-opts', 'alias', 'cuboid(40, 30, 12, { at: [15, -7, 3], corner: 3 });');
add('r2-alias-torus', 'alias', 'torus(40, 10);');
add('r2-alias-torus-at', 'alias', 'torus(40, 10, { at: [5, -3, 7] });');
add('r2-alias-box', 'alias', 'box(40, 30, 12);', { planar: true });
add('r2-alias-ring', 'alias', 'ring(40, 10);');

// cylinder whole-shape round close to the radius: truck bbox is looser than OCCT's
for (const c of [1, 2, 3, 4, 4.5, 4.9, 4.99]) add(`r2bb-cyl-10-30-c${c}`, 'cyl.corner.bbox', `cylinder(10, 30, { corner: ${c} });`);
for (const c of [6, 10, 11, 11.9]) add(`r2bb-cyl-24-30-c${c}`, 'cyl.corner.bbox', `cylinder(24, 30, { corner: ${c} });`);
for (const c of [2, 4, 4.9]) add(`r2bb-cyl-10-10-c${c}`, 'cyl.corner.bbox', `cylinder(10, 10, { corner: ${c} });`);

// how close to half the shortest side does the wrong solid start (shortest side on X)
for (const [i, c] of [['a', 5.99], ['b', 5.999], ['c', 5.99999], ['d', 5.9999999], ['e', 6.000001], ['f', 6.01]]) add(`r2e-box-12-20-30-${i}`, 'box.corner.edge', `box(12, 20, 30, { corner: ${c} });`);
for (const [i, c] of [['a', 5.9999], ['b', 5.99995], ['c', 5.999999], ['d', 5.99999], ['e', 5.9999999], ['f', 6.000001]]) add(`r2z-box-20-30-12-${i}`, 'box.corner.edge', `box(20, 30, 12, { corner: ${c} });`);
for (const [i, c] of [['a', 4.99999], ['b', 4.9999999], ['c', 5.000001]]) add(`r2z-cyl-48-10-${i}`, 'cyl.corner.edge', `cylinder(48, 10, { corner: ${c} });`);
for (const [i, c] of [['a', 5.9999], ['b', 5.99995]]) add(`r2e-box-12-20-30-${i}2`, 'box.corner.edge', `box(12, 20, 30, { corner: ${c} });`);
// param() as a size
add('param-box', 'param', 'const w = param("w", 40); box(w, 30, 12);', { planar: true });
add('param-cyl', 'param', 'const d = param("d", 24); cylinder(d, 30);');
add('param-ring', 'param', 'const a = param("a", 40); const t = param("t", 10); ring(a, t);');
add('param-prism', 'param', 'const s = param("s", 6); prism(s, 30, 12);', { planar: true });
add('param-box-corner', 'param', 'const c = param("c", 3); box(40, 30, 12, { corner: c });');
add('param-at', 'param', 'const x = param("x", 15); box(40, 30, 12, { at: [x, 0, 0] });', { planar: true });

// validation (script level only, kernel not reached when the script refuses)
const bad = [
  ['v-box-neg', 'box(-10, 10, 10);'], ['v-box-zero', 'box(0, 10, 10);'], ['v-box-nan', 'box(NaN, 10, 10);'],
  ['v-box-inf', 'box(Infinity, 10, 10);'], ['v-box-str', 'box("10", 10, 10);'], ['v-box-missing', 'box(10, 10);'],
  ['v-box-null', 'box(null, 10, 10);'], ['v-box-extra', 'box(10, 10, 10, 10);'], ['v-box-unknown-opt', 'box(10, 10, 10, { colour: 1 });'],
  ['v-box-opts-array', 'box(10, 10, 10, [1, 2, 3]);'], ['v-box-at-short', 'box(10, 10, 10, { at: [1, 2] });'],
  ['v-box-at-str', 'box(10, 10, 10, { at: [1, 2, "3"] });'], ['v-box-corner-zero', 'box(10, 10, 10, { corner: 0 });'],
  ['v-box-corner-neg', 'box(10, 10, 10, { corner: -1 });'], ['v-box-corner-str', 'box(10, 10, 10, { corner: "1" });'],
  ['v-box-rotate-opt', 'box(10, 10, 10, { rotate: [0, 0, 45] });'], ['v-box-center-opt', 'box(10, 10, 10, { center: [0, 0, 0] });'],
  ['v-cyl-neg', 'cylinder(-10, 10);'], ['v-cyl-zero-tall', 'cylinder(10, 0);'], ['v-cyl-unknown', 'cylinder(10, 10, { radius: 3 });'],
  ['v-sph-corner', 'sphere(10, { corner: 2 });'], ['v-sph-neg', 'sphere(-1);'], ['v-sph-rotate-opt', 'sphere(10, { rotate: [1, 2, 3] });'],
  ['v-cone-corner', 'cone(10, 10, { corner: 2 });'], ['v-cone-three-arg', 'cone(10, 5, 10);'], ['v-cone-zero', 'cone(0, 10);'],
  ['v-ring-corner', 'ring(10, 2, { corner: 1 });'], ['v-ring-zero-tube', 'ring(10, 0);'], ['v-ring-neg', 'ring(-10, 2);'],
  ['v-prism-corner', 'prism(5, 10, 10, { corner: 1 });'], ['v-prism-neg', 'prism(5, -10, 10);'], ['v-prism-zero-sides', 'prism(0, 10, 10);'],
  ['v-prism-neg-sides', 'prism(-3, 10, 10);'],
  ['v-wedge-corner', 'wedge(10, 10, 10, { corner: 1 });'], ['v-wedge-neg', 'wedge(10, -10, 10);'], ['v-wedge-missing', 'wedge(10, 10);'],
  ['v-param-zero', 'const w = param("w", 0); box(w, 10, 10);'], ['v-param-neg', 'const w = param("w", -5); box(w, 10, 10);'],
  ['v-param-str', 'const w = param("w", "5"); box(w, 10, 10);'],
  ['v-turn-prism', 'turn(sphere(10), "x");'],
];
for (const [id, s] of bad) add(id, 'validation', s, { validationOnly: true });

// ---- run -------------------------------------------------------------------------------------------------------------
const results = [];
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  if (prefix && !c.id.startsWith(prefix)) continue;
  let row;
  const t0 = Date.now();
  try {
    if (c.validationOnly) {
      const r = runScript(c.script);
      row = { id: c.id, feature: c.feature, script: c.script, scriptRefusal: r.errors.map((e) => e.message ?? String(e)), builtFeatures: r.errors.length ? [] : r.doc.features.map((f) => f.kind), status: r.errors.length ? 'refused-by-script' : 'ACCEPTED' };
    } else row = measureCase(c);
  } catch (e) { row = { id: c.id, feature: c.feature, status: 'HARNESS-ERROR', error: String(e.stack ?? e).slice(0, 800) }; }
  row.ms = Date.now() - t0;
  results.push(row);
  const t = row.truck;
  const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
  console.log(row.id.padEnd(30), String(row.status ?? '').padEnd(22),
    t && t.dVolOcct !== undefined ? `dVol ${ex(t.dVolOcct)} dBbox ${ex(t.dBboxOcct)} dCom ${ex(t.dComOcct)} dAn ${ex(t.dVolAnalytic)} faces ${t.faces}/${t.facesOcct}` : (row.truck?.refused ?? row.scriptRefusal?.[0] ?? row.error ?? row.occt?.refused ?? ''));
}
writeFileSync(path.join(OUT, 'primitives-measure.json'), JSON.stringify(results, null, 1));
console.log('wrote', path.join(OUT, 'primitives-measure.json'));
