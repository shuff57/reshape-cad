// CONTRACT PIECE (round 3, proposed translator code, lives only in the contract dir). The post-solve check the SolidCraft soup route needs,
// because SolidCraft answers an IMPOSSIBLE rule set by collapsing the sketch to a sliver (status "solved", failing [], dof > 0) and extruding it.
// Two independent tests on the solved geometry, neither asks SolidCraft anything:
//   (1) every driving rule holds, checked by phase2/rule-check.mjs (plain geometry, SIGNED distanceX/distanceY), catches the |d| side flip;
//   (2) no line / radius has been squeezed below DEG_REL of the drawn size of the sketch, unless a length dimension asked for exactly that.
// DEG_REL is 1e-3 and was chosen from the measured separation in r3b.mjs (silent slivers sit at 1e-6 .. 2e-5 of the drawn diagonal, legal shrinks
// of 40 -> 1 sit at 2.5e-2); it is NOT the round-2 prototype value 1e-6, which passed the 1.6e-6 and 2.1e-5 slivers.
import { ruleCheck } from './lib.mjs';
export const DEG_REL = 1e-3;
export const RULE_TOL_MM = 1e-6;     // relative to max(1, diag)
export const RULE_TOL_UNITLESS = 1e-6; // parallel/perpendicular are sin/cos of an angle; angle is in degrees
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
export function sizeOf(geoms) {
  const pts = [];
  for (const g of geoms) { if (g.k === 'point') pts.push(g.p); else if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); else pts.push(g.a, g.b); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
/** metrics only (no verdict): used by the measurement scripts to show the separation */
export function metrics(drawn, solved, rules) {
  const diag = sizeOf(drawn);
  const ratios = [];
  drawn.forEach((g, i) => {
    if (g.construction) return;
    const s = solved[i];
    if (g.k === 'line') ratios.push({ id: g.id, what: 'line', solved: len(sub(s.b, s.a)), drawn: len(sub(g.b, g.a)) });
    if (g.k === 'circle' || g.k === 'arc') ratios.push({ id: g.id, what: 'radius', solved: s.r, drawn: g.r });
  });
  const minVsDiag = Math.min(...ratios.map((r) => r.solved / diag));
  const minVsDrawn = Math.min(...ratios.map((r) => r.solved / Math.max(r.drawn, 1e-12)));
  const res = ruleCheck.checkRules(solved, rules, drawn).filter((r) => r.driving && r.residual !== null);
  const tol = (r) => (r.unit === 'mm' ? RULE_TOL_MM * Math.max(1, diag) : RULE_TOL_UNITLESS);
  const worst = res.map((r) => ({ ...r, over: r.residual / tol(r) })).sort((a, b) => b.over - a.over)[0] ?? null;
  return { diag, minVsDiag, minVsDrawn, ratios, worst };
}
/**
 * drawn: the geoms as drawn (start state); solved: solver output geoms; rules: soup rules; label(i): noun phrase for rule i.
 * Returns {ok:true} or {ok:false, kind:'rule-not-held'|'collapsed', ruleIndex?, entity?, sentence}.
 */
export function guardSolved(drawn, solved, rules, label = (i) => `rule ${i + 1}`) {
  const m = metrics(drawn, solved, rules);
  if (m.worst && m.worst.over > 1) {
    return { ok: false, kind: 'rule-not-held', ruleIndex: m.worst.rule, residual: m.worst.residual, unit: m.worst.unit, sentence: `The solver could not keep ${label(m.worst.rule)}, so the sketch is not built; remove or change one of the rules.` };
  }
  for (const r of m.ratios) {
    if (r.solved >= DEG_REL * m.diag) continue;
    const asked = rules.some((x) => x.driving !== false && x.active !== false && ((x.k === 'distance' && x.a === r.id && x.b === r.id && Math.abs(x.value - r.solved) <= RULE_TOL_MM * Math.max(1, m.diag)) || ((x.k === 'radius' && x.a === r.id && Math.abs(x.value - r.solved) <= RULE_TOL_MM) || (x.k === 'diameter' && x.a === r.id && Math.abs(x.value / 2 - r.solved) <= RULE_TOL_MM))));
    if (asked) continue;
    return { ok: false, kind: 'collapsed', entity: r.id, sentence: `These rules squeeze ${r.what === 'line' ? 'line' : 'circle'} ${r.id} down to almost nothing, so the shape cannot be built; remove or change one of them.` };
  }
  return { ok: true };
}
