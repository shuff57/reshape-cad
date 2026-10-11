// Piece sk-circle-arc-tangent: slot profile = 2 lines (length 40, 20 apart) + 2 tangent semicircle arcs, r=10.
// Pure reSHape Script -> ModelDoc -> brep-rs wasm via BrepRsEngineAdapter. Run: node <this file>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');
const OUTJSON = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ours-sk-circle-arc-tangent.json');
const require = createRequire(path.join(ROOT, 'packages/brep-adapter/package.json'));
const THREE = require('three');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('file://' + path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const { BrepRsEngineAdapter } = await import('file://' + path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const { SketchSession2D } = await import('file://' + path.join(ROOT, 'packages/brep-adapter/dist/sketch-session.js'));

const R = 10, L = 40, H = 10;
// Geometry: arc1 (id1) centre (0,10) left cap, arc2 (id2) centre (40,10) right cap; line3 top y=20, line4 bottom y=0 (the reference spec: bottom line from (0,0) to (40,0)).
const geomSrc = `[
 { k:'arc', id:1, c:[0,${R}], r:${R}, a:[0,0], b:[0,${2*R}], sense:'cw' },
 { k:'arc', id:2, c:[${L},${R}], r:${R}, a:[${L},${2*R}], b:[${L},0], sense:'cw' },
 { k:'line', id:3, a:[0,${2*R}], b:[${L},${2*R}] },
 { k:'line', id:4, a:[${L},0], b:[0,0] }]`;
const tangentJoins = `
 { k:'coincident', a:3, aEnd:'a', b:1, bEnd:'b' }, { k:'tangent', a:3, aEnd:'a', b:1, bEnd:'b' },
 { k:'coincident', a:3, aEnd:'b', b:2, bEnd:'a' }, { k:'tangent', a:3, aEnd:'b', b:2, bEnd:'a' },
 { k:'coincident', a:4, aEnd:'a', b:2, bEnd:'b' }, { k:'tangent', a:4, aEnd:'a', b:2, bEnd:'b' },
 { k:'coincident', a:4, aEnd:'b', b:1, bEnd:'a' }, { k:'tangent', a:4, aEnd:'b', b:1, bEnd:'a' }`;
const dims = `{ k:'radius', a:1, value:${R} }, { k:'equal', a:1, b:2 }, { k:'horizontal', a:3 }, { k:'distance', a:3, aEnd:'a', b:3, bEnd:'b', value:${L} }`;
const anchor = `{ k:'lock', a:1, aEnd:'c' }`;

const variants = {
  // as asked: tangents + radius 10 + length 40 + horizontal; free to translate
  floating: `${tangentJoins}, ${dims}`,
  // plus the arc centre pinned = fully constrained
  anchored: `${tangentJoins}, ${dims}, ${anchor}`,
  // radius on the other arc as well (should be redundant with equal)
  redundantProbe: `${tangentJoins}, ${dims}, ${anchor}, { k:'radius', a:2, value:${R} }`,
};

const adapter = new BrepRsEngineAdapter(THREE);
adapter.loadFromBytes(brep);

const result = { id: 'sk-circle-arc-tangent', variants: {}, notes: '' };
const diag = {};
let mainDoc;
for (const [name, rules] of Object.entries(variants)) {
  const src = `const sk1 = sketch('top'); sk1.geom(${geomSrc}); sk1.rules([${rules}]); pull(sk1, ${H});`;
  const r = runScript(src);
  if (r.errors?.length) { diag[name] = { scriptErrors: r.errors }; continue; }
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  const sess = new SketchSession2D();
  sess.loadFromBytes?.(brep);
  const out = {};
  try {
    const err = sess.open(sk.geoms, sk.rules);
    out.openRefusal = err;
    if (!err) {
      out.solved = sess.solve();
      out.diagnosis = sess.diagnose();
      out.profile = sess.profile();
      out.lastError = sess.lastError();
    }
  } catch (e) { out.crash = String(e.stack || e); }
  diag[name] = out;
  if (name === 'anchored') mainDoc = r.doc;
  if (name === 'floating') mainDoc ??= r.doc;
  if (name === 'anchored') mainDoc = r.doc;
}
result.variants = diag;

let outcome = 'error', refusal, build = {};
try {
  const doc = mainDoc;
  const ex = doc.features.find((f) => f.kind === 'extrude');
  const built = adapter.build(doc);
  const refusals = built.refusals ? Object.fromEntries(built.refusals) : {};
  const shape = built.shapes.get(ex.id);
  if (!shape) {
    outcome = 'refused'; refusal = Object.values(refusals).join(' | ') || 'no shape, no refusal sentence';
  } else {
    const m = adapter.mesh(shape);
    const meas = JSON.parse(brep.measure_doc(JSON.stringify({ version: 1, features: doc.features })));
    const pos = m?.geometry.getAttribute('position');
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; pos && i < pos.count; i++) for (let a = 0; a < 3; a++) {
      const v = pos.getComponent(i, a); bb[a] = Math.min(bb[a], v); bb[a + 3] = Math.max(bb[a + 3], v);
    }
    build = { volume: meas.shapes?.[ex.id]?.volume, measure: meas.shapes?.[ex.id], bbox: bb, faces: m?.faces.length, meshVerts: pos?.count, refusals };
    outcome = m && pos && pos.count > 0 ? 'built' : 'error';
  }
} catch (e) { outcome = 'error'; refusal = String(e.stack || e); }

// ---- standard block read by compare.mjs (0-based rule indices; conflicting/redundant from the real solver's bucket+blame) ----
const stdCaseOf = (d) => ({ dof: d?.dof ?? null, bucket: d?.bucket ?? null, nativeBlame: d?.blame ?? [],
  conflicting: d?.bucket === 'conflicting' ? d.blame : [], conflictingNative: d?.bucket === 'conflicting' ? d.blame : [],
  redundant: d?.bucket === 'redundant' ? d.blame : [], indexBase: 0 });
const bboxOfProfile = (p) => { const xs = [], ys = [];
  for (const l of p?.loops ?? []) for (const s of l.segs) { if (s.a) { xs.push(s.a[0], s.b[0]); ys.push(s.a[1], s.b[1]); } }
  return xs.length ? [Math.min(...xs), Math.min(...ys), 0, Math.max(...xs), Math.max(...ys), 0] : null; };
Object.assign(result, { outcome, refusal, ...build });
// The solid is a sanity extrusion; the sketch's own x/y extent is what the reference sketch bbox measures, so z is not compared.
result.std = { kind: 'sketch', outcome, bboxAxes: [0, 1], bbox: build.bbox, cases: { main: stdCaseOf(diag.anchored?.diagnosis) } };
result.expected = { volume: (L * 2 * R + Math.PI * R * R) * H, bbox: [-R, 0, 0, L + R, 2 * R, H], facesExpected: 'lines 2 + cylinders 2 + caps 2 = 6' };
writeFileSync(OUTJSON, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
