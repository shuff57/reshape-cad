// Script-level front end of the blend-loft guard (round 4). Given reSHape Script text it returns the solved doc, the verdict of
// the guard for every blend, and (the part the doc alone cannot show) what the doc no longer shows after blend()/loft() rewrote it:
//   - the offsets every sketch had BEFORE blend() moved its second sketch (neutral), and
//   - the order the student wrote the two sketch arguments in (argOrder), which differs from the doc's bottom-first targets for a negative gap.
// Library: pass in runScript, solveDoc and the sketch-arc module from packages/{script,sketch}/dist.
import { guardDoc } from './blend-loft.guard.mjs';

/** Re-runs the script with the TOOL NAMES blend and loft rebound, inside the script's own scope, to a recorder that builds nothing.
 *  Round 3 did this with a regex on the text `blend(` / `loft(`, which an alias (`const f = loft; f(a, b, 30)`) walks past (found by the
 *  round-3 critic: the pull of the shared sketch silently moved from z0-5 to z30-35). A rebinding catches every way of reaching the tool,
 *  because the script runs inside with(scope) and a const of the same name shadows the tool for the whole script.
 *  Returns { map: sketchId -> offset the student gave it, calls: [[firstArgId, secondArgId, gap]...], errors }.
 *  If this run fails for any reason the caller gets map = null and the guard falls back to its conservative rule. */
export function neutralRun(src, { runScript }) {
  const g = globalThis;
  const saved = g.__blendCalls;
  g.__blendCalls = [];
  try {
    const pre = 'const __rec = (a, b, gap) => { globalThis.__blendCalls.push([a && a.id, b && b.id, gap]); return cuboid(1, 1, 1); };\nconst blend = __rec, loft = __rec;\n';
    const run = runScript(pre + src);
    const errors = run.errors.map((e) => e.message ?? String(e));
    const m = new Map();
    for (const f of run.doc.features) if (f.kind === 'sketch') m.set(f.id, f.offset ?? 0);
    return { map: errors.length ? null : m, calls: g.__blendCalls.slice(), errors };
  } finally { g.__blendCalls = saved; }
}

/** blend feature id -> [id of the sketch the student wrote first, id of the one written second], matched on the pair of sketch ids. */
export function argOrderOf(doc, calls) {
  const used = new Set(); const out = new Map();
  for (const f of doc.features) {
    if (f.kind !== 'blend' || f.targets?.length !== 2) continue;
    const key = [...f.targets].sort().join('|');
    const k = calls.findIndex((c, i) => !used.has(i) && [c[0], c[1]].sort().join('|') === key);
    if (k >= 0) { used.add(k); out.set(f.id, [calls[k][0], calls[k][1]]); }
  }
  return out;
}

export function guardedRun(src, { runScript, solveDoc, arc }) {
  const run = runScript(src);
  const scriptErrors = run.errors.map((e) => e.message ?? String(e));
  const doc = solveDoc({ version: 1, features: run.doc.features });
  const nz = neutralRun(src, { runScript });
  const argOrder = argOrderOf(doc, nz.calls);
  const verdicts = guardDoc(doc, { outlineOf: arc.outlineOf, neutral: nz.map, argOrder });
  return { run, doc, scriptErrors, neutral: nz, argOrder, verdicts };
}
