// SPIKE PROTOTYPE, referee only (round 4, move-turn). The interpreter (packages/script, read-only here) accepts move(shape, [x,y,z], { copy: 1 }) and
// { copy: 'yes' } and builds a plain CONSUMING move, with no sentence: the student asked for a copy and the original is gone. It also drops a 4th argument
// after the options object. This reads the call out of the script text (page layer, like option-lint.mjs and explain-script-error.mjs) and says what is wrong.
// lintMove(source) -> [{ line, sentence }]. Only literal values are judged: copy: true / false / a name or expression are left alone.
function splitTop(text) { // split on commas at depth 0
  const parts = []; let depth = 0; let cur = ''; let q = null;
  for (const ch of text) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
export function lintMove(source) {
  const out = []; const re = /\bmove\s*\(/g; let m;
  while ((m = re.exec(source))) {
    let depth = 1; let i = re.lastIndex; let q = null;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c; else if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    }
    const args = splitTop(source.slice(re.lastIndex, i - 1));
    const line = source.slice(0, m.index).split('\n').length;
    const opt = args[2];
    if (opt && opt.startsWith('{')) {
      const cm = /\bcopy\s*:\s*([^,}]+)/.exec(opt);
      if (cm) {
        const v = cm[1].trim();
        if (/^(['"`]).*\1$/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || v === 'null' || v === 'undefined') {
          out.push({ line, sentence: `move() needs copy: true or copy: false, but you wrote copy: ${v} -- write copy: true to keep the original and get a copy, or leave the option out to move the original itself.` });
        }
      }
      if (args.length > 3) out.push({ line, sentence: `move() takes a shape, an offset and one { } of options, but you gave it ${args.length - 3} more argument${args.length - 3 > 1 ? 's' : ''} (${args.slice(3).join(', ')}) -- remove ${args.length - 3 > 1 ? 'them' : 'it'}.` });
    }
  }
  return out;
}
