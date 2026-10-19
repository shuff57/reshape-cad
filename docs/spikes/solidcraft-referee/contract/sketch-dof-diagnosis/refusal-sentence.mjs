// CONTRACT PIECE (proposed translator code, lives only in the contract dir): SolidCraft's raw refusal text -> the one plain sentence a student sees.
// Raw text names engine constraint ids ("conflicts with k10, k11"), engine type names ("LinearDimension") and an API flag ("driven: true"); none of that
// is in the student's script. The ids ARE recoverable: k<N> is the N-th constraint-creating command, which the phase2 mapper's ruleMap turns into a rule.
export const CONSTRAINT_CMD = (c) => c.command.startsWith('sketch.constraint.') || c.command === 'sketch.dimension';
// ROUND 3 FIX: the ordinal rule below ("k<N> is the N-th constraint-creating command") is WRONG as soon as one row is a no-op: the engine answers
// a repeated rule with {"constraint":"k9","existing":true} and allocates no id, so every later k is one lower than the command count says. Measured
// (r3e.mjs): a duplicate origin coincident before the lengths made the old table name the wrong rule. Use kTablesFromResults, which reads the ids the
// engine itself returned for each command.
/** m = mapSketch result. Returns map[N] = rule index (N = the k number), and ordOfCommand(ci) = the k number a command created. */
export function kTables(m) {
  const kToRule = []; const ordOf = new Map(); let k = 0;
  m.commands.forEach((c, ci) => { if (CONSTRAINT_CMD(c)) { k++; ordOf.set(ci, k); kToRule[k] = m.ruleMap.findIndex((ix) => ix && ix.includes(ci)); } });
  return { kToRule, ordOf };
}
/**
 * Round-3 table: kToRule[N] = rule index for engine id "k<N>", read from each command's OWN output (created.constraints / created.dimensions, or
 * `constraint` for a no-op that answered existing:true; the first command that created an id owns it). results = wrapper2 per-command outputs.
 */
export function kTablesFromResults(m, results) {
  const kToRule = [];
  for (const r of results) {
    if (!r.ok || !CONSTRAINT_CMD(r) || !r.out) continue;
    const ids = [...(r.out.created?.constraints ?? []), ...(r.out.created?.dimensions ?? [])];
    if (r.out.constraint) ids.push(r.out.constraint);
    const rule = m.ruleMap.findIndex((ix) => ix && ix.includes(r.i));
    for (const id of ids) { const n = Number(String(id).replace(/^k/, '')); if (kToRule[n] === undefined) kToRule[n] = rule; }
  }
  return { kToRule };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ent = (geoms, id) => { if (id === -1) return 'the origin'; const g = geoms.find((x) => x.id === id); return g?.k === 'circle' ? `circle ${id}` : g?.k === 'arc' ? `arc ${id}` : `line ${id}`; };
/** a noun phrase for one soup rule */
export function labelSoup(r, geoms) {
  const e = (id) => ent(geoms, id);
  switch (r.k) {
    case 'coincident': return `the join between ${e(r.a)} and ${e(r.b)}`;
    case 'horizontal': return `${e(r.a)} staying level`;
    case 'vertical': return `${e(r.a)} staying upright`;
    case 'lock': return `${e(r.a)}'s pinned point`;
    case 'distance': return `the ${r.value} length of ${e(r.a)}`;
    case 'distanceX': return r.a === r.b ? `the ${r.value} across size of ${e(r.a)}` : `the ${r.value} across distance from ${e(r.a)} to ${e(r.b)}`;
    case 'distanceY': return r.a === r.b ? `the ${r.value} up size of ${e(r.a)}` : `the ${r.value} up distance from ${e(r.a)} to ${e(r.b)}`;
    case 'radius': return `the ${r.value} radius of ${e(r.a)}`;
    case 'diameter': return `the ${r.value} diameter of ${e(r.a)}`;
    case 'equal': return `${e(r.a)} and ${e(r.b)} being equal`;
    case 'parallel': return `${e(r.a)} and ${e(r.b)} being parallel`;
    case 'perpendicular': return `${e(r.a)} and ${e(r.b)} meeting at a right angle`;
    case 'tangent': return `${e(r.a)} touching ${e(r.b)} smoothly`;
    case 'angle': return `the ${r.value} degree angle between ${e(r.a)} and ${e(r.b)}`;
    default: return `the ${r.k} rule on ${e(r.a)}`;
  }
}
/**
 * raw: SolidCraft's error string. failedRule: rule index of the command that was refused. labelOf(i): noun phrase for rule i.
 * isStructural(i): true for join rows the student never wrote. kToRule: from kTables.
 */
export function plainRefusal({ raw, failedRule, labelOf, isStructural, kToRule }) {
  const nw = labelOf(failedRule);
  const ids = [...raw.matchAll(/\bk(\d+)\b/g)].map((x) => Number(x[1]));
  if (/already determined by/.test(raw)) {
    return `${cap(nw)} cannot be added as a driving size because the other rules already fix it; remove it, or keep it only as a reference measurement.`;
  }
  const older = [...new Set(ids.map((n) => kToRule[n]).filter((i) => i !== undefined && i >= 0 && i !== failedRule))];
  const named = older.filter((i) => !isStructural(i));
  if (/over-constrain/.test(raw)) {
    if (named.length === 0) return `${cap(nw)} cannot be added because it contradicts the other rules already on this sketch.`;
    const shown = named.slice(0, 3).map(labelOf); const more = named.length - shown.length;
    const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
    return `${cap(nw)} cannot be added because it contradicts ${list}${more > 0 ? ` and ${more} other rule${more > 1 ? 's' : ''}` : ''}.`;
  }
  if (/neither entity can move/.test(raw)) return `${cap(nw)} cannot be added because the edges it ties together are already held in place by the other rules.`;
  return `${cap(nw)} cannot be added because the rules already on this sketch do not allow it.`;
}
/** the acceptance test for "a plain sentence a student can act on" */
export function plainProblems(s) {
  const bad = [];
  if (/\bk\d+\b/.test(s)) bad.push('engine id');
  if (/LinearDimension|RadialDimension|AngularDimension|Coincident\)|driven:|invalid parameters|sketch\.(constraint|dimension)|`/.test(s)) bad.push('engine jargon');
  if (/\n/.test(s)) bad.push('multi-line');
  if ((s.match(/[.!?](\s|$)/g) ?? []).length !== 1) bad.push('not exactly one sentence');
  if (s.length > 260) bad.push('too long');
  return bad;
}
