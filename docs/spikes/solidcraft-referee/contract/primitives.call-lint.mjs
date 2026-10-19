// SPIKE, referee only (contract / primitives group, round 3). Script-text half of the primitives pre-flight guard.
// The interpreter (packages/script, read-only here) accepts two things that change the part without a word:
//   1. a surplus value after the { } options object:  box(1, 2, 3, { at: [0,0,0] }, 99)   -> 99 is dropped, no error
//   2. a sides count with a fraction:                  prism(5.4, 10, 5)                    -> Math.round to 5, no error
// This reads the call out of the script text (strings and // comments skipped) and says which one it is, in the student's words.
// The page would run it before runScript; the real fix is one line in each primitive in reshape-script.ts.

const ARITY = { box: 3, cuboid: 3, cylinder: 2, sphere: 1, cone: 2, ring: 2, torus: 2, prism: 3, wedge: 3 };
const SHAPE = {
  box: 'width, depth and height', cuboid: 'width, depth and height', cylinder: 'across and tall', sphere: 'across', cone: 'across and tall',
  ring: 'across and tubeAcross', torus: 'across and tubeAcross', prism: 'sides, across and tall', wedge: 'width, depth and tall',
};

/** blank out strings and comments (same length) so brackets inside them are not counted */
export function mask(text) {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') out[i++] = ' '; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2; while (i < end) out[i++] = text[i - 1] === '\n' ? '\n' : ' '; continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; out[i++] = q; while (i < text.length && text[i] !== q) { if (text[i] === '\\') out[i++] = ' '; if (i < text.length) out[i++] = ' '; } if (i < text.length) out[i++] = q; continue; }
    i++;
  }
  return out.join('');
}

/** every call of a primitive: {name, args:[{text,start,end}], open, close} (top-level comma split) */
export function primitiveCalls(text) {
  const m = mask(text);
  const calls = [];
  const re = /(^|[^\w$.])(box|cuboid|cylinder|sphere|cone|ring|torus|prism|wedge)\s*\(/g;
  let mm;
  while ((mm = re.exec(m))) {
    const name = mm[2];
    const open = re.lastIndex - 1;
    let depth = 1; let i = open + 1; let argStart = i; const args = [];
    for (; i < m.length && depth > 0; i++) {
      const c = m[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; } else if (c === ',' && depth === 1) { args.push({ start: argStart, end: i }); argStart = i + 1; }
    }
    if (depth !== 0) continue; // unbalanced: the interpreter reports it
    if (m.slice(argStart, i).trim() !== '' || args.length) args.push({ start: argStart, end: i });
    calls.push({ name, open, close: i, args: args.map((a) => ({ ...a, text: text.slice(a.start, a.end).trim() })) });
  }
  return calls;
}

/** [{code, sentence}] for surplus values. The sentence uses the name the student typed. */
export function lintSurplusArgs(text) {
  const out = [];
  for (const c of primitiveCalls(text)) {
    const max = ARITY[c.name] + 1; // the sizes plus one { } of options
    if (c.args.length > max) {
      const extra = c.args.slice(max).map((a) => a.text);
      out.push({
        code: 'surplus-argument', call: c.name,
        sentence: `${c.name}() takes ${SHAPE[c.name]}, then at most one { } of options -- the extra value${extra.length > 1 ? 's' : ''} ${extra.join(', ')} would be ignored, so take ${extra.length > 1 ? 'them' : 'it'} out.`,
      });
    }
  }
  return out;
}

/**
 * prism sides must be a whole number. The interpreter rounds 5.4 to 5, 5.5 to 6, 2.6 to 3 and 12.4 to 12 without a word and keeps only the rounded
 * value in the document, so the check has to see the typed value. Round 3 probed with "+ 0.499" and "- 0.499", which MISSED 2.5, 2.6 and 12.4:
 * one of the two probes ran into the 3..12 range check, the script errored and the lint gave up. Round 4 asks the interpreter a question whose
 * answer is always in range: the first argument of this call is replaced (in the script itself, so variables and param() defined earlier still
 * resolve, and the typed expression is evaluated ONCE) by  ((v) => 4 + (|v - round(v)| > 1e-9 ? 5 : 0))(<typed>)  : 4 when whole, 9 when not.
 * A control run replaces it by 4. If the two documents differ, the typed value is not whole. Suggestions come from the same trick with floor and
 * ceil, clamped to 3..12.
 * `runSides(script)` -> array of the sides of every prism in the document, or null when the script does not run.
 */
export function lintPrismSides(text, runSides) {
  const out = [];
  for (const c of primitiveCalls(text)) {
    if (c.name !== 'prism' || !c.args.length) continue;
    const a = c.args[0];
    const sub = (expr) => `${text.slice(0, a.start)} ${expr} ${text.slice(a.end)}`;
    const ctl = runSides(sub('4'));
    const probe = runSides(sub(`((v) => 4 + (Math.abs(v - Math.round(v)) > 1e-9 ? 5 : 0))(${a.text})`));
    if (!ctl || !probe || ctl.join() === probe.join()) continue;
    const at = probe.findIndex((v, i) => v !== ctl[i]);
    const lo = runSides(sub(`((v) => Math.min(12, Math.max(3, Math.floor(v))))(${a.text})`));
    const hi = runSides(sub(`((v) => Math.min(12, Math.max(3, Math.ceil(v))))(${a.text})`));
    const l = lo?.[at] ?? 3; const h = hi?.[at] ?? 12;
    out.push({ code: 'prism-sides-fraction', call: 'prism', sentence: `prism() needs a whole number of sides, from 3 to 12 -- ${a.text} is not whole, so it would be rounded to a different shape than you typed; use a whole number such as ${l}${h !== l ? ` or ${h}` : ''}.` });
  }
  return out;
}

/**
 * cone(across, tall, third): the interpreter answers "cone's extras go in a { } object at the end ... You gave it 10." for a third number. That
 * sentence tells the student to wrap the number in { }, and no option takes it. The honest answer is that there is no flat-topped cone.
 */
export function lintConeSecondRadius(text) {
  const out = [];
  for (const c of primitiveCalls(text)) {
    if (c.name !== 'cone' || c.args.length < 3) continue;
    if (c.args[2].text.startsWith('{')) continue;
    out.push({ code: 'cone-second-radius', call: 'cone', sentence: `cone() makes a pointed cone from across and tall only -- the third value ${c.args[2].text} would be a second radius, and a flat-topped cone is not available.` });
  }
  return out;
}

/** every script-text refusal, in the order a student should fix them */
export function lintScript(text, runSides) {
  return [...lintConeSecondRadius(text), ...lintSurplusArgs(text), ...(runSides ? lintPrismSides(text, runSides) : [])];
}
