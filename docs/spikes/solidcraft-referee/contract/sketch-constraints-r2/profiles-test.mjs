// Profile selection on circle-only multi-profile sketches: the host's second-pass selector phase2/sketch-map.mjs docProfileIndices (ray cast from SolidCraft's
// interior point) against the round-2 selector guard.mjs evenOddProfiles (winding number), and the guarded route end to end.
//   SOLIDCRAFT_REFEREE_PKG2=<p2 pkg> bun profiles-test.mjs [--out=out/profiles.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { C, H, plainRules, roughen, CASES } from './cases.mjs';
import { evenOddProfiles, ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/profiles.json').slice(6);
const lockc = (id) => ({ k: 'lock', a: id, aEnd: 'c' });
const rad = (id, v) => ({ k: 'radius', a: id, value: v });
function extrudeSel(m, indices, profiles) {
  const cmds = lib.mapper.extrudeCommands(m, { height: H }).filter((c) => c.command !== '@sketch');
  const e = cmds.find((c) => c.command === 'solid.extrude'); e.params.profiles = indices.map((i) => ({ point: profiles[i].interior }));
  return lib.bodiesOf(lib.scRaw(cmds).measure);
}
const rows = [];
function oneCase(name, geoms, rules, wantVol, wantBodies) {
  const r = lib.scSketch(geoms, rules);
  if (r.mapperRefused || r.firstRefusal || !r.dump) { rows.push({ name, error: r.mapperRefused ?? r.firstRefusal }); return; }
  const prof = r.profiles;
  const oldIdx = lib.mapper.docProfileIndices(prof, r.solved);
  const newIdx = evenOddProfiles(prof, r.solved, rules);
  const oldBody = oldIdx.length === prof.length ? r.body : oldIdx.length ? extrudeSel(r.map, oldIdx, prof) : null;
  const g = ladderSketch({ geoms, rules });
  const row = { name, profiles: prof.length, oldIdx, newIdx, defaultAllProfiles: r.body && { volume: r.body.volume, bodies: r.body.bodies },
    oldSelector: oldBody && { volume: oldBody.volume, bodies: oldBody.bodies, ok: Math.abs(oldBody.volume - wantVol) / wantVol < 1e-3 && oldBody.bodies === wantBodies },
    guarded: g.ok ? { volume: g.body.volume, bodies: g.body.bodies, chosen: g.chosen, ok: Math.abs(g.body.volume - wantVol) / wantVol < 1e-3 && g.body.bodies === wantBodies } : { refused: g.sentence },
    want: { volume: wantVol, bodies: wantBodies } };
  rows.push(row);
  console.log(`${name.padEnd(46)} profiles ${prof.length} old ${JSON.stringify(oldIdx)} (${oldBody ? (row.oldSelector.ok ? 'ok' : 'WRONG ' + oldBody.volume.toFixed(1)) : 'none'}) new ${JSON.stringify(newIdx)} guarded ${g.ok ? (row.guarded.ok ? 'ok' : 'WRONG ' + g.body.volume.toFixed(1)) : 'REFUSED ' + g.sentence.slice(0, 60)} want ${wantVol.toFixed(1)}`);
}
const twoDiscs = (x2, y1, y2) => oneCase(`2 discs r10@(0,${y1}) r5@(${x2},${y2})`, [C(1, [0, y1], 10), C(2, [x2, y2], 5)], [lockc(1), lockc(2), rad(1, 10), rad(2, 5)], Math.PI * 125 * H, 2);
for (const x2 of [30, 28]) for (const [y1, y2] of [[3, -2], [0, 0], [0.1, 0.1], [7.3, 7.3], [1, -1], [2, 2], [5, -5], [-3, 3], [4, 0], [0, 4], [6, 1.5]]) twoDiscs(x2, y1, y2);
// disc inside disc (annulus), at offsets
for (const [y1, y2] of [[0, 0], [3, 3.5], [3, -2], [7.3, 6]]) oneCase(`annulus r10@(0,${y1}) r4@(2,${y2})`, [C(1, [0, y1], 10), C(2, [2, y2], 4)], [lockc(1), lockc(2), rad(1, 10), rad(2, 4)], Math.PI * (100 - 16) * H, 1);
// three discs, one nested
for (const y of [0, 3, -2]) oneCase(`3 discs (r10, r4 inside, r5 apart) y=${y}`, [C(1, [0, y], 10), C(2, [1, y + 0.5], 4), C(3, [30, y - 2], 5)], [lockc(1), lockc(2), lockc(3), rad(1, 10), rad(2, 4), rad(3, 5)], Math.PI * (100 - 16 + 25) * H, 2);
// the seeded rough-start external tangent circles of round 1
const cs = CASES.find((c) => c.id === 'circle-circle-external-mode');
const tally = { n: 0, oldWrong: 0, newWrong: 0, guardedWrong: 0, guardedRefused: 0, defaultAllProfilesAlreadyRight: 0 };
for (const frac of [0.035, 0.15]) for (let k = 0; k < 40; k++) {
  const st = roughen(cs.geoms, cs.rules, `${cs.id}#${k}#${frac}`, frac);
  const rules = plainRules(cs.rules);
  const r = lib.scSketch(st, rules);
  if (r.mapperRefused || r.firstRefusal || !r.dump) continue;
  tally.n++;
  const want = cs.area * H;
  const okV = (b) => b && Math.abs(b.volume - want) / want < 3e-4 && b.bodies === 2;
  const oldIdx = lib.mapper.docProfileIndices(r.profiles, r.solved), newIdx = evenOddProfiles(r.profiles, r.solved, rules);
  const oldB = oldIdx.length === r.profiles.length ? r.body : oldIdx.length ? extrudeSel(r.map, oldIdx, r.profiles) : null;
  const newB = newIdx.length === r.profiles.length ? r.body : newIdx.length ? extrudeSel(r.map, newIdx, r.profiles) : null;
  if (!okV(oldB)) tally.oldWrong++;
  if (!okV(newB)) tally.newWrong++;
  const g = ladderSketch({ geoms: st, rules });
  if (!g.ok) tally.guardedRefused++; else if (!okV(g.body)) tally.guardedWrong++;
}
console.log('seeded external-tangent circles (rough starts, 3.5% and 15%):', JSON.stringify(tally));
writeFileSync(OUTF, JSON.stringify({ rows, seeded: tally }, null, 1));
