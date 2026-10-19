// SolidCraft DoF / determinedness probe through the phase0 wrapper (which only returns the FIRST failing command or the final measure).
// Method: after the mapped sketch commands, greedily add driving dimensions that pin every point coordinate (distance from the origin,
// x and y) and every radius, at the values of an independent solution. solidcraft refuses a dimension the sketch already determines
// ("that dimension is already determined by ..." when the value agrees, "...conflicts with the sketch..." when it does not), so
// the number of ACCEPTED probes is the degrees of freedom the solver believes the sketch has; the refusal sentences name what determines.
import { scRun, mapper, clone } from './lib.mjs';

export function roughen(fx) {
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  const rnd = mulberry(seedOf(fx.id));
  const pts = [];
  for (const g of fx.geoms) { if (g.k === 'point') pts.push(g.p); else if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); else pts.push(g.a, g.b); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const amp = 0.035 * Math.max(diag, 1);
  const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const j = () => (rnd() * 2 - 1) * amp; const mv = (p) => [p[0] + j(), p[1] + j()];
  return fx.geoms.map((g) => {
    const o = clone(g);
    const lk = (e) => locked.has(`${g.id}:${e}`) || (e === 'c' && (g.k === 'circle' || g.k === 'arc') && locked.has(`${g.id}:`)) || (e === 'a' && (g.k === 'line' || g.k === 'point') && locked.has(`${g.id}:`));
    if (g.k === 'point') { if (!lk('a')) o.p = mv(g.p); }
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o;
  });
}

/** probe list from mapped names + independent solved geoms */
function probeList(mapped, solved) {
  const byId = new Map(solved.map((g) => [g.id, g]));
  const out = [];
  for (const n of mapped.names) {
    if (n.geom == null) continue;
    const g = byId.get(n.geom);
    const coord = (e) => (g.k === 'point' ? g.p : g.k === 'line' ? (e === 'b' ? g.b : g.a) : e === 'c' ? g.c : e === 'b' ? g.b : g.a);
    for (const [e, ref] of Object.entries(n.points)) {
      const p = coord(e);
      for (const [ax, mode] of [[0, 'vertical'], [1, 'horizontal']]) {
        const v = Math.abs(p[ax]);
        out.push({ label: `${ref}.${ax === 0 ? 'x' : 'y'}`, cmd: v > 1e-9
          ? { command: 'sketch.dimension', params: { entities: ['origin', ref], type: ax === 0 ? 'horizontal' : 'vertical', value: v } }
          : { command: 'sketch.constraint.horizontal_vertical', params: { points: ['origin', ref], mode, if_redundant: 'refuse' } } });
      }
    }
    if (g.k === 'circle' || g.k === 'arc') out.push({ label: `${n.curve}.r`, cmd: { command: 'sketch.dimension', params: { entities: [n.curve], type: 'radius', value: g.r } } });
  }
  return out;
}

/** returns {accepted, refusedAs:[{label, kind, sentence}], anomalies} */
export function dofProbe(mapped, solved) {
  const prefix = mapped.commands;
  let remaining = probeList(mapped, solved);
  const accepted = [], refused = [], anomalies = [];
  let guard = 0;
  while (remaining.length && guard++ < 400) {
    const cmds = [...prefix, ...accepted.map((p) => p.cmd), ...remaining.map((p) => p.cmd)];
    const r = scRun(cmds);
    if (r.ok) { accepted.push(...remaining); remaining = []; break; }
    const base = prefix.length + accepted.length;
    const k = r.index - base;
    if (k < 0 || k >= remaining.length) { anomalies.push({ index: r.index, base, error: r.error }); break; }
    const p = remaining[k];
    const err = String(r.error);
    const kind = /already determined/.test(err) ? 'redundant' : /conflicts with the sketch|over-constrain/.test(err) ? 'conflict' : 'other';
    refused.push({ label: p.label, kind, sentence: err });
    remaining.splice(k, 1);
  }
  return { dof: accepted.length, accepted: accepted.map((p) => p.label), refused, anomalies };
}
