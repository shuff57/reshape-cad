// SPIKE, referee only (round 4). Table builders over primitives-r4/results/*.json; each returns the short text quoted in primitives.json.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HERE, outcome } from './truth.mjs';
export const res = (n) => { const p = path.join(HERE, 'results', n + '.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const ex = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(d) : 'n/a');
const dv = (r) => r.truck ? (r.truck.dVolOcct ?? r.truck.dVolAn) : undefined;

/** E12: Q bins */
export function e12Q() {
  const rows = res('e12'); if (!rows) return null;
  const Q = (r) => {
    const f = r.doc.features[0]; const c = f.center ?? [0, 0, 0]; const turned = (r.script ?? '').startsWith('turn(');
    let ext;
    if (f.kind === 'box') ext = f.size.map((v) => v / 2); else if (f.kind === 'wedge') ext = [f.width, f.depth, f.height]; else ext = [f.radius, f.radius, f.height / 2];
    if (turned) { const R = Math.hypot(...ext); ext = [R, R, R]; }
    return c.reduce((p, v, i) => p * (Math.abs(v) + ext[i]), 1) / r.an;
  };
  const built = rows.filter((r) => r.status === 'built' && r.truck?.dVolAn !== undefined);
  const lo = built.filter((r) => Q(r) <= 1e6); const mid = built.filter((r) => Q(r) > 1e6 && Q(r) <= 1e7); const hi = built.filter((r) => Q(r) > 1e7);
  return {
    n: rows.length, built: built.length,
    q1e6: { n: lo.length, bad: lo.filter((r) => !r.good).length, maxdVol: Math.max(...lo.map((r) => r.truck.dVolAn)), maxdCom: Math.max(...lo.map((r) => r.truck.dComOcct ?? 0)) },
    q1e7: { n: mid.length, bad: mid.filter((r) => !r.good).length, maxdVol: Math.max(...mid.map((r) => r.truck.dVolAn)) },
    qhi: { n: hi.length, bad: hi.filter((r) => !r.good).length, minBadQ: Math.min(...hi.filter((r) => !r.good).map(Q)) },
    refused: rows.filter((r) => r.status === 'truck-refused').length,
    neg: rows.filter((r) => r.status === 'built' && r.truck.volume < 0).length,
    nan: rows.filter((r) => r.status === 'built' && r.truck.com.some((v) => !Number.isFinite(v))).length,
    dyadicTrap: rows.filter((r) => /^e12-(box|wedge)-s(0\.5|1|5)-e1000000$/.test(r.id)).map((r) => `${r.id.replace('e12-', '')}:${r.good ? 'exact' : 'wrong'}`),
    tinyFar: ['e12-wedge-s0.01-e1000000', 'e12-wedge-s0.1-e1000000', 'e12-wedge-s0.002-e1000', 'e12-wedge-s0.1-e1000', 'e12-box-s0.1-e1000000', 'e12-box-s0.01-e1000000'].map((id) => { const r = rows.find((x) => x.id === id); return r ? `${id.replace('e12-', '')}: ${r.status === 'built' ? `vol ${r.truck.volume.toExponential(2)} (oracle ${r.an.toExponential(2)}), COM err ${ex(r.truck.dComOcct)} x diag` : 'truck refused in kernel text'}` : null; }).filter(Boolean),
  };
}
/** E13: aspect */
export function e13() {
  const a = res('e13'); const b = res('e13b'); if (!a) return null;
  const sh = {};
  for (const r of a) { const m = /e13-(\w+)-L([\d.]+)-a([\de.+]+)/.exec(r.id); const asp = +m[3]; (sh[m[1]] ??= []).push({ asp, ok: r.status === 'built' && r.good, st: r.status }); }
  const firstBad = {}; const lastAllGood = {};
  for (const [k, v] of Object.entries(sh)) {
    const asps = [...new Set(v.map((x) => x.asp))].sort((x, y) => x - y);
    for (const asp of asps) { const cell = v.filter((x) => x.asp === asp); if (cell.some((x) => !x.ok) && firstBad[k] === undefined) firstBad[k] = asp; }
    lastAllGood[k] = Math.max(...asps.filter((asp) => v.filter((x) => x.asp === asp).every((x) => x.ok)).filter((asp) => firstBad[k] === undefined || asp < firstBad[k]));
  }
  return { n: a.length, firstBad, lastAllGood, critic: b ? b.map((r) => `${r.script.replace(';', '')} -> ${r.status === 'built' ? r.truck.faces + '/' + r.truck.facesOcct + ' faces' : 'truck refused'}`) : [] };
}
/** E14/E14b: corner floor cells */
export function e14() {
  const a = res('e14-corner-floor'); if (!a) return null;
  const box = {};
  for (const r of a.filter((x) => x.id.startsWith('e14-box'))) { const m = /s([\d.]+)-c([\d.e-]+)/.exec(r.id); (box[m[1]] ??= []).push(`${m[2]}:${r.status === 'built' ? (r.good ? 'ok' : r.truck.faces + 'f') : 'REF'}`); }
  const cyl = a.filter((x) => x.id.startsWith('e14-cyl'));
  const b = res('e14b-cyl-corner-bigR') ?? [];
  const all = [...cyl, ...b];
  const smallestGood = Math.min(...all.filter((x) => x.status === 'built' && x.good).map((x) => +/-c([\d.e-]+)$/.exec(x.id)[1]));
  const refusedMax = Math.max(...all.filter((x) => x.status === 'truck-refused').map((x) => +/-c([\d.e-]+)$/.exec(x.id)[1]));
  return { box, nCyl: all.length, cylBuiltGood: all.filter((x) => x.status === 'built' && x.good).length, cylBuiltBad: all.filter((x) => x.status === 'built' && !x.good).length, smallestGood, refusedMax, refusedTexts: [...new Set(all.filter((x) => x.status === 'truck-refused').map((x) => String(x.refusal).replace(/^.*solidcraft refused it -- /, '').slice(0, 80)))] };
}
/** E15/E15b: cylinder leftover table: for each (R,H) the largest wrong leftover and smallest right leftover */
export function e15() {
  const rows = [...(res('e15-cyl-leftover') ?? []), ...(res('e15b-cyl-leftover-big') ?? [])];
  const cells = {};
  for (const r of rows) {
    if (r.status !== 'built' || /-H\d+-l|e15b-H/.test(r.id) && !/-R-/.test(r.id)) continue;
    const f = r.doc.features[0]; const R = f.radius; const H = f.height; const l = R - f.round;
    const key = `R${R} H${H} ${f.roundStyle === 'chamfer' ? 'bevel' : 'corner'}`;
    (cells[key] ??= []).push({ l, ok: r.good, size: Math.max(2 * R, H) });
  }
  const out = [];
  for (const [k, v] of Object.entries(cells)) {
    const bad = v.filter((x) => !x.ok).map((x) => x.l); const good = v.filter((x) => x.ok).map((x) => x.l); const size = v[0].size;
    out.push({ k, size, maxBad: bad.length ? Math.max(...bad) : null, minGood: good.length ? Math.min(...good) : null, fracBad: bad.length ? Math.max(...bad) / size : null, fracGood: good.length ? Math.min(...good) / size : null });
  }
  return out;
}
