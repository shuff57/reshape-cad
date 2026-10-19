// ROUND 3 shared rig for group 'sketch-dof-diagnosis'. Referee only.
//   SOLIDCRAFT_REFEREE_PKG2=<dir with solidcraft_referee_p2.js: wasm-bindgen --target nodejs of phase2/wrapper2, same sc-src as the main pkg>
// The phase0 wrapper returns only the first failing command; wrapper2 returns EVERY command output (ids, existing:true, report, points), which is
// what dof, redundancy, id mapping and geometry checks need. wrapper2 keeps running after a refused command; scSketch reports the FIRST refusal
// and a caller that ignores it is the "keeps sending commands" danger recorded in round 1/2.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mapper, ruleCheck, clone, brepSketch, REPO, SPIKE } from './lib.mjs';
export * from './lib.mjs';
const PKG2 = process.env.SOLIDCRAFT_REFEREE_PKG2;
if (!PKG2) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG2 unset'); process.exit(2); }
const sc2 = createRequire(import.meta.url)(path.join(PKG2, 'solidcraft_referee_p2.js'));

export const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const L = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
export const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
export const loopJoins = (n) => Array.from({ length: n }, (_, i) => join(1 + i, 1 + ((i + 1) % n)));
export const len = (i, v, extra = {}) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b', ...(v !== undefined ? { value: v } : {}), ...extra });
export const rect = (x0, y0, x1, y1) => [L(1, [x0, y0], [x1, y0]), L(2, [x1, y0], [x1, y1]), L(3, [x1, y1], [x0, y1]), L(4, [x0, y1], [x0, y0])];
export const hv = () => [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
export const shape = () => [...loopJoins(4), ...hv()];
export const origin = { k: 'coincident', a: 1, aEnd: 'a', b: -1, bEnd: 'a' };
export const TRI = () => [L(1, [0, 0], [40, 0]), L(2, [40, 0], [10, 25]), L(3, [10, 25], [0, 0])];

/** solved geoms (same shape as the soup rows) from a wrapper2 @sketch dump + the mapper's names table. */
export function solvedGeoms(geoms, names, dump) {
  const P = new Map(dump.sketch.points.map((p) => [p.id, p.pos]));
  const C = new Map(dump.sketch.curves.map((c) => [c.id, c]));
  return geoms.map((g) => {
    const n = names.find((x) => x.geom === g.id);
    if (g.k === 'point') return { ...g, p: P.get(n.points.a) };
    if (g.k === 'line') return { ...g, a: P.get(n.points.a), b: P.get(n.points.b) };
    if (g.k === 'circle') return { ...g, c: P.get(n.points.c), r: C.get(n.curve).r };
    return { ...g, a: P.get(n.points.a), b: P.get(n.points.b), c: P.get(n.points.c), r: C.get(n.curve).r };
  });
}

/**
 * Map + run + extrude one soup sketch on SolidCraft. Stops reading at the FIRST refused command (what a translator must do).
 * Returns { mapperRefused } | { firstRefusal:{index,command,error,rule}, ... } plus status/dof/failing/redundant/solved geoms/profile areas/volume.
 */
export function scSketch(geoms, rules, { plane = 'xy', height = 10, id = 'p', extrude = true } = {}) {
  const m = mapper.mapSketch({ id, plane, geoms: clone(geoms), rules: clone(rules) });
  if (!m.ok) return { mapperRefused: m.refusals.map((r) => r.sentence) };
  const cmds = extrude ? mapper.extrudeCommands(m, { height }) : [...m.commands, { command: '@sketch', params: {} }];
  const r = JSON.parse(sc2.run(JSON.stringify({ commands: cmds })));
  const res = r.results;
  const bad = res.find((x) => !x.ok && x.command !== '@sketch');
  const sk = res.find((x) => x.command === '@sketch');
  const dump = sk?.out;
  const firstRefusal = bad ? { index: bad.i, command: bad.command, error: bad.error, rule: m.ruleMap.findIndex((ix) => ix && ix.includes(bad.i)) } : null;
  const ext = res.find((x) => x.command === 'solid.extrude');
  const bodies = r.measure?.out?.bodies ?? r.measure?.bodies ?? null;
  return {
    map: m, results: res, firstRefusal, dump,
    report: dump ? { status: dump.report.status, dof: dump.report.dof, failing: dump.report.failing, redundant: dump.report.redundant, folded: dump.report.folded, max_residual: dump.report.max_residual } : null,
    solved: dump ? solvedGeoms(geoms, m.names, dump) : null,
    profiles: dump?.profile_list?.map((p) => p.area) ?? [],
    extrudeError: ext && !ext.ok ? ext.error : null,
    volume: bodies ? bodies.map((b) => b.volume_mm3) : null,
  };
}
export function brepDiag(geoms, rules) {
  const o = brepSketch(geoms, rules);
  return o.open ? { open: o.open } : { bucket: o.diag?.bucket, dof: o.diag?.dof, blame: o.diag?.blame, solved: o.solved, err: o.lastError };
}
export { sc2 };
