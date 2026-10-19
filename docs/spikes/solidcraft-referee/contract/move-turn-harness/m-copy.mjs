// move({copy:true}): shipped translator (refuses) vs guarded prototype (maps the copy, names found by DIFF), against live OCCT + brep-rs.
// Every top-level body of the scene is measured, so a stolen/mis-named body cannot hide behind one matching id.
import { writeFileSync } from 'node:fs';
import { runCase, runScript, mt } from './runner.mjs';
import { verdict } from './cases.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
import { translateDoc as naiveProto } from './translate-proto.mjs'; // copy mapped with GUESSED names ('<name> (2)'), the hazard
const f = (v) => (typeof v === 'number' ? v.toExponential(1) : v);
const out = [];
function go(name, script, opts = {}) {
  const r0 = runScript(script, opts.values ? { values: opts.values } : {});
  if (r0.errors.length) { console.log(name, 'SCRIPT ERROR', r0.errors[0].message); out.push({ name, script, errors: r0.errors.map((e) => e.message) }); return; }
  const ids = mt.topLevel(r0.doc).map((x) => x.id);
  const g = runCase({ script, ids, translateFn: guard, values: opts.values });
  const s = runCase({ script, ids, values: opts.values });
  const n = name.startsWith('collide/') ? runCase({ script, ids, translateFn: naiveProto, values: opts.values }) : null;
  const per = ids.map((id) => ({ id, guard: verdict(g, id), shipped: verdict(s, id), naive: n ? verdict(n, id) : undefined, naiveBbox: n?.truck[id]?.bbox, naiveDVol: n?.truck[id]?.dVol, g: g.truck[id], bbox: g.truck[id]?.bbox, occtBbox: g.truck[id]?.occtBbox }));
  const all = per.every((p) => p.guard === 'PASS');
  console.log(name.padEnd(30), all ? 'ALL-PASS' : 'NOT-ALL', per.map((p) => `${p.id}:${p.guard}/${p.shipped}${p.naive ? '/naive=' + p.naive + (p.naive !== 'PASS' ? ' bbox ' + JSON.stringify(p.naiveBbox?.map((v) => +v.toFixed(2))) : '') : ''}${p.g?.refused ? '(' + p.g.refused.slice(0, 80) + ')' : ` dVol=${f(p.g.dVol)} dBbox=${f(p.g.dBbox)} dCom=${f(p.g.dCom)} f=${p.g.faces}/${p.g.occtFaces}`}`).join(' | '));
  out.push({ name, script, allPass: all, per: per.map((p) => ({ id: p.id, guard: p.guard, shipped: p.shipped, naive: p.naive, naiveBbox: p.naiveBbox, refused: p.g?.refused, dVol: p.g?.dVol, dBbox: p.g?.dBbox, dCom: p.g?.dCom, faces: p.g?.faces, occtFaces: p.g?.occtFaces, bbox: p.bbox, occtBbox: p.occtBbox, shippedRefusal: s.truck[p.id]?.refused })), cmds: g.commands });
}
const C = {
  'copy/box': `const a = box(20, 10, 6, { at: [5, 2, -1] });\nmove(a, [30, -4, 6], { copy: true });`,
  'copy/cylinder': `const a = cylinder(12, 20, { at: [5, 2, -1] });\nmove(a, [30, -4, 6], { copy: true });`,
  'copy/sphere': `const a = sphere(14, { at: [5, 2, -1] });\nmove(a, [40, 0, 0], { copy: true });`,
  'copy/cone': `const a = cone(14, 18, { at: [5, 2, -1] });\nmove(a, [40, 0, 0], { copy: true });`,
  'copy/ring': `const a = ring(30, 6);\nmove(a, [0, 0, 20], { copy: true });`,
  'copy/prism': `const a = prism(6, 20, 12);\nmove(a, [50, 0, 0], { copy: true });`,
  'copy/wedge': `const a = wedge(20, 10, 8);\nmove(a, [30, -4, 6], { copy: true });`,
  'copy/hole': `const s = box(40, 30, 20);\nhole(s, { across: 8, at: [5, 3] });\nmove(s, [60, 0, 0], { copy: true });`,
  'copy/hollow': `const s = box(40, 30, 20);\nhollow(s, { wall: 2, open: 'top' });\nmove(s, [60, 0, 0], { copy: true });`,
  'copy/pull': `const k = sketch('top');\nk.rect(30, 20);\nconst v = pull(k, 10);\nmove(v, [0, 40, 0], { copy: true });`,
  'copy/join': `const a = box(20, 10, 6);\nconst c = box(8, 8, 8, { at: [0, 0, 7] });\nconst v = join(a, c);\nmove(v, [0, 30, 0], { copy: true });`,
  'copy/mirror-result': `const a = box(20, 10, 6, { at: [30, 0, 0] });\nconst m = mirror(a, 'left-right');\nmove(m, [0, 40, 0], { copy: true });`,
  'copy/turned-orig': `const a = box(20, 10, 6);\nturn(a, [0, 0, 30]);\nmove(a, [40, 0, 0], { copy: true });`,
  'copy/chain3': `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(b, [20, 0, 0], { copy: true });`,
  'copy/copy-then-move-orig': `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(a, [0, 20, 0]);`,
  'copy/copy-then-move-copy': `const a = box(10, 10, 10);\nconst b = move(a, [20, 0, 0], { copy: true });\nmove(b, [0, 20, 0]);`,
  'copy/copy-then-turn-copy': `const a = box(30, 10, 10);\nconst b = move(a, [0, 30, 0], { copy: true });\nturn(b, [0, 0, 90]);`,
  'copy/join-overlap': `const a = box(20, 10, 6);\nconst b = move(a, [10, 0, 0], { copy: true });\njoin(a, b);`,
  'copy/join-touch': `const a = box(20, 10, 6);\nconst b = move(a, [20, 0, 0], { copy: true });\njoin(a, b);`,
  'copy/cut-by-copy': `const a = box(30, 30, 10);\nconst c = cylinder(8, 30);\nconst d = move(c, [6, 4, 0], { copy: true });\ncut(a, d);`,
  // the pattern/mirror name-collision hazard: phase0 guessed '<name> (2)' for repeat instances and picked up the copy
  'collide/copy-then-repeat': `const a = box(10, 10, 10);\nmove(a, [0, 50, 0], { copy: true });\nrepeat(a, { count: 3, step: [15, 0, 0] });`,
  'collide/repeat-then-copy': `const a = box(10, 10, 10);\nconst p = repeat(a, { count: 3, step: [15, 0, 0] });\nmove(p, [0, 50, 0], { copy: true });`,
  'collide/copy-then-repeat-copy': `const a = box(10, 10, 10);\nconst b = move(a, [0, 50, 0], { copy: true });\nrepeat(b, { count: 2, step: [15, 0, 0] });`,
  'collide/copy-then-repeatAround': `const a = box(6, 6, 6, { at: [20, 0, 0] });\nmove(a, [0, 0, 30], { copy: true });\nrepeatAround(a, { count: 4 });`,
  'collide/copy-then-mirror': `const a = box(10, 10, 10, { at: [20, 0, 0] });\nmove(a, [0, 40, 0], { copy: true });\nmirror(a, 'left-right');`,
  'collide/two-copies-then-repeat': `const a = box(10, 10, 10);\nmove(a, [0, 50, 0], { copy: true });\nmove(a, [0, 80, 0], { copy: true });\nrepeat(a, { count: 3, step: [15, 0, 0] });`,
  'collide/repeat-twice-with-copy': `const a = box(10, 10, 10);\nmove(a, [0, 50, 0], { copy: true });\nconst p = repeat(a, { count: 2, step: [15, 0, 0] });\nrepeat(p, { count: 2, step: [0, 0, 15] });`,
  'copy/param': `const a = box(10, 10, 10);\nmove(a, [param('dx', 25), 0, 0], { copy: true });`,
};
for (const [k, s] of Object.entries(C)) go(k, s);
go('copy/param@dx=40', C['copy/param'], { values: { move1_x: 40 } });
writeFileSync('m-copy-results.json', JSON.stringify(out, null, 1));
