// TypeScript port of docs/spikes/solidcraft-referee/phase7/pane/lib/rule-check.mjs. Behaviour-preserving.
//
// An INDEPENDENT oracle: evaluates our soup rules on a set of solved geoms (either solver's output), in plain geometry,
// sharing no code with any kernel. Residuals are lengths (mm) or degrees (angle).
import type { SoupGeom } from '@shuff57/reshape-script/model-types';
import type { V2 } from './types.js';
import type { RuleRow } from './sketch-map.js';

type LineGeom = Extract<SoupGeom, { k: 'line' }>;
type RoundGeom = Extract<SoupGeom, { k: 'circle' | 'arc' }>;

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);

export function pointOf(g: SoupGeom | undefined | null, end?: string, lock = false): V2 | null {
  if (!g) return null;
  if (g.k === 'point') return g.p;
  if (g.k === 'line') return end === 'b' ? g.b : g.a;
  if (g.k === 'circle') return g.c;
  if (g.k === 'arc') return end === 'c' ? g.c : end === 'b' ? g.b : lock ? g.c : g.a;
  return null;
}

export interface RuleResidual {
  rule: number;
  kind: string;
  residual: number | null;
  unit: string;
  driving: boolean;
}

/** returns [{rule, kind, residual, unit}]; `start` (the geoms before solving) is needed only for `lock`. */
export function checkRules(geoms: SoupGeom[], rules: RuleRow[], start: SoupGeom[] | null = null): RuleResidual[] {
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const sById = new Map((start ?? []).map((g) => [g.id, g]));
  // The original does not check that a rule's ids exist or that the geometry kind fits the rule: a bad row throws
  // (a TypeError) and the caller sees it. The casts below keep that: the rule kind decides the geometry kind.
  const P = (id: number, end?: string, lock?: boolean) => (id === -1 ? [0, 0] : pointOf(byId.get(id), end, lock)) as V2;
  const out: RuleResidual[] = [];
  rules.forEach((r, i) => {
    if (r.active === false) return;
    let res: number | null = null, unit = 'mm';
    const ga = byId.get(r.a) as LineGeom, gb = byId.get((r as { b?: number }).b as number) as LineGeom;
    switch (r.k) {
      case 'coincident': { const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd); res = len(sub(a, b)); break; }
      case 'pointOnObject': {
        const p = P(r.a, r.aEnd);
        if (r.b === -2) res = Math.abs(p[1]); else if (r.b === -3) res = Math.abs(p[0]);
        else if (gb.k === 'line') res = Math.abs(cross(sub(gb.b, gb.a), sub(p, gb.a))) / len(sub(gb.b, gb.a));
        else res = Math.abs(len(sub(p, (gb as unknown as RoundGeom).c)) - (gb as unknown as RoundGeom).r);
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
      case 'equal': res = Math.abs((ga.k === 'line' ? len(sub(ga.b, ga.a)) : (ga as unknown as RoundGeom).r) - (gb.k === 'line' ? len(sub(gb.b, gb.a)) : (gb as unknown as RoundGeom).r)); break;
      case 'tangent': {
        const round = (g: SoupGeom) => g.k === 'circle' || g.k === 'arc';
        if (r.aEnd !== undefined && r.bEnd !== undefined && (ga.k as string) !== 'circle' && (gb.k as string) !== 'circle') { // ga / gb are typed LineGeom for convenience; kind is checked at runtime
          // endpoint form: tangent AT the joint (not merely touching).
          const Pt = pointOf(ga, r.aEnd) as V2;
          if (ga.k === 'line' || gb.k === 'line') {
            const L = (ga.k === 'line' ? ga : gb) as LineGeom, C = (ga.k === 'line' ? gb : ga) as unknown as RoundGeom;
            const d = sub(L.b, L.a);
            res = Math.abs(dot(sub(Pt, C.c), d)) / len(d);
          } else {
            const ra = ga as unknown as RoundGeom, rb = gb as unknown as RoundGeom;
            const u = sub(Pt, ra.c), v = sub(Pt, rb.c);
            res = Math.abs(cross(u, v)) / Math.max(len(u) + len(v), 1e-12);
          }
          break;
        }
        if (round(ga) && round(gb)) {
          const ra = ga as unknown as RoundGeom, rb = gb as unknown as RoundGeom;
          const d = len(sub(ra.c, rb.c)); res = Math.min(Math.abs(d - (ra.r + rb.r)), Math.abs(d - Math.abs(ra.r - rb.r)));
        } else {
          const L = (ga.k === 'line' ? ga : gb) as LineGeom, C = (ga.k === 'line' ? gb : ga) as unknown as RoundGeom;
          res = Math.abs(Math.abs(cross(sub(L.b, L.a), sub(C.c, L.a))) / len(sub(L.b, L.a)) - C.r);
        }
        break;
      }
      case 'symmetric': {
        const a = P(r.a, r.aEnd), b = P(r.b, r.bEnd);
        if (r.cEnd !== undefined) { const c = P(r.c, r.cEnd); res = len([(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]]); }
        else {
          const L = (r.c === -2 ? { a: [0, 0], b: [1, 0] } : r.c === -3 ? { a: [0, 0], b: [0, 1] } : byId.get(r.c)) as { a: V2; b: V2 };
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
      case 'radius': res = Math.abs((ga as unknown as RoundGeom).r - r.value); break;
      case 'diameter': res = Math.abs(2 * (ga as unknown as RoundGeom).r - r.value); break;
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
        const a = pointOf(byId.get(r.a), r.aEnd, true) as V2, b = pointOf(s, r.aEnd, true) as V2;
        res = len(sub(a, b)); break;
      }
      default: res = null;
    }
    out.push({ rule: i, kind: r.k, residual: res, unit, driving: r.driving !== false });
  });
  return out;
}
