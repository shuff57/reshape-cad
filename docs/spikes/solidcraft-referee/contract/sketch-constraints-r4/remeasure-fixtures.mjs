// Fresh re-measure on the CURRENT rig (demo/pkg = phase0 wrapper: no @sketch dump). Solid-level only:
// mapper -> SolidCraft -> volume/bbox/faces vs closed form, live brep-rs, live OCCT. No profile selection (needs the dump).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const SPIKE = path.join(REPO, 'docs/spikes/solidcraft-referee');
const imp = (p) => import(pathToFileURL(p).href);
const sc = await imp(path.join(SPIKE, 'demo/pkg/solidcraft_referee.js'));
sc.initSync({ module: readFileSync(path.join(SPIKE, 'demo/pkg/solidcraft_referee_bg.wasm')) });
const { mapSketch, extrudeCommands } = await imp(path.join(SPIKE, 'phase2/sketch-map.mjs'));
const { OWN, H, gauntletFixtures } = await imp(path.join(SPIKE, 'phase2/fixtures-p2.mjs'));
const BP = path.join(REPO, 'archive/brep-rs/pkg');
const brep = await imp(path.join(BP, 'brep_rs.js')); brep.initSync({ module: readFileSync(path.join(BP, 'brep_rs_bg.wasm')) });
const { SketchSession2D } = await imp(path.join(REPO, 'packages/brep-adapter/dist/sketch-session.js'));
const { buildDoc } = await imp(path.join(REPO, 'packages/brep-adapter/dist/occt-build.js'));
const arcMod = await imp(path.join(REPO, 'packages/sketch/dist/sketch-arc.js'));
const OD = path.join(REPO, 'node_modules/replicad-opencascadejs/dist');
const oc = await (await imp(path.join(OD, 'replicad_single.js'))).default({ locateFile: (f) => path.join(OD, f) });
const clone = (o) => JSON.parse(JSON.stringify(o));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
function geomBox(gs) { const pts = []; for (const g of gs) { if (g.k === 'point') pts.push(g.p); else if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); else pts.push(g.a, g.b); } const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
function roughen(fx, frac) {
  const rnd = mulberry(seedOf(fx.id)); const bb = geomBox(fx.geoms);
  const amp = frac * Math.max(Math.hypot(bb[2] - bb[0], bb[3] - bb[1]), 1);
  const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const j = () => (rnd() * 2 - 1) * amp; const mv = (p) => [p[0] + j(), p[1] + j()];
  return fx.geoms.map((g) => { const o = clone(g);
    const lk = (e) => locked.has(`${g.id}:${e}`);
    if (g.k === 'point') { if (!lk('a')) o.p = mv(g.p); }
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o; });
}
function truck(fx, geoms) {
  const mapped = mapSketch({ id: fx.id, plane: fx.plane, geoms, rules: fx.rules }, { name: 'sk' });
  if (!mapped.ok) return { refused: 'mapper', sentence: mapped.refusals.map((r) => r.sentence).join(' | ') };
  const cmds = extrudeCommands(mapped, { height: H }).filter((c) => c.command !== '@sketch');
  const r = JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
  if (!r.ok) return { refused: 'solidcraft', sentence: r.failed ? `command ${r.failed.index} ${r.failed.command}: ${r.failed.error}` : r.error };
  const bs = r.measure.out?.bodies ?? r.measure.bodies;
  const vol = bs.reduce((a, b) => a + b.volume_mm3, 0);
  return { bodies: bs.length, volume: vol, faces: bs.reduce((a, b) => a + b.faces, 0),
    bbox: [...[0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))), ...[0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])))] };
}
function brepRef(fx, geoms) {
  const o = {};
  try {
    const s = new SketchSession2D(); s.loadFromBytes(brep);
    const e = s.open(clone(geoms), clone(fx.rules));
    if (e) { o.refused = `open: ${JSON.stringify(e).slice(0, 120)}`; s.close(); return o; }
    const ok = s.solve(); if (!ok) { o.refused = `solve: ${s.lastError()}`; s.close(); return o; }
    o.solved = s.solvedGeoms(); o.dof = s.diagnose()?.dof; s.close();
    const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: fx.plane, offset: 0, geoms: clone(geoms), rules: clone(fx.rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] };
    const built = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const m = built.shapes?.e1; if (!m) { o.refused = 'brep-rs no shape'; return o; }
    o.volume = m.volume; o.faces = m.faces ?? m.face_count; o.bbox = [...m.bbox[0], ...m.bbox[1]];
  } catch (e) { o.refused = String(e.message).slice(0, 120); }
  return o;
}
function snap(gs) {
  const g2 = clone(gs); const pts = [];
  for (const g of g2) for (const k of ['a', 'b']) if (g[k] && (g.k === 'line' || g.k === 'arc')) pts.push([g, k]);
  const reps = [];
  for (const [g, k] of pts) { const hit = reps.find((r) => Math.hypot(r[0] - g[k][0], r[1] - g[k][1]) < 1e-5); if (hit) g[k] = [...hit]; else reps.push([...g[k]]); }
  return g2;
}
function occtRef(fx, geoms, solved) {
  try {
    if (solved) solved = snap(solved);
    const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: fx.plane, offset: 0, geoms: clone(solved ?? geoms), rules: solved ? clone(fx.rules).filter((r) => ![r.a, r.b, r.c].some((x) => typeof x === 'number' && x < 0)) : clone(fx.rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: H }] };
    const b = buildDoc(oc, doc, arcMod); const shape = b.shapes.get('e1');
    if (!shape) return { refused: [...(b.refusals?.values?.() ?? [])].join(' | ') || 'no shape' };
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(), hi = bx.CornerMax();
    return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()] };
  } catch (e) { return { refused: String(e.message).slice(0, 120) }; }
}
const bboxRel = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]) / Math.max(Math.abs(b[i]), 1)));
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const out = [];
for (const fx of [...OWN, ...gauntletFixtures()]) {
  if (only.length && !only.some((o) => fx.id.includes(o))) continue;
  for (const mode of ['stored', 'rough3.5', 'rough15']) {
    const geoms = mode === 'stored' ? clone(fx.geoms) : roughen(fx, mode === 'rough3.5' ? 0.035 : 0.15);
    const t0 = performance.now();
    const t = truck(fx, geoms);
    const rec = { id: fx.id, mode, ms: Math.round(performance.now() - t0), closedVol: fx.closed != null ? fx.closed * H : null };
    if (t.refused) { rec.refused = t.refused; rec.sentence = t.sentence; out.push(rec); console.log(`REFUSED ${fx.id} ${mode} [${t.refused}] ${String(t.sentence).slice(0, 160)}`); continue; }
    rec.sc = { volume: t.volume, faces: t.faces, bodies: t.bodies, bbox: t.bbox };
    const curved = fx.geoms.some((g) => g.k === 'circle' || g.k === 'arc');
    rec.tol = curved ? 3e-4 : 1e-9;
    if (rec.closedVol != null) rec.dClosed = rel(t.volume, rec.closedVol);
    if (fx.bbox) rec.dBboxClosed = bboxRel(t.bbox, fx.bbox);
    const b = brepRef(fx, geoms); rec.brep = b.refused ? { refused: b.refused } : { volume: b.volume, faces: b.faces, d: rel(t.volume, b.volume), faceSame: b.faces === t.faces, dof: b.dof };
    const o = occtRef(fx, geoms, b.solved); rec.occt = o.refused ? { refused: o.refused } : { volume: o.volume, d: rel(t.volume, o.volume), dBbox: bboxRel(t.bbox, o.bbox) };
    // verdict only against references that exist; curved bar 3e-4 (truck tessellation)
    const checks = [];
    if (rec.dClosed != null) checks.push(rec.dClosed <= rec.tol);
    if (rec.dBboxClosed != null) checks.push(rec.dBboxClosed <= rec.tol);
    if (rec.brep.d != null) checks.push(rec.brep.d <= rec.tol);
    if (rec.occt.d != null) checks.push(rec.occt.d <= rec.tol);
    rec.verdict = !checks.length ? 'NO-REFERENCE' : checks.every(Boolean) ? 'MATCH' : 'MISMATCH';
    out.push(rec);
    console.log(`${rec.verdict.padEnd(9)} ${fx.id.padEnd(52)} ${mode.padEnd(8)} bodies ${t.bodies} faces ${t.faces} dClosed ${rec.dClosed?.toExponential(1) ?? '-'} dBbox ${rec.dBboxClosed?.toExponential(1) ?? '-'} brep ${rec.brep.d?.toExponential(1) ?? rec.brep.refused?.slice(0, 40)} occt ${rec.occt.d?.toExponential(1) ?? rec.occt.refused?.slice(0, 40)} ${rec.ms}ms`);
  }
}
writeFileSync(process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '/dev/null', JSON.stringify(out, null, 1));
