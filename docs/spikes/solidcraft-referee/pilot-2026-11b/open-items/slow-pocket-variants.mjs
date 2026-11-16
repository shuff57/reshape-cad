// slow-pocket-variants.mjs [cases | read <trace.log>]: plan item 5, step 2: what in the input makes a pocket slow. The hang search's slowest calls
// without a time budget were pockets (awkward fc 3671, combined 3023, fc 3431, combined 2495, rg 3028, rg 2860, rg 2692). Each is cut down here to
// the steps up to the slow pocket, and then one thing at a time is changed: the depth, the taper, the rounds of the outline, the shape pocketed.
//   node slow-pocket-variants.mjs cases > cases.json     then  TRACE_CALLS=1 node sweep/host-route-sweep.mjs --corpus=file --cases=cases.json
//                                                              --name=pockets --out=<dir> --no-oracle --timeout=300 > trace.log 2>&1
//   node slow-pocket-variants.mjs read trace.log <dir>/hr-pockets.jsonl      the table
import fs from 'node:fs';
const rect = (id, w, h, rounds) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [w, 0], [w, h], [0, h]], ...(rounds ? { rounds: { 0: rounds, 1: rounds } } : {}) });
const circ = (id, a, b) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [a, b] });
const pk = (id, target, into, depth, extra = {}) => ({ id, kind: 'pocket', target, into, depth, ...extra });
const ball = (r, center = [0, 0, 0]) => ({ id: 's1', kind: 'sphere', radius: r, center }); const box = (size) => ({ id: 'b1', kind: 'box', size, center: [0, 0, 0] });
const cyl = (r, h) => ({ id: 'c1', kind: 'cylinder', radius: r, height: h, center: [0, 0, 0] });
const F = [];
const fam = (name, list) => list.forEach(([what, features]) => F.push({ id: `${name}: ${what}`, doc: { version: 1, features } }));
fam('A ball r 8, an 8 x 6 pocket (fc 3671)', [
  ['as found: 0.01 deep, corners rounded 0.001', [ball(8), rect('sk2', 8, 6, 0.001), pk('pk3', 'sk2', 's1', 0.01)]],
  ['0.01 deep, sharp corners', [ball(8), rect('sk2', 8, 6), pk('pk3', 'sk2', 's1', 0.01)]],
  ['1 deep, corners rounded 0.001', [ball(8), rect('sk2', 8, 6, 0.001), pk('pk3', 'sk2', 's1', 1)]],
  ['1 deep, sharp corners', [ball(8), rect('sk2', 8, 6), pk('pk3', 'sk2', 's1', 1)]],
  ['3 deep, sharp corners', [ball(8), rect('sk2', 8, 6), pk('pk3', 'sk2', 's1', 3)]],
  ['the same 0.01 pocket in a 16 x 16 x 16 box', [box([16, 16, 16]), rect('sk2', 8, 6, 0.001), pk('pk3', 'sk2', 'b1', 0.01)]],
]);
fam('B ball r 8 off the origin, a 4 x 4 pocket 2 deep (combined 3023)', [
  ['as found: taper 25, corners rounded 1.999', [ball(8, [8, -5, 3]), rect('sk2', 4, 4, 1.999), pk('pk3', 'sk2', 's1', 2, { taper: 25 })]],
  ['no taper, corners rounded 1.999', [ball(8, [8, -5, 3]), rect('sk2', 4, 4, 1.999), pk('pk3', 'sk2', 's1', 2)]],
  ['taper 25, sharp corners', [ball(8, [8, -5, 3]), rect('sk2', 4, 4), pk('pk3', 'sk2', 's1', 2, { taper: 25 })]],
  ['no taper, sharp corners', [ball(8, [8, -5, 3]), rect('sk2', 4, 4), pk('pk3', 'sk2', 's1', 2)]],
  ['taper 25, a circle of 4', [ball(8, [8, -5, 3]), circ('sk2', [0, 2], [4, 2]), pk('pk3', 'sk2', 's1', 2, { taper: 25 })]],
  ['the same tapered pocket in a 16 x 16 x 16 box', [box([16, 16, 16]), rect('sk2', 4, 4, 1.999), pk('pk3', 'sk2', 'b1', 2, { taper: 25 })]],
]);
fam('C ball r 10, two round pockets one after the other (fc 3431)', [
  ['the first only: 2 deep, taper 25', [ball(10), circ('sk3', [4, 8], [8, 8]), pk('pk4', 'sk3', 's1', 2, { taper: 25 })]],
  ['as found: then a second, 40 deep, taper 25', [ball(10), circ('sk3', [4, 8], [8, 8]), pk('pk4', 'sk3', 's1', 2, { taper: 25 }), circ('sk5', [4, 10], [8, 10]), pk('pk6', 'sk5', 'pk4', 40, { taper: 25 })]],
  ['both without taper', [ball(10), circ('sk3', [4, 8], [8, 8]), pk('pk4', 'sk3', 's1', 2), circ('sk5', [4, 10], [8, 10]), pk('pk6', 'sk5', 'pk4', 40)]],
]);
fam('D a disc r 12, 0.02 high, drafted 2 degrees, a round pocket 0.01 deep (combined 2495)', [
  ['as found', [cyl(12, 0.02), { id: 'd2', kind: 'draft', target: 'c1', angle: 2, pull: 'z', neutral: 0, whole: true }, circ('sk3', [3, 10], [9, 10]), pk('pk4', 'sk3', 'd2', 0.01)]],
  ['without the draft', [cyl(12, 0.02), circ('sk3', [3, 10], [9, 10]), pk('pk4', 'sk3', 'c1', 0.01)]],
  ['a disc 12 high, drafted, the pocket 0.01 deep', [cyl(12, 12), { id: 'd2', kind: 'draft', target: 'c1', angle: 2, pull: 'z', neutral: 0, whole: true }, circ('sk3', [3, 10], [9, 10]), pk('pk4', 'sk3', 'd2', 0.01)]],
  ['a disc 12 high, drafted, the pocket 1 deep', [cyl(12, 12), { id: 'd2', kind: 'draft', target: 'c1', angle: 2, pull: 'z', neutral: 0, whole: true }, circ('sk3', [3, 10], [9, 10]), pk('pk4', 'sk3', 'd2', 1)]],
]);
fam('E a 40 x 20 x 10 box, a tapered through pocket, then a second pocket that cuts into its wall (rg 3028)', [
  ['as found: the first taper 25, the second 0.01 deep', [box([40, 20, 10]), circ('sk2', [2, 6], [10, 6]), pk('pk3', 'sk2', 'b1', 2, { through: true, taper: 25 }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 0.01)]],
  ['the second 1 deep', [box([40, 20, 10]), circ('sk2', [2, 6], [10, 6]), pk('pk3', 'sk2', 'b1', 2, { through: true, taper: 25 }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 1)]],
  ['the first without taper, the second 0.01 deep', [box([40, 20, 10]), circ('sk2', [2, 6], [10, 6]), pk('pk3', 'sk2', 'b1', 2, { through: true }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 0.01)]],
  ['the second clear of the first (its circle moved 10 along x), 0.01 deep', [box([40, 20, 10]), circ('sk2', [2, 6], [10, 6]), pk('pk3', 'sk2', 'b1', 2, { through: true, taper: 25 }), circ('sk4', [19, 6], [25, 6]), pk('pk5', 'sk4', 'pk3', 0.01)]],
]);
fam('F a 20 x 30 x 20 box, two tapered through pockets that meet (rg 2860)', [
  ['as found: taper -15, then taper 25', [box([20, 30, 20]), circ('sk2', [2, 8], [10, 8]), pk('pk3', 'sk2', 'b1', 40, { through: true, taper: -15 }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 5, { through: true, taper: 25 })]],
  ['the second without taper', [box([20, 30, 20]), circ('sk2', [2, 8], [10, 8]), pk('pk3', 'sk2', 'b1', 40, { through: true, taper: -15 }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 5, { through: true })]],
  ['both without taper', [box([20, 30, 20]), circ('sk2', [2, 8], [10, 8]), pk('pk3', 'sk2', 'b1', 40, { through: true }), circ('sk4', [9, 6], [15, 6]), pk('pk5', 'sk4', 'pk3', 5, { through: true })]],
]);
fam('G a cylinder r 8, 12 high, an 8 x 6 pocket 5 deep across its wall (rg 2692)', [
  ['as found: taper 25, corners rounded 0.001', [cyl(8, 12), rect('sk2', 8, 6, 0.001), pk('pk3', 'sk2', 'c1', 5, { taper: 25 })]],
  ['no taper', [cyl(8, 12), rect('sk2', 8, 6, 0.001), pk('pk3', 'sk2', 'c1', 5)]],
]);
const [mode, TRACE, ROWS] = process.argv.slice(2);
if (mode === 'cases') { console.log(JSON.stringify(F)); process.exit(0); }
if (mode !== 'read') { console.log(`${F.length} variants; see the head of this file`); process.exit(0); }
// the trace: a case's calls are numbered from #1; cases come in the order of the file
const segs = []; let open = null;
for (const line of fs.readFileSync(TRACE, 'utf8').split('\n')) { let m;
  if ((m = /^CALL start (#\d+|topology reading,) (\d+) commands, last (\S+) .*?(budget [\d.]+ s|no budget)$/.exec(line))) { if (m[1] === '#1') segs.push([]); open = { topo: m[1].startsWith('topology'), n: +m[2], last: m[3], budget: m[4] !== 'no budget', ms: null }; }
  else if ((m = /^CALL end\s+(#\d+|topology reading) (\d+) ms (.*)$/.exec(line)) && open) { open.ms = +m[2]; open.how = m[3]; segs.at(-1).push(open); open = null; } }
const rows = new Map(fs.readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
if (segs.length !== F.length) console.log(`NOTE: ${segs.length} groups of calls for ${F.length} variants`);
let fam0 = ''; F.forEach((c, i) => { const [family, what] = c.id.split(': '); if (family !== fam0) { console.log(`\n${family}`); fam0 = family; }
  const r = rows.get(c.id); const calls = segs[i] ?? []; const noB = calls.filter((x) => !x.budget).sort((a, b) => b.ms - a.ms)[0]; const last = (r?.feats ?? []).at(-1);
  console.log(`  ${what.padEnd(72)} script ${r?.hang ? 'no answer in 300 s' : ((r?.ms ?? 0) / 1000).toFixed(1).padStart(6) + ' s'} | longest call without a budget ${noB ? (noB.ms / 1000).toFixed(1).padStart(6) + ' s' : '   none'} | the last pocket: ${last ? (last.status === 'built' ? 'built' : `refused${last.guard ? ' ' + last.guard : ''}: ${(last.refusal ?? '').slice(0, 110)}`) : '-'}`); });
