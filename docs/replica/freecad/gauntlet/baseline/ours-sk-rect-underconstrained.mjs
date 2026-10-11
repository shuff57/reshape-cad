// Piece sk-rect-underconstrained: 40x30 rectangle, 4 coincident corners + horizontal(1) + vertical(2) only.
// Ours: reSHape Script soup sketch -> brep-rs sketch_diagnose (DoF/bucket/blame) -> profile -> pad(extrude 10) as a sanity solid.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const PKG = path.join(root, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(root, 'packages/script/dist/reshape-script.js'));
const { SketchSession2D } = await import(path.join(root, 'packages/brep-adapter/dist/sketch-session.js'));
const { BrepRsEngineAdapter } = await import(path.join(root, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const THREE = createRequire(path.join(root, 'packages/brep-adapter/package.json'))('three');

const src = `const sk1 = sketch('top')
sk1.geom([
  { k:'line', id:1, a:[0,0], b:[40,0] },
  { k:'line', id:2, a:[40,0], b:[40,30] },
  { k:'line', id:3, a:[40,30], b:[0,30] },
  { k:'line', id:4, a:[0,30], b:[0,0] },
])
sk1.rules([
  { k:'coincident', a:1, aEnd:'b', b:2, bEnd:'a' },
  { k:'coincident', a:2, aEnd:'b', b:3, bEnd:'a' },
  { k:'coincident', a:3, aEnd:'b', b:4, bEnd:'a' },
  { k:'coincident', a:4, aEnd:'b', b:1, bEnd:'a' },
  { k:'horizontal', a:1 },
  { k:'vertical', a:2 },
  { k:'horizontal', a:3 },
  { k:'vertical', a:4 },
])`;
const out = { id: 'sk-rect-underconstrained', script: path.relative(root, new URL(import.meta.url).pathname), source: src };
const r = runScript(src);
if (r.errors?.length) { out.outcome = 'error'; out.notes = 'script errors: ' + JSON.stringify(r.errors); }
else {
  const sk = r.doc.features.find(f => f.kind === 'sketch');
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const e = s.open(sk.geom, sk.constraints_soup ?? sk.rules ?? []);
  out.sketchKeys = Object.keys(sk);
  if (e) { out.outcome = 'refused'; out.refusal = e; out.notes = 'open refused'; }
  else {
    out.solveOk = s.solve(); out.solveError = s.lastError();
    out.diagnosis = s.diagnose();
    out.profile = s.profile();
    // sanity solid: pad 10
    const doc = { version: 1, features: [...r.doc.features, { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 }] };
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    out.refusals = m.refusals ?? {};
    const ad = new BrepRsEngineAdapter(THREE); ad.loadFromBytes(brep);
    const b = ad.build(doc);
    const shape = b.shapes.get('e1');
    const mesh = shape && ad.mesh(shape);
    out.measure = m.shapes?.e1;
    out.faces = mesh?.faces?.length;
    out.meshVerts = mesh?.geometry?.getAttribute('position')?.count;
    out.adapterRefusals = b.refusals ? Object.fromEntries(b.refusals) : {};
    const ok = out.solveOk && out.diagnosis && mesh && out.meshVerts > 0;
    out.outcome = ok ? 'built' : (Object.keys(out.adapterRefusals).length ? 'refused' : 'error');
    out.notes = `Ours DoF=${out.diagnosis?.dof} rank=${out.diagnosis?.rank} bucket=${out.diagnosis?.bucket} blame=${JSON.stringify(out.diagnosis?.blame)}`;
  }
}

// ---- standard block read by compare.mjs (0-based rule indices; conflicting/redundant from the real solver's bucket+blame) ----
const stdCaseOf = (d) => ({ dof: d?.dof ?? null, bucket: d?.bucket ?? null, nativeBlame: d?.blame ?? [],
  conflicting: d?.bucket === 'conflicting' ? d.blame : [], conflictingNative: d?.bucket === 'conflicting' ? d.blame : [],
  redundant: d?.bucket === 'redundant' ? d.blame : [], indexBase: 0 });
const bboxOfProfile = (p) => { const xs = [], ys = [];
  for (const l of p?.loops ?? []) for (const s of l.segs) { if (s.a) { xs.push(s.a[0], s.b[0]); ys.push(s.a[1], s.b[1]); } }
  return xs.length ? [Math.min(...xs), Math.min(...ys), 0, Math.max(...xs), Math.max(...ys), 0] : null; };
out.std = { kind: 'sketch', outcome: out.outcome, cases: { main: stdCaseOf(out.diagnosis) } };
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(here, 'ours-sk-rect-underconstrained.json'), JSON.stringify(out, null, 2));
