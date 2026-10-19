// ROUND 4 shared rig for group 'sketch-dof-diagnosis': STOCK pkg only (SOLIDCRAFT_REFEREE_PKG = the phase0 wrapper: `run` returns the first refused command or the final measure).
// Nothing here needs wrapper2 / SOLIDCRAFT_REFEREE_PKG2; a SolveReport reading is NOT available on this rig and every number in the round-4 files is derived without it:
//   dof of SolidCraft's own sketch  = number of independent pins its solver accepts (rankByProbe below, redundancy-refusal probing);
//   redundant / conflicting         = `if_redundant:"refuse"` and the command-time refusal text;
//   geometry                        = measure of the extruded body (volume, bbox, centre of mass, face types).
export * from './lib.mjs';
import * as L from './lib.mjs';
import { H as H0 } from './legacy.mjs';

export const H = H0;
export const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const e2 = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toExponential(3) : String(x)) : x);
export const LN = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
export const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
export const loopJoins = (n) => Array.from({ length: n }, (_, i) => join(1 + i, 1 + ((i + 1) % n)));
export const len = (i, v) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b', value: v });
export const rect = (x0, y0, x1, y1) => [LN(1, [x0, y0], [x1, y0]), LN(2, [x1, y0], [x1, y1]), LN(3, [x1, y1], [x0, y1]), LN(4, [x0, y1], [x0, y0])];
export const hv = () => [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
export const shape = () => [...loopJoins(4), ...hv()];
export const origin = { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' };
export const TRI = () => [LN(1, [0, 0], [40, 0]), LN(2, [40, 0], [10, 25]), LN(3, [10, 25], [0, 0])];
export const polyArea = (p) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2;

const clone = L.clone;
const measureOf = (m) => { const bs = m.bodies; return { volume: bs.reduce((s, b) => s + b.volume_mm3, 0), bodies: bs.length, faces: bs.reduce((s, b) => s + b.faces, 0), bbox: bs.map((b) => [...b.bbox.min, ...b.bbox.max]), com: bs.map((b) => b.center_of_mass), faceTypes: bs.map((b) => b.face_types), areas: bs.map((b) => b.area_mm2) }; };

/**
 * map + run (+ extrude). opts: { plane, height, extrude, patch(cmds, mapped) -> cmds }.
 * -> {mapperRefused:[sentence]} | {refusal:{index,command,error,rule}} | {built:true, ...measure}
 */
export function scBuild(geoms, rules, { plane = 'xy', height = H, extrude = true, patch } = {}) {
  const m = L.mapper.mapSketch({ id: 'p', plane, geoms: clone(geoms), rules: clone(rules) });
  if (!m.ok) return { mapperRefused: m.refusals.map((r) => r.sentence), map: m };
  let cmds = extrude ? L.mapper.extrudeCommands(m, { height }).filter((c) => c.command !== '@sketch') : [...m.commands];
  if (patch) cmds = patch(cmds, m);
  const r = L.scRun(cmds);
  if (!r.ok) return { refusal: { index: r.index, command: r.command, error: r.error, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(r.index)) }, map: m };
  return { built: true, ...measureOf(r.measure), map: m, measureRaw: r.measure };
}
export const refuseAll = (cmds) => cmds.map((c) => (c.command.startsWith('sketch.constraint.') ? { ...c, params: { ...c.params, if_redundant: 'refuse' } } : c));
export const drivenAll = (cmds) => cmds.map((c) => (c.command === 'sketch.dimension' && c.params.if_redundant === undefined ? { ...c, params: { ...c.params, if_redundant: 'driven' } } : c));

// ---------- SolidCraft's own dof, from refusals ----------
const posOf = (g, key) => (g.k === 'point' ? g.p : g.k === 'line' ? (key === 'b' ? g.b : g.a) : g.k === 'circle' ? g.c : key === 'b' ? g.b : key === 'c' ? g.c : g.a);
/**
 * Number of independent pins SolidCraft's solver accepts on top of the rules = its remaining degrees of freedom. Every coordinate of every point (and every radius) is offered as a dimension
 * to a fixed helper point 1000 mm away (so all signed deltas are positive); a pin the sketch already determines is refused as redundant, an accepted one removes one dof.
 * It measures SolidCraft's bookkeeping from the START STATE it is given (that is the point: it is start-state dependent for exactly-tangent docs).
 */
export function rankByProbe(geoms, rules, { plane = 'xy' } = {}) {
  const m = L.mapper.mapSketch({ id: 'p', plane, geoms: clone(geoms), rules: clone(rules) });
  if (!m.ok) return { mapperRefused: m.refusals.map((r) => r.sentence) };
  const base = m.commands;
  const r0 = L.scRun(base);
  if (!r0.ok) return { baseRefused: `command ${r0.index} ${r0.command}: ${r0.error}`, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(r0.index)) };
  const OFF = 1000;
  const helper = [{ command: 'sketch.point', params: { point: [-OFF, -OFF], id: 'hh', connect: false } }, { command: 'sketch.constraint.fix', params: { entity: 'hh', fixed: true } }];
  const cands = [];
  for (const nm of m.names) {
    if (nm.geom == null) continue;
    const g = geoms.find((x) => x.id === nm.geom);
    for (const [key, ref] of Object.entries(nm.points)) {
      const p = posOf(g, key);
      cands.push({ tag: `g${g.id}.${key}.x`, params: { entities: [ref, 'hh'], type: 'horizontal', value: Math.abs(p[0] + OFF) } });
      cands.push({ tag: `g${g.id}.${key}.y`, params: { entities: [ref, 'hh'], type: 'vertical', value: Math.abs(p[1] + OFF) } });
    }
    if (g.k === 'circle' || g.k === 'arc') cands.push({ tag: `g${g.id}.r`, params: { entities: [nm.curve], type: 'radius', value: g.r } });
  }
  const acc = []; let rej = 0;
  for (const c of cands) {
    const cmds = [...base, ...helper, ...acc.map((a) => ({ command: 'sketch.dimension', params: a.params })), { command: 'sketch.dimension', params: c.params }];
    const r = L.scRun(cmds);
    if (r.ok) acc.push(c); else rej++;
  }
  return { dof: acc.length, rejected: rej, candidates: cands.length };
}
