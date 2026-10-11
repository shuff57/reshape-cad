// Piece sk-conflict: contradictory width (40 vs 50) and redundant width (40 twice) on a rectangle sketch (40 x 20, the reference spec; rule order mirrors ref-sk-conflict.py so 0-based rule indices line up).
// Measured on the real brep-rs wasm (packages/brep-rs/pkg) via SketchSession2D (sketch_open/solve/diagnose/profile)
// and, for the build half, measure_doc + BrepRsEngineAdapter. One kernel, no fallback.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('file://' + path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const { SketchSession2D } = await import('file://' + path.join(ROOT, 'packages/brep-adapter/dist/sketch-session.js'));
const { BrepRsEngineAdapter } = await import('file://' + path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));

const GEOM = `[{k:'line',id:1,a:[0,0],b:[40,0]},{k:'line',id:2,a:[40,0],b:[40,20]},{k:'line',id:3,a:[40,20],b:[0,20]},{k:'line',id:4,a:[0,20],b:[0,0]}]`;
const BASE = [
  `{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'}`, `{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'}`,
  `{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'}`, `{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'}`,
  `{k:'horizontal',a:1}`, `{k:'horizontal',a:3}`, `{k:'vertical',a:2}`, `{k:'vertical',a:4}`,
  `{k:'lock',a:1,aEnd:'a'}`,
  `{k:'distanceX',a:1,aEnd:'a',b:1,bEnd:'b',value:40}`,   // index 9: width 40
  `{k:'distanceY',a:2,aEnd:'a',b:2,bEnd:'b',value:20}`,   // index 10: height 20
];
const CASES = {
  baseline_fully_constrained: BASE,
  contradictory_width_50: [...BASE, `{k:'distanceX',a:1,aEnd:'a',b:1,bEnd:'b',value:50}`], // index 11
  redundant_width_40: [...BASE, `{k:'distanceX',a:1,aEnd:'a',b:1,bEnd:'b',value:40}`],      // index 11
};

const results = {};
const notes = [];
for (const [name, rules] of Object.entries(CASES)) {
  const src = `const sk1 = sketch('top')\nsk1.geom(${GEOM})\nsk1.rules([${rules.join(',')}])`;
  const r = runScript(src);
  const out = { scriptErrors: r.errors.map((e) => e.message), ruleCount: rules.length };
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  if (!sk) { out.error = 'no sketch feature'; results[name] = out; continue; }
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const openErr = s.open(sk.geom ?? sk.geoms, sk.rules);
  out.openRefusal = openErr;
  if (!openErr) {
    out.solveOk = s.solve();
    out.solveLastError = out.solveOk ? null : s.lastError();
    out.diagnosis = s.diagnose();   // {rank,dof,bucket,blame} ; blame = 0-based rule indices into rules[]
    const p = s.profile();
    out.profile = 'refusal' in p ? { refusal: p.refusal } : { loops: p.loops.length };
    if (out.solveOk) out.solvedLines = s.solvedGeoms().map((g) => ({ id: g.id, a: g.a, b: g.b }));
  }
  s.close();
  // Build half: extrude 10 through measure_doc and the adapter
  const doc = { version: 1, features: [...r.doc.features, { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 }] };
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  out.measure = { refusals: m.refusals ?? {}, e1: m.shapes?.e1 ?? null };
  try {
    const ad = new BrepRsEngineAdapter(); ad.loadFromBytes(brep);
    const b = ad.build(doc);
    const shape = b.shapes.get('e1');
    out.adapter = { refusals: Object.fromEntries(b.refusals ?? []), hasShape: !!shape };
    // ad.mesh() needs a THREE namespace (browser-side); the shape handle + measure_doc faces/volume stand in for a non-empty mesh.
  } catch (e) { out.adapter = { error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
  results[name] = out;
}

// ---- standard block read by compare.mjs ----------------------------------------------------------
// Rule order here equals FreeCAD's constraint order (4 coincident, H, H, V, V, origin fix, DistanceX, DistanceY, then the
// added row), so both sides use the same 0-based index. The solver's native `blame` names ONE rule (the row whose addition
// broke consistency). FreeCAD's ConflictingConstraints names the WHOLE contradicting set. To compare like with like we also
// derive the set from the same solver by leave-one-out: rule i is in the conflicting set iff dropping it clears the
// 'conflicting' bucket. Both lists are published; compare.mjs prints the native one next to the derived one.
function bucketOf(rules) {
  const sk = runScript(`const sk1 = sketch('top')\nsk1.geom(${GEOM})\nsk1.rules([${rules.join(',')}])`).doc.features.find((f) => f.kind === 'sketch');
  const s = new SketchSession2D(); s.loadFromBytes(brep);
  const e = s.open(sk.geom ?? sk.geoms, sk.rules);
  let b = null;
  if (!e) { s.solve(); b = s.diagnose()?.bucket ?? null; }
  s.close();
  return b;
}
function stdCase(name) {
  const o = results[name];
  const bucket = o.diagnosis?.bucket ?? null;
  const native = o.diagnosis?.blame ?? [];
  let conflictSet = [];
  if (bucket === 'conflicting') {
    CASES[name].forEach((_, i) => { if (bucketOf(CASES[name].filter((__, j) => j !== i)) !== 'conflicting') conflictSet.push(i); });
  }
  return {
    dof: o.diagnosis?.dof ?? null,
    bucket,
    nativeBlame: native,
    conflicting: bucket === 'conflicting' ? conflictSet : [],
    conflictingNative: bucket === 'conflicting' ? native : [],
    redundant: bucket === 'redundant' ? native : [],
    indexBase: 0,
  };
}
const std = {
  kind: 'sketch',
  outcome: results.baseline_fully_constrained.adapter?.hasShape && !Object.keys(results.baseline_fully_constrained.adapter.refusals ?? {}).length ? 'built' : 'error',
  cases: { baseline: stdCase('baseline_fully_constrained'), conflict: stdCase('contradictory_width_50'), redundant: stdCase('redundant_width_40') },
  conflictBuildRefused: !!results.contradictory_width_50.adapter?.refusals?.e1,
};
const res = { piece: 'sk-conflict', id: 'sk-conflict', outcome: std.outcome, std, cases: results };
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ours-sk-conflict.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
