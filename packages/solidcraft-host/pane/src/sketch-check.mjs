// The student-facing sketch check: one line per dimensioned sketch (a soup: rows and rules), in the student's words.
//
// "Fully defined" is said only when TWO counts agree: SolidCraft's own solver (dof, from the built sketch) and the host's independent solver (soup-solve.mjs, the
// rank of the rules at the solution, no kernel). A count only one of them gives, a rule kind the independent solver does not know, or a built sketch whose rules
// the independent rule check finds unmet, is reported as not confirmed, never as fully defined. Measured on the pin 2026-11-12: 25 of 25 built sketches agree
// (docs/spikes/solidcraft-referee/pilot-2026-11/PILOT.md, "Sketch check").
//
// A rule SolidCraft refuses is named by what the student wrote (its kind and value, from the doc's own rule row), never by the kernel's ids.
// No DOM here: pane.js renders what this returns.

/** mm: a built sketch whose worst rule residual (independent rule check) is above this does not obey its own rules. */
export const RULE_OK = 1e-6;
const num = (v) => String(+(+v).toFixed(4));
const WORDS = {
  coincident: 'a join', horizontal: 'a horizontal rule', vertical: 'a vertical rule', parallel: 'a parallel rule', perpendicular: 'a perpendicular rule',
  equal: 'an equal rule', tangent: 'a tangent rule', midpoint: 'a midpoint rule', symmetric: 'a symmetric rule', pointOnObject: 'a point-on rule', lock: 'a fixed point',
};
/** One rule row in the student's words: "a length of 40", "a horizontal rule". null when the row is not one this knows. */
export function ruleWords(r) {
  if (!r || typeof r.k !== 'string') return null;
  const v = Number.isFinite(+r.value) ? num(r.value) : null;
  if (r.k === 'distance' && v !== null) return r.a === r.b ? `a length of ${v}` : `a distance of ${v}`;
  if (r.k === 'distanceX' && v !== null) return `a sideways distance (dx) of ${v}`;
  if (r.k === 'distanceY' && v !== null) return `an up distance (dy) of ${v}`;
  if (r.k === 'radius' && v !== null) return `a radius of ${v}`;
  if (r.k === 'diameter' && v !== null) return `a diameter of ${v}`;
  if (r.k === 'angle' && v !== null) return `an angle of ${v}`;
  return WORDS[r.k] ?? null;
}
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
/**
 * The rule behind a sketch command SolidCraft refused. `feature` = a translated feature ({ failed: { command, params, error }, commands }); `soups` = the
 * translator's record per sketch name ({ sketchId, rules, ruleMap }: ruleMap[i] = the positions, counted from the sketch's own sketch.create, of rule i's commands).
 * Returns { sketchId, kind: 'clash' | 'repeat' | 'other', rule } (rule = the doc's row, or null when no row maps to the refused command), or null when the
 * refused command is not a sketch's.
 */
export function refusedRule(feature, soups) {
  const fl = feature?.failed; const cmds = feature?.commands;
  if (!fl || typeof fl.command !== 'string' || !fl.command.startsWith('sketch.') || !Array.isArray(cmds)) return null;
  const err = String(fl.error ?? '');
  const kind = /over-constrain/.test(err) ? 'clash' : /already determined/.test(err) ? 'repeat' : 'other';
  const want = stable(fl.params ?? {});
  let found = null;
  cmds.forEach((c, s) => {
    const meta = c?.command === 'sketch.create' ? soups?.[c.params?.name] : null;
    if (!meta) return;
    const hits = [];
    (meta.ruleMap ?? []).forEach((js, i) => { for (const j of js ?? []) { const x = cmds[s + j]; if (x && x.command === fl.command && stable(x.params ?? {}) === want) hits.push(i); } });
    // the same command written twice: the first was accepted (or it would have been the refused one), so the refused one is the next
    if (hits.length) found = { sketchId: meta.sketchId, kind, rule: meta.rules?.[hits[Math.min(1, hits.length - 1)]] ?? null };
    else if (!found) found = { sketchId: meta.sketchId, kind, rule: null };
  });
  return found;
}
const ways = (n) => `${n} way${n === 1 ? '' : 's'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/**
 * The check of one dimensioned sketch.
 *   id        the sketch's id in the script
 *   feature   its translated feature ({ status, guard }), or undefined
 *   users     the translated features that pull or cut it ({ status })
 *   refused   refusedRule() of the first user SolidCraft refused on a sketch command, or null
 *   accepted  one entry per built copy of the sketch: { status, dof, worstRes } (SolidCraft's solver status and count; the independent rule check's worst residual, null = nothing to check)
 *   own       the independent solver's result ({ dof, unsupported })
 * Returns { id, state, cls, result, text }.
 */
export function sketchCheck({ id, feature, users = [], refused = null, accepted = [], own = null }) {
  const row = (state, cls, result, text) => ({ id, state, cls, result, text });
  if (feature?.status === 'refused') {
    return feature.guard === 'SG-RULES-UNDERDETERMINED'
      ? row('free-moved', 'refused', 'not built', `It is not fully defined, and its rules have to move it. See ${id} under Steps.`)
      : row('not-built', 'refused', 'not built', `See ${id} under Steps.`);
  }
  if (refused && refused.kind !== 'other') {
    const w = ruleWords(refused.rule);
    return refused.kind === 'clash'
      ? row('clash', 'refused', 'rules clash', `${w ? cap(w) : 'One of its rules'} cannot hold together with the rules before it; remove or change one of them.`)
      : row('repeat', 'refused', 'rule repeated', `${w ? cap(w) : 'One of its rules'} is already fixed by the rules before it; remove it.`);
  }
  if (accepted.length) {
    const ownDof = own && !own.unsupported && Number.isInteger(own.dof) ? own.dof : null;
    const agree = ownDof !== null && accepted.every((a) => a.status === 'solved' && a.dof === ownDof && !(a.worstRes > RULE_OK));
    if (!agree) return row('unconfirmed', 'note', 'not confirmed', 'It was built, but this check could not confirm whether it is fully defined.');
    return ownDof === 0
      ? row('defined', 'built', 'fully defined', 'Its rules fix every size and position.')
      : row('free', 'note', 'not fully defined', `It can still slide, turn or change size in ${ways(ownDof)}. It was built as you drew it; add rules or dimensions to pin it down.`);
  }
  if (!users.length) return row('unused', 'mut', 'not checked', 'No step uses it yet.');
  return row('not-checked', 'mut', 'not checked', 'The step that uses it was not built. See Steps.');
}
