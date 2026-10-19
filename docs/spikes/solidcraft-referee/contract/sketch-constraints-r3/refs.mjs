// Shared referee helpers for round 3: live OCCT build of a ModelDoc, live brep-rs build of a script, one-sentence counter.
import path from 'node:path';
import * as lib from './lib.mjs';
const OCCT_DIR = path.join(lib.REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await lib.imp(path.join(OCCT_DIR, 'replicad_single.js'));
export const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await lib.imp(path.join(lib.REPO, 'packages/brep-adapter/dist/occt-build.js'));
/** OCCT volume + bbox of the last extrude of a ModelDoc (optionally with the sketch geoms replaced by brep-rs-solved ones). */
export function occtOf(doc, solvedGeoms) {
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
/** brep-rs + OCCT of a reSHape script text (soup sketch). */
export function refsOfScript(text) {
  const out = {};
  try {
    const run = lib.runScript(text);
    if (run.errors?.length) return { scriptError: run.errors.map((e) => e.message).join(' | ') };
    const doc = lib.modelCodegen.solveDoc(run.doc);
    const b = lib.brepBuild(doc);
    out.brep = b.outcome === 'built' ? { volume: b.volume, faces: b.faces, bbox: b.bbox } : { refused: b.refusal };
    const skf = doc.features.find((f) => f.kind === 'sketch');
    const bs = lib.brepSolve(skf.geoms, skf.rules);
    const o = occtOf(doc, bs.geoms ?? null);
    out.occt = o.refused ? { refused: o.refused } : o;
    out.doc = doc;
  } catch (e) { out.error = String(e.message).slice(0, 200); }
  return out;
}
/** number of sentences in a student-facing string: a terminator (. ! ?) followed by whitespace and an upper-case letter / digit / quote; decimals, "sk.rules()" and "e.g." do not split. */
export function sentenceCount(s) {
  const t = String(s).trim();
  if (!t) return 0;
  let n = 1;
  for (const m of t.matchAll(/[.!?](?=\s+["'(A-Z0-9])/g)) { if (m.index + 1 < t.length) n++; }
  return n;
}
export const isOneSentence = (s) => sentenceCount(s) === 1 && /[.]$/.test(String(s).trim());
