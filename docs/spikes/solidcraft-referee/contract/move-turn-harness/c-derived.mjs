import { writeFileSync } from 'node:fs';
import { runCase } from './runner.mjs';
import { line, verdict } from './cases.mjs';
const D = {
  hole_box: `const s = box(40, 30, 20, { at: [3, -2, 1] });\nhole(s, { across: 8, at: [5, 3] });`,
  corner_box: `const s = box(30, 20, 10, { corner: 2 });`,
  fillet_box: `const s = box(30, 20, 10);\nround(s.edge('top', 'front'), 2);`,
  hollow_box: `const s = box(30, 20, 10);\nhollow(s, { wall: 2 });`,
  hollow_open: `const s = box(30, 20, 10);\nhollow(s, { wall: 2, open: 'top' });`,
  hole_cyl: `const s = cylinder(30, 20, { at: [2, 3, 1] });\nhole(s, { across: 6, at: [4, 2] });`,
  join_box_cyl: `const a = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = join(a, c);`,
  cut_box_cyl: `const a = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = cut(a, c);`,
  keep_box_cyl: `const a = box(30, 20, 10);\nconst c = cylinder(10, 30, { at: [10, 0, 0] });\nconst s = keep(a, c);`,
  mirror_box: `const a = box(30, 20, 10, { at: [20, 0, 0] });\nconst s = mirror(a, 'left-right');`,
  repeat_box: `const a = box(10, 10, 10);\nrepeat(a, { count: 3, step: 15 });`,
  repeatAround: `const a = box(10, 10, 10, { at: [30, 0, 0] });\nrepeatAround(a, { count: 4, axis: 'z' });`,
  pull_rect: 'x',
  moved_box: `const a = box(20, 10, 6);\nmove(a, [10, 5, 3]);`,
};
const ANG = [[0, 0, 45], [90, 0, 0], [0, 90, 0], [30, 40, 50], [-30, -40, -50], [10, 20, 300], [0, 0, 0], [360, 0, 0]];
const rows = []; const summary = {};
// variable names: use the last assigned handle per case
const VAR = { hole_box: 's', corner_box: 's', fillet_box: 's', hollow_box: 's', join_box_cyl: 's', cut_box_cyl: 's', keep_box_cyl: 's', mirror_box: 's', hollow_open: 's', hole_cyl: 's', repeat_box: 'a', repeatAround: 'a', pull_rect: 'p', moved_box: 'a' };
const out = [];
for (const name of Object.keys(D)) for (const a of ANG) {
  let base = D[name];
  if (name === 'pull_rect') base = `const sk = sketch('top');\nsk.rect(30, 20);\nconst p = pull(sk, 12);`;
  const script = `${base}\nturn(${VAR[name]}, [${a.join(', ')}]);`;
  const t0 = Date.now();
  let r;
  try { r = runCase({ script }); } catch (e) { out.push({ name, a, error: String(e.stack).slice(0, 300) }); console.error(name, 'THROW', e.message); continue; }
  if (r.errors.length) { out.push({ name, a, script, error: r.errors }); console.log(name, JSON.stringify(a), 'SCRIPT ERROR', JSON.stringify(r.errors)); continue; }
  const id = r.features.at(-1).id;
  const v = verdict(r, id); const t = r.truck[id];
  out.push({ name, a, kinds: r.features.map((x) => x.kind).join('>'), last: id, v, dVol: t.dVol, dBbox: t.dBbox, dCom: t.dCom, faces: t.faces, occtFaces: t.occtFaces, refused: t.refused, brepDVol: r.brep[id]?.dVol, brepDBbox: r.brep[id]?.dBbox, brepRefused: r.brep[id]?.refused, occtVol: t.occtVolume, tfeat: r.truckFeatures.map((x)=>x.id+':'+x.status).join(',') });
  console.error(name, JSON.stringify(a), v, Date.now() - t0, 'ms');
  if (v !== 'PASS') console.log(line(`turn-derived/${name}${JSON.stringify(a)}`, r, [id]));
  summary[name] = summary[name] ?? {}; summary[name][v] = (summary[name][v] ?? 0) + 1;
}
writeFileSync('c-derived-results.json', JSON.stringify({ out, summary }, null, 1));
console.log(JSON.stringify(summary));
console.log('done');
