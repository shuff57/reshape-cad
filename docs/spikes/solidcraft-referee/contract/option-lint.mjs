// SPIKE, referee only (contract / extrude-pocket group). The interpreter (packages/script, read-only here) answers an option object with a key it
// does not know ({ twist: 5 }, { through: true } on a pull, { deep: true } on a pocket) with
//     "pull() takes a sketch and a height; the third argument (a { } object) was ignored. To move the result, use move(...)."
// and the script FAILS anyway. The sentence says the argument was ignored (it was not, the script stops) and never names the key. This reads the call
// out of the script text and says which key is wrong and what the call does take. The page runs it on exactly that interpreter error.
const PULL_KEYS = ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal'];
const POCKET_KEYS = [...PULL_KEYS, 'through'];

/** [{name, objText}] for every pull( / extrude( / pocket( call that has a { } as its last argument. */
function calls(text) {
  const out = [];
  const re = /\b(pull|extrude|pocket)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1; let i = re.lastIndex; const start = i;
    let objStart = -1; let objDepthAtStart = 0;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '{') { if (depth === 1) objStart = i; depth++; objDepthAtStart = depth; }
      else if (c === '}') { depth--; if (depth === 1 && objStart >= 0) out.push({ name: m[1], objText: text.slice(objStart, i + 1) }); }
    }
    void start; void objDepthAtStart;
  }
  return out;
}
/** the top-level keys of an object literal text */
function keysOf(obj) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 1) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(obj.slice(i));
      if (m && (i === 0 || /[{,\s]/.test(obj[i - 1]))) { keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}
/** A plain sentence for the interpreter's "was ignored" error, or null when this is not that error / no wrong key is found. */
export function explainOptionError(scriptText, errorMessage) {
  const m = /^(pull|extrude|pocket)\(\) takes .*\bargument \(a \{ \} object\) was ignored/.exec(errorMessage ?? '');
  if (!m) return null;
  const want = m[1] === 'extrude' ? 'pull' : m[1];
  for (const c of calls(scriptText)) {
    if ((c.name === 'extrude' ? 'pull' : c.name) !== want) continue;
    const allowed = want === 'pocket' ? POCKET_KEYS : PULL_KEYS;
    const bad = keysOf(c.objText).filter((k) => !allowed.includes(k));
    if (!bad.length) continue;
    const k = bad[0];
    const lead = want === 'pull' && k === 'through'
      ? 'through is a pocket option (cut all the way); a pull has nothing to cut through'
      : `${want}() has no option called ${k}`;
    return `${lead}. ${want}() takes ${allowed.join(', ')}.`;
  }
  return null;
}
