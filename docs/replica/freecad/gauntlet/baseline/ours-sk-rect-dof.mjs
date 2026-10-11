// Piece sk-rect-dof: 40x30 rectangle sketch, DoF + conflict/redundancy via the brep-rs sketch seam.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await import(path.join(ROOT, 'packages/brep-adapter/dist/sketch-session.js'));
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));

const L = (id, a, b) => ({ k: 'line', id, a, b });
const geoms = [L(1,[0,0],[40,0]), L(2,[40,0],[40,30]), L(3,[40,30],[0,30]), L(4,[0,30],[0,0]),
  { k: 'point', id: 5, p: [0,0] }];
const cc = (a,b) => ({ k:'coincident', a, aEnd:'b', b, bEnd:'a' });
const base = [cc(1,2), cc(2,3), cc(3,4), cc(4,1),
  { k:'horizontal', a:1 }, { k:'horizontal', a:3 }, { k:'vertical', a:2 }, { k:'vertical', a:4 },
  { k:'distance', a:1, aEnd:'a', b:1, bEnd:'b', value:40 },
  { k:'distance', a:2, aEnd:'a', b:2, bEnd:'b', value:30 }];
const fixRules = [{ k:'coincident', a:5, aEnd:'a', b:1, bEnd:'a' }, { k:'lock', a:5 }];

const out = { id:'sk-rect-dof', outcome:'error', script:'docs/replica/freecad/gauntlet/baseline/ours-sk-rect-dof.mjs', notes:'' };
const session = new SketchSession2D(); session.loadFromBytes(brep);
const run = (name, rules, g = geoms) => {
  const err = session.open(g, rules);
  if (err) return { name, openRefusal: err };
  const ok = session.solve();
  return { name, solved: ok, lastError: ok ? null : brep.sketch_last_error(), diag: session.diagnose(), profile: session.profile() };
};
try {
  const variants = [
    run('full: coincident+H/V+40+30+origin point locked & coincident', [...base, ...fixRules]),
    run('without origin fix', base),
    run('fix via distanceX/Y of corner to origin point? (point locked, dx=0,dy=0 omitted) lock on line1 only', [...base, { k:'lock', a:1 }]),
  ];
  const full = variants[0];
  // script path: how reSHape Script expresses it
  const rs = runScript("const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[40,30],[0,30]]); sk1.horiz(1); sk1.vert(2); sk1.length(1,40); sk1.length(2,30); sk1.lock(1);");
  const rs2 = runScript("const sk1 = sketch('top'); sk1.rect(40,30);");
  out.scriptProbe = { polygonWithRules: rs.error ?? { constraints: rs.doc.features[0].constraints ?? null }, rect: rs2.error ?? 'ok' };
  out.variants = variants;
  out.dof = full.diag?.dof; out.rank = full.diag?.rank; out.bucket = full.diag?.bucket; out.blame = full.diag?.blame;
  out.outcome = full.diag && full.profile?.loops ? 'built' : 'refused';
  if (out.outcome==='refused') out.refusal = full.openRefusal ?? full.lastError ?? JSON.stringify(full.profile);
  out.notes = 'Sketch piece: no solid. Soup rows via SketchSession2D (sketch_open/solve/diagnose/profile). Corner fix is a point geometry coincident with line1.a plus lock on the point (the soup lock takes a geometry, not an endpoint).';
} catch (e) { out.outcome='error'; out.notes=String(e.stack||e); }

// ---- standard block read by compare.mjs (0-based rule indices; conflicting/redundant from the real solver's bucket+blame) ----
const stdCaseOf = (d) => ({ dof: d?.dof ?? null, bucket: d?.bucket ?? null, nativeBlame: d?.blame ?? [],
  conflicting: d?.bucket === 'conflicting' ? d.blame : [], conflictingNative: d?.bucket === 'conflicting' ? d.blame : [],
  redundant: d?.bucket === 'redundant' ? d.blame : [], indexBase: 0 });
const bboxOfProfile = (p) => { const xs = [], ys = [];
  for (const l of p?.loops ?? []) for (const s of l.segs) { if (s.a) { xs.push(s.a[0], s.b[0]); ys.push(s.a[1], s.b[1]); } }
  return xs.length ? [Math.min(...xs), Math.min(...ys), 0, Math.max(...xs), Math.max(...ys), 0] : null; };
out.std = { kind: 'sketch', outcome: out.outcome, bboxAxes: [0, 1], bbox: bboxOfProfile(out.variants?.[0]?.profile),
  cases: { main: stdCaseOf(out.variants?.[0]?.diag) } };
writeFileSync(path.join(HERE,'ours-sk-rect-dof.json'), JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
