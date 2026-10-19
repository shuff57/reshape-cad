// Built-in axes (-2 = X axis, -3 = Y axis) in EVERY rule kind and every slot (a, b, c): which are built, which are refused (guard sentence), what brep-rs does with the same row.
//   bun axes.mjs [--out=out/axes.json]
import { writeFileSync } from 'node:fs';
import * as lib from './lib.mjs';
import { refsOfScript } from './refs.mjs';
import { H, L, C, rectG, rectShape, atOrigin, len, soupScript, loopJoins, dX, dY } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/axes.json').slice(6);
const SHAPE = { h1: { k: 'horizontal', a: 1 }, v2: { k: 'vertical', a: 2 }, h3: { k: 'horizontal', a: 3 }, v4: { k: 'vertical', a: 4 } };
/** a 30 x 20 rectangle whose rules are the usual ones MINUS the ones named in `omit`, so the axis row under test is not redundant with them */
const rectOmit = (omit = [], extra = [], { pin = true, geoms = rectG(0.3, 0.2, 28.4, 17.1), bbox = [0, 0, 30, 20] } = {}) => ({ geoms, rules: [...loopJoins(4), ...Object.entries(SHAPE).filter(([k]) => !omit.includes(k)).map(([, v]) => v), ...(pin ? [atOrigin(1)] : []), ...extra, len(1, 30), len(2, 20)], area: 600, bbox });
const rect = () => rectOmit([], []);
// a circle r5 whose centre is 5.4 above the X axis, to be made tangent to it
const circ = () => ({ geoms: [C(1, [10, 5.4], 5.2)], rules: [{ k: 'radius', a: 1, value: 5 }, { k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'c', value: 10 }], area: Math.PI * 25, bbox: [5, 0, 15, 10], curved: true });
const P = [];
const add = (kind, slot, axis, mk, row, note = '') => P.push({ kind, slot, axis, mk, row, note });
for (const [ax, name] of [[-2, 'X axis'], [-3, 'Y axis']]) {
  const X = ax === -2;
  // each of these REPLACES the usual rule (horizontal / vertical) with the axis row, so nothing is redundant
  add('parallel', 'b', name, () => rectOmit([X ? 'h1' : 'v2']), { k: 'parallel', a: X ? 1 : 2, b: ax });
  add('parallel', 'a', name, () => rectOmit([X ? 'h1' : 'v2']), { k: 'parallel', a: ax, b: X ? 1 : 2 });
  add('perpendicular', 'b', name, () => rectOmit([X ? 'v2' : 'h1']), { k: 'perpendicular', a: X ? 2 : 1, b: ax });
  add('perpendicular', 'a', name, () => rectOmit([X ? 'v2' : 'h1']), { k: 'perpendicular', a: ax, b: X ? 2 : 1 });
  add('pointOnObject', 'b', name, () => (X ? rectOmit([], [{ k: 'pointOnObject', a: 1, aEnd: 'a', b: -2 }, dX(-1, 'a', 1, 'a', 3)], { pin: false, geoms: rectG(3.2, 0.3, 31.4, 17.1), bbox: [3, 0, 33, 20] }) : rectOmit([], [{ k: 'pointOnObject', a: 1, aEnd: 'a', b: -3 }, dY(-1, 'a', 1, 'a', 4)], { pin: false, geoms: rectG(0.3, 4.2, 28.4, 21.1), bbox: [0, 4, 30, 24] })), null, 'corner on the axis, the other coordinate by a signed distance');
  add('symmetric', 'c', name, () => ({ geoms: rectG(-15.2, -9.7, 14.6, 10.4), rules: [...rectShape(), len(1, 30), len(2, 20), X ? dX(-1, 'a', 1, 'a', -15) : dY(-1, 'a', 1, 'a', -10), X ? { k: 'symmetric', a: 1, aEnd: 'a', b: 4, bEnd: 'a', c: -2 } : { k: 'symmetric', a: 1, aEnd: 'a', b: 1, bEnd: 'b', c: -3 }, X ? { k: 'symmetric', a: 2, aEnd: 'b', b: 2, bEnd: 'a', c: -2 } : { k: 'symmetric', a: 3, aEnd: 'a', b: 3, bEnd: 'b', c: -3 }], area: 600, bbox: [-15, -10, 15, 10] }), null, 'mirror about the axis (centred rectangle)');
  add('tangent', 'b', name, circ, X ? { k: 'tangent', a: 1, b: -2 } : null);
  add('tangent', 'a', name, circ, X ? { k: 'tangent', a: -2, b: 1 } : null);
  // refused family
  add('equal', 'b', name, rect, { k: 'equal', a: 1, b: ax });
  add('angle', 'b', name, () => rectOmit([X ? 'h1' : 'v2']), { k: 'angle', a: 1, b: ax, value: X ? 180 : 90 });
  add('angle', 'a', name, () => rectOmit([X ? 'v2' : 'h1']), { k: 'angle', a: ax, b: 2, value: 90 });
  add('horizontal', 'a', name, rect, { k: 'horizontal', a: ax });
  add('vertical', 'a', name, rect, { k: 'vertical', a: ax });
  add('coincident', 'b', name, () => rectOmit([], [], { pin: false }), { k: 'coincident', a: 1, aEnd: 'a', b: ax, bEnd: 'a' });
  add('distance', 'b', name, rect, { k: 'distance', a: 1, aEnd: 'a', b: ax, bEnd: 'a', value: 5 });
  add('distanceX', 'b', name, rect, { k: 'distanceX', a: ax, aEnd: 'a', b: 1, bEnd: 'a', value: 5 });
  add('distanceY', 'b', name, rect, { k: 'distanceY', a: 1, aEnd: 'a', b: ax, bEnd: 'a', value: 5 });
  add('radius', 'a', name, circ, { k: 'radius', a: ax, value: 5 });
  add('diameter', 'a', name, circ, { k: 'diameter', a: ax, value: 10 });
  add('lock', 'a', name, rect, { k: 'lock', a: ax, aEnd: 'a' });
}
const rows = [];
for (const p of P.filter((x) => x.row !== undefined && (x.row || x.note))) {
  const b = p.mk(); const rules = p.row ? [...b.rules, p.row] : b.rules; const geoms = b.geoms;
  const g = ladderSketch({ geoms, rules });
  const rb = refsOfScript(soupScript(geoms, rules));
  const bs = lib.brepSolve(geoms, rules);
  const rec = { kind: p.kind, slot: p.slot, axis: p.axis, note: p.note, row: p.row, guarded: g.ok ? { built: true, volume: g.body.volume, bbox: g.body.bbox, rightVolume: lib.rel(g.body.volume, b.area * H) <= (b.curved ? 3e-4 : 1e-9) && Math.max(...[b.bbox[0], b.bbox[1], 0, b.bbox[2], b.bbox[3], H].map((w, i) => Math.abs(g.body.bbox[i] - w))) <= (b.curved ? 2e-3 : 1e-6) } : { refused: g.sentence, stage: g.stage }, brep: rb.brep?.volume !== undefined ? { built: true, volume: rb.brep.volume } : { refused: rb.brep?.refused ?? rb.scriptError ?? rb.error ?? bs.open }, brepOpen: bs.open ?? null };
  rows.push(rec);
  console.log(`${p.kind.padEnd(14)} slot ${p.slot} ${p.axis.padEnd(7)} guarded ${g.ok ? 'BUILT ' + (rec.guarded.rightVolume ? 'right' : 'WRONG') + ' ' + g.body.volume.toFixed(3) : 'REFUSED[' + g.stage + '] ' + g.sentence.slice(0, 110)} | brep-rs ${rec.brep.built ? 'built ' + rec.brep.volume.toFixed(3) : 'refused: ' + String(rec.brep.refused).slice(0, 80)}`);
}
writeFileSync(OUTF, JSON.stringify(rows, null, 1));
