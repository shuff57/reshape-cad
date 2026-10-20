// SPIKE, referee only (patterns-mirror, round 6). A SOURCE-level front door for the guard layer, for the two language defects the translator cannot see
// because the script lowers a repeatAround of a pocket or hole into plain rotated pockets / holes (the ModelDoc then carries no trace of the angle).
// packages/script is not ours to edit in this spike, so the guard reads the call text.
//
//   repeatAround(x, { ..., angle: A })  (also its alias polarPattern)   with |A| >= 360 and A != 360   -> refused (720 and -360 mean a full turn to the script and something else to FreeCAD;
//                                                                         pm-polar-holes-720-x4 / -neg360-x4)
//   angle that is not a plain number expression (a variable, a call)   -> refused (the guard cannot check it)
//   options that are not written inline in the call (repeatAround(x, opts)) while the source mentions "angle" anywhere -> refused (same reason)
//
// Not covered, and labelled WRONG in the rows: a partial angle (0 < |A| < 360) on a pocket or hole is spaced angle/(count-1) while the same call on a whole
// shape is spaced angle/count (row 76). The whole-shape side is refused by the translator, so that part never builds; the pocket/hole side matches FreeCAD.
export const PREFLIGHT_SENTENCE = 'repeatAround(): an angle of 360 degrees or more (or a negative full turn) means something different for a pocket or hole than for a whole shape, so it is not available -- leave the angle out for a full turn, or give one under 360.';
export const PREFLIGHT_SENTENCE_VAR = 'repeatAround(): the angle has to be written as a plain number inside the call, for example { count: 4, angle: 90 }, so it can be checked.';

/** Index of the matching close bracket for the open bracket at `i` (skips strings), or -1. */
function matchClose(src, i) {
  const open = src[i]; const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0; let q = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k;
  }
  return -1;
}
/** Top-level split of an argument list on commas. */
function splitArgs(s) {
  const out = []; let depth = 0; let q = null; let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === '\\') { cur += s[++k] ?? ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('({['.includes(c)) depth++; else if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** Returns null when the call text is fine, else { sentence, why }. */
export function preflightScript(src) {
  const code = String(src).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\b(repeatAround|polarPattern)\b(?!\s*\()/.test(code) && /\bangle\b/.test(code)) return { sentence: PREFLIGHT_SENTENCE_VAR, why: 'repeatAround used without a direct call' };
  const re = /\b(?:repeatAround|polarPattern)\s*\(/g; let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1; const close = matchClose(code, open);
    if (close < 0) continue;
    const args = splitArgs(code.slice(open + 1, close));
    const opt = (args[1] ?? '').trim();
    if (!opt) continue;
    if (!opt.startsWith('{')) { if (/\bangle\b/.test(code)) return { sentence: PREFLIGHT_SENTENCE_VAR, why: 'options not inline' }; continue; }
    const inner = opt.slice(1, opt.lastIndexOf('}'));
    for (const prop of splitArgs(inner)) {
      const pm = /^\s*(?:["']?angle["']?)\s*:\s*([\s\S]*)$/.exec(prop);
      if (!pm) continue;
      const expr = pm[1].trim();
      if (!/^[-+*/().\d\s eE]+$/.test(expr)) return { sentence: PREFLIGHT_SENTENCE_VAR, why: `angle expression ${expr}` };
      let val; try { val = Function(`"use strict"; return (${expr});`)(); } catch { return { sentence: PREFLIGHT_SENTENCE_VAR, why: `angle expression ${expr}` }; }
      if (!Number.isFinite(val)) return { sentence: PREFLIGHT_SENTENCE_VAR, why: `angle ${expr}` };
      if (Math.abs(val) >= 360 && val !== 360) return { sentence: PREFLIGHT_SENTENCE, why: `angle ${val}` };
    }
  }
  return null;
}
