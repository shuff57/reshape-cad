// Random differential fuzz for several bores on one sphere: 2-4 bores, parallel (along z) or not, through or blind, random sizes
// and offsets, built by brep-rs and by OpenCascade, volumes compared. Run from packages/kernel/test (module resolution):
//   cp ../../../docs/specs/prototypes/sphere-multi-bore-fuzz.mjs ./zz-fuzz.mjs && bun zz-fuzz.mjs [count] [seed]; rm zz-fuzz.mjs
// Prints every disagreement, how many scripts built, refused, and the worst relative volume difference. brep-rs refusing is fine;
// building a different volume from OpenCascade is the defect this exists to catch.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.cwd(), '../../..');
const PKG = path.join(REPO, 'packages/brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const OCCT_DIR = path.join(REPO, 'node_modules/replicad-opencascadejs/dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const arc = await import('../../sketch/dist/sketch-arc.js');
const count = +(process.argv[2] ?? 200), seed0 = +(process.argv[3] ?? 1);
let seed = seed0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const PI = Math.PI;
function integralI(R, r, e) {
  const N = 4000, h = PI / N;
  const g = (th) => {
    const y = r * Math.sin(th), w = r * Math.cos(th), c2 = R * R - y * y, c = Math.sqrt(c2);
    const F = (x) => 0.5 * (x * Math.sqrt(Math.max(0, c2 - x * x)) + c2 * Math.asin(Math.max(-1, Math.min(1, x / c))));
    return (F(e + w) - F(e - w)) * r * Math.cos(th);
  };
  let acc = 0;
  for (let i = 0; i <= N; i++) acc += g(-PI / 2 + i * h) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2);
  return (acc * h) / 3;
}
// the closed form for parallel (z) bores: the ball less each bore's removed volume (the independent oracle; OpenCascade centres a
// later blind hole on ITS box of the bored part, which a pole-swallowing blind bore has shrunk, so it can be the wrong one)
const closedForm = (R, holes) => (4 / 3) * PI * R ** 3 - holes.reduce((a, h) => { const e = Math.hypot(h.x, h.y); return a + (h.deep === undefined ? 2 * integralI(R, h.r, e) : integralI(R, h.r, e) - (R - h.deep) * PI * h.r * h.r); }, 0);
let built = 0, refused = 0, bad = 0, scriptErr = 0, worst = 0, occtOff = 0, closedChecked = 0, worstClosed = 0;
for (let i = 0; i < count; i++) {
  const R = +(10 + 20 * rnd()).toFixed(2);
  const k = 2 + Math.floor(rnd() * 3);
  const holes = [];
  for (let t = 0; t < 40 && holes.length < k; t++) {
    const r = +(R * (0.04 + 0.2 * rnd())).toFixed(2);
    const e = R * 0.95 - r;
    const rad = e * Math.sqrt(rnd()), th = rnd() * 6.2832;
    const x = +(rad * Math.cos(th)).toFixed(2), y = +(rad * Math.sin(th)).toFixed(2);
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + r + 0.3)) continue;
    const along = rnd() < 0.15 ? ['x', 'y'][Math.floor(rnd() * 2)] : 'z';
    const deep = rnd() < 0.4 ? +(R * (0.3 + 1.1 * rnd())).toFixed(2) : undefined;
    holes.push({ r, x, y, along, deep });
  }
  const allZ = holes.every((h) => h.along === 'z');
  const code = `const s = sphere(${2 * R}); ${holes.map((h) => `hole(s, { across: ${2 * h.r}${h.along !== 'z' ? `, along: '${h.along}'` : ''}, at: [${h.x}, ${h.y}]${h.deep !== undefined ? `, deep: ${h.deep}` : ''} })`).join('; ')}`;
  const r = runScript(code);
  if (r.errors.length) { scriptErr++; continue; }
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  if (Object.keys(refusals).length) { refused++; continue; }
  const id = r.doc.features.at(-1).id;
  const vol = JSON.parse(brep.measure_doc(j)).shapes[id].volume;
  let ov;
  try {
    const shape = buildDoc(oc, { version: 1, features: r.doc.features }, arc).shapes.get(id);
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    ov = g.Mass();
  } catch { continue; }
  built++;
  const rel = Math.abs(vol - ov) / ov;
  worst = Math.max(worst, rel);
  if (allZ) {
    // blind holes need their floor between -s0 and s0 for the closed form to be the intended solid; the builder only builds those
    const cf = closedForm(R, holes);
    const relC = Math.abs(vol - cf) / cf;
    closedChecked++;
    worstClosed = Math.max(worstClosed, relC);
    if (relC > 1e-9) { bad++; console.log('WRONG vs closed form', relC.toExponential(2), 'occt rel', rel.toExponential(2), code); }
    else if (rel > 1e-6) { occtOff++; console.log('occt differs, brep matches the closed form', rel.toExponential(2), code); }
  } else if (rel > 1e-6) { bad++; console.log('DISAGREE (not all z, no closed form)', rel.toExponential(2), code); }
}
console.log({ count, built, refused, scriptErr, bad, occtOff, closedChecked, worstRelVsOcct: worst, worstRelVsClosedForm: worstClosed });
