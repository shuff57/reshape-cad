// SPIKE, referee only. An INDEPENDENT oracle: evaluates our soup rules on a set of solved geoms (either solver's output),
// in plain geometry, sharing no code with brep-rs or solidcraft. Residuals are lengths (mm) or degrees (angle).
// Used to say "this solver's output satisfies every rule" without asking the solver that produced it.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

export function pointOf(g, end, lock = false) {
  if (!g) return null;
  if (g.k === 'point') return g.p;
  if (g.k === 'line') return end === 'b' ? g.b : g.a;
  if (g.k === 'circle') return g.c;
  if (g.k === 'arc') return end === 'c' ? g.c : end === 'b' ? g.b : lock ? g.c : g.a;
  return null;
}

/** returns [{rule, kind, residual, unit}]; `start` (the geoms before solving) is needed only for `lock`. */
export function checkRules(geoms, rules, start = null) {
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const sById = new Map((start ?? []).map((g) => [g.id, g]));
  const P = (id, end, lock) => (id === -1 ? [0, 0] : pointOf(byId.get(id), end, lock));
  const out = [];
  rules.forEach((r, i) => {
    if (r.active === false) return;
    let res = null, unit = 'mm';
    const ga = byId.get(r.a), gb = byId.get(r.b);
    switch (r.k) {
      case 'coincident': { const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd); res = len(sub(a, b)); break; }
      case 'pointOnObject': {
        const p = P(r.a, r.aEnd);
        if (r.b === -2) res = Math.abs(p[1]); else if (r.b === -3) res = Math.abs(p[0]);
        else if (gb.k === 'line') res = Math.abs(cross(sub(gb.b, gb.a), sub(p, gb.a))) / len(sub(gb.b, gb.a));
        else res = Math.abs(len(sub(p, gb.c)) - gb.r);
        break;
      }
      case 'horizontal': res = Math.abs(ga.a[1] - ga.b[1]); break;
      case 'vertical': res = Math.abs(ga.a[0] - ga.b[0]); break;
      case 'parallel': case 'perpendicular': {
        const da = r.a < 0 ? (r.a === -2 ? [1, 0] : [0, 1]) : sub(ga.b, ga.a);
        const db = r.b < 0 ? (r.b === -2 ? [1, 0] : [0, 1]) : sub(gb.b, gb.a);
        const s = len(da) * len(db);
        res = (r.k === 'parallel' ? Math.abs(cross(da, db)) : Math.abs(dot(da, db))) / s; unit = '1 (sin/cos of the angle)';
        break;
      }
      case 'equal': res = Math.abs((ga.k === 'line' ? len(sub(ga.b, ga.a)) : ga.r) - (gb.k === 'line' ? len(sub(gb.b, gb.a)) : gb.r)); break;
      case 'tangent': {
        const round = (g) => g.k === 'circle' || g.k === 'arc';
        if (r.aEnd !== undefined && r.bEnd !== undefined && ga.k !== 'circle' && gb.k !== 'circle') {
          // endpoint form: tangent AT the joint (not merely touching): the radius to the joint is perpendicular to the line,
          // or the two centres and the joint are collinear.
          const P = pointOf(ga, r.aEnd);
          if (ga.k === 'line' || gb.k === 'line') {
            const L = ga.k === 'line' ? ga : gb, C = ga.k === 'line' ? gb : ga;
            const d = sub(L.b, L.a);
            res = Math.abs(dot(sub(P, C.c), d)) / len(d);
          } else {
            const u = sub(P, ga.c), v = sub(P, gb.c);
            res = Math.abs(cross(u, v)) / Math.max(len(u) + len(v), 1e-12);
          }
          break;
        }
        if (round(ga) && round(gb)) { const d = len(sub(ga.c, gb.c)); res = Math.min(Math.abs(d - (ga.r + gb.r)), Math.abs(d - Math.abs(ga.r - gb.r))); }
        else { const L = ga.k === 'line' ? ga : gb, C = ga.k === 'line' ? gb : ga; res = Math.abs(Math.abs(cross(sub(L.b, L.a), sub(C.c, L.a))) / len(sub(L.b, L.a)) - C.r); }
        break;
      }
      case 'symmetric': {
        const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd);
        if (r.cEnd !== undefined) { const c = P(r.c, r.cEnd); res = len([(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]]); }
        else {
          const L = r.c === -2 ? { a: [0, 0], b: [1, 0] } : r.c === -3 ? { a: [0, 0], b: [0, 1] } : byId.get(r.c);
          const d = sub(L.b, L.a), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const off = Math.abs(cross(d, sub(m, L.a))) / len(d);
          const perp = Math.abs(dot(d, sub(b, a))) / len(d);
          res = Math.max(off, perp);
        }
        break;
      }
      case 'distance': res = Math.abs(len(sub(P(r.a, r.aEnd), P(r.b, r.bEnd))) - r.value); break;
      case 'distanceX': res = Math.abs(P(r.b, r.bEnd)[0] - P(r.a, r.aEnd)[0] - r.value); break;
      case 'distanceY': res = Math.abs(P(r.b, r.bEnd)[1] - P(r.a, r.aEnd)[1] - r.value); break;
      case 'radius': res = Math.abs(ga.r - r.value); break;
      case 'diameter': res = Math.abs(2 * ga.r - r.value); break;
      case 'angle': {
        const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a);
        const d = ((Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI - r.value) % 180;
        const dd = ((d % 180) + 180) % 180;
        res = Math.min(dd, 180 - dd); unit = 'deg (mod 180)';
        break;
      }
      case 'lock': {
        const s = sById.get(r.a);
        if (!s) { res = null; break; }
        const a = pointOf(byId.get(r.a), r.aEnd, true), b = pointOf(s, r.aEnd, true);
        res = len(sub(a, b)); break;
      }
      default: res = null;
    }
    out.push({ rule: i, kind: r.k, residual: res, unit, driving: r.driving !== false });
  });
  return out;
}
